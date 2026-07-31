// functions/panel-datos.js
// Devuelve el listado completo de locales (placas NFC) guardado en
// Cloudflare KV, para pintarlo en el panel privado (panel.html). Solo
// lectura, protegido por una contraseña compartida (ADMIN_PASSWORD) que
// el panel envía en la cabecera "x-panel-password".

import { listLocales } from './_lib/kv.js';

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  const password = request.headers.get('x-panel-password');
  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return json({ error: 'No autorizado' }, 401);
  }

  try {
    const locales = await listLocales(env);
    return json({ locales });
  } catch (err) {
    console.error('Error leyendo locales de KV: ' + (err && err.message));
    return json({ error: 'Error interno: ' + (err && err.message) }, 500);
  }
}
