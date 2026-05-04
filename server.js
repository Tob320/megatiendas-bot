require('dotenv').config();
const express = require('express');
const path    = require('path');
const storage = require('./src/storageManager');
const { processMessage }    = require('./src/aiEngine');
const { sendConsultaResponse, sendSSTAlert } = require('./src/emailService');

const app   = express();
const PORT  = process.env.PORT || 3000;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Chat ──────────────────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { email, message } = req.body;

  if (!email || !EMAIL_REGEX.test(email.trim()))
    return res.status(400).json({ error: 'Correo electrónico inválido.' });
  if (!message || !message.trim())
    return res.status(400).json({ error: 'El mensaje no puede estar vacío.' });

  const cleanEmail = email.trim().toLowerCase();
  const cleanMsg   = message.trim();

  try {
    const { response, category, isSST } = await processMessage(cleanEmail, cleanMsg);
    const ts = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });

    await storage.saveMessage({ phone: cleanEmail, role: 'user',      content: cleanMsg, category });
    await storage.saveMessage({ phone: cleanEmail, role: 'assistant', content: response, category });
    storage.saveKPIEvent({ phone: cleanEmail, category, messagePreview: cleanMsg });

    if (isSST) {
      await sendSSTAlert({ phone: cleanEmail, message: cleanMsg, timestamp: ts });
    }

    await sendConsultaResponse({
      to:          cleanEmail,
      phone:       cleanEmail,
      userMessage: cleanMsg,
      botResponse: response,
      category,
      timestamp:   ts
    });

    res.json({ response, category, emailSent: true });
  } catch (err) {
    console.error('[CHAT]', err.message);
    res.status(500).json({ error: 'Error procesando tu consulta. Intenta de nuevo.' });
  }
});

// ── KPI APIs ──────────────────────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  try { res.json(storage.getKPIStats()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/kpi/categories', (req, res) => {
  try { res.json(storage.getCategoryStats()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/conversations', async (req, res) => {
  try {
    const { phone, month, year } = req.query;
    res.json(await storage.getConversations({ phone, month, year }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Start ─────────────────────────────────────────────────────────────────────

storage.init().then(() => {
  app.listen(PORT, () => console.log(`[SERVER] http://localhost:${PORT}`));
}).catch(console.error);

module.exports = app;
