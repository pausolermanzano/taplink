// functions/_lib/places.js
// Resuelve automáticamente el enlace directo de reseñas de Google de un
// negocio a partir de su nombre y dirección, usando la Places API (New)
// de Google vía fetch — sin SDK, igual que el resto del proyecto.
//
// Usamos el campo oficial "writeAReviewUri" que la propia API de Google
// genera y devuelve (Text Search New). NO construimos el enlace a mano
// con el Place ID (search.google.com/local/writereview?placeid=...):
// ese truco es conocido por no ser 100% fiable — para algunos negocios
// lleva a la ficha general de Maps en vez de abrir el cuadro de reseña.
// El enlace que da la propia API sí lo genera Google, así que es fiable.
//
// Requiere la variable de entorno GOOGLE_PLACES_API_KEY en Cloudflare
// Pages (Google Cloud Console > APIs & Services > Credentials, con la
// "Places API (New)" activada en el proyecto).

// Busca el negocio por nombre + dirección y devuelve { reviewUrl,
// placeId, nombreEncontrado, direccionEncontrada } o null si no se
// encuentra nada.
export async function resolveReviewLink(env, { negocio, direccion, cp, ciudad }) {
  if (!env.GOOGLE_PLACES_API_KEY) {
    throw new Error('Falta configurar GOOGLE_PLACES_API_KEY en Cloudflare Pages.');
  }

  const query = [negocio, direccion, cp, ciudad].filter(Boolean).join(', ');

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
      // Pedimos solo los campos que necesitamos (abarata la llamada):
      // el enlace oficial de reseña, más nombre/dirección para poder
      // enseñarle a Marc qué negocio ha encontrado exactamente.
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.googleMapsLinks.writeAReviewUri'
    },
    body: JSON.stringify({ textQuery: query })
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error('No se pudo conectar con Google Places' + (data && data.error ? ': ' + data.error.message : ''));
  }
  if (!data.places || !data.places.length) {
    return null; // No se ha encontrado ningún negocio con esos datos.
  }

  const best = data.places[0];
  const reviewUrl = best.googleMapsLinks && best.googleMapsLinks.writeAReviewUri;
  if (!reviewUrl) {
    // Encontrado el negocio, pero Google no ha dado el enlace de reseña
    // (muy raro). Mejor tratarlo como "no encontrado" para que salga el
    // aviso de rellenarlo a mano, en vez de guardar un enlace vacío.
    return null;
  }

  return {
    placeId: best.id,
    reviewUrl,
    nombreEncontrado: (best.displayName && best.displayName.text) || '',
    direccionEncontrada: best.formattedAddress || ''
  };
}
