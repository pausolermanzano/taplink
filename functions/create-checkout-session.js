// Cloudflare Pages Function — crea una sesión de Stripe Checkout con el
// contenido real del carrito (placas a pago único + plan de gestión
// recurrente) y devuelve la URL a la que el navegador debe redirigir.
//
// Ruta resultante: /create-checkout-session (por el nombre de este archivo).
//
// No usa el SDK de Stripe a propósito: llama directamente a la API REST de
// Stripe con fetch(), que es 100% compatible con el runtime de Cloudflare
// Workers/Pages sin necesidad de polyfills de Node ni dependencias npm —
// así evitamos cualquier fallo de compatibilidad en el build.
//
// Requiere la variable de entorno STRIPE_SECRET_KEY configurada en el
// proyecto de Cloudflare Pages (Settings -> Environment variables).
// Nunca se expone al navegador.

import { resolveReviewLink } from './_lib/places.js';

const PLATES = {
  premium: { name: 'Placa Premium', price: 4999 },
  estandar: { name: 'Placa Estándar', price: 4299 },
  pack: { name: 'Pack Doble (2x Placa Premium)', price: 7498 }
};

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

// Convierte "Bar Nou" en "bar-nou-x7k2": esto es lo que se usará en la URL
// de las placas NFC de ese local (taplink.es/go/bar-nou-x7k2). El sufijo
// aleatorio evita choques si dos negocios se llaman igual.
function slugify(str) {
  const base = (str || 'local')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'local';
  const suffix = Math.random().toString(36).slice(2, 6);
  return base + '-' + suffix;
}

// Código de pedido / acceso al panel (TPK-XXXXXX). Se genera aquí, en el
// servidor, para que sea el mismo que luego se manda por email y el que
// activa la cuenta — antes se generaba también en el navegador al volver
// de Stripe, por su cuenta, sin relación real con ningún envío.
function generarCodigo() {
  return 'TPK-' + Math.floor(100000 + Math.random() * 899999);
}

export async function onRequest(context) {
  const { request } = context;
  if (request.method !== 'POST') {
    return json({ error: 'Method Not Allowed' }, 405);
  }
  return handlePost(context);
}

