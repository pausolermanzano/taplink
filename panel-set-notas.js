// functions/panel-set-notas.js
// Guarda una nota de texto libre sobre un local -- el "cualquier
// variable" que no encaja en ningún otro campo del panel (acuerdos
// especiales, recordatorios, lo que haga falta). Protegido igual que el
// resto de rutas del panel.

import { setNotas } from './_lib/kv.js';

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

  const slug = ((payload && payload.slug) || '').trim();
  const notas = ((payload && payload.notas) || '').toString();

  if (!slug) return json({ error: 'Falta slug' }, 400);

  const local = await setNotas(env, slug, notas);
  if (!local) return json({ error: 'No existe ningún local con ese slug.' }, 404);

  return json({ ok: true });
}
