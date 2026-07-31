// functions/_lib/stripe-verify.js
// Verifica que una notificación (webhook) que dice venir de Stripe es
// realmente de Stripe, usando Web Crypto (compatible con Cloudflare
// Workers/Pages) en vez del SDK oficial de Stripe, que no es 100%
// compatible con este runtime.
//
// Referencia del algoritmo: https://stripe.com/docs/webhooks#verify-manually

export async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader) return false;

  const parts = {};
  sigHeader.split(',').forEach((pair) => {
    const [k, v] = pair.split('=');
    parts[k] = v;
  });
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;

  // Evita reproducir notificaciones muy antiguas (tolerancia de 5 minutos)
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = [...new Uint8Array(sigBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

  // Comparación en tiempo constante para evitar timing attacks
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}
