// functions/go/[slug].js
// Esta es la URL a la que apunta CADA placa NFC, ej: https://taplink.es/go/bar-nou-x7k2
//
// - Si el local está "activo" -> redirige a su enlace de reseñas de Google.
// - Si está "pausado" o "cancelado" (por impago) -> redirige a la página de
//   aviso, en vez de a las reseñas. Así se corta el servicio automáticamente,
//   sin que nadie tenga que hacer nada manualmente.

import { getLocalBySlug } from '../_lib/kv.js';

// EXPERIMENTAL: además del botón (que ya funciona en iPhone y Android
// normal), se intenta cargar la página de reseñas de Google dentro de un
// iframe en esta misma pantalla. La idea es que Android solo entrega la
// navegación a otra app cuando el salto ocurre en la pantalla principal
// del navegador -- si Google se carga DENTRO de un recuadro de nuestra
// propia página, en teoría no debería secuestrarlo ninguna app.
//
// Riesgo conocido y asumido: es muy posible que Google bloquee que sus
// páginas se carguen dentro de webs ajenas (X-Frame-Options / CSP), y en
// ese caso el recuadro saldría en blanco o con un error de Google. Por
// eso el botón de siempre se queda debajo, intacto, como red de
// seguridad -- si el iframe falla, la persona simplemente usa el botón
// como hasta ahora.
function paginaSalto(destino, esAndroid) {
  const safe = destino.replace(/"/g, '&quot;');
  let href = safe;
  if (esAndroid) {
    try {
      const u = new URL(destino);
      const resto = u.pathname + u.search;
      href = `intent://${u.host}${resto}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(destino)};end`;
    } catch (e) {
      href = safe;
    }
  }
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dejar una reseña</title>
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;margin:0;background:#fafafa;color:#222;
padding:20px;min-height:100vh;display:flex;flex-direction:column;align-items:center}
h1{font-size:18px;margin:6px 0 14px;text-align:center}
iframe{width:100%;max-width:480px;height:46vh;border:1px solid #ddd;border-radius:12px;background:#fff}
a.btn{display:inline-block;margin-top:18px;padding:16px 32px;background:#2563eb;color:#fff;font-size:17px;
font-weight:700;text-decoration:none;border-radius:10px}
p.ayuda{margin-top:16px;font-size:13px;color:#777;max-width:320px;line-height:1.5;text-align:center}
</style></head>
<body>
<h1>¡Gracias por tu visita! ⭐</h1>
<iframe src="${safe}" loading="eager" referrerpolicy="no-referrer-when-downgrade"></iframe>
<a class="btn" href="${href}">Dejar mi reseña en Google</a>
<p class="ayuda">Si el recuadro de arriba sale en blanco, usa el botón. Y si se abre la ficha del negocio en vez de las estrellas, tócalas arriba para escribir tu reseña.</p>
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
    const esAndroid = /Android/i.test(request.headers.get('user-agent') || '');

    if (!local) {
      // Placa no registrada (todavía) en Cloudflare KV
      return Response.redirect(origin, 302);
    }

    const { estado, review_url } = local;

    if (estado === 'activo' && review_url) {
      return respuestaHTML(paginaSalto(review_url, esAndroid));
    }

    return respuestaHTML(paginaSalto(fallback, esAndroid));
  } catch (err) {
    const esAndroid = /Android/i.test(request.headers.get('user-agent') || '');
    return respuestaHTML(paginaSalto(fallback, esAndroid));
  }
}
