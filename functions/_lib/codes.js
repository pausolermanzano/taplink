// functions/_lib/codes.js
// Generación de slug (URL de la placa) y código (TPK-XXXXXX) — usado
// tanto por create-checkout-session.js (compra online) como por
// panel-crear-manual.js (venta presencial de Marc/Pau), para que el
// formato sea siempre el mismo y no haya dos sitios generándolo cada uno
// a su manera.

// Convierte "Bar Nou" en "bar-nou-x7k2": esto es lo que se usará en la URL
// de las placas NFC de ese local (taplink.es/go/bar-nou-x7k2). El sufijo
// aleatorio evita choques si dos negocios se llaman igual.
export function slugify(str) {
  const base = (str || 'local')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'local';
  const suffix = Math.random().toString(36).slice(2, 6);
  return base + '-' + suffix;
}

// Código de pedido / acceso al panel (TPK-XXXXXX). Es el mismo formato
// tanto si el negocio compra online como si se lo da un comercial en
// mano — así en el panel se ven todos los clientes con el mismo tipo de
// código, sin distinguir de dónde vino cada uno.
export function generarCodigo() {
  return 'TPK-' + Math.floor(100000 + Math.random() * 899999);
}
