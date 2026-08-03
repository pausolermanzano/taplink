// functions/panel-set-recomendaciones.js
// Guarda el número de recomendaciones de un local (otros negocios que ha
// convencido de comprar Taplink), a petición de Marc o Pau desde el
// panel. Cada recomendación da 3 meses de mensualidad gratis, pero
// aplicar ese descuento se hace a mano (pausando el cobro esos meses o
// desde Stripe) — esto solo lleva la cuenta de cuántas lleva.
//
// Protegido igual que el resto de rutas del panel: requiere la
// cabecera "x-panel-password" con ADMIN_PASSWORD.

import { aplicarRecomendaciones } from './_lib/kv.js';
import { ampliarPausaMeses } from './_lib/stripe.js';

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
  const recomendaciones = payload && payload.recomendaciones;
  if (!slug) return json({ error: 'Falta slug' }, 400);

  let resultado;
  try {
    resultado = await aplicarRecomendaciones(env, slug, recomendaciones);
  } catch (err) {
    return json({ error: 'Error interno: ' + (err && err.message) }, 500);
  }
  if (!resultado) return json({ error: 'No existe ningún local con ese slug.' }, 404);

  // Si ya tiene mensualidad activa, aplicamos los meses gratis nuevos
  // AHORA MISMO en Stripe (pausamos el cobro esos meses). Si todavía
  // no tiene suscripción (venta en efectivo sin activar aún), los
  // meses ya han quedado guardados como pendientes — se aplican solos
  // en cuanto el negocio active su mensualidad (ver webhook-nfc.js).
  if (resultado.mesesNuevos > 0 && resultado.subscriptionId) {
    try {
      await ampliarPausaMeses(env, resultado.subscriptionId, resultado.mesesNuevos);
    } catch (err) {
      return json({
        ok: true,
        recomendaciones: resultado.local.recomendaciones,
        aviso: 'Se ha guardado el número, pero no se ha podido pausar el cobro en Stripe automáticamente: ' + (err && err.message)
      });
    }
  }

  return json({
    ok: true,
    recomendaciones: resultado.local.recomendaciones,
    meses_gratis_pendientes: resultado.local.meses_gratis_pendientes || 0
  });
}
