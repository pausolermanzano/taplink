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
