export const SOURCE_URL = 'https://gcmdc-scora.netlify.app/ras';
export const API_URL = 'https://fuilylndxmosiiwjgrpc.supabase.co/rest/v1/rpc/listar_ras_disponiveis';
// Publishable key shipped by the original site's public JavaScript; not a service role key.
export const PUBLIC_KEY = 'sb_publishable_EPEZ2LY9XtNkdlFnAsRNaQ_Pi_nLs1c';
export const INTERVALS = [30, 60, 120, 300, 600];
export const DEFAULT_SETTINGS = { interval: 60, enabled: true, workdays: 'all', notifyChanges: false };

export function localDay(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function normalizeRows(payload) {
  if (!Array.isArray(payload)) throw new Error('A API retornou um formato inesperado.');
  const ids = new Set();
  return payload.map(row => {
    if (!row || row.id == null || typeof row.data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.data) || typeof row.local !== 'string' || !Number.isFinite(row.vagas) || !Number.isFinite(row.vagas_ocupadas) || row.vagas < 0 || row.vagas_ocupadas < 0 || (row.candidatura_ate && !Number.isFinite(Date.parse(row.candidatura_ate)))) {
      throw new Error('A API retornou uma vaga inválida. A última consulta válida foi preservada.');
    }
    const id = String(row.id);
    if (ids.has(id)) throw new Error('A API retornou identificadores duplicados.');
    ids.add(id);
    return {
      id, date: row.data, location: row.local,
      start: row.horario_inicio || '', end: row.horario_termino || '',
      notes: row.observacoes || '', total: row.vagas, occupied: row.vagas_ocupadas,
      remaining: Math.max(0, Math.min(row.vagas, Number.isFinite(row.vagas_restantes) ? row.vagas_restantes : row.vagas - row.vagas_ocupadas)),
      deadline: row.candidatura_ate || null,
    };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

export function statusOf(row, now = Date.now()) {
  if (row.date < localDay(now) || (row.deadline && Date.parse(row.deadline) <= now)) return 'closed';
  return row.remaining > 0 ? 'open' : 'full';
}

export function matchesWorkdays(row, workdays) {
  if (workdays === 'all') return true;
  // RAS is available on days off: work on even days => notify on odd days.
  return Number(row.date.slice(-2)) % 2 === (workdays === 'even' ? 1 : 0);
}

export function decorate(row, now = Date.now()) { return { ...row, status: statusOf(row, now) }; }

export function detectChanges(previous, current, now = Date.now()) {
  if (previous === null) return [];
  const old = new Map(previous.map(row => [row.id, row]));
  const changes = [];
  for (const row of current) {
    const before = old.get(row.id);
    const state = statusOf(row, now);
    let kind = null;
    if (!before) kind = state === 'open' ? 'opened' : 'added';
    else if (state === 'open' && (before.status !== 'open' || row.remaining > before.remaining)) kind = 'opened';
    else if (JSON.stringify({ ...before, status: undefined }) !== JSON.stringify({ ...row, status: undefined }) || before.status !== state) kind = 'updated';
    if (kind) changes.push({ kind, row: decorate(row, now) });
    old.delete(row.id);
  }
  for (const row of old.values()) changes.push({ kind: 'removed', row: { ...row, status: 'closed' } });
  return changes;
}

export function validateSettings(input) {
  if (!input || !INTERVALS.includes(input.interval) || typeof input.enabled !== 'boolean' || !['all', 'even', 'odd'].includes(input.workdays) || typeof input.notifyChanges !== 'boolean') throw new Error('Configuração inválida.');
  return { interval: input.interval, enabled: input.enabled, workdays: input.workdays, notifyChanges: input.notifyChanges };
}
