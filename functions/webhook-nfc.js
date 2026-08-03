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
import { getLocalBySubscriptionId, getLocalBySlug, setEstado, createLocal, linkSubscription, sumarPago, limpiarMesesPendientes, setEmailError } from './_lib/kv.js';
import { ampliarPausaMeses } from './_lib/stripe.js';
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
        if (meta.slug && session.subscription) {
          const yaVinculado = await getLocalBySubscriptionId(env, session.subscription);
          if (!yaVinculado) {
            const origin = new URL(request.url).origin;
            const nfcLink = origin + '/go/' + meta.slug;
            const email = session.customer_email || (session.customer_details && session.customer_details.email);

            // Caso 1: venta presencial que activa su mensualidad ahora.
            // El local YA EXISTE (lo creó Marc/Pau desde el panel al
            // entregar la placa) — no creamos uno nuevo, solo enlazamos
            // esta suscripción al que ya había, buscándolo por el mismo
            // slug que viaja en el metadata.
            const localExistente = await getLocalBySlug(env, meta.slug);
            if (localExistente) {
              if (!localExistente.stripe_subscription_id) {
                await linkSubscription(env, meta.slug, session.subscription);
                console.log('Mensualidad vinculada a local presencial ya existente: ' + meta.slug);

                // Si este local ya tenía recomendaciones guardadas de
                // antes (venta en efectivo, sin mensualidad activa
                // todavía), los meses gratis se quedaron "pendientes" —
                // se aplican ahora mismo, en cuanto existe una
                // suscripción real de Stripe a la que aplicarlos.
                if (localExistente.meses_gratis_pendientes) {
                  try {
                    await ampliarPausaMeses(env, session.subscription, localExistente.meses_gratis_pendientes);
                    await limpiarMesesPendientes(env, meta.slug);
                  } catch (pausaErr) {
                    console.error('Fallo aplicando meses gratis pendientes:', pausaErr && pausaErr.message);
                  }
                }
              }
              try {
                await enviarNotificacionInterna(env, {
                  negocio: localExistente.nombre_local,
                  nfcLink,
                  codigo: localExistente.codigo || meta.codigo || '',
                  nombreCliente: localExistente.nombre_cliente || '',
                  emailCliente: email || '',
                  telefono: localExistente.telefono || ''
                });
              } catch (mailErr) {
                console.error('Fallo enviando notificación interna (mensualidad vinculada):', mailErr && mailErr.message);
                try { await setEmailError(env, meta.slug, 'interna', mailErr && mailErr.message); } catch (e) {}
              }
              break;
            }

            // Caso 2: compra online completa (placa + mensualidad juntas,
            // el flujo de siempre) — aquí sí toca crear el local desde
            // cero, con todos los datos de facturación/envío.
            if (meta.review_url) {
              const local = await createLocal(env, {
                slug: meta.slug,
                nombre_local: meta.negocio || meta.slug,
                review_url: meta.review_url,
                stripe_subscription_id: session.subscription,
                codigo: meta.code || '',
                estado: 'activo',
                origen: 'web',
                nombre_cliente: meta.nombre || '',
                nif: meta.nif || '',
                direccion: meta.dir || '',
                cp: meta.cp || '',
                ciudad: meta.ciudad || '',
                telefono: meta.tel || ''
              });
              console.log('Local creado en KV: ' + local.slug);
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
        const invoice = event.data.object;
        await actualizarEstado(env, invoice.subscription, 'activo');
        await registrarPago(env, invoice.subscription, invoice);
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

// Suma el importe de una factura cobrada (invoice.paid) al acumulado
// histórico del local, para poder ver en el panel cuánto lleva pagado
// en total y cuánto paga en su cuota actual (útil también para precios
// a medida por volumen, que no son ni 7,99€ ni 79€).
async function registrarPago(env, subscriptionId, invoice) {
  if (!subscriptionId) return;
  const local = await getLocalBySubscriptionId(env, subscriptionId);
  if (!local) return;
  const linea = invoice.lines && invoice.lines.data && invoice.lines.data[0];
  const intervalo = linea && linea.price && linea.price.recurring && linea.price.recurring.interval;
  await sumarPago(env, local.slug, invoice.amount_paid || 0, intervalo || '');
}
