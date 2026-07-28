// functions/webhook-nfc.js
// Stripe llama a esta URL automáticamente (https://taplink.es/webhook-nfc)
// cada vez que pasa algo con un pago o una suscripción. Aquí es donde se
// decide, sin intervención manual, si un local se queda "activo" (sus
// placas siguen llevando a las reseñas) o pasa a "pausado" (sus placas
// dejan de redirigir a las reseñas).
//
// Configurar en Stripe Dashboard > Developers > Webhooks, apuntando a
// https://taplink.es/webhook-nfc y escuchando estos eventos:
//   - checkout.session.completed
//   - invoice.payment_failed
//   - customer.subscription.deleted
//   - customer.subscription.updated
//   - invoice.paid

import { verifyStripeSignature } from './_lib/stripe-verify.js';
import { getLocalBySubscriptionId, setEstado, createLocal } from './_lib/kv.js';

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  const payload = await request.text();
  const signature = request.headers.get('stripe-signature');

  const valid = await verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return json({ error: 'Firma inválida' }, 400);

  let event;
  try {
    event = JSON.parse(payload);
  } catch (e) {
    return json({ error: 'Payload inválido' }, 400);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const meta = session.metadata || {};
        if (meta.slug && meta.review_url && session.subscription) {
          const yaExiste = await getLocalBySubscriptionId(env, session.subscription);
          if (!yaExiste) {
            await createLocal(env, {
              slug: meta.slug,
              nombre_local: meta.negocio || meta.slug,
              review_url: meta.review_url,
              stripe_subscription_id: session.subscription,
              estado: 'activo'
            });
          }
        }
        break;
      }
      case 'invoice.payment_failed': {
        await actualizarEstado(env, event.data.object.subscription, 'pausado');
        break;
      }
      case 'customer.subscription.deleted': {
        await actualizarEstado(env, event.data.object.id, 'cancelado');
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        if (['past_due', 'unpaid', 'canceled', 'incomplete_expired'].includes(sub.status)) {
          await actualizarEstado(env, sub.id, 'pausado');
        } else if (sub.status === 'active') {
          await actualizarEstado(env, sub.id, 'activo');
        }
        break;
      }
      case 'invoice.paid': {
        await actualizarEstado(env, event.data.object.subscription, 'activo');
        break;
      }
      default:
        break;
    }
    return json({ received: true });
  } catch (err) {
    return json({ error: 'Error interno' }, 500);
  }
}

async function actualizarEstado(env, subscriptionId, estado) {
  if (!subscriptionId) return;
  const local = await getLocalBySubscriptionId(env, subscriptionId);
  if (!local) return; // suscripción de otra cosa, o local aún no creado: se ignora
  await setEstado(env, local.slug, estado);
}
