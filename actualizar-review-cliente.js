// functions/actualizar-review-cliente.js
// Permite que el propio cliente (sin contraseña de admin) actualice el
// enlace de reseñas de SU local, desde mi-resena.html, pegando el
// enlace oficial que le da la app de Google Maps. Así evitamos depender
// del enlace autogenerado por la API de Places, que en algunos móviles
// (sobre todo Android/MIUI) no lleva bien a las estrellas.
//
// "Protegido" por el código Taplink (TPK-XXXXXX): no es una contraseña
// secreta al nivel del panel de admin, pero solo lo conoce el cliente
// dueño de esa placa (se lo damos por email o en persona) -- es
// suficiente para esta acción, que solo cambia UN dato (el enlace de
// reseñas) de UN local, nunca datos sensibles ni de otros locales.

import { getLocalByCodigo, setReviewUrl } from './_lib/kv.js';

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ error: 'Petición inválida.' }, 400);
  }

  const codigo = ((payload && payload.codigo) || '').trim();
  const reviewUrl = ((payload && payload.reviewUrl) || '').trim();

  if (!codigo) return json({ error: 'Falta el código.' }, 400);
  if (!/^https?:\/\//i.test(reviewUrl)) {
    return json({ error: 'El enlace debe empezar por http:// o https://' }, 400);
  }
  // Solo aceptamos enlaces de dominios de Google -- evita que alguien use
  // esto para redirigir la placa a cualquier otra web.
  let host;
  try { host = new URL(reviewUrl).host.toLowerCase(); } catch (e) { host = ''; }
  const dominiosPermitidos = ['google.com', 'g.page', 'goo.gl'];
  const esDominioGoogle = dominiosPermitidos.some(d => host === d || host.endsWith('.' + d));
  if (!esDominioGoogle) {
    return json({ error: 'Ese enlace no parece ser de Google. Tiene que venir de la app de Google Maps ("Pedir reseñas" o compartir tu ficha).' }, 400);
  }

  const local = await getLocalByCodigo(env, codigo);
  if (!local) {
    return json({ error: 'No encontramos ningún local con ese código. Revísalo e inténtalo de nuevo.' }, 404);
  }

  await setReviewUrl(env, local.slug, reviewUrl);

  return json({ ok: true });
}
