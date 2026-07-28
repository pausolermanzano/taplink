// functions/panel-set-estado.js
// Permite cambiar a mano el estado de un local (activo/pausado/cancelado)
// desde el panel privado (panel.html), sin esperar a que Stripe avise de
// nada. Protegido con la misma contraseña que panel-datos.js.
//
// POST /panel-set-estado
// Body: { "slug": "bar-nou-x7k2", "estado": "pausado" }
// Header: x-panel-password: <ADMIN_PASSWORD>

import { setEstado, getLocalBySlug } from './_lib/kv.js';

const ESTADOS_VALIDOS = ['activo', 'pausado', 'cancelado'];

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

  const slug = payload && payload.slug;
  const estado = payload && payload.estado;

  if (!slug) return json({ error: 'Falta el slug del local.' }, 400);
  if (!ESTADOS_VALIDOS.includes(estado)) {
    return json({ error: 'Estado no válido. Usa: ' + ESTADOS_VALIDOS.join(', ') }, 400);
  }

  const existente = await getLocalBySlug(env, slug);
  if (!existente) return json({ error: 'No existe ningún local con ese slug.' }, 404);

  const actualizado = await setEstado(env, slug, estado);
  return json({ ok: true, local: actualizado });
}
