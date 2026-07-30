// functions/_lib/places.js
// Resuelve automáticamente el enlace directo de reseñas de Google de un
// negocio a partir de su nombre y dirección, usando la Places API de
// Google (Find Place From Text) vía fetch — sin SDK, igual que el resto
// del proyecto.
//
// Requiere la variable de entorno GOOGLE_PLACES_API_KEY en Cloudflare
// Pages (Google Cloud Console > APIs & Services > Credentials, con la
// "Places API" activada en el proyecto).

// Construye el enlace que lleva directamente al formulario de "Escribir
// una reseña" de Google para un Place ID concreto.
export function buildReviewUrl(placeId) {
  return 'https://search.google.com/local/writereview?placeid=' + encodeURIComponent(placeId);
}

// Busca el negocio por nombre + dirección y devuelve { placeId, reviewUrl,
// nombreEncontrado, direccionEncontrada } o null si no se encuentra nada.
export async function resolveReviewLink(env, { negocio, direccion, cp, ciudad }) {
  if (!env.GOOGLE_PLACES_API_KEY) {
    throw new Error('Falta configurar GOOGLE_PLACES_API_KEY en Cloudflare Pages.');
  }

  const query = [negocio, direccion, cp, ciudad].filter(Boolean).join(', ');
  const url = new URL('https://maps.googleapis.com/maps/api/place/findplacefromtext/json');
  url.searchParams.set('input', query);
  url.searchParams.set('inputtype', 'textquery');
  url.searchParams.set('fields', 'place_id,name,formatted_address');
  url.searchParams.set('language', 'es');
  url.searchParams.set('key', env.GOOGLE_PLACES_API_KEY);

  const res = await fetch(url.toString());
  const data = await res.json().catch(() => null);

  if (!res.ok || !data) {
    throw new Error('No se pudo conectar con Google Places.');
  }
  if (data.status !== 'OK' || !data.candidates || !data.candidates.length) {
    // ZERO_RESULTS es el caso normal cuando no se encuentra el negocio;
    // otros status (REQUEST_DENIED, INVALID_REQUEST...) indican un
    // problema de configuración (clave, facturación, API no activada).
    return null;
  }

  const best = data.candidates[0];
  return {
    placeId: best.place_id,
    reviewUrl: buildReviewUrl(best.place_id),
    nombreEncontrado: best.name || '',
    direccionEncontrada: best.formatted_address || ''
  };
}
