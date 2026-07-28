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
  await env.LOCALES_KV.put(`sub:${fields.stripe_subscription_id}`, fields.slug);
  return record;
}

export async function setEstado(env, slug, estado) {
  const local = await getLocalBySlug(env, slug);
  if (!local) return null;
  local.estado = estado;
  await env.LOCALES_KV.put(`local:${slug}`, JSON.stringify(local));
  return local;
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
