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
import { getLocalBySubscriptionId, setEstado, createLocal, setEmailError } from './_lib/kv.js';
import { enviarConfirmacionPedido, enviarNotificacionInterna } from './_lib/email.js';

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

  // STRIPE_WEBHOOK_SECRET puede contener uno o varios secretos separados
  // por comas (el de modo test y el de modo live a la vez). Así, cambiar
  // entre test y live en Stripe nunca vuelve a desincronizar el webhook:
  // aceptamos el evento si la firma coincide con CUALQUIERA de los
  // secretos configurados.
  const secretos = (env.STRIPE_WEBHOOK_SECRET || '').split(',').map(s => s.trim()).filter(Boolean);
  let valid = false;
  for (const secreto of secretos) {
    if (await verifyStripeSignature(payload, signature, secreto)) { valid = true; break; }
  }
  if (!valid) {
    console.error('Webhook recibido con firma inválida (revisa STRIPE_WEBHOOK_SECRET: ' + secretos.length + ' secreto(s) configurado(s)).');
    return json({ error: 'Firma inválida' }, 400);
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch (e) {
    return json({ error: 'Payload inválido' }, 400);
  }
  console.log('Webhook OK, evento: ' + event.type);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const meta = session.metadata || {};
        console.log('checkout.session.completed recibido. slug=' + meta.slug + ' subscription=' + session.subscription);
        if (meta.slug && meta.review_url && session.subscription) {
          const yaExiste = await getLocalBySubscriptionId(env, session.subscription);
          if (!yaExiste) {
            const origin = new URL(request.url).origin;
            const nfcLink = origin + '/go/' + meta.slug;
            const local = await createLocal(env, {
              slug: meta.slug,
              nombre_local: meta.negocio || meta.slug,
              review_url: meta.review_url,
              stripe_subscription_id: session.subscription,
              codigo: meta.code || '',
              estado: 'activo',
              nombre_cliente: meta.nombre || '',
              nif: meta.nif || '',
              direccion: meta.dir || '',
              cp: meta.cp || '',
              ciudad: meta.ciudad || '',
              telefono: meta.tel || ''
            });
            console.log('Local creado en KV: ' + local.slug);
            const email = session.customer_email || (session.customer_details && session.customer_details.email);
            if (email) {
              try {
                await enviarConfirmacionPedido(env, {
                  to: email,
                  negocio: local.nombre_local,
                  codigo: meta.code || '',
                  nfcLink
                });
              } catch (mailErr) {
                // No tumbamos el webhook por un fallo de envío: el local ya
                // ha quedado creado y activo, que es lo crítico aquí. Guardamos
                // el motivo exacto en KV para verlo directamente en panel.html,
                // sin depender de los logs de Cloudflare.
                console.error('Fallo enviando email de confirmación al cliente:', mailErr && mailErr.message);
                try { await setEmailError(env, local.slug, 'confirmacion', mailErr && mailErr.message); } catch (e) {}
              }
            } else {
              console.error('checkout.session.completed sin email de cliente: no se pudo enviar confirmación.');
            }
            try {
              await enviarNotificacionInterna(env, {
                negocio: local.nombre_local,
                nfcLink,
                codigo: meta.code || '',
                nombreCliente: meta.nombre || '',
                emailCliente: email || '',
                telefono: meta.tel || ''
              });
            } catch (mailErr) {
              console.error('Fallo enviando notificación interna a Taplink:', mailErr && mailErr.message);
              try { await setEmailError(env, local.slug, 'interna', mailErr && mailErr.message); } catch (e) {}
            }
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
    console.error('Error interno procesando webhook (' + event.type + '): ' + (err && err.message));
    return json({ error: 'Error interno' }, 500);
  }
}

async function actualizarEstado(env, subscriptionId, estado) {
  if (!subscriptionId) return;
  const local = await getLocalBySubscriptionId(env, subscriptionId);
  if (!local) return; // suscripción de otra cosa, o local aún no creado: se ignora
  if (local.manual) return; // alguien lo ha fijado a mano desde el panel: Stripe no lo toca
  await setEstado(env, local.slug, estado);
}
