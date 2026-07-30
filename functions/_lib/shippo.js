// functions/_lib/shippo.js
// Genera una etiqueta de envío con Shippo a partir de la dirección del
// cliente (guardada en KV al hacer el pedido) y la dirección de origen
// de Taplink (variables de entorno). Se llama SOLO cuando Marc pulsa el
// botón "Generar etiqueta" en el panel — no es automático, para poder
// revisar la dirección antes de gastar dinero en la etiqueta.
//
// Requiere estas variables de entorno en Cloudflare Pages:
//   SHIPPO_API_KEY          (shippo_test_... o shippo_live_...)
//   SHIPPO_FROM_NAME        (ej. "Taplink")
//   SHIPPO_FROM_STREET1     (dirección desde donde se envían las placas)
//   SHIPPO_FROM_CITY
//   SHIPPO_FROM_ZIP
//   SHIPPO_FROM_STATE       (ej. "Girona" — puede dejarse igual que la ciudad)
//   SHIPPO_FROM_COUNTRY     (ej. "ES")
//   SHIPPO_FROM_PHONE
//   SHIPPO_FROM_EMAIL
// Opcionales (si no están, se usan valores por defecto para un sobre/
// caja pequeña con una placa NFC):
//   SHIPPO_PARCEL_WEIGHT_G, SHIPPO_PARCEL_LENGTH_CM,
//   SHIPPO_PARCEL_WIDTH_CM, SHIPPO_PARCEL_HEIGHT_CM

function requireFromAddress(env) {
  const faltan = ['SHIPPO_FROM_NAME', 'SHIPPO_FROM_STREET1', 'SHIPPO_FROM_CITY', 'SHIPPO_FROM_ZIP', 'SHIPPO_FROM_COUNTRY', 'SHIPPO_FROM_PHONE', 'SHIPPO_FROM_EMAIL']
    .filter(k => !env[k]);
  if (faltan.length) {
    throw new Error('Faltan variables de origen en Cloudflare: ' + faltan.join(', '));
  }
}

async function shippoFetch(env, path, body) {
  const res = await fetch('https://api.goshippo.com' + path, {
    method: 'POST',
    headers: {
      'Authorization': 'ShippoToken ' + env.SHIPPO_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    const msg = (data && (data.detail || JSON.stringify(data))) || ('HTTP ' + res.status);
    throw new Error('Shippo: ' + msg);
  }
  return data;
}

// Crea el envío, coge la tarifa más barata disponible y compra la
// etiqueta. Devuelve { trackingNumber, trackingUrl, labelUrl, carrier,
// servicio, precio }.
export async function comprarEtiqueta(env, local) {
  if (!env.SHIPPO_API_KEY) {
    throw new Error('Falta configurar SHIPPO_API_KEY en Cloudflare Pages.');
  }
  requireFromAddress(env);

  if (!local.direccion || !local.cp || !local.ciudad) {
    throw new Error('A este pedido le faltan datos de dirección del cliente.');
  }

  const address_from = {
    name: env.SHIPPO_FROM_NAME,
    street1: env.SHIPPO_FROM_STREET1,
    city: env.SHIPPO_FROM_CITY,
    zip: env.SHIPPO_FROM_ZIP,
    state: env.SHIPPO_FROM_STATE || env.SHIPPO_FROM_CITY,
    country: env.SHIPPO_FROM_COUNTRY,
    phone: env.SHIPPO_FROM_PHONE,
    email: env.SHIPPO_FROM_EMAIL
  };

  const address_to = {
    name: local.nombre_cliente || local.nombre_local,
    street1: local.direccion,
    city: local.ciudad,
    zip: local.cp,
    state: local.ciudad,
    country: 'ES', // El checkout actual solo recoge clientes de España.
    phone: local.telefono || '',
    email: local.email || ''
  };

  const parcel = {
    length: String(env.SHIPPO_PARCEL_LENGTH_CM || '12'),
    width: String(env.SHIPPO_PARCEL_WIDTH_CM || '12'),
    height: String(env.SHIPPO_PARCEL_HEIGHT_CM || '1'),
    distance_unit: 'cm',
    weight: String(env.SHIPPO_PARCEL_WEIGHT_G || '100'),
    mass_unit: 'g'
  };

  const shipment = await shippoFetch(env, '/shipments/', {
    address_from, address_to, parcels: [parcel], async: false
  });

  const rates = (shipment.rates || []).filter(r => r.amount);
  if (!rates.length) {
    throw new Error('Shippo no ha devuelto ninguna tarifa para esta dirección. Revisa que la dirección del cliente sea correcta.');
  }
  rates.sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount));
  const mejor = rates[0];

  const transaction = await shippoFetch(env, '/transactions/', {
    rate: mejor.object_id,
    label_file_type: 'PDF',
    async: false
  });

  if (transaction.status !== 'SUCCESS') {
    const err = (transaction.messages || []).map(m => m.text).join(' | ') || transaction.status;
    throw new Error('Shippo no ha podido generar la etiqueta: ' + err);
  }

  return {
    trackingNumber: transaction.tracking_number || '',
    trackingUrl: transaction.tracking_url_provider || '',
    labelUrl: transaction.label_url || '',
    carrier: mejor.provider || '',
    servicio: mejor.servicelevel && mejor.servicelevel.name || '',
    precio: mejor.amount + ' ' + mejor.currency
  };
}
