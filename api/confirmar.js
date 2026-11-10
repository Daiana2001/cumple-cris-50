// Vercel Serverless Function — nunca poner claves privadas en index.html.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Los 50 de Cris <onboarding@resend.dev>';
const MAP_URL = 'https://maps.app.goo.gl/GmwJuMPMSViTPGvB8?g_st=ic';
const escapeHtml = (v) => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method !== 'POST') {res.setHeader('Allow','POST');return res.status(405).json({error:'Método no permitido.'});}
  if(!SUPABASE_URL || !SUPABASE_SECRET_KEY) return res.status(503).json({error:'Falta configurar Supabase en Vercel.'});
  if(!req.headers['content-type']?.toLowerCase().includes('application/json')) return res.status(415).json({error:'Formato inválido.'});
  const raw=req.body;
  if(JSON.stringify(raw||{}).length>6000) return res.status(413).json({error:'Formulario demasiado largo.'});
  const {nombre,email,asiste,cantidad_personas,acompanantes,mensaje}=raw||{};
  const name=typeof nombre==='string'?nombre.trim():'';
  const mail=typeof email==='string'?email.trim().toLowerCase():'';
  const names=Array.isArray(acompanantes)?acompanantes.map(v=>typeof v==='string'?v.trim():''):[];
  const msg=typeof mensaje==='string'?mensaje.trim():'';
  if(new Date()>=new Date('2026-12-01T03:00:00Z')) return res.status(403).json({error:'El plazo para confirmar ya terminó.'});
  if(name.length<2||name.length>120||!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail))||mail.length>254||typeof asiste!=='boolean'||!Number.isInteger(cantidad_personas)||cantidad_personas<1||cantidad_personas>6||msg.length>1000||names.some(n=>n.length<2||n.length>120)||names.length!==(asiste?cantidad_personas-1:0)||(!asiste&&cantidad_personas!==1)) return res.status(400).json({error:'Revisá los datos y los nombres de los acompañantes.'});
  // Inserción atómica: el índice UNIQUE en email evita duplicados simultáneos.
  let saved;
  try {
    const r=await fetch(`${SUPABASE_URL}/rest/v1/invitados_cris`,{
      method:'POST',headers:{'apikey':SUPABASE_SECRET_KEY,'Content-Type':'application/json','Prefer':'return=representation'},
      body:JSON.stringify({nombre:name,email:mail,asiste,cantidad_personas,acompanantes:names,mensaje:msg||null})
    });
    if(!r.ok){const error=await r.json().catch(()=>({}));if(r.status===409||error.code==='23505')return res.status(409).json({error:'Este correo ya tiene una confirmación registrada. 💗'});console.error('Supabase insert:',r.status,error.code);return res.status(502).json({error:'No se pudo guardar la confirmación. Avisale a la organizadora.'});}
    saved=(await r.json())[0];
  } catch(e){console.error('Supabase connection error',e);return res.status(502).json({error:'No se pudo conectar con la base de datos.'});}
  if(!asiste) return res.status(200).json({ok:true,emailEnviado:false});
  // La respuesta ya fue guardada; un fallo de correo NO permite volver a registrar el mismo email.
  if(!RESEND_API_KEY){console.error('RESEND_API_KEY missing');return res.status(200).json({ok:true,emailEnviado:false});}
  const companionList=names.length?`<p><strong>Acompañantes:</strong> ${names.map(escapeHtml).join(', ')}</p>`:'';
  const html=`<div style="font-family:Georgia,serif;max-width:560px;margin:auto;padding:28px;background:#fff7f4;color:#654d4c;text-align:center"><h1 style="color:#ad6d78">Los 50 de Cris ♡</h1><h2>¡Gracias por confirmar tu asistencia!</h2><p>¡Qué alegría que nos acompañes, ${escapeHtml(name)}!</p><p><strong>Sábado 12 de diciembre de 2026 · 21:30 hs</strong></p><p>Salón Sindicato Camioneros Ruta 22<br>Predio Camioneros Allen, Río Negro</p><p><a href="${MAP_URL}">Ver ubicación en Google Maps</a></p><p><strong>Personas confirmadas:</strong> ${cantidad_personas}</p>${companionList}<hr style="border:0;border-top:1px solid #e8d5cb;margin:24px 0"><h3 style="color:#ad6d78">🎁 Opciones de regalo</h3><p>Como soy una hormiguita aventurera 🐜, siempre sueño con mi próxima aventura. Si querés hacerme un regalito, podés ayudarme a cumplirla. ✈️💗</p><p>Alias: <strong>Hormiga.Aventurera</strong><br>A nombre de Daiana Villanueva</p><p>¡Nos vemos para celebrar! ♡</p></div>`;
  try{
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:FROM_EMAIL,to:[mail],subject:'¡Tu asistencia a los 50 de Cris está confirmada! 💗',html})});
    if(!r.ok){console.error('Resend send failed:',r.status,await r.text());return res.status(200).json({ok:true,emailEnviado:false});}
    return res.status(200).json({ok:true,emailEnviado:true});
  }catch(e){console.error('Resend connection error',e);return res.status(200).json({ok:true,emailEnviado:false});}
};
