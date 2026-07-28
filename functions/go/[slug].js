// functions/go/[slug].js
// Esta es la URL a la que apunta CADA placa NFC, ej: https://taplink.es/go/bar-nou-x7k2
//
// - Si el local está "activo" -> redirige a su enlace de reseñas de Google.
// - Si está "pausado" o "cancelado" (por impago) -> redirige a la página de
//   aviso, en vez de a las reseñas. Así se corta el servicio automáticamente,
//   sin que nadie tenga que hacer nada manualmente.

import { getLocalBySlug } from '../_lib/kv.js';

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
      // Placa no registrada (todavía) en Airtable
      return Response.redirect(origin, 302);
    }

    const { estado, review_url } = local;

    if (estado === 'activo' && review_url) {
      return Response.redirect(review_url, 302);
    }

    return Response.redirect(fallback, 302);
  } catch (err) {
    return Response.redirect(fallback, 302);
  }
}
