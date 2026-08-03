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

// Se llama en cada evento "invoice.paid" de Stripe: suma el importe de
// esa cuota al acumulado histórico del local (para verlo en el panel:
// "cuánto lleva pagado en total") y guarda el importe de la última
// cuota (para ver cuánto paga ahora mismo — 7,99€, o más si tiene un
// precio a medida por volumen).
export async function sumarPago(env, slug, amountCents, intervalo) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return null;
  local.total_pagado = (local.total_pagado || 0) + (amountCents || 0);
  local.ultima_cuota = amountCents || 0;
  if (intervalo) local.ultima_cuota_intervalo = intervalo;
  local.ultimo_pago_fecha = new Date().toISOString();
  await env.LOCALES_KV.put(`local:${slug}`, JSON.stringify(local));
  return local;
}

// Actualiza el número de recomendaciones. Los meses pendientes se
// RECALCULAN siempre desde cero (recomendaciones × 3 − meses ya
// aplicados de verdad en Stripe), en vez de ir sumando — así, si
// corriges el número hacia abajo por error, el aviso de "meses
// pendientes" baja también, en vez de quedarse colgado con un valor
// antiguo. Lo único que NO se deshace nunca es una pausa que YA se
// haya aplicado en Stripe (eso habría que revertirlo a mano si hiciera
// falta) — pero mientras el negocio no tenga mensualidad activa, no
// hay nada aplicado todavía, así que corregir el número es 100% seguro.
export async function aplicarRecomendaciones(env, slug, nuevoValor) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return null;
  const anterior = local.recomendaciones || 0;
  const valor = Math.max(0, parseInt(nuevoValor, 10) || 0);
  const deltaRecomendaciones = valor - anterior;
  const mesesNuevos = deltaRecomendaciones > 0 ? deltaRecomendaciones * 3 : 0;
  const mesesAplicados = local.meses_aplicados || 0;

  local.recomendaciones = valor;
  local.meses_gratis_pendientes = Math.max(0, (valor * 3) - mesesAplicados);
  await env.LOCALES_KV.put(`local:${slug}`, JSON.stringify(local));

  return { local, mesesNuevos, subscriptionId: local.stripe_subscription_id || null };
}

// Registra que se han aplicado N meses de verdad en Stripe (ya sea al
// momento, o al activar la mensualidad de un local que tenía meses
// pendientes) y recalcula lo que queda pendiente a partir de ahí. Esto
// es lo que hace que, si luego se corrige el número de recomendaciones
// hacia abajo, el pendiente se recalcule bien en vez de quedarse
// colgado con un valor antiguo.
export async function marcarMesesAplicados(env, slug, mesesAplicadosAhora) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return null;
  local.meses_aplicados = (local.meses_aplicados || 0) + (mesesAplicadosAhora || 0);
  local.meses_gratis_pendientes = Math.max(0, ((local.recomendaciones || 0) * 3) - local.meses_aplicados);
  await env.LOCALES_KV.put(`local:${slug}`, JSON.stringify(local));
  return local;
}

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

// Busca un local por su código (TPK-XXXXXX) — el que usa el negocio para
// identificarse en "Ya tengo mi placa" cuando va a activar su
// mensualidad. Usa un índice propio (codigo:{codigo} -> slug) igual que
// ya se hace con las suscripciones de Stripe, para no tener que recorrer
// todos los locales en cada intento de pago.
export async function getLocalByCodigo(env, codigo) {
  const slug = await env.LOCALES_KV.get(`codigo:${codigo}`);
  if (!slug) return null;
  const local = await getLocalBySlug(env, slug);
  return local ? { ...local, slug } : null;
}

export async function createLocal(env, fields) {
  const record = { ...fields, creado: new Date().toISOString() };
  await env.LOCALES_KV.put(`local:${fields.slug}`, JSON.stringify(record));
  // Solo se escriben estos índices si hay algo real que indexar: un
  // stripe_subscription_id o un codigo vacíos pisarían siempre la misma
  // clave ("sub:" o "codigo:") y cada local nuevo sin uno de los dos
  // borraría el índice del anterior que tampoco lo tuviera.
  if (fields.stripe_subscription_id) {
    await env.LOCALES_KV.put(`sub:${fields.stripe_subscription_id}`, fields.slug);
  }
  if (fields.codigo) {
    await env.LOCALES_KV.put(`codigo:${fields.codigo}`, fields.slug);
  }
  return record;
}

// Vincula una suscripción de Stripe nueva a un local que YA EXISTÍA sin
// ninguna (el caso de venta presencial: Marc/Pau lo crean desde el panel
// cuando entregan la placa, y semanas o meses después el negocio activa
// su mensualidad desde "Ya tengo mi placa"). A diferencia de createLocal,
// esto no crea un registro nuevo: actualiza el que ya estaba.
export async function linkSubscription(env, slug, subscriptionId) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return null;
  local.stripe_subscription_id = subscriptionId;
  local.estado = 'activo';
  await env.LOCALES_KV.put(`local:${slug}`, JSON.stringify(local));
  await env.LOCALES_KV.put(`sub:${subscriptionId}`, slug);
  return local;
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
export async function setReviewUrl(env, slug, reviewUrl) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return null;
  local.review_url = reviewUrl;
  await env.LOCALES_KV.put(`local:${slug}`, JSON.stringify(local));
  return local;
}

// Elimina un local de forma permanente y sin vuelta atrás: borra tanto su
// registro (local:{slug}) como el índice que lo relaciona con su
// suscripción de Stripe (sub:{stripe_subscription_id}). No cancela la
// suscripción en Stripe (eso se hace aparte, desde el propio Stripe, si
// hace falta) — solo borra los datos guardados en Taplink.
export async function deleteLocal(env, slug) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return false;
  await env.LOCALES_KV.delete(`local:${slug}`);
  if (local.stripe_subscription_id) {
    await env.LOCALES_KV.delete(`sub:${local.stripe_subscription_id}`);
  }
  if (local.codigo) {
    await env.LOCALES_KV.delete(`codigo:${local.codigo}`);
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
