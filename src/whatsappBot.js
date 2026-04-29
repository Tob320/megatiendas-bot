const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { processMessage } = require('./aiEngine');
const storage = require('./storageManager');
const { sendSSTAlert } = require('./emailService');

const COMPANY_NUMBER = process.env.COMPANY_PHONE || '3205932136';
const MAX_RECONNECT  = 5;

let client;
let reconnectAttempts = 0;
let currentIo;

// ─── Client factory ───────────────────────────────────────────────────────────

function createClient() {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: './data/sessions' }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ],
      ...(process.env.PUPPETEER_EXECUTABLE_PATH && {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
      })
    }
  });
}

// ─── Reconnect with exponential backoff ──────────────────────────────────────

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT) {
    console.error('[WHATSAPP] Máximo de reconexiones alcanzado. Requiere intervención manual.');
    currentIo.emit('status', { status: 'max_reconnect_reached' });
    return;
  }

  reconnectAttempts++;
  const delay = Math.min(5000 * reconnectAttempts, 60_000);
  console.log(`[WHATSAPP] Reconectando en ${delay / 1000}s (intento ${reconnectAttempts}/${MAX_RECONNECT})…`);

  setTimeout(async () => {
    try {
      await client.destroy().catch(() => {});
      attachEvents(currentIo);
      await client.initialize();
    } catch (err) {
      console.error('[WHATSAPP] Error en reconexión:', err.message);
      scheduleReconnect();
    }
  }, delay);
}

// ─── Event binding ────────────────────────────────────────────────────────────

function attachEvents(io) {
  client = createClient();

  client.on('qr', async (qr) => {
    console.log('[WHATSAPP] Nuevo QR generado — escanear en el dashboard.');
    global.whatsappStatus = 'qr';
    try {
      const dataUrl = await qrcode.toDataURL(qr, { width: 256 });
      io.emit('qr', { qr: dataUrl });
      io.emit('status', { status: 'qr' });
    } catch (e) {
      console.error('[QR]', e.message);
    }
  });

  client.on('authenticated', () => {
    console.log('[WHATSAPP] Sesión autenticada.');
    global.whatsappStatus = 'authenticated';
    io.emit('status', { status: 'authenticated' });
    reconnectAttempts = 0;
  });

  client.on('ready', () => {
    console.log(`[WHATSAPP] Listo. Número: ${COMPANY_NUMBER}`);
    global.whatsappStatus = 'connected';
    io.emit('status', { status: 'connected' });
    io.emit('qr', { qr: null });
  });

  client.on('auth_failure', (msg) => {
    console.error('[WHATSAPP] Fallo de autenticación:', msg);
    global.whatsappStatus = 'auth_failed';
    io.emit('status', { status: 'auth_failed' });
    // Session is invalid; operator must restart and scan a new QR
  });

  client.on('disconnected', (reason) => {
    console.warn('[WHATSAPP] Desconectado:', reason);
    global.whatsappStatus = 'disconnected';
    io.emit('status', { status: 'disconnected', reason });
    scheduleReconnect();
  });

  client.on('message', handleMessage);
}

// ─── Message handler ──────────────────────────────────────────────────────────

async function handleMessage(message) {
  // Skip groups, broadcast, and non-text
  if (message.from.includes('@g.us') || message.from === 'status@broadcast') return;
  if (message.isStatus || !message.body?.trim()) return;

  const phone    = message.from.replace('@c.us', '');
  const userText = message.body.trim();

  console.log(`[MSG] ${phone}: ${userText.substring(0, 70)}`);

  await storage.saveMessage({ phone, role: 'user', content: userText, category: 'incoming' });

  try {
    const { response, category, isSST } = await processMessage(phone, userText);

    await storage.saveMessage({ phone, role: 'assistant', content: response, category });
    storage.saveKPIEvent({ phone, category, messagePreview: userText });

    currentIo.emit('new_message', {
      phone,
      category,
      preview:   userText.substring(0, 90),
      timestamp: new Date().toISOString()
    });

    if (isSST) {
      const ts = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
      await sendSSTAlert({ phone, message: userText, timestamp: ts });
      currentIo.emit('sst_alert', { phone, message: userText });
      console.warn(`[SST CRÍTICO] Accidente reportado por ${phone}`);
    }

    await message.reply(response);

  } catch (err) {
    console.error('[AI] Error procesando mensaje:', err.message);
    await message.reply(
      'En este momento no puedo procesar tu consulta. Por favor escríbenos a *apturnos@megatiendas.co* o vuelve a intentarlo en unos minutos.'
    ).catch(() => {});
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

function initWhatsApp(io) {
  currentIo = io;
  attachEvents(io);
  client.initialize().catch((err) => {
    console.error('[WHATSAPP] Error al inicializar:', err.message);
    scheduleReconnect();
  });
}

module.exports = { initWhatsApp };
