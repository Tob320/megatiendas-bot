const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Conversation history keyed by phone number
const history = new Map();
const MAX_TURNS = 10; // Keep last 10 exchanges per user

// ─── System prompt (cached) ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres el asistente virtual de Gestión Humana de Megatiendas Invercomer. Atiendes a colaboradores y líderes de manera ejecutiva, empática y concisa (máximo 3 párrafos, salvo complejidad). Responde siempre en español.

**IDENTIDAD**
Áreas de atención: Nómina, SST (Salud y Seguridad en el Trabajo), Jurídica/Laboral y P&P (Riesgo, Prevención y Pérdida).

**PARÁMETROS LEGALES INNEGOCIABLES — Colombia 2026**
- Jornada máxima: 220 horas/mes (Ley 2101 de 2021, transición en curso).
- Recargo dominical y festivo: 80 % adicional sobre la hora ordinaria diurna (Ley 2466 de 2024, vigente).
- P&P significa siempre: "Riesgo, Prevención y Pérdida". No redefinir bajo ninguna circunstancia.
- Aplica la legislación laboral colombiana vigente. Si no tienes certeza de un dato legal específico, indícalo y remite al área jurídica.

**PROTOCOLO CRÍTICO — ACCIDENTE / EMERGENCIA SST**
Si el colaborador reporta un accidente, lesión, emergencia médica o riesgo inminente:
1. Coloca la etiqueta [SST_ACCIDENTE] al INICIO de tu respuesta (activa el protocolo automático de notificación).
2. Responde con calma, claridad y máxima prioridad.
3. Indica pasos de primeros auxilios básicos si aplica.
4. Informa que el caso ha sido escalado automáticamente al equipo de SST.
5. Solicita: nombre completo, cédula, sede/tienda, descripción del incidente y estado actual del colaborador.

**HABEAS DATA — Ley 1581 de 2012**
Al iniciar una conversación nueva, informa brevemente que sus datos se tratan conforme a la política de privacidad de Megatiendas Invercomer y la Ley 1581 de 2012. No solicites ni almacenes datos sensibles fuera del contexto laboral estrictamente necesario.

**CATEGORIZACIÓN**
Al final de cada respuesta, incluye la etiqueta: [CATEGORIA: Nómina|SST|Jurídica|P&P|General]

**CONTACTO DE URGENCIA**
Para urgencias laborales o seguimiento: apturnos@megatiendas.co`;

// ─── Category detection ───────────────────────────────────────────────────────

function detectCategory(text) {
  if (/accidente|lesión|herida|emergencia|sst|seguridad|riesgo|epp|salud ocup|enfermedad laboral/i.test(text)) return 'SST';
  if (/nómina|salario|pago|liquidación|cesantías|prima|vacacion|auxilio|descuento|colilla|devengado/i.test(text)) return 'Nómina';
  if (/contrato|despido|demanda|tutela|inspección|ministerio|jurídic|legal|fuero|sanción disciplinaria/i.test(text)) return 'Jurídica';
  if (/pérdida|robo|inventario|prevención|p&p|riesgo operacional|merma/i.test(text)) return 'P&P';
  return 'General';
}

function extractCategory(text) {
  const m = text.match(/\[CATEGORIA:\s*([\w&]+)\]/i);
  return m ? m[1].trim() : 'General';
}

// ─── Core processor ──────────────────────────────────────────────────────────

async function processMessage(phone, userMessage) {
  if (!history.has(phone)) history.set(phone, []);

  const conv = history.get(phone);
  conv.push({ role: 'user', content: userMessage });

  // Trim to MAX_TURNS (each turn = 2 messages)
  const trimmed = conv.slice(-(MAX_TURNS * 2));

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' } // Prompt caching — avoids re-processing on every turn
      }
    ],
    messages: trimmed
  });

  const raw = response.content[0].text;
  conv.push({ role: 'assistant', content: raw });
  history.set(phone, conv.slice(-(MAX_TURNS * 2)));

  const category = extractCategory(raw);
  const isSST    = raw.startsWith('[SST_ACCIDENTE]');

  // Strip internal tags before sending to user
  const clean = raw
    .replace(/\[SST_ACCIDENTE\]/g, '')
    .replace(/\[CATEGORIA:[^\]]+\]/gi, '')
    .trim();

  return { response: clean, category, isSST, inputCategory: detectCategory(userMessage) };
}

function clearHistory(phone) {
  history.delete(phone);
}

module.exports = { processMessage, clearHistory };
