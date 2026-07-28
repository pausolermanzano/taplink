// functions/panel-datos.js
// Devuelve el listado completo de locales (placas NFC) guardado en Airtable,
// para pintarlo en el panel privado (panel.html). Solo lectura.
//
// Protegido por una contraseña compartida (ADMIN_PASSWORD), que el panel
// envía en la cabecera "x-panel-password". No expone nunca la clave de
// Airtable al navegador: esta función hace de intermediario.

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  const password = request.headers.get('x-panel-password');
  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return json({ error: 'No autorizado' }, 401);
  }

  const table = env.AIRTABLE_TABLE_NAME || 'Locales';
  const baseUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`;
  const headers = { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` };

  try {
    let records = [];
    let offset = null;
    do {
      const url = baseUrl + (offset ? `?offset=${offset}` : '');
      const res = await fetch(url, { headers });
      if (!res.ok) return json({ error: 'Error consultando Airtable' }, 500);
      const data = await res.json();
      records = records.concat(data.records || []);
      offset = data.offset || null;
    } while (offset);

    const locales = records
      .map((r) => ({
        id: r.id,
        nombre_local: r.fields.nombre_local || '',
        slug: r.fields.slug || '',
        estado: r.fields.estado || '',
        review_url: r.fields.review_url || '',
        stripe_subscription_id: r.fields.stripe_subscription_id || '',
        creado: r.createdTime
      }))
      .sort((a, b) => new Date(b.creado) - new Date(a.creado));

    return json({ locales });
  } catch (err) {
    return json({ error: 'Error interno' }, 500);
  }
}
