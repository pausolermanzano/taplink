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

function normalizeUrl(url) {
  const u = (url || '').trim();
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : 'https://' + u;
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
  const reviewUrl = normalizeUrl(payload && payload.glink);
  const slug = slugify(negocio);
  const codigo = generarCodigo();

  if (!Array.isArray(cart) || cart.length === 0) {
    return json({ error: 'El carrito está vacío.' }, 400);
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
  // Esto mismo se copia a la suscripción (no solo a la sesión), porque el
  // webhook de pagos fallidos recibe la suscripción, no la sesión original.
  body.set('subscription_data[metadata][negocio]', negocio || '');
  body.set('subscription_data[metadata][slug]', slug);
  body.set('subscription_data[metadata][review_url]', reviewUrl);
  body.set('subscription_data[metadata][code]', codigo);

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
