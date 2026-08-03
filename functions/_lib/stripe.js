// functions/_lib/stripe.js
// Llamadas directas a la API REST de Stripe (fetch, sin SDK — mismo
// estilo que el resto del proyecto), usadas para aplicar los meses
// gratis por recomendación de forma 100% automática.
//
// Usamos "pause_collection" en vez de cupones porque escala mejor a
// miles de negocios: Stripe se encarga solo de retomar el cobro en la
// fecha indicada (resumes_at) — no hace falta ningún cron job nuestro
// para "acordarnos" de reactivar a nadie, ni gestionar cupones que se
// acumulan o expiran de formas raras si se aplican varias veces.

export async function obtenerSuscripcion(env, subscriptionId) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY }
  });
  if (!res.ok) return null;
  return res.json();
}

// Pausa el cobro de una suscripción hasta la fecha indicada (unix
// seconds). behavior=void: no se generan facturas durante la pausa, y
// en resumes_at Stripe retoma el cobro normal él solo.
export async function pausarSuscripcionHasta(env, subscriptionId, resumesAtUnix) {
  const body = new URLSearchParams();
  body.set('pause_collection[behavior]', 'void');
  body.set('pause_collection[resumes_at]', String(resumesAtUnix));
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error('Stripe error al pausar la suscripción: ' + (data && data.error && data.error.message));
  }
  return data;
}

// Suma N meses de pausa a una suscripción a partir de AHORA, o a
// partir de la pausa que ya tuviera (si un negocio recibe varias
// recomendaciones seguidas, los meses se apilan en vez de pisarse).
export async function ampliarPausaMeses(env, subscriptionId, meses) {
  const sub = await obtenerSuscripcion(env, subscriptionId);
  const ahora = Math.floor(Date.now() / 1000);
  const pausaActual = sub && sub.pause_collection && sub.pause_collection.resumes_at;
  const base = pausaActual && pausaActual > ahora ? pausaActual : ahora;
  const nuevaFecha = new Date(base * 1000);
  nuevaFecha.setMonth(nuevaFecha.getMonth() + meses);
  return pausarSuscripcionHasta(env, subscriptionId, Math.floor(nuevaFecha.getTime() / 1000));
}
