# Redirección de placas NFC con corte automático por impago

Esto se ha integrado directamente en tu proyecto de Cloudflare Pages
(el mismo que ya sigue `CLOUDFLARE-SETUP.md`). No hace falta ningún
servicio ni dominio nuevo.

## Qué hace

Cada cliente, al comprar sus placas y darse de alta desde tu propia web
(el formulario que ya existe: email, negocio, enlace de Google), consigue
automáticamente un link único de reseñas:

    https://taplink.es/go/{slug-del-negocio}-{código}

Ese link:
- Si el local está al día de pago → redirige a su ficha de Google.
- Si le ha fallado un cobro → redirige a `taplink.es/pago-pendiente.html`.

Todo esto pasa solo, en tiempo real, porque Stripe avisa automáticamente
cuando un pago falla, se recupera, o se cancela una suscripción. Vosotros
no tenéis que revisar nada a mano.

## Qué se ha añadido/tocado

- `functions/go/[slug].js` — la redirección en sí.
- `functions/webhook-nfc.js` — recibe los avisos de Stripe y activa/pausa
  cada local en Airtable.
- `functions/_lib/airtable.js` y `functions/_lib/stripe-verify.js` — código
  compartido (no son rutas públicas).
- `functions/create-checkout-session.js` — se le ha añadido: generar el
  `slug` a partir del nombre del negocio, y mandar el enlace de Google
  (`glink`) como metadato de la suscripción.
- `index.html` — una línea: ahora también se manda `glink` al crear la
  sesión de pago (antes no se enviaba).
- `pago-pendiente.html` — página nueva y independiente, no toca la app
  principal.

No se ha tocado nada del carrito, el panel "Mi Taplink" ni el resto del
flujo de compra: siguen funcionando exactamente igual que antes.

## Paso 1 — Crear la tabla en Airtable

1. Cuenta gratis en https://airtable.com
2. Base nueva, ej. "Taplink". Tabla llamada **Locales**, columnas:

   | Columna | Tipo |
   |---|---|
   | `slug` | Texto |
   | `nombre_local` | Texto |
   | `review_url` | Texto |
   | `stripe_subscription_id` | Texto |
   | `estado` | Selección única: `activo` / `pausado` / `cancelado` |

   No hace falta rellenar filas a mano: se crean solas en cuanto un
   cliente completa su primer pago.

3. Token de acceso: https://airtable.com/create/tokens (permisos de
   lectura y escritura sobre esa base) → es tu `AIRTABLE_API_KEY`.
4. El `AIRTABLE_BASE_ID` está en la URL de la base (empieza por `app...`).

## Paso 2 — Añadir el webhook en Stripe

1. Developers → Webhooks → Add endpoint.
2. URL: `https://taplink.es/webhook-nfc`
3. Eventos a escuchar:
   - `checkout.session.completed`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
   - `customer.subscription.updated`
   - `invoice.paid`
4. Copia el **Signing secret** (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`.

## Paso 3 — Variables de entorno en Cloudflare Pages

En el proyecto → Settings → Environment variables, añade (además de la
`STRIPE_SECRET_KEY` que ya tenéis):

- `AIRTABLE_API_KEY`
- `AIRTABLE_BASE_ID`
- `AIRTABLE_TABLE_NAME` = `Locales`
- `STRIPE_WEBHOOK_SECRET`
- `ADMIN_PASSWORD` (la contraseña que compartiréis Marc y Pau para entrar al panel)
- `FALLBACK_URL` = `https://taplink.es/pago-pendiente.html` (opcional, ya
  es el valor por defecto)

Guarda y vuelve a desplegar (Retry deployment) para que las tome.

## Paso 3bis — El panel privado

En `https://taplink.es/panel.html` tenéis un listado de solo lectura con
todos los locales: nombre, estado (activo/pausado/cancelado), el link de
su placa, su enlace de reseñas y la fecha de alta. Se actualiza en tiempo
real contra Airtable (botón "Actualizar").

Pide la contraseña `ADMIN_PASSWORD` la primera vez que se abre en un
navegador (se queda recordada mientras no cierres esa pestaña). Es una
protección sencilla pensada para que solo la uséis Marc y Pau — si más
adelante queréis algo más robusto (verificación en dos pasos, por
ejemplo), Cloudflare Access permite añadir esa capa sin tocar el código,
desde el propio dashboard de Cloudflare.

## Paso 4 — Programar cada placa NFC

Cuando un cliente completa el pago, en Airtable aparece su fila con el
`slug` ya generado (ej. `bar-nou-x7k2`). Esa es la URL que programáis en la
placa con NFC Tools:

    https://taplink.es/go/bar-nou-x7k2

## Cómo se comporta ante un impago

1. Stripe intenta cobrar y falla → manda `invoice.payment_failed` a
   `taplink.es/webhook-nfc`.
2. El sistema busca en Airtable el local con ese `stripe_subscription_id`
   y lo pone en `pausado`.
3. A partir de ahí, la placa de ese local deja de llevar a reseñas y lleva
   a `pago-pendiente.html`.
4. Si el cliente vuelve a pagar, llega `invoice.paid` y se reactiva solo.

## Notas técnicas para Pau

- Todo está escrito sin dependencias npm (fetch + Web Crypto), igual que
  `create-checkout-session.js`, para evitar problemas de compatibilidad
  con el build de Cloudflare Pages.
- La verificación de firma del webhook se hace a mano con `crypto.subtle`
  (HMAC-SHA256) siguiendo el algoritmo oficial de Stripe, en
  `functions/_lib/stripe-verify.js`.
- Los archivos dentro de `functions/_lib/` no son rutas públicas (el guion
  bajo hace que Cloudflare los ignore como endpoint), solo se importan
  desde las funciones reales.
