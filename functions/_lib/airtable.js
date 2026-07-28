// functions/_lib/airtable.js
// Funciones para leer y actualizar los "locales" (placas NFC) guardados en
// Airtable. Airtable actúa como base de datos "no-code": Marc y Pau pueden
// ver y editar cada fila directamente desde la interfaz web de Airtable.
//
// El prefijo "_" en el nombre de la carpeta hace que Cloudflare Pages NO
// la publique como una ruta pública — solo se usa como módulo interno,
// importado desde las funciones reales (go/[slug].js, webhook-nfc.js).

function baseUrl(env) {
  const table = env.AIRTABLE_TABLE_NAME || 'Locales';
  return `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`;
}

function authHeaders(env) {
  return {
    Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
    'Content-Type': 'application/json'
  };
}

export async function getLocalBySlug(env, slug) {
  const formula = encodeURIComponent(`{slug} = "${slug}"`);
  const res = await fetch(`${baseUrl(env)}?filterByFormula=${formula}&maxRecords=1`, {
    headers: authHeaders(env)
  });
  if (!res.ok) throw new Error(`Airtable error (getLocalBySlug): ${res.status}`);
  const data = await res.json();
  return data.records[0] || null;
}

export async function getLocalBySubscriptionId(env, subscriptionId) {
  const formula = encodeURIComponent(`{stripe_subscription_id} = "${subscriptionId}"`);
  const res = await fetch(`${baseUrl(env)}?filterByFormula=${formula}&maxRecords=1`, {
    headers: authHeaders(env)
  });
  if (!res.ok) throw new Error(`Airtable error (getLocalBySubscriptionId): ${res.status}`);
  const data = await res.json();
  return data.records[0] || null;
}

export async function createLocal(env, fields) {
  const res = await fetch(baseUrl(env), {
    method: 'POST',
    headers: authHeaders(env),
    body: JSON.stringify({ fields })
  });
  if (!res.ok) throw new Error(`Airtable error (createLocal): ${res.status}`);
  return res.json();
}

export async function setEstado(env, recordId, estado) {
  const res = await fetch(`${baseUrl(env)}/${recordId}`, {
    method: 'PATCH',
    headers: authHeaders(env),
    body: JSON.stringify({ fields: { estado } })
  });
  if (!res.ok) throw new Error(`Airtable error (setEstado): ${res.status}`);
  return res.json();
}
