// functions/go/[slug].js
// Esta es la URL a la que apunta CADA placa NFC, ej: https://taplink.es/go/bar-nou-x7k2
//
// - Si el local está "activo" -> redirige a su enlace de reseñas de Google.
// - Si está "pausado" o "cancelado" (por impago) -> redirige a la página de
//   aviso, en vez de a las reseñas. Así se corta el servicio automáticamente,
//   sin que nadie tenga que hacer nada manualmente.

import { getLocalBySlug } from '../_lib/kv.js';

// Página intermedia mínima: en vez de un 302 directo, carga esta página
// y desde AHÍ lanza el salto al destino. Esto evita que Android intercepte
// el enlace de Google (search.google.com/local/writereview) y lo abra con
// la app de Maps en vez del navegador -- la app de Maps a veces no lleva
// directo a las estrellas, solo abre la ficha del negocio.
function paginaSalto(destino) {
  const safe = destino.replace(/"/g, '&quot;');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Redirigiendo...</title>
<meta http-equiv="refresh" content="0; url=${safe}">
<style>
body{font-family:-apple-system,system-ui,sans-serif;display:flex;flex-direction:column;
align-items:center;justify-content:center;height:100vh;margin:0;background:#fafafa;color:#333;text-align:center;padding:20px}
a{margin-top:16px;color:#2563eb;font-weight:600;text-decoration:none}
</style></head>
<body>
<p>Abriendo...</p>
<a href="${safe}">Toca aquí si no se abre automáticamente</a>
<script>window.location.replace(${JSON.stringify(destino)});</script>
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