async function handlePost(context) {
  const { request, env } = context;

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: 'Falta configurar STRIPE_SECRET_KEY en Cloudflare Pages.' }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ error: 'Petición inválida.' }, 400);
  }

  const cart = (payload && payload.cart) || [];
  const plan = payload && payload.plan;
  const email = payload && payload.email;
  const negocio = payload && payload.negocio;
  const slug = slugify(negocio);
  const codigo = generarCodigo();

  // Datos de facturación y envío del cliente. Se validan aquí también
  // (no solo en el navegador) porque este endpoint es una API pública:
  // cualquiera podría llamarlo directamente saltándose el formulario.
  const nombre = ((payload && payload.nombre) || '').trim();
  const nif = ((payload && payload.nif) || '').trim();
  const dir = ((payload && payload.dir) || '').trim();
  const cp = ((payload && payload.cp) || '').trim();
  const ciudad = ((payload && payload.ciudad) || '').trim();
  const tel = ((payload && payload.tel) || '').trim();

  const faltantes = [];
  if (!email) faltantes.push('email');
  if (!negocio) faltantes.push('negocio');
  if (!nombre) faltantes.push('nombre');
  if (!nif) faltantes.push('nif');
  if (!dir) faltantes.push('dir');
  if (!/^\d{5}$/.test(cp)) faltantes.push('cp');
  if (!ciudad) faltantes.push('ciudad');
  if (!tel) faltantes.push('tel');
  if (faltantes.length) {
    return json({ error: 'Faltan datos obligatorios: ' + faltantes.join(', ') }, 400);
  }

  if (!Array.isArray(cart) || cart.length === 0) {
    return json({ error: 'El carrito está vacío.' }, 400);
  }

  // El enlace de reseñas ya NO lo escribe el cliente a mano: se resuelve
  // automáticamente a partir del nombre del negocio + su dirección, vía
  // Google Places API. Así el cliente solo rellena los datos que ya
  // rellenaba de todos modos (nombre, dirección, ciudad).
  let reviewUrl;
  try {
    const encontrado = await resolveReviewLink(env, { negocio, direccion: dir, cp, ciudad });
    if (!encontrado) {
      return json({
        error: 'No hemos encontrado tu negocio en Google automáticamente. Para no perder tu pedido, dinos el enlace tú mismo: 1) Busca tu negocio en Google Maps. 2) Toca las estrellas de valoración. 3) Copia el enlace que te aparece y envíanoslo a info@taplink.es o por WhatsApp indicando tu nombre y negocio — lo activamos a mano en menos de 1 hora.'
      }, 400);
    }
    reviewUrl = encontrado.reviewUrl;
  } catch (e) {
    return json({ error: 'No se pudo verificar tu negocio en Google ahora mismo. Inténtalo de nuevo en un momento.' }, 500);
  }

  // Stripe solo permite UN line item sin "recurring" cuando el modo es
  // "subscription". Por eso agregamos todas las placas del carrito en un
  // único line item de pago único, y el plan de gestión va aparte como el
  // único line item recurrente.
  let oneTimeTotal = 0;
  const nameParts = [];
  for (const item of cart) {
    const id = item && item.id;
    const p = PLATES[id];
    if (!p) {
      return json({ error: 'Producto desconocido: ' + id }, 400);
    }
    const qty = Math.max(1, parseInt(item.qty, 10) || 1);
    oneTimeTotal += p.price * qty;
    nameParts.push(p.name + ' ×' + qty);
  }

  if (oneTimeTotal <= 0) {
    return json({ error: 'El carrito no tiene un importe válido.' }, 400);
  }

  const chosenPlan = PLAN[plan] ? plan : 'mensual';
  const planData = PLAN[chosenPlan];

  const origin = new URL(request.url).origin;

  const body = new URLSearchParams();
  body.set('mode', 'subscription');
  body.append('payment_method_types[]', 'card');
  if (email) body.set('customer_email', email);
  body.set('success_url', origin + '/?checkout=success&session_id={CHECKOUT_SESSION_ID}');
  body.set('cancel_url', origin + '/?checkout=cancel');
  body.set('allow_promotion_codes', 'true');
  body.set('metadata[negocio]', negocio || '');
  body.set('metadata[plan]', chosenPlan);
  body.set('metadata[slug]', slug);
  body.set('metadata[review_url]', reviewUrl);
  body.set('metadata[code]', codigo);
  body.set('metadata[nombre]', nombre);
  body.set('metadata[nif]', nif);
  body.set('metadata[dir]', dir);
  body.set('metadata[cp]', cp);
  body.set('metadata[ciudad]', ciudad);
  body.set('metadata[tel]', tel);
  // Esto mismo se copia a la suscripción (no solo a la sesión), porque el
  // webhook de pagos fallidos recibe la suscripción, no la sesión original.
  body.set('subscription_data[metadata][negocio]', negocio || '');
  body.set('subscription_data[metadata][slug]', slug);
  body.set('subscription_data[metadata][review_url]', reviewUrl);
  body.set('subscription_data[metadata][code]', codigo);
  body.set('subscription_data[metadata][nombre]', nombre);
  body.set('subscription_data[metadata][nif]', nif);
  body.set('subscription_data[metadata][dir]', dir);
  body.set('subscription_data[metadata][cp]', cp);
  body.set('subscription_data[metadata][ciudad]', ciudad);
  body.set('subscription_data[metadata][tel]', tel);

  // Nota: los datos de facturación/envío ya viajan como metadata (arriba).
  // No usamos aquí "customer_creation" (inválido en mode=subscription, lo
  // habría roto todo) ni "billing_address_collection"/"phone_number_
  // collection" (harían que Stripe volviera a pedir dirección y teléfono
  // en su propia pantalla, duplicando lo que ya pedimos en nuestro
  // formulario).

  // Line item 1: placas (pago único, importe agregado)
  body.set('line_items[0][price_data][currency]', 'eur');
  body.set('line_items[0][price_data][product_data][name]', nameParts.join(', '));
  body.set('line_items[0][price_data][unit_amount]', String(oneTimeTotal));
  body.set('line_items[0][quantity]', '1');

  // Line item 2: plan de gestión (recurrente)
  body.set('line_items[1][price_data][currency]', 'eur');
  body.set('line_items[1][price_data][product_data][name]', planData.name);
  body.set('line_items[1][price_data][unit_amount]', String(planData.price));
  body.set('line_items[1][price_data][recurring][interval]', planData.interval);
  body.set('line_items[1][quantity]', '1');

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

    return json({ url: data.url, slug: slug });
  } catch (err) {
    return json({ error: 'No se pudo conectar con Stripe.' }, 500);
  }
}
