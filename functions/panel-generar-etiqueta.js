// functions/panel-generar-etiqueta.js
// Genera y COMPRA una etiqueta de envío con Shippo para un pedido
// concreto, a petición de Marc desde el panel (botón "📦 Generar
// etiqueta"). No es automático: se ejecuta solo cuando se llama a este
// endpoint, para poder revisar la dirección antes de gastar dinero en
// la etiqueta real.
//
// Protegido igual que el resto de rutas del panel: requiere la
// cabecera "x-panel-password" con ADMIN_PASSWORD.

import { getLocalBySlug, setEnvioLabel } from './_lib/kv.js';
import { comprarEtiqueta } from './_lib/shippo.js';

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  const password = request.headers.get('x-panel-password');
  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return json({ error: 'No autorizado' }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ error: 'Petición inválida.' }, 400);
  }

  const slug = (payload && payload.slug || '').trim();
  if (!slug) return json({ error: 'Falta slug' }, 400);

  const local = await getLocalBySlug(env, slug);
  if (!local) return json({ error: 'No existe ningún local con ese slug.' }, 404);

  try {
    const etiqueta = await comprarEtiqueta(env, local);
    await setEnvioLabel(env, slug, etiqueta);
    return json({ ok: true, etiqueta });
  } catch (err) {
    return json({ error: (err && err.message) || 'Error desconocido al generar la etiqueta.' }, 500);
  }
}
