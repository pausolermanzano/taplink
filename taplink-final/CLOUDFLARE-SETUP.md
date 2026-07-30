# Poner en marcha el pago con Stripe en Cloudflare Pages

El código ya está listo y adaptado a Cloudflare (sin dependencias npm, para
evitar cualquier fallo de compatibilidad en el build). Solo faltan estos pasos.

## 1. Crear cuenta y proyecto en Cloudflare Pages
- Entra en dash.cloudflare.com (crea la cuenta si no la tienes, es gratis).
- Ve a **Workers & Pages → Create → Pages**.
- Sube esta carpeta directamente ("Upload assets" / "Deploy directly") o
  conéctala a un repositorio de GitHub — cualquiera de las dos vale.
- Build command: déjalo vacío (no hace falta build).
- Build output directory: `/` (la raíz).
- Cloudflare detecta solo la carpeta `functions/` y publica automáticamente
  la ruta `/create-checkout-session` a partir de `functions/create-checkout-session.js`.

## 2. Añadir la clave secreta de Stripe (nunca en el código ni en el chat)
En el proyecto de Cloudflare Pages:
`Settings → Environment variables → Add variable`
- Variable name: `STRIPE_SECRET_KEY`
- Value: tu clave `sk_test_...` (modo test) de Stripe → Developers → API keys
- Environment: Production (y también Preview si quieres probar antes de publicar)
- Guarda y vuelve a desplegar (Deployments → Retry deployment / o simplemente
  vuelve a subir) para que la función la recoja.

## 3. Probar el pago
- Entra en la URL que te da Cloudflare (tipo `taplink.pages.dev`), añade una
  placa al carrito y completa el checkout.
- En el paso de pago de Stripe usa la tarjeta de test `4242 4242 4242 4242`,
  cualquier fecha futura y cualquier CVC de 3 dígitos.
- Al pagar, Stripe redirige de vuelta con `?checkout=success` y la web genera
  el código de pedido (TPK-XXXXXX) y muestra la confirmación.

## Qué se cobra en cada sesión
- Todas las placas del carrito se agrupan en **un único cargo de pago único**
  (Stripe solo permite un line item sin recurrencia por sesión de suscripción).
- El plan de gestión (mensual 7,99 €/mes o anual 79 €/año) va aparte, como
  cargo recurrente, en la misma sesión.

## Pasar a producción (cobros reales)
Repite el paso 2 con la clave `sk_live_...` de Stripe (con el modo de prueba
desactivado en el Dashboard de Stripe). No hay que tocar nada más del código.

## Dominio propio
Cuando quieras usar `taplink.com` en vez de `taplink.pages.dev`: en el
proyecto de Cloudflare Pages, `Custom domains → Set up a custom domain`, y
sigue el asistente. No afecta a la función ni a la clave de Stripe.
