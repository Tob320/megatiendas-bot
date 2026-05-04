// Almacenamiento en memoria — compatible con Vercel serverless
// KPI y conversaciones se reinician con cada deploy (sin SQLite ni filesystem)

const kpiEvents     = [];
const employeeEmails = new Map();
const conversations  = new Map();

async function init() {
  console.log('[STORAGE] Modo memoria activo.');
}

// ─── Mensajes ─────────────────────────────────────────────────────────────────

async function saveMessage({ phone, role, content, category }) {
  const key = phone;
  if (!conversations.has(key)) conversations.set(key, []);
  conversations.get(key).push({
    timestamp: new Date().toISOString(),
    role,
    content,
    category: category || 'General'
  });
}

// ─── KPI ──────────────────────────────────────────────────────────────────────

function saveKPIEvent({ phone, category, messagePreview }) {
  kpiEvents.push({
    phone,
    category,
    timestamp:       new Date().toISOString(),
    message_preview: (messagePreview || '').substring(0, 120)
  });
}

function getKPIStats() {
  const today = new Date().toISOString().split('T')[0];
  const todayEvents = kpiEvents.filter(e => e.timestamp.startsWith(today));
  const uniquePhones = new Set(kpiEvents.map(e => e.phone));

  return {
    todayCount:     todayEvents.length,
    totalCount:     kpiEvents.length,
    uniqueUsers:    uniquePhones.size,
    recentMessages: [...kpiEvents].reverse().slice(0, 15)
  };
}

function getCategoryStats() {
  const counts = {};
  kpiEvents.forEach(e => { counts[e.category] = (counts[e.category] || 0) + 1; });
  return Object.entries(counts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

// ─── Conversaciones ───────────────────────────────────────────────────────────

async function getConversations({ phone, month, year }) {
  const results = [];
  for (const [key, msgs] of conversations.entries()) {
    if (phone && !key.includes(phone)) continue;
    const filtered = msgs.filter(m => {
      if (year  && !m.timestamp.startsWith(year))  return false;
      if (month && !m.timestamp.startsWith(`${year}-${month.padStart(2,'0')}`)) return false;
      return true;
    });
    if (filtered.length) results.push({ phone: key, date: new Date().toISOString().split('T')[0], messages: filtered });
  }
  return results;
}

// ─── Emails ───────────────────────────────────────────────────────────────────

function saveEmployeeEmail(phone, email) {
  employeeEmails.set(phone, email);
}

function getEmployeeEmail(phone) {
  return employeeEmails.get(phone) || null;
}

module.exports = { init, saveMessage, saveKPIEvent, getKPIStats, getCategoryStats, getConversations, saveEmployeeEmail, getEmployeeEmail };
