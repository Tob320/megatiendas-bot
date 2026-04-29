require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const storageManager = require('./src/storageManager');
const { initWhatsApp, requestPairingCode } = require('./src/whatsappBot');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/stats', (req, res) => {
  try {
    res.json(storageManager.getKPIStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/kpi/categories', (req, res) => {
  try {
    res.json(storageManager.getCategoryStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pairing-code', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Falta el número de teléfono.' });
  try {
    const code = await requestPairingCode(phone);
    res.json({ code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/conversations', async (req, res) => {
  try {
    const { phone, month, year } = req.query;
    const conversations = await storageManager.getConversations({ phone, month, year });
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

io.on('connection', (socket) => {
  console.log('[SOCKET] Dashboard conectado:', socket.id);
  socket.emit('status', { status: global.whatsappStatus || 'disconnected' });
  socket.on('disconnect', () => {
    console.log('[SOCKET] Dashboard desconectado:', socket.id);
  });
});

async function start() {
  await storageManager.init();
  initWhatsApp(io);
  server.listen(PORT, () => {
    console.log(`\n[SERVER] Dashboard → http://localhost:${PORT}\n`);
  });
}

start().catch(console.error);
