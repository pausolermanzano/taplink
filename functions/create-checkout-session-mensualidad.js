// functions/create-checkout-session-mensualidad.js
// Crea una sesión de Stripe Checkout SOLO para el plan de gestión
// (mensual o anual) — sin ninguna placa, porque este endpoint es el que
// llama /ya-tengo-mi-placa.html: negocios a los que Marc o Pau ya les
// han entregado la placa en persona y cobrado en efectivo, y que ahora
// activan aquí el cobro recurrente de la mensualidad.
//
// A diferencia de create-checkout-session.js (compra online completa),
// aquí NO se genera un slug ni un código nuevos: el negocio ya tiene los
// suyos (se los dio el comercial al entregarle la placa), y hay que
// enlazar la suscripción nueva a ESE registro que ya existe en KV — lo
// hace el webhook (webhook-nfc.js) al recibir checkout.session.completed,
// buscando el local por el mismo slug que viaja aquí en el metadata.
//
// Requiere STRIPE_SECRET_KEY, igual que create-checkout-session.js.

import { getLocalByCodigo } from './_lib/kv.js';

const PLAN = {
  mensual: { name: 'Plan de gestión — mensual', price: 799, interval: 'month' },
  anual: { name: 'Plan de gestión — anual', price: 7900, interval: 'year' }
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: 'Falta configurar STRIPE_SECRET_KEY en Cloudflare Pages.' }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ error: 'Petición inválida.' }, 400);
  }

  const codigo = ((payload && payload.codigo) || '').trim();
  const email = ((payload && payload.email) || '').trim();
  const chosenPlan = PLAN[payload && payload.plan] ? payload.plan : 'mensual';
  const planData = PLAN[chosenPlan];

  if (!codigo) return json({ error: 'Falta el código de tu placa.' }, 400);
  if (!email) return json({ error: 'Falta tu email.' }, 400);

  const local = await getLocalByCodigo(env, codigo);
  if (!local) {
    return json({ error: 'No hemos encontrado ninguna placa con ese código. Revísalo o escríbenos por WhatsApp.' }, 404);
  }
  if (local.stripe_subscription_id) {
    return json({ error: 'Esta placa ya tiene una mensualidad activada. Si crees que es un error, escríbenos por WhatsApp.' }, 409);
  }

  const origin = new URL(request.url).origin;

  const body = new URLSearchParams();
  body.set('mode', 'subscription');
  body.append('payment_method_types[]', 'card');
  body.set('customer_email', email);
  body.set('success_url', origin + '/ya-tengo-mi-placa.html?activado=1');
  body.set('cancel_url', origin + '/ya-tengo-mi-placa.html?codigo=' + encodeURIComponent(codigo));
  body.set('allow_promotion_codes', 'true');
  body.set('metadata[negocio]', local.nombre_local || '');
  body.set('metadata[plan]', chosenPlan);
  body.set('metadata[slug]', local.slug);
  body.set('metadata[codigo]', codigo);
  body.set('subscription_data[metadata][negocio]', local.nombre_local || '');
  body.set('subscription_data[metadata][slug]', local.slug);
  body.set('subscription_data[metadata][codigo]', codigo);

  body.set('line_items[0][price_data][currency]', 'eur');
  body.set('line_items[0][price_data][product_data][name]', planData.name);
  body.set('line_items[0][price_data][unit_amount]', String(planData.price));
  body.set('line_items[0][price_data][recurring][interval]', planData.interval);
  body.set('line_items[0][quantity]', '1');

  try {
    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    let data;
    try {
      data = await stripeRes.json();
    } catch (e) {
      return json({ error: 'Respuesta inválida de Stripe.' }, 500);
    }

    if (!stripeRes.ok) {
      const msg = (data && data.error && data.error.message) || 'Error creando la sesión de pago.';
      return json({ error: msg }, 500);
    }

    return json({ url: data.url });
  } catch (err) {
    return json({ error: 'No se pudo conectar con Stripe.' }, 500);
  }
}
