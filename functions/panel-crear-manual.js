// functions/panel-crear-manual.js
// Da de alta un local "a mano" desde el panel privado (panel.html), para
// las ventas presenciales: Marc o Pau entregan la placa en el momento y
// cobran en efectivo, así que aquí no hay ningún pago de Stripe todavía
// — solo se genera el código (TPK-XXXXXX) y el enlace que hay que grabar
// en la placa con NFC Tools.
//
// La mensualidad de gestión se activa DESPUÉS, cuando el negocio entra en
// /ya-tengo-mi-placa.html con este mismo código y paga con tarjeta. Ese
// pago se vincula a ESTE MISMO registro (no crea uno nuevo) gracias al
// índice por código guardado aquí — ver create-checkout-session-
// mensualidad.js y el manejo de checkout.session.completed en
// webhook-nfc.js.
//
// Protegido igual que el resto de rutas del panel: requiere la cabecera
// "x-panel-password" con ADMIN_PASSWORD.

import { createLocal, getLocalByCodigo, registrarCobro } from './_lib/kv.js';
import { resolveReviewLink } from './_lib/places.js';
import { slugify, generarCodigo } from './_lib/codes.js';

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  const password = request.headers.get('x-panel-password');
  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return json({ error: 'No autorizado' }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ error: 'Petición inválida.' }, 400);
  }

  const negocio = ((payload && payload.negocio) || '').trim();
  const negocioDir = ((payload && payload.negocioDir) || '').trim();
  const nombreCliente = ((payload && payload.nombreCliente) || '').trim();
  const telefono = ((payload && payload.telefono) || '').trim();
  const importeCobrado = Number(payload && payload.importeCobrado) || 0;
  const metodoCobro = ((payload && payload.metodoCobro) || 'efectivo').trim();
  const precioMensual = Number(payload && payload.precioMensual) || 0;

  if (!negocio) return json({ error: 'Falta el nombre del negocio.' }, 400);
  if (!negocioDir) return json({ error: 'Falta la dirección (tal cual en Google Maps).' }, 400);

  // Mismo motor de búsqueda que la compra online: si Marc escribe el
  // nombre y la dirección tal cual salen en Google Maps, esto encuentra
  // la ficha solo. Si Google no la encuentra, mejor avisar aquí y ahora
  // que dejar el enlace de reseñas vacío o mal generado.
  let reviewUrl;
  try {
    const encontrado = await resolveReviewLink(env, { negocio, direccion: negocioDir });
    if (!encontrado) {
      return json({
        error: 'No se ha encontrado ese negocio en Google. Revisa que el nombre y la dirección estén tal cual en Google Maps, o pégalo directamente desde la ficha.'
      }, 400);
    }
    reviewUrl = encontrado.reviewUrl;
  } catch (e) {
    return json({ error: (e && e.message) || 'No se pudo verificar el negocio en Google ahora mismo.' }, 500);
  }

  const slug = slugify(negocio);
  let codigo = generarCodigo();
  // Choque de códigos casi imposible (1 entre ~900.000), pero comprobamos
  // igualmente antes de guardar nada — si alguna vez chocara, generamos
  // otro en vez de pisar el local de otro negocio.
  for (let intentos = 0; intentos < 5 && (await getLocalByCodigo(env, codigo)); intentos++) {
    codigo = generarCodigo();
  }

  const origin = new URL(request.url).origin;

  const local = await createLocal(env, {
    slug,
    nombre_local: negocio,
    review_url: reviewUrl,
    codigo,
    estado: 'activo',
    stripe_subscription_id: '',
    nombre_cliente: nombreCliente,
    telefono,
    origen: 'efectivo',
    precio_mensual: precioMensual
  });

  if (importeCobrado > 0) {
    try {
      await registrarCobro(env, local.slug, {
        importe: importeCobrado,
        moneda: 'eur',
        metodo: metodoCobro,
        nota: 'Cobro inicial (venta en persona)'
      });
    } catch (e) {
      // No bloqueamos el alta del cliente por un fallo aquí -- el local
      // ya está creado, que es lo importante; el cobro se puede añadir
      // luego a mano desde el panel si hace falta.
    }
  }

  return json({
    ok: true,
    slug: local.slug,
    codigo: local.codigo,
    review_url: local.review_url,
    nfc_link: origin + '/go/' + slug,
    mi_resena_link: origin + '/mi-resena.html?codigo=' + encodeURIComponent(codigo),
    activar_mensualidad_link: origin + '/ya-tengo-mi-placa.html?codigo=' + encodeURIComponent(codigo) + '&negocio=' + encodeURIComponent(negocio) + (telefono ? '&tel=' + encodeURIComponent(telefono) : '')
  });
}
