import { randomUUID } from 'node:crypto';
import { API_URL, PUBLIC_KEY, decorate, detectChanges, normalizeRows, matchesWorkdays, statusOf } from './domain.js';
import { sourceRequest } from './source.js';

export class Monitor {
  constructor(store, { fetcher = sourceRequest, push, now = () => Date.now() } = {}) {
    this.store = store; this.fetcher = fetcher; this.push = push; this.now = now;
    this.timer = null; this.inflight = null; this.delivery = null; this.nextCheck = null; this.failures = 0; this.stopped = false;
  }
  schedule() {
    clearTimeout(this.timer); this.nextCheck = null;
    if (this.stopped || !this.store.state.settings.enabled) return;
    const delay = Math.min(900, this.store.state.settings.interval * 2 ** Math.min(this.failures, 4)) * 1000;
    this.nextCheck = this.now() + delay;
    this.timer = setTimeout(() => this.check().catch(console.error), delay);
    this.timer.unref?.();
  }
  check() {
    if (this.inflight) return this.inflight;
    clearTimeout(this.timer); this.nextCheck = null;
    this.inflight = this.run().finally(() => { this.inflight = null; this.schedule(); });
    return this.inflight;
  }
  async run() {
    const state = this.store.state;
    try {
      const response = await this.fetcher(API_URL, {
        method: 'POST', headers: { apikey: PUBLIC_KEY, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
        body: '{}', signal: AbortSignal.timeout(65_000),
      });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'O SCORA passou a exigir autorização. A consulta precisa ser reconfigurada.' : `O SCORA respondeu com erro ${response.status}. Uma nova tentativa será feita automaticamente.`);
      const rows = normalizeRows(await response.json());
      const now = this.now();
      const initial = state.snapshot === null;
      const changes = detectChanges(state.snapshot, rows, now);
      state.snapshot = rows.map(row => decorate(row, now));
      state.lastCheck = new Date(now).toISOString(); state.checks += 1; state.error = null; this.failures = 0;
      if (changes.length) state.lastChange = state.lastCheck;
      if (initial) state.events.unshift({ id: randomUUID(), kind: 'connected', at: state.lastCheck, title: 'Primeira consulta concluída', detail: `${rows.length} RAS encontrados. Acompanhando as próximas alterações.` });
      for (const change of changes) {
        const date = change.row.date.split('-').reverse().join('/');
        const title = change.kind === 'opened' ? 'Vaga aberta no radar' : change.kind === 'added' ? 'Novo RAS encontrado' : change.kind === 'removed' ? 'RAS removido da lista' : 'RAS atualizado';
        const detail = `${change.row.location} · ${date} · ${change.row.remaining} vaga(s) restante(s)`;
        const event = { id: randomUUID(), kind: change.kind, at: state.lastCheck, title, detail, row: change.row };
        state.events.unshift(event);
        if (matchesWorkdays(change.row, state.settings.workdays) && (change.kind === 'opened' || state.settings.notifyChanges)) {
          for (const subscription of state.subscriptions) state.outbox.push({ id: randomUUID(), eventId: event.id, endpoint: subscription.endpoint, payload: { title, body: detail, tag: event.id }, attempts: 0, nextAttempt: now, expires: now + 3_600_000 });
        }
      }
      state.events = state.events.slice(0, 200);
      this.store.save();
    } catch (error) {
      this.failures += 1;
      state.error = ['TimeoutError', 'AbortError'].includes(error.name) ? 'O SCORA demorou para responder. Tentaremos novamente automaticamente.' : error.message === 'fetch failed' || ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(error.code) ? 'Não foi possível alcançar o SCORA. Verifique a conexão do servidor.' : error.message;
      this.store.save();
    }
    await this.deliver();
  }
  deliver() {
    if (this.delivery) return this.delivery;
    this.delivery = this.flush().finally(() => { this.delivery = null; });
    return this.delivery;
  }
  async flush() {
    if (!this.push) return;
    const state = this.store.state;
    for (const job of [...state.outbox]) {
      if (job.nextAttempt > this.now()) continue;
      const subscription = state.subscriptions.find(item => item.endpoint === job.endpoint);
      const event = state.events.find(item => item.id === job.eventId);
      const current = event?.row && state.snapshot?.find(row => row.id === event.row.id);
      const obsolete = event?.kind === 'opened' && (!current || statusOf(current, this.now()) !== 'open' || !matchesWorkdays(current, state.settings.workdays));
      if (!subscription || job.expires <= this.now() || obsolete) { state.outbox = state.outbox.filter(item => item.id !== job.id); continue; }
      try {
        await this.push(subscription, job.payload);
        state.outbox = state.outbox.filter(item => item.id !== job.id);
        state.lastPush = new Date(this.now()).toISOString(); state.pushError = null;
      } catch (error) {
        if ([404, 410].includes(error.statusCode)) {
          state.subscriptions = state.subscriptions.filter(item => item.endpoint !== job.endpoint);
          state.outbox = state.outbox.filter(item => item.endpoint !== job.endpoint);
          state.pushError = 'Um dispositivo perdeu a permissão de notificações. Ative os alertas novamente nele.';
        } else {
          job.attempts += 1; job.nextAttempt = this.now() + Math.min(900, 30 * 2 ** job.attempts) * 1000;
          state.pushError = 'Um aviso não pôde ser enviado. O servidor tentará novamente por até uma hora.';
        }
      }
      this.store.save();
    }
    this.store.save();
  }
  view() {
    const state = this.store.state;
    return {
      settings: state.settings, rows: (state.snapshot || []).map(row => decorate(row, this.now())), events: state.events,
      initialized: state.snapshot !== null, checking: !!this.inflight, lastCheck: state.lastCheck, lastChange: state.lastChange,
      nextCheck: this.nextCheck, checks: state.checks, error: state.error, pushError: state.pushError || null,
      devices: state.subscriptions.length, lastPush: state.lastPush || null, serverTime: this.now(),
    };
  }
  stop() { this.stopped = true; clearTimeout(this.timer); this.nextCheck = null; }
}
