// functions/_lib/kv.js
// Guarda y consulta los "locales" (placas NFC) en Cloudflare KV — la base
// de datos gratuita de Cloudflare, incluida en la misma cuenta donde ya
// está la web, sin registro aparte y sin límites de prueba.
//
// Requiere un namespace de KV creado en Cloudflare y enlazado al proyecto
// de Pages con el nombre de variable LOCALES_KV (ver NFC-REDIRECT-SETUP.md).
//
// Estructura de claves:
//   local:{slug}               -> JSON con los datos del local
//   sub:{stripe_subscription_id} -> el slug al que pertenece esa suscripción

export async function getLocalBySlug(env, slug) {
  const raw = await env.LOCALES_KV.get(`local:${slug}`);
  if (!raw) return null;
  return JSON.parse(raw);
}

export async function getLocalBySubscriptionId(env, subscriptionId) {
  const slug = await env.LOCALES_KV.get(`sub:${subscriptionId}`);
  if (!slug) return null;
  const local = await getLocalBySlug(env, slug);
  return local ? { ...local, slug } : null;
}

// No hay un índice codigo:{codigo} dedicado (los códigos TPK-XXXXXX son
// pocos en volumen), así que se busca recorriendo todos los locales. Se
// usa para comprobar colisiones al generar un código nuevo (panel-crear-
// manual.js) y para encontrar el local al activar la mensualidad desde
// /ya-tengo-mi-placa.html (create-checkout-session-mensualidad.js).
export async function getLocalByCodigo(env, codigo) {
  const locales = await listLocales(env);
  return locales.find(l => l.codigo === codigo) || null;
}

// Suma o corrige el número de recomendaciones de un local (otros
// negocios que ha convencido de comprar Taplink). Cada recomendación
// NUEVA (por encima de las que ya tenía) da 3 meses gratis, que se
// guardan en meses_gratis_pendientes hasta que se aplican de verdad en
// Stripe (ver marcarMesesAplicados) o hasta que el negocio activa su
// mensualidad por primera vez (venta en efectivo).
export async function aplicarRecomendaciones(env, slug, recomendaciones) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return null;
  const anterior = local.recomendaciones || 0;
  const nuevo = Math.max(0, Number(recomendaciones) || 0);
  const mesesNuevos = nuevo > anterior ? (nuevo - anterior) * 3 : 0;
  local.recomendaciones = nuevo;
  local.meses_gratis_pendientes = (local.meses_gratis_pendientes || 0) + mesesNuevos;
  await env.LOCALES_KV.put(`local:${slug}`, JSON.stringify(local));
  return { local, mesesNuevos, subscriptionId: local.stripe_subscription_id || null };
}

// Descuenta de meses_gratis_pendientes los meses que ya se han aplicado
// de verdad (pausando el cobro en Stripe), para no volver a aplicarlos
// dos veces si se repite la operación.
export async function marcarMesesAplicados(env, slug, mesesAplicados) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return null;
  local.meses_gratis_pendientes = Math.max(0, (local.meses_gratis_pendientes || 0) - (Number(mesesAplicados) || 0));
  await env.LOCALES_KV.put(`local:${slug}`, JSON.stringify(local));
  return local;
}

export async function createLocal(env, fields) {
  const record = { ...fields, creado: new Date().toISOString() };
  await env.LOCALES_KV.put(`local:${fields.slug}`, JSON.stringify(record));
  // Los locales creados a mano (venta en persona) no tienen suscripción de
  // Stripe real -- si guardáramos sub:"" para todos, el segundo cliente
  // manual pisaría el índice del primero. Solo se guarda el índice sub:{id}
  // cuando hay un ID de verdad.
  if (fields.stripe_subscription_id) {
    await env.LOCALES_KV.put(`sub:${fields.stripe_subscription_id}`, fields.slug);
  }
  return record;
}

export async function setEstado(env, slug, estado) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return null;
  local.estado = estado;
  await env.LOCALES_KV.put(`local:${slug}`, JSON.stringify(local));
  return local;
}

// Guarda el motivo exacto por el que ha fallado el envío de un email (de
// confirmación o de notificación interna) directamente en el registro del
// local, para poder verlo en el panel (panel.html) sin tener que bucear en
// los logs de Cloudflare ni en Resend. Se sobreescribe en cada intento: solo
// queda el error más reciente.
export async function setEmailError(env, slug, tipo, mensaje) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return null;
  local.email_errors = local.email_errors || {};
  local.email_errors[tipo] = { mensaje: String(mensaje || ''), fecha: new Date().toISOString() };
  await env.LOCALES_KV.put(`local:${slug}`, JSON.stringify(local));
  return local;
}

// Cambia el estado A MANO desde el panel: marca manual=true para que los
// eventos automáticos de Stripe (pagos, renovaciones...) dejen de tocar
// este local hasta que alguien vuelva a poner "Automático" desde el panel.
export async function setEstadoManual(env, slug, estado) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return null;
  local.estado = estado;
  local.manual = true;
  await env.LOCALES_KV.put(`local:${slug}`, JSON.stringify(local));
  return local;
}

// Devuelve el control a Stripe: el próximo evento de pago/suscripción que
// llegue ya podrá volver a cambiar el estado de este local con normalidad.
export async function liberarManual(env, slug) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return null;
  local.manual = false;
  await env.LOCALES_KV.put(`local:${slug}`, JSON.stringify(local));
  return local;
}

