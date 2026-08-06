// functions/panel-set-precio.js
// Permite al admin fijar o corregir el precio mensual de un local (por
// ejemplo, si se le hizo un descuento, o para clientes de venta manual
// que todavía no tienen mensualidad de Stripe). Protegido igual que el
// resto de rutas del panel.

import { setPrecioMensual } from './_lib/kv.js';

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
  const precio = Number(payload && payload.precio);

  if (!slug) return json({ error: 'Falta slug' }, 400);
  if (isNaN(precio) || precio < 0) return json({ error: 'El precio tiene que ser un número.' }, 400);

  const local = await setPrecioMensual(env, slug, precio);
  if (!local) return json({ error: 'No existe ningún local con ese slug.' }, 404);

  return json({ ok: true });
}
