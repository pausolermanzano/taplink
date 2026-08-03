// functions/_lib/email.js
// Envía el correo de confirmación de pedido usando la API de Resend
// (https://resend.com) vía fetch, sin SDK ni dependencias npm — mismo
// estilo que el resto de funciones de este proyecto.
//
// Requiere la variable de entorno RESEND_API_KEY en Cloudflare Pages.
// El remitente (pedidos@taplink.es) debe pertenecer a un dominio ya
// verificado en Resend (Domains > taplink.es > Verified).

const FROM = 'Taplink <pedidos@taplink.es>';

export async function enviarConfirmacionPedido(env, { to, negocio, codigo, nfcLink }) {
  if (!env.RESEND_API_KEY) {
    throw new Error('Falta RESEND_API_KEY en las variables de entorno.');
  }

  const asunto = 'Tu pedido Taplink — código ' + codigo;

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0b0d16">
      <h2 style="margin:0 0 16px">¡Gracias por tu pedido!</h2>
      <p style="font-size:15px;line-height:1.6">Hola${negocio ? ' de parte de ' + escapeHtml(negocio) : ''},</p>
      <p style="font-size:15px;line-height:1.6">Hemos confirmado tu pedido. Guarda este código: lo necesitarás para crear tu cuenta en <strong>Mi Taplink</strong> y acceder a tu panel.</p>
      <p style="margin:26px 0;padding:18px 20px;background:#f2f3f7;border-left:4px solid #2b4bff;font-size:22px;font-weight:700;letter-spacing:.02em">${escapeHtml(codigo)}</p>
      <p style="font-size:15px;line-height:1.6">Este es el enlace que llevará tu placa a las reseñas de Google:</p>
      <p style="font-size:14px;word-break:break-all"><a href="${nfcLink}" style="color:#2b4bff">${nfcLink}</a></p>
      <p style="font-size:14px;line-height:1.6;margin-top:30px;color:#555">Grabamos tu placa y sale en menos de 24 h. Cualquier duda, respóndenos a este email o escríbenos a info@taplink.es.</p>
      <p style="font-size:13px;color:#888;margin-top:34px">Taplink · Placas NFC para reseñas de Google</p>
    </div>`;

  const texto = `¡Gracias por tu pedido!\n\n` +
    `Tu código de acceso al panel: ${codigo}\n\n` +
    `Enlace de tu placa: ${nfcLink}\n\n` +
    `Grabamos tu placa y sale en menos de 24 h.\n` +
    `Dudas: info@taplink.es`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: asunto,
      html,
      text: texto
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error('Resend error ' + res.status + ': ' + errText);
  }

  return res.json();
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Aviso interno a Taplink: se dispara junto con el email al cliente, cada
// vez que se confirma un pedido nuevo. Va a NOTIFICATIONS_TO (o, si no se
// ha configurado esa variable, a info@taplink.es por defecto) para que el
// equipo se entere sin tener que entrar al panel a comprobarlo.
export async function enviarNotificacionInterna(env, { negocio, nfcLink, codigo, nombreCliente, emailCliente, telefono }) {
  if (!env.RESEND_API_KEY) {
    throw new Error('Falta RESEND_API_KEY en las variables de entorno.');
  }
  const destino = env.NOTIFICATIONS_TO || 'info@taplink.es';

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0b0d16">
      <h2 style="margin:0 0 16px">Nuevo pedido confirmado</h2>
      <p style="font-size:15px;line-height:1.6"><strong>${escapeHtml(negocio)}</strong> acaba de completar su pago.</p>
      <p style="margin:20px 0;padding:14px 18px;background:#f2f3f7;border-left:4px solid #2b4bff;font-size:14px;line-height:1.7">
        Código: <strong>${escapeHtml(codigo)}</strong><br>
        Cliente: ${escapeHtml(nombreCliente || '—')}<br>
        Email: ${escapeHtml(emailCliente || '—')}<br>
        Teléfono: ${escapeHtml(telefono || '—')}
      </p>
      <p style="font-size:14px">Enlace de la placa (el que hay que grabar con NFC Tools):</p>
      <p style="font-size:14px;word-break:break-all"><a href="${nfcLink}" style="color:#2b4bff">${nfcLink}</a></p>
      <p style="font-size:13px;color:#888;margin-top:30px">Ya está guardado en el panel: taplink.es/panel.html</p>
    </div>`;

  const texto = `Nuevo pedido confirmado\n\n` +
    `Negocio: ${negocio}\nCódigo: ${codigo}\nCliente: ${nombreCliente || '—'}\nEmail: ${emailCliente || '—'}\nTeléfono: ${telefono || '—'}\n\n` +
    `Enlace de la placa: ${nfcLink}\n\nYa está guardado en el panel: taplink.es/panel.html`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM,
      to: [destino],
      subject: 'Nuevo pedido: ' + negocio + ' (' + codigo + ')',
      html,
      text: texto
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error('Resend error ' + res.status + ': ' + errText);
  }

  return res.json();
}
