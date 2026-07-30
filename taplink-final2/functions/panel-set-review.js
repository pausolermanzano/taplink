// functions/panel-set-review.js
// Corrige a mano, desde el panel privado (panel.html), el enlace de
// reseñas de un local concreto. Protegido igual que el resto de rutas
// del panel: requiere la cabecera "x-panel-password" con ADMIN_PASSWORD.

import { setReviewUrl } from './_lib/kv.js';

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
  const reviewUrl = (payload && payload.reviewUrl || '').trim();
  if (!slug) return json({ error: 'Falta slug' }, 400);
  if (!/^https?:\/\//i.test(reviewUrl)) return json({ error: 'El enlace debe empezar por http:// o https://' }, 400);

  try {
    const local = await setReviewUrl(env, slug, reviewUrl);
    if (!local) return json({ error: 'No existe ningún local con ese slug.' }, 404);
    return json({ ok: true });
  } catch (err) {
    return json({ error: 'Error interno: ' + (err && err.message) }, 500);
  }
}
