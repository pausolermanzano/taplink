// functions/go/[slug].js
// Esta es la URL a la que apunta CADA placa NFC, ej: https://taplink.es/go/bar-nou-x7k2
//
// - Si el local está "activo" -> redirige a su enlace de reseñas de Google.
// - Si está "pausado" o "cancelado" (por impago) -> redirige a la página de
//   aviso, en vez de a las reseñas. Así se corta el servicio automáticamente,
//   sin que nadie tenga que hacer nada manualmente.

import { getLocalBySlug } from '../_lib/kv.js';

// Página intermedia: en vez de saltar SOLA, muestra un botón grande que
// hay que tocar. Un toque real del usuario sobre un enlace tiene más
// probabilidades de quedarse en el navegador que un salto automático por
// script -- Android decide con más frecuencia "abrir con Google Maps" en
// los saltos automáticos que en los toques directos de la persona.
// Aun así, esto no es infalible: Android puede seguir abriendo la app de
// Maps en vez del navegador según el móvil. Por eso se añade también una
// instrucción de respaldo, por si la reseña no se abre directa a las
// estrellas y hay que tocarlas una vez más desde la ficha del negocio.
function paginaSalto(destino) {
  const safe = destino.replace(/"/g, '&quot;');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dejar una reseña</title>
<style>
body{font-family:-apple-system,system-ui,sans-serif;display:flex;flex-direction:column;
align-items:center;justify-content:center;height:100vh;margin:0;background:#fafafa;color:#222;text-align:center;padding:24px}
h1{font-size:19px;margin:0 0 22px}
a.btn{display:inline-block;padding:16px 32px;background:#2563eb;color:#fff;font-size:17px;
font-weight:700;text-decoration:none;border-radius:10px}
p.ayuda{margin-top:22px;font-size:13px;color:#777;max-width:320px;line-height:1.5}
</style></head>
<body>
<h1>¡Gracias por tu visita! ⭐</h1>
<a class="btn" href="${safe}">Dejar mi reseña en Google</a>
<p class="ayuda">Si se abre la ficha del negocio en vez de las estrellas, solo tienes que tocar las estrellas de arriba para escribir tu reseña.</p>
</body></html>`;
}

function respuestaHTML(html) {
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export async function onRequest(context) {
  const { params, env, request } = context;
  const slug = params.slug;
  const origin = new URL(request.url).origin;
  const fallback = env.FALLBACK_URL || origin + '/pago-pendiente.html';

  if (!slug) {
    return Response.redirect(origin, 302);
  }

  try {
    const local = await getLocalBySlug(env, slug);

    if (!local) {
      // Placa no registrada (todavía) en Cloudflare KV
      return Response.redirect(origin, 302);
    }

    const { estado, review_url } = local;

    if (estado === 'activo' && review_url) {
      return respuestaHTML(paginaSalto(review_url));
    }

    return respuestaHTML(paginaSalto(fallback));
  } catch (err) {
    return respuestaHTML(paginaSalto(fallback));
  }
}
