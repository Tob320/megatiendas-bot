const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode');
const path = require('path');
const { processMessage } = require('./aiEngine');
const storage = require('./storageManager');
const { sendSSTAlert } = require('./emailService');

const SESSIONS_DIR = path.join(__dirname, '..', 'data', 'sessions');
const MAX_RECONNECT = 5;

let sock;
let reconnectAttempts = 0;

// ─── Extraer texto plano del mensaje Baileys ──────────────────────────────────

function extractText(msg) {
  const m = msg.message;
  if (!m) return '';
  return m.conversation
    || m.extendedTextMessage?.text
    || m.imageMessage?.caption
    || m.videoMessage?.caption
    || m.buttonsResponseMessage?.selectedDisplayText
    || m.listResponseMessage?.title
    || '';
}

// ─── Conexión principal ───────────────────────────────────────────────────────

async function connect(io) {
  const { state, saveCreds } = await useMultiFileAuthState(SESSIONS_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['Megatiendas GH Bot', 'Chrome', '3.0'],
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    markOnlineOnConnect: false
  });

  // Persistir credenciales en cada actualización
  sock.ev.on('creds.update', saveCreds);

  // ── Eventos de conexión ──
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      global.whatsappStatus = 'qr';
      try {
        const dataUrl = await qrcode.toDataURL(qr, { width: 260 });
        io.emit('qr', { qr: dataUrl });
        io.emit('status', { status: 'qr' });
        console.log('[WHATSAPP] QR listo para escanear.');
      } catch (e) {
        console.error('[QR]', e.message);
      }
    }

    if (connection === 'open') {
      console.log('[WHATSAPP] ✓ Conectado y listo.');
      global.whatsappStatus = 'connected';
      reconnectAttempts = 0;
      io.emit('status', { status: 'connected' });
      io.emit('qr', { qr: null });
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut  = statusCode === DisconnectReason.loggedOut;

      console.warn('[WHATSAPP] Desconectado. Código:', statusCode);
      global.whatsappStatus = 'disconnected';
      io.emit('status', { status: 'disconnected' });

      if (loggedOut) {
        console.log('[WHATSAPP] Sesión cerrada por el usuario. Requiere nuevo QR.');
        io.emit('status', { status: 'auth_failed' });
        return;
      }

      if (reconnectAttempts < MAX_RECONNECT) {
        reconnectAttempts++;
        const delay = Math.min(3000 * reconnectAttempts, 30_000);
        console.log(`[WHATSAPP] Reconectando en ${delay / 1000}s (intento ${reconnectAttempts}/${MAX_RECONNECT})…`);
        setTimeout(() => connect(io), delay);
      } else {
        console.error('[WHATSAPP] Máximo de reconexiones alcanzado.');
        io.emit('status', { status: 'max_reconnect_reached' });
      }
    }
  });

  // ── Mensajes entrantes ──
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const jid = msg.key.remoteJid || '';
      if (jid.endsWith('@g.us') || jid === 'status@broadcast') continue;

      const phone = jid.replace('@s.whatsapp.net', '');
      const text  = extractText(msg).trim();
      if (!text) continue;

      console.log(`[MSG] ${phone}: ${text.substring(0, 70)}`);

      await storage.saveMessage({ phone, role: 'user', content: text, category: 'incoming' });

      try {
        const { response, category, isSST } = await processMessage(phone, text);

        await storage.saveMessage({ phone, role: 'assistant', content: response, category });
        storage.saveKPIEvent({ phone, category, messagePreview: text });

        io.emit('new_message', {
          phone,
          category,
          preview:   text.substring(0, 90),
          timestamp: new Date().toISOString()
        });

        if (isSST) {
          const ts = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
          await sendSSTAlert({ phone, message: text, timestamp: ts });
          io.emit('sst_alert', { phone, message: text });
          console.warn(`[SST CRÍTICO] Accidente reportado por ${phone}`);
        }

        await sock.sendMessage(jid, { text: response });

      } catch (err) {
        console.error('[AI] Error:', err.message);
        await sock.sendMessage(jid, {
          text: 'En este momento no puedo procesar tu consulta. Por favor escríbenos a *apturnos@megatiendas.co* o intenta de nuevo.'
        }).catch(() => {});
      }
    }
  });
}

// ─── Pairing code ─────────────────────────────────────────────────────────────

async function requestPairingCode(phone) {
  if (!sock) throw new Error('Bot no inicializado todavía. Espera unos segundos.');
  if (global.whatsappStatus === 'connected') throw new Error('Ya hay una sesión activa.');

  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 10) throw new Error('Número inválido. Usa el código de país (ej: 573205932136).');

  const code = await sock.requestPairingCode(cleaned);
  console.log(`[WHATSAPP] Pairing code para ${cleaned}: ${code}`);
  return code;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

function initWhatsApp(io) {
  connect(io).catch((err) => {
    console.error('[WHATSAPP] Error al inicializar:', err.message);
    setTimeout(() => connect(io), 5000);
  });
}

module.exports = { initWhatsApp, requestPairingCode };
