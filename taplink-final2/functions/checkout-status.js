// functions/checkout-status.js
// El frontend llama aquí justo al volver de Stripe (?checkout=success&
// session_id=...) para obtener el código TPK y el enlace de la placa
// REALES — los mismos que ya se han guardado en Cloudflare KV y enviado
// por email — en vez de inventar un código nuevo en el navegador.
//
// Como el webhook de Stripe puede tardar uno o dos segundos en procesar
// el pago, esta ruta puede devolver { ready:false } justo al principio;
// el frontend debe reintentar un par de veces con una pequeña espera.

import { getLocalBySlug } from './_lib/kv.js';

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);

  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId) return json({ error: 'Falta session_id' }, 400);
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'Falta STRIPE_SECRET_KEY' }, 500);

  try {
    const stripeRes = await fetch(
      'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId),
      { headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY } }
    );
    const session = await stripeRes.json();
    if (!stripeRes.ok) {
      const msg = (session && session.error && session.error.message) || 'No se pudo consultar la sesión.';
      return json({ error: msg }, 500);
    }

    const meta = session.metadata || {};
    const email = session.customer_email || (session.customer_details && session.customer_details.email) || '';

    if (!meta.slug) return json({ ready: false });

    const local = await getLocalBySlug(env, meta.slug);
    if (!local) {
      // El webhook todavía no ha procesado este pago (normalmente tarda
      // solo un par de segundos) — el frontend debe reintentar.
      return json({ ready: false });
    }

    return json({
      ready: true,
      code: local.codigo || meta.code || '',
      negocio: local.nombre_local || meta.negocio || '',
      slug: local.slug,
      nfcLink: url.origin + '/go/' + local.slug,
      email
    });
  } catch (err) {
    return json({ error: 'No se pudo conectar con Stripe.' }, 500);
  }
}
