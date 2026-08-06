// functions/panel-registrar-cobro.js
// Permite al admin anotar un cobro manual (efectivo, Bizum, transferencia)
// desde el panel -- para ventas presenciales o cualquier pago que no pase
// por Stripe. Los cobros por Stripe se registran solos (ver webhook-nfc.js).
// Protegido igual que el resto de rutas del panel.

import { registrarCobro } from './_lib/kv.js';

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
  const importe = Number(payload && payload.importe);
  const metodo = ((payload && payload.metodo) || 'efectivo').trim();
  const nota = ((payload && payload.nota) || '').trim();

  if (!slug) return json({ error: 'Falta slug' }, 400);
  if (!importe || importe <= 0) return json({ error: 'El importe tiene que ser un número mayor que 0.' }, 400);

  const local = await registrarCobro(env, slug, { importe, moneda: 'eur', metodo, nota });
  if (!local) return json({ error: 'No existe ningún local con ese slug.' }, 404);

  return json({ ok: true, total_cobrado: local.total_cobrado });
}
