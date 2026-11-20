
const crypto = require('node:crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL;
const REENVIO_SECRET = process.env.REENVIO_SECRET;

const MAP_URL = 'https://maps.app.goo.gl/GmwJuMPMSViTPGvB8?g_st=ic';

const escapeHtml = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY ||
      !RESEND_API_KEY || !FROM_EMAIL || !REENVIO_SECRET) {
    return res.status(503).json({
      error: 'Faltan variables de entorno.'
    });
  }

  // Solo la organizadora puede usar esta función.
  const supplied = req.headers['x-reenvio-secret'] || '';
  const a = Buffer.from(String(supplied));
  const b = Buffer.from(REENVIO_SECRET);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'No autorizado.' });
  }

  const email = typeof req.body?.email === 'string'
    ? req.body.email.trim().toLowerCase()
    : '';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Correo inválido.' });
  }

  try {
    // Buscar la confirmación existente, sin insertar registros.
    const url = new URL(`${SUPABASE_URL}/rest/v1/invitados_cris`);
    url.searchParams.set('select',
      'nombre,email,asiste,cantidad_personas,acompanantes');
    url.searchParams.set('email', `eq.${email}`);
    url.searchParams.set('limit', '1');

    const lookup = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!lookup.ok) {
      console.error('Supabase:', lookup.status);
      return res.status(502).json({
        error: 'No se pudo consultar Supabase.'
      });
    }

    const records = await lookup.json();
    const invitado = records[0];

    if (!invitado) {
      return res.status(404).json({
        error: 'No existe una confirmación con ese correo.'
      });
    }

    if (!invitado.asiste) {
      return res.status(400).json({
        error: 'Esta persona indicó que no asistirá.'
      });
    }

    const acompanantes = Array.isArray(invitado.acompanantes)
      ? invitado.acompanantes
      : [];

    const companionList = acompanantes.length
      ? `<p><strong>Acompañantes:</strong> ${
          acompanantes.map(escapeHtml).join(', ')
        }</p>`
      : '';

    const html = `
      <div style="font-family:Georgia,serif;max-width:560px;
        margin:auto;padding:28px;background:#fff7f4;
        color:#654d4c;text-align:center">

        <h1 style="color:#ad6d78">Los 50 de Cris ♡</h1>
        <h2>¡Tu asistencia está confirmada!</h2>

        <p>¡Qué alegría que nos acompañes,
          ${escapeHtml(invitado.nombre)}!</p>

        <p><strong>
          Sábado 12 de diciembre de 2026 · 21:30 hs
        </strong></p>

        <p>Salón Sindicato Camioneros Ruta 22<br>
          Predio Camioneros Allen, Río Negro</p>

        <p><a href="${MAP_URL}">
          Ver ubicación en Google Maps
        </a></p>

        <p><strong>Personas confirmadas:</strong>
          ${Number(invitado.cantidad_personas)}</p>

        ${companionList}

        <hr style="border:0;border-top:1px solid #e8d5cb;
          margin:24px 0">

        <h3 style="color:#ad6d78">🎁 Opciones de regalo</h3>

        <p>Como buena sagitariana aventurera ♐✨,
          Cris siempre está pensando en su próxima aventura.
          Si querés hacerle un regalo, podés transferir
          el importe que desees para que ella elija algo
          especial para su próximo viaje. ✈️💗</p>

        <p>Alias: <strong>sagitariana.aventura</strong><br>
          A nombre de Daiana Villanueva</p>

        <p>¡Nos vemos para celebrar! ♡</p>
      </div>
    `;

    const send = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [invitado.email],
        subject: '¡Tu asistencia a los 50 de Cris está confirmada! 💗',
        html
      })
    });

    if (!send.ok) {
      const error = await send.text();
      console.error('Resend:', send.status, error);

      return res.status(502).json({
        error: 'Resend rechazó el envío.',
        codigo: send.status
      });
    }

    const result = await send.json();

    return res.status(200).json({
      ok: true,
      mensaje: 'Correo aceptado por Resend.',
      resendId: result.id
    });

  } catch (error) {
    console.error('Error al reenviar:', error);
    return res.status(500).json({
      error: 'No se pudo completar el reenvío.'
    });
  }
};
