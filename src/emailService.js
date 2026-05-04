const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.RESEND_FROM || 'Bot Gestión Humana <gestionhumana@megatiendas.co>';
const SST_DEST = 'apturnos@megatiendas.co';

// ─── SST accident alert ───────────────────────────────────────────────────────

async function sendSSTAlert({ phone, message, timestamp }) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto">
      <div style="background:#D41830;color:#fff;padding:20px;border-radius:8px 8px 0 0">
        <h1 style="margin:0;font-size:19px">⚠️ ALERTA CRÍTICA — ACCIDENTE DE TRABAJO</h1>
        <p style="margin:4px 0 0;font-size:12px">Bot Gestión Humana · Megatiendas Invercomer</p>
      </div>
      <div style="background:#fff8f8;border:1px solid #D41830;padding:24px;border-radius:0 0 8px 8px">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr>
            <td style="padding:8px 12px;font-weight:bold;color:#555;width:140px">Celular</td>
            <td style="padding:8px 12px">${phone}</td>
          </tr>
          <tr style="background:#fef9f9">
            <td style="padding:8px 12px;font-weight:bold;color:#555">Fecha/Hora (COT)</td>
            <td style="padding:8px 12px">${timestamp}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;font-weight:bold;color:#555">Mensaje</td>
            <td style="padding:8px 12px;color:#b91c1c">${message}</td>
          </tr>
        </table>
        <hr style="border:none;border-top:1px solid #fecaca;margin:18px 0">
        <p style="font-size:13px;color:#666;margin:0">
          <strong>Acción requerida:</strong> Contactar inmediatamente al colaborador y activar el protocolo de atención de accidentes laborales.<br>
          Generado automáticamente por el sistema de Gestión Humana de Megatiendas Invercomer.
        </p>
      </div>
    </div>`;

  await resend.emails.send({
    from:    FROM,
    to:      SST_DEST,
    subject: `🚨 ACCIDENTE SST — Cel ${phone} — ${timestamp}`,
    html
  });

  console.log(`[EMAIL] Alerta SST enviada a ${SST_DEST} para ${phone}`);
}

// ─── Consulta summary to employee ────────────────────────────────────────────

async function sendConsultaResponse({ to, phone, userMessage, botResponse, category, timestamp }) {
  const catColors = {
    SST:      '#D41830',
    Nómina:   '#1a56db',
    Jurídica: '#7e3af2',
    'P&P':    '#057a55',
    General:  '#374151'
  };
  const color = catColors[category] || catColors.General;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto">
      <div style="background:${color};color:#fff;padding:20px;border-radius:8px 8px 0 0">
        <h1 style="margin:0;font-size:17px">Resumen de tu consulta — ${category}</h1>
        <p style="margin:4px 0 0;font-size:12px">Bot Gestión Humana · Megatiendas Invercomer · ${timestamp}</p>
      </div>
      <div style="padding:24px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px;background:#fff">
        <p style="font-size:13px;color:#6b7280;margin:0 0 6px">Tu consulta:</p>
        <div style="background:#f3f4f6;border-left:3px solid ${color};padding:12px 16px;border-radius:4px;font-size:14px;color:#374151;margin-bottom:18px">
          ${userMessage}
        </div>
        <p style="font-size:13px;color:#6b7280;margin:0 0 6px">Respuesta:</p>
        <div style="font-size:14px;color:#111827;line-height:1.6;white-space:pre-wrap">${botResponse}</div>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
        <p style="font-size:12px;color:#9ca3af;margin:0">
          Para más información comunícate con Gestión Humana: <strong>apturnos@megatiendas.co</strong>
        </p>
      </div>
    </div>`;

  await resend.emails.send({
    from:    FROM,
    to,
    subject: `[${category}] Resumen de tu consulta — ${timestamp}`,
    html
  });

  console.log(`[EMAIL] Resumen enviado a ${to} (${phone}) — ${category}`);
}

// ─── Daily KPI report ─────────────────────────────────────────────────────────

async function sendDailyReport(stats) {
  const rows = (stats.categoryStats || []).map(c =>
    `<tr>
       <td style="padding:7px 14px">${c.category}</td>
       <td style="padding:7px 14px;text-align:right;font-weight:bold">${c.count}</td>
     </tr>`
  ).join('');

  const date = new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' });

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:580px">
      <div style="background:#003087;color:#fff;padding:20px;border-radius:8px 8px 0 0">
        <h1 style="margin:0;font-size:17px">Reporte Diario — Bot Gestión Humana</h1>
        <p style="margin:4px 0 0;font-size:12px">${date}</p>
      </div>
      <div style="padding:22px;border:1px solid #ddd;border-radius:0 0 8px 8px">
        <p style="margin:0 0 6px"><strong>Mensajes hoy:</strong> ${stats.todayCount}</p>
        <p style="margin:0 0 14px"><strong>Usuarios únicos totales:</strong> ${stats.uniqueUsers}</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#f0f4ff">
              <th style="padding:8px 14px;text-align:left">Categoría</th>
              <th style="padding:8px 14px;text-align:right">Consultas acumuladas</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;

  await resend.emails.send({
    from:    FROM,
    to:      SST_DEST,
    subject: `Reporte Diario Bot GH — ${date}`,
    html
  });

  console.log('[EMAIL] Reporte diario enviado.');
}

module.exports = { sendSSTAlert, sendConsultaResponse, sendDailyReport };
