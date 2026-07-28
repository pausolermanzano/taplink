# Redirección de placas NFC con corte automático por impago

Esto se ha integrado directamente en tu proyecto de Cloudflare Pages
(el mismo que ya sigue `CLOUDFLARE-SETUP.md`). No hace falta ningún
servicio ni dominio nuevo, y tampoco ninguna cuenta externa: la base de
datos (Cloudflare KV) vive en la misma cuenta de Cloudflare que ya usáis.

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
  cada local.
- `functions/panel-datos.js` — sirve el listado al panel privado.
- `functions/_lib/kv.js` y `functions/_lib/stripe-verify.js` — código
  compartido (no son rutas públicas).
- `functions/create-checkout-session.js` — se le ha añadido: generar el
  `slug` a partir del nombre del negocio, y mandar el enlace de Google
  (`glink`) como metadato de la suscripción.
- `index.html` — ahora también se manda `glink` al crear la sesión de
  pago, y la pantalla de confirmación muestra el link de la placa con un
  botón de copiar.
- `pago-pendiente.html` y `panel.html` — páginas nuevas e independientes,
  no tocan la app principal.

No se ha tocado nada del carrito, el panel "Mi Taplink" ni el resto del
flujo de compra: siguen funcionando exactamente igual que antes.

## Paso 1 — Crear el namespace de KV (la base de datos)

Esto lo haces dentro del mismo dashboard de Cloudflare donde ya tenéis la
web, no hace falta salir a ningún otro sitio:

1. En dash.cloudflare.com, ve a **Workers y Pages → KV** (en el menú de
   la izquierda).
2. **Create a namespace**. Ponle de nombre `taplink_locales`.
3. Eso es todo — no hay que crear columnas ni tablas, se rellena solo.

## Paso 2 — Enlazar el namespace a tu proyecto de Pages

1. Entra en tu proyecto de Cloudflare Pages → **Settings → Functions**.
2. Baja hasta **KV namespace bindings** → **Add binding**.
3. Variable name: `LOCALES_KV`
4. KV namespace: selecciona `taplink_locales` (el que has creado).
5. Guarda. Repite esto también para el entorno de "Preview" si lo usáis.

## Paso 3 — Añadir el webhook en Stripe

1. Developers → Webhooks → Add endpoint.
2. URL: `https://taplink.es/webhook-nfc`
3. Eventos a escuchar:
   - `checkout.session.completed`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
   - `customer.subscription.updated`
   - `invoice.paid`
4. Copia el **Signing secret** (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`.

## Paso 4 — Variables de entorno en Cloudflare Pages

En tu proyecto → **Settings → Environment variables**, añade (además de
la `STRIPE_SECRET_KEY` que ya tenéis):

- `STRIPE_WEBHOOK_SECRET`
- `ADMIN_PASSWORD` (la contraseña que compartiréis Marc y Pau para entrar al panel)
- `FALLBACK_URL` = `https://taplink.es/pago-pendiente.html` (opcional, ya
  es el valor por defecto)

Guarda y vuelve a desplegar (**Retry deployment**) para que tanto estas
variables como el binding de KV del Paso 2 se apliquen.

## Paso 5 — El panel privado

En `https://taplink.es/panel.html` tenéis un listado de solo lectura con
todos los locales: nombre, estado (activo/pausado/cancelado), el link de
su placa, su enlace de reseñas y la fecha de alta.

Pide la contraseña `ADMIN_PASSWORD` la primera vez que se abre en un
navegador (se queda recordada mientras no cierres esa pestaña). Es una
protección sencilla pensada para que solo la uséis Marc y Pau — si más
adelante queréis algo más robusto (verificación en dos pasos, por
ejemplo), Cloudflare Access permite añadir esa capa sin tocar el código,
desde el propio dashboard de Cloudflare.

## Paso 6 — Programar cada placa NFC

Cuando un cliente completa el pago, la pantalla de confirmación de tu
web le muestra (y a ti también) el link ya listo, con botón de copiar.
También queda guardado en el panel privado. Es esta URL la que
programáis en la placa con NFC Tools:

    https://taplink.es/go/bar-nou-x7k2

## Cómo se comporta ante un impago

1. Stripe intenta cobrar y falla → manda `invoice.payment_failed` a
   `taplink.es/webhook-nfc`.
2. El sistema busca el local con ese `stripe_subscription_id` y lo pone
   en `pausado`.
3. A partir de ahí, la placa de ese local deja de llevar a reseñas y lleva
   a `pago-pendiente.html`.
4. Si el cliente vuelve a pagar, llega `invoice.paid` y se reactiva solo.

## Sobre los límites gratuitos de Cloudflare KV

100.000 lecturas al día y 1.000 escrituras al día, gratis para siempre,
sin tarjeta ni periodo de prueba. Una lectura ocurre cada vez que alguien
toca una placa; una escritura, solo cuando se da de alta un cliente o
cambia su estado de pago. Para el volumen de un negocio como este, con
mucho margen de sobra.

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
- KV es "eventually consistent": un cambio de estado puede tardar unos
  segundos en propagarse a todas las regiones. Para este caso de uso
  (pausar un local tras un impago) no supone ningún problema real.
