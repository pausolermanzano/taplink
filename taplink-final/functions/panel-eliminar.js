// functions/panel-eliminar.js
// Elimina un cliente/local de forma PERMANENTE desde el panel privado
// (panel.html). Protegido igual que panel-datos.js: requiere la
// cabecera "x-panel-password" con ADMIN_PASSWORD.
//
// No cancela nada en Stripe — si el cliente sigue teniendo una
// suscripción activa, hay que cancelarla aparte desde el Dashboard de
// Stripe. Esto solo borra el registro guardado en Taplink (KV).

import { deleteLocal } from './_lib/kv.js';

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

  try {
    const borrado = await deleteLocal(env, slug);
    if (!borrado) return json({ error: 'No existe ningún local con ese slug.' }, 404);
    return json({ ok: true });
  } catch (err) {
    return json({ error: 'Error interno: ' + (err && err.message) }, 500);
  }
}