// Guarda los datos de la etiqueta de envío generada con Shippo
// (tracking, link del PDF, transportista) en el registro del local,
// para poder verla y reimprimirla desde el panel sin volver a Shippo.
export async function setEnvioLabel(env, slug, datos) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return null;
  local.envio_label = {
    tracking_number: datos.trackingNumber || '',
    tracking_url: datos.trackingUrl || '',
    label_url: datos.labelUrl || '',
    carrier: datos.carrier || '',
    servicio: datos.servicio || '',
    precio: datos.precio || '',
    fecha: new Date().toISOString()
  };
  await env.LOCALES_KV.put(`local:${slug}`, JSON.stringify(local));
  return local;
}

// Permite corregir a mano, desde el panel, el enlace de reseñas de un
// local concreto — por si la resolución automática con Google Places no
// ha acertado para ese negocio en particular (fichas nuevas o
// incompletas en Google, homónimos, etc.).
// Guarda el enlace de reseñas. Cuando lo pone el ADMIN desde el panel
// (bloquear=true), queda "bloqueado": el cliente ya no podrá pisarlo
// desde mi-resena.html hasta que el admin lo desbloquee. Cuando lo pone
// el propio cliente (bloquear=false, por defecto), no se toca el bloqueo.
export async function setReviewUrl(env, slug, reviewUrl, bloquear) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return null;
  local.review_url = reviewUrl;
  if (bloquear) local.review_bloqueado = true;
  await env.LOCALES_KV.put(`local:${slug}`, JSON.stringify(local));
  return local;
}

// Permite al admin desbloquear un enlace (para que el cliente pueda
// volver a configurarlo él mismo desde mi-resena.html) sin tener que
// tocar el enlace en sí.
export async function setReviewBloqueado(env, slug, bloqueado) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return null;
  local.review_bloqueado = !!bloqueado;
  await env.LOCALES_KV.put(`local:${slug}`, JSON.stringify(local));
  return local;
}

// Elimina un local de forma permanente y sin vuelta atrás: borra tanto su
// registro (local:{slug}) como el índice que lo relaciona con su
// suscripción de Stripe (sub:{stripe_subscription_id}). No cancela la
// suscripción en Stripe (eso se hace aparte, desde el propio Stripe, si
// hace falta) — solo borra los datos guardados en Taplink.
// Añade un cobro al historial de un local (tanto si viene de Stripe como
// si lo registra el admin a mano por un pago en efectivo/Bizum/etc.) y
// mantiene el total acumulado. importe siempre en euros (no céntimos).
export async function registrarCobro(env, slug, { importe, moneda, metodo, nota }) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return null;
  const cobro = {
    fecha: new Date().toISOString(),
    importe: Number(importe) || 0,
    moneda: moneda || 'eur',
    metodo: metodo || 'otro',
    nota: nota || ''
  };
  local.pagos = Array.isArray(local.pagos) ? local.pagos : [];
  local.pagos.push(cobro);
  // Los locales llevan años activos y esto podría crecer sin límite --
  // nos quedamos con los últimos 200 cobros (de sobra para cualquier
  // cliente de Taplink) para que el registro en KV no crezca sin freno.
  if (local.pagos.length > 200) local.pagos = local.pagos.slice(-200);
  local.total_cobrado = (Number(local.total_cobrado) || 0) + cobro.importe;
  await env.LOCALES_KV.put(`local:${slug}`, JSON.stringify(local));
  return local;
}

export async function setPrecioMensual(env, slug, precio) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return null;
  local.precio_mensual = Number(precio) || 0;
  await env.LOCALES_KV.put(`local:${slug}`, JSON.stringify(local));
  return local;
}

// Guarda cualquier nota libre del admin sobre el local (texto libre,
// para lo que no encaje en ningún otro campo).
export async function setNotas(env, slug, notas) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return null;
  local.notas = notas || '';
  await env.LOCALES_KV.put(`local:${slug}`, JSON.stringify(local));
  return local;
}

// Vincula una suscripción de Stripe nueva a un local que YA EXISTÍA (caso
// de una venta manual que activa la mensualidad después, desde
// /ya-tengo-mi-placa.html). A diferencia de createLocal, aquí el local ya
// tiene slug e historial -- solo hay que guardar el ID de suscripción y
// el índice sub:{id} para que los eventos futuros de Stripe (facturas,
// bajas, etc.) lo encuentren.
export async function vincularSuscripcion(env, slug, subscriptionId) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return null;
  local.stripe_subscription_id = subscriptionId;
  local.origen = 'stripe';
  await env.LOCALES_KV.put(`local:${slug}`, JSON.stringify(local));
  await env.LOCALES_KV.put(`sub:${subscriptionId}`, slug);
  return local;
}

// Elimina un local de forma permanente y sin vuelta atrás: borra tanto su
// registro principal como el índice por suscripción de Stripe, si tenía.
export async function deleteLocal(env, slug) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return false;
  await env.LOCALES_KV.delete(`local:${slug}`);
  if (local.stripe_subscription_id) {
    await env.LOCALES_KV.delete(`sub:${local.stripe_subscription_id}`);
  }
  return true;
}

export async function listLocales(env) {
  const locales = [];
  let cursor;
  do {
    const page = await env.LOCALES_KV.list({ prefix: 'local:', cursor });
    for (const key of page.keys) {
      const raw = await env.LOCALES_KV.get(key.name);
      if (raw) locales.push({ slug: key.name.replace('local:', ''), ...JSON.parse(raw) });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return locales.sort((a, b) => new Date(b.creado || 0) - new Date(a.creado || 0));
}
