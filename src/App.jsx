import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowDownUp, ArrowRight, ArrowUpRight, Bell, BellRing, CalendarDays, Check, CheckCheck, ChevronRight, CircleHelp, Clock3, ExternalLink, History, LayoutDashboard, LoaderCircle, MapPin, Pause, Play, Radar, RefreshCw, Search, Settings2, ShieldCheck, Smartphone, Sparkles, Users, WifiOff, X } from 'lucide-react';

const SOURCE = 'https://gcmdc-scora.netlify.app/ras';
const INTERVALS = [{ value: 30, label: '30 segundos' }, { value: 60, label: '1 minuto' }, { value: 120, label: '2 minutos' }, { value: 300, label: '5 minutos' }, { value: 600, label: '10 minutos' }];
const formatTime = value => value ? new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Sao_Paulo' }) : '—';
const formatDate = value => new Date(`${value}T12:00:00-03:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'America/Sao_Paulo' }).replace('.', '');
const weekday = value => new Date(`${value}T12:00:00-03:00`).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'America/Sao_Paulo' }).replace('.', '');
function relative(value, now) {
  if (!value) return 'Nenhuma alteração';
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000));
  if (seconds < 60) return 'Há poucos segundos';
  if (seconds < 3600) return `Há ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `Há ${Math.floor(seconds / 3600)} h`;
  return new Date(value).toLocaleDateString('pt-BR');
}
async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(30_000) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Não foi possível concluir a solicitação.'); error.status = response.status; throw error; }
  return data;
}
function Brand() { return <div className="brand"><span className="brand-symbol"><Radar size={25} strokeWidth={1.8} /></span><span>ras<span className="brand-light">radar</span><small>SEU PRÓXIMO RAS, AQUI.</small></span></div>; }
function Toggle({ value, onChange, label, disabled }) { return <button type="button" className={`toggle ${value ? 'on' : ''}`} role="switch" aria-label={label} aria-checked={value} onClick={() => onChange(!value)} disabled={disabled}><span /></button>; }
function Modal({ title, children, onClose, toast, onDismiss }) {
  const dialog = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className="modal" onCancel={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }}><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Fechar" onClick={onClose}><X size={20} /></button></div>{children}{toast && <div className={`modal-toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}><span>{toast.message}</span><button aria-label="Fechar aviso" onClick={onDismiss}><X size={15} /></button></div>}</dialog>;
}
function EventList({ events, now, expanded = false }) {
  if (!events.length) return <div className="empty-history"><History size={26} /><p>O histórico começa na primeira consulta.</p><small>As próximas mudanças aparecerão aqui.</small></div>;
  return <div className={`event-list ${expanded ? 'expanded' : ''}`}>{events.map(event => <div className="event" key={event.id}><span className={`event-icon ${event.kind === 'opened' ? 'green' : ''}`}>{event.kind === 'opened' ? <BellRing size={15} /> : event.kind === 'connected' ? <CheckCheck size={15} /> : <RefreshCw size={14} />}</span><div><strong>{event.title}</strong><p>{event.detail}</p><time title={new Date(event.at).toLocaleString('pt-BR')}>{relative(event.at, now)}</time></div></div>)}</div>;
}

export default function App() {
  const [auth, setAuth] = useState(null);
  const [password, setPassword] = useState('');
  const [data, setData] = useState(null);
  const [offline, setOffline] = useState('');
  const [page, setPage] = useState('dashboard');
  const [tab, setTab] = useState('all');
  const [date, setDate] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('asc');
  const [pageIndex, setPageIndex] = useState(0);
  useEffect(() => setPageIndex(0), [tab, date, search, sort, data?.settings.workdays]);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const toastTimer = useRef();
  const skew = useRef(0);
  function notify(message, error = false) { setToast({ message, error }); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 6500); }
  function receive(result) { skew.current = result.serverTime - Date.now(); setData(result); setOffline(''); }
  useEffect(() => {
    api('/auth').then(setAuth).catch(() => setOffline('Não foi possível conectar ao servidor. Confirme que ele está ligado.'));
    const tick = setInterval(() => setNow(Date.now() + skew.current), 1000);
    const install = event => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener('beforeinstallprompt', install);
    if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => { clearInterval(tick); clearTimeout(toastTimer.current); window.removeEventListener('beforeinstallprompt', install); };
  }, []);
  useEffect(() => {
    if (!auth?.authenticated) return;
    let active = true;
    let pending = false;
    const update = async () => {
      if (pending) return;
      pending = true;
      try { const result = await api('/status'); if (active) receive(result); }
      catch (error) { if (active) { if (error.status === 401) { setAuth({ authenticated: false, required: true }); setData(null); } else setOffline('Conexão com o servidor interrompida. Os dados abaixo podem estar desatualizados.'); } }
      finally { pending = false; }
    };
    update(); const timer = setInterval(update, 5000);
    const onVisible = () => { if (document.visibilityState === 'visible') update(); };
    document.addEventListener('visibilitychange', onVisible);
    if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.ready.then(reg => reg.pushManager?.getSubscription()).then(async sub => { if (sub) { const result = await api('/push/status', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }); if (active) setPushEnabled(result.registered); } }).catch(() => {});
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [auth?.authenticated]);
  async function login(event) {
    event.preventDefault(); setBusy(true);
    try { await api('/login', { method: 'POST', body: JSON.stringify({ password }) }); setPassword(''); setAuth({ authenticated: true, required: true }); }
    catch (error) { notify(error.message, true); } finally { setBusy(false); }
  }
  async function check() {
    setBusy(true);
    try { const result = await api('/check', { method: 'POST', body: '{}' }); receive(result); notify('Verificação iniciada. O painel será atualizado ao receber a resposta.'); }
    catch (error) { notify(error.message, true); } finally { setBusy(false); }
  }
  async function settings(patch) {
    if (!data || saving) return;
    setSaving(true);
    try { receive(await api('/settings', { method: 'PUT', body: JSON.stringify({ ...data.settings, ...patch }) })); notify('Preferências salvas.'); }
    catch (error) { notify(error.message, true); } finally { setSaving(false); }
  }
  async function enablePush() {
    if (!window.isSecureContext) return notify('Abra o painel em um endereço HTTPS para ativar os avisos no celular.', true);
    if (!('PushManager' in window) || !('Notification' in window)) return notify('No iPhone, adicione o site à Tela de Início e abra pelo ícone. No Android, use um navegador com suporte a notificações.', true);
    setPushBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Permita as notificações nas configurações do navegador para receber os avisos.');
      const registration = await navigator.serviceWorker.ready;
      const { publicKey } = await api('/push/key');
      const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
      const sub = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await api('/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
      setPushEnabled(true); notify('Dispositivo conectado! Você já pode testar o aviso.');
      receive(await api('/status'));
    } catch (error) { notify(error.message, true); } finally { setPushBusy(false); }
  }
  async function pushAction(action) {
    setPushBusy(true);
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (!sub) throw new Error('Ative as notificações primeiro.');
      await api(`/push/${action}`, { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
      if (action === 'unsubscribe') { await sub.unsubscribe(); setPushEnabled(false); }
      notify(action === 'test' ? 'Teste aceito pelo serviço de push. Confira as notificações do aparelho.' : 'Alertas desativados neste dispositivo.');
      receive(await api('/status'));
    } catch (error) { notify(error.message, true); } finally { setPushBusy(false); }
  }
  const rows = data?.rows || [];
  const config = data?.settings || { interval: 60, enabled: true, workdays: 'all', notifyChanges: false };
  const eligible = rows.filter(row => config.workdays === 'all' || Number(row.date.slice(-2)) % 2 === (config.workdays === 'even' ? 1 : 0));
  const open = eligible.filter(row => row.status === 'open');
  const dates = [...new Set(eligible.map(row => row.date))];
  const filtered = eligible.filter(row => (tab === 'all' || row.status === tab) && (date === 'all' || row.date === date) && row.location.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))).sort((a, b) => sort === 'asc' ? a.date.localeCompare(b.date) || a.start.localeCompare(b.start) : b.date.localeCompare(a.date) || b.start.localeCompare(a.start));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 6));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const visibleRows = filtered.slice(currentPage * 6, currentPage * 6 + 6);
  const seconds = data?.nextCheck ? Math.max(0, Math.ceil((data.nextCheck - now) / 1000)) : null;
  const stale = data?.lastCheck && now - Date.parse(data.lastCheck) > Math.max(config.interval * 2000 + 30_000, 90_000);
  const problem = offline || data?.error;
  const healthy = data?.initialized && !problem && !stale;
  const statusText = problem ? 'Conexão interrompida' : !data?.initialized ? 'Conectando ao SCORA' : !config.enabled ? 'Monitoramento pausado' : stale ? 'Aguardando atualização' : 'Monitoramento ativo';
  const pageTitles = { dashboard: 'Visão geral', history: 'Histórico de atualizações', settings: 'Configurações' };

  return <>
    {auth && !auth.authenticated ? <main className="login-screen"><div className="login-card"><Brand /><h1>Seu radar, só seu.</h1><p>Digite a senha de acesso definida para este painel.</p><form onSubmit={login}><label>Senha do painel<input autoFocus type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label><button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />} Entrar no painel</button></form><small>Esta é a senha do RAS Radar, não a sua senha do SCORA.</small></div></main> : <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace"><span className="workspace-avatar"><ShieldCheck size={20} /></span><span><strong>Meu monitor de RAS</strong><small>GCM · Duque de Caxias</small></span><span className="workspace-dot" /></div>
        <p className="nav-label">ACOMPANHAMENTO</p>
        <nav aria-label="Menu principal">{[{ id: 'dashboard', label: 'Visão geral', Icon: LayoutDashboard }, { id: 'history', label: 'Histórico', Icon: History }, { id: 'settings', label: 'Configurações', Icon: Settings2 }].map(({ id, label, Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => setPage(id)}><Icon size={19} /><span>{label}</span>{id === 'dashboard' && <span className="nav-dot" />}</button>)}</nav>
        <div className="sidebar-bottom"><div className="mobile-card"><span className="mobile-icon"><Smartphone size={23} /><span className="tiny-dot" /></span><strong>Seu radar vai com você</strong><p>Receba um aviso no celular quando uma vaga abrir.</p><button onClick={() => setModal('push')}>Configurar alertas <ArrowUpRight size={16} /></button></div><button className="help-link" onClick={() => setModal('help')}><CircleHelp size={18} /> Como funciona <ArrowUpRight size={15} /></button><div className="sidebar-footer"><span className="mini-logo"><Radar size={15} /></span><span>Feito para a sua próxima escala.</span></div></div>
      </aside>
      <div className="main-wrap">
        <header className="topbar"><div className="breadcrumb"><span>Meu espaço</span><ChevronRight size={14} /><strong>{pageTitles[page]}</strong></div><div className="topbar-right"><span className="today"><CalendarDays size={15} />{new Date(now).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })}</span><span className="topbar-divider" /><button className="notification-button" aria-label="Configurar notificações" onClick={() => setModal('push')}><Bell size={20} />{pushEnabled && <i />}</button><span className="avatar">EU</span></div></header>
        <main className="content">
          <div className="page-heading"><div><div className="eyebrow"><span /> SEU TEMPO IMPORTA</div><h1>{page === 'dashboard' ? 'Suas oportunidades, no radar.' : pageTitles[page]}</h1><p>{page === 'dashboard' ? 'Acompanhe as vagas de RAS e saiba quando a próxima oportunidade aparecer.' : page === 'history' ? 'Cada mudança detectada, com data e hora. Tudo em um só lugar.' : 'Deixe o radar acompanhar o que faz sentido para a sua escala.'}</p></div><a className="button secondary source-button" href={SOURCE} target="_blank" rel="noreferrer">Abrir SCORA <ArrowUpRight size={16} /></a></div>
          {problem && <div className="error-banner" role="alert"><WifiOff size={19} /><div><strong>Não foi possível atualizar o radar</strong><p>{problem}</p></div><button onClick={auth ? check : () => window.location.reload()} disabled={busy}>Tentar novamente</button></div>}
          {page === 'dashboard' && <>
            <section className={`monitor-banner ${!config.enabled ? 'paused' : ''}`}><div className="banner-radar"><Radar size={28} /></div><div className="banner-copy"><div><h2>{statusText}</h2><span className={`live-badge ${healthy && config.enabled ? '' : 'muted'}`}><i />{healthy && config.enabled ? 'AO VIVO' : !config.enabled ? 'PAUSADO' : 'AGUARDANDO'}</span></div><p>{config.enabled ? `Conferindo o SCORA a cada ${INTERVALS.find(item => item.value === config.interval)?.label}. A gente acompanha para você.` : 'Suas preferências estão salvas. Retome quando quiser.'}</p></div><div className="next-check"><span>Próxima verificação</span><strong>{!config.enabled ? 'Pausado' : busy || data?.checking ? 'Consultando…' : seconds !== null ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : 'Conectando…'}</strong></div><button className="banner-control" title={config.enabled ? 'Pausar monitoramento' : 'Retomar monitoramento'} aria-label={config.enabled ? 'Pausar monitoramento' : 'Retomar monitoramento'} onClick={() => settings({ enabled: !config.enabled })} disabled={saving || !data}>{config.enabled ? <Pause size={18} /> : <Play size={18} />}</button></section>
            <section className="stats" aria-label="Resumo das vagas"><Stat icon={CalendarDays} label="RAS monitorados" value={data?.initialized ? eligible.length.toString().padStart(2, '0') : '—'} detail="Na sua seleção de escala" /><Stat icon={Users} label="Vagas abertas" value={data?.initialized ? open.reduce((sum, row) => sum + row.remaining, 0).toString().padStart(2, '0') : '—'} detail={`${open.length} RAS com candidaturas abertas`} green /><Stat icon={CalendarDays} label="Datas no radar" value={data?.initialized ? dates.length.toString().padStart(2, '0') : '—'} detail="Dias com RAS na listagem" /><Stat icon={Activity} label="Última alteração" value={data?.lastChange ? formatTime(data.lastChange).slice(0, 5) : '—'} detail={relative(data?.lastChange, now)} small /></section>
            <div className="dashboard-grid"><div className="opportunities card"><div className="card-heading"><div><h2>Vagas de RAS <span className="count-badge">{eligible.length}</span></h2><p>Encontre a próxima data para a sua escala.</p></div><button className="button compact" onClick={check} disabled={busy || !auth?.authenticated}><RefreshCw size={15} className={busy || data?.checking ? 'spin' : ''} />Verificar agora</button></div><div className="vacancy-tabs" role="tablist" aria-label="Status das vagas">{[{ id: 'all', label: 'Todos os RAS' }, { id: 'open', label: 'Abertos' }, { id: 'full', label: 'Esgotados' }, { id: 'closed', label: 'Encerrados' }].map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'selected' : ''} onClick={() => setTab(item.id)}>{item.label}{item.id === 'open' && <span>{open.length}</span>}</button>)}</div><div className="list-tools"><label className="search-input"><Search size={17} /><input aria-label="Buscar por local" placeholder="Buscar por local…" value={search} onChange={event => setSearch(event.target.value)} /></label><button className="sort-button" onClick={() => setSort(sort === 'asc' ? 'desc' : 'asc')} aria-label="Alterar ordem das datas"><ArrowDownUp size={15} /><span>{sort === 'asc' ? 'Mais próximas' : 'Mais distantes'}</span></button></div><div className="date-filters"><button className={date === 'all' ? 'selected' : ''} onClick={() => setDate('all')}><CalendarDays size={16} /><span>Todas as datas</span></button>{dates.slice(0, 8).map(day => <button key={day} className={date === day ? 'selected' : ''} onClick={() => setDate(day)}>{formatDate(day)} <span className="day-week">{weekday(day)}</span></button>)}{dates.length > 8 && <select aria-label="Outras datas" value={date} onChange={event => setDate(event.target.value)}><option value="all">Outras datas</option>{dates.map(day => <option key={day} value={day}>{formatDate(day)}</option>)}</select>}</div>
              {!data?.initialized ? <div className="empty-state"><span className="empty-radar"><Radar size={36} className={!problem ? 'slow-spin' : ''} /></span><h3>{problem ? 'Aguardando conexão' : 'Preparando o seu radar'}</h3><p>As vagas reais do SCORA aparecerão aqui assim que a primeira consulta terminar.</p></div> : !filtered.length ? <div className="empty-state"><span className="empty-radar"><Radar size={36} /></span><h3>{tab === 'open' ? 'Nenhuma vaga aberta por enquanto' : 'Nenhum RAS nesta seleção'}</h3><p>{tab === 'open' ? 'O radar continua acompanhando. Ative os alertas para saber quando uma oportunidade surgir.' : 'Experimente outra data, status ou nome de local.'}</p>{tab === 'open' && <button className="button secondary" onClick={() => setModal('push')}><Bell size={16} />Configurar alertas</button>}</div> : <div className="table-scroll"><table><thead><tr><th>DATA / LOCAL</th><th>HORÁRIO</th><th>VAGAS</th><th>STATUS</th><th><span className="sr-only">Acessar</span></th></tr></thead><tbody>{visibleRows.map(row => <tr key={row.id}><td><div className="vacancy-name"><div className={`date-box ${row.status === 'open' ? 'open' : ''}`}><strong>{row.date.slice(-2)}</strong><span>{weekday(row.date)}</span></div><div><strong>{row.location}</strong><span><MapPin size={11} />{formatDate(row.date)} · RAS #{row.id}</span></div></div></td><td><div className="time-cell"><Clock3 size={13} /><span>{row.start.slice(0, 5) || '—'} – {row.end.slice(0, 5) || '—'}</span></div><small>{row.notes.trim() || 'Sem observações'}</small></td><td><div className="capacity"><strong>{row.remaining}</strong><span> / {row.total}</span><div className="capacity-track"><i style={{ width: `${row.total ? row.occupied / row.total * 100 : 0}%` }} /></div></div></td><td><span className={`status-badge ${row.status}`}><i />{row.status === 'open' ? 'Aberto' : row.status === 'full' ? 'Esgotado' : 'Encerrado'}</span><small title={row.deadline ? new Date(row.deadline).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : ''}>{row.deadline ? `${row.status === 'closed' ? 'Prazo' : 'Até'} ${new Date(row.deadline).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })} · ${formatTime(row.deadline).slice(0, 5)}` : 'Sem prazo informado'}</small></td><td><a className="row-link" href={SOURCE} target="_blank" rel="noreferrer" aria-label={`Ver ${row.location} no SCORA`}><ArrowUpRight size={17} /></a></td></tr>)}</tbody></table></div>}
              <div className="table-footer"><span>{filtered.length ? `${currentPage * 6 + 1}–${Math.min((currentPage + 1) * 6, filtered.length)} de ${filtered.length} RAS` : '0 RAS nesta seleção'}</span><span><ShieldCheck size={13} />Dados do SCORA</span><div className="pagination"><button aria-label="Página anterior" disabled={currentPage === 0} onClick={() => setPageIndex(currentPage - 1)}><ChevronRight size={13} className="previous-icon" /></button><span>{currentPage + 1} / {pageCount}</span><button aria-label="Próxima página" disabled={currentPage + 1 >= pageCount} onClick={() => setPageIndex(currentPage + 1)}><ChevronRight size={13} /></button></div></div></div>
              <aside className="right-column"><section className="card monitor-config"><div className="section-title"><span className="soft-icon"><Settings2 size={18} /></span><h2>Seu monitor</h2></div><label className="field-label" htmlFor="interval">Verificar a cada</label><select id="interval" value={config.interval} onChange={event => settings({ interval: Number(event.target.value) })} disabled={saving || !data}>{INTERVALS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><div className="notification-row"><span><strong>Avisos neste aparelho</strong><small>{pushEnabled ? 'Notificações ativadas' : 'Receba quando uma vaga abrir'}</small></span><Toggle label="Configurar avisos neste aparelho" value={pushEnabled} onChange={() => setModal('push')} /></div><div className="config-separator" /><div className="connection-line"><span><i className={healthy ? 'green-dot' : 'gray-dot'} />{healthy ? 'SCORA conectado' : data?.error ? 'SCORA indisponível' : 'Aguardando SCORA'}</span><ExternalLink size={12} /></div><div className="check-line"><span>Última consulta</span><strong>{formatTime(data?.lastCheck)}</strong></div><div className="check-line"><span>Consultas realizadas</span><strong>{data?.checks || 0}</strong></div><button className="text-button" onClick={() => setPage('settings')}>Ajustar preferências <ArrowRight size={14} /></button></section>
              <section className="card recent-activity"><div className="section-title"><h2>Últimas atualizações</h2><span className="subtle-icon"><History size={17} /></span></div><EventList events={(data?.events || []).slice(0, 3)} now={now} /><button className="history-link" onClick={() => setPage('history')}>Ver histórico completo <ArrowRight size={14} /></button></section>
              <div className="tip-card"><Sparkles size={19} /><div><strong>Uma vaga pode voltar.</strong><p>Se alguém cancelar a candidatura, seu radar detecta a nova disponibilidade.</p></div></div></aside></div>
          </>}
          {page === 'history' && <section className="card history-page"><div className="card-heading"><div><h2>O que mudou no SCORA</h2><p>Até 200 registros mais recentes. Horários de detecção pelo radar.</p></div><span className="count-badge">{data?.events.length || 0}</span></div><EventList events={data?.events || []} now={now} expanded /></section>}
          {page === 'settings' && <div className="settings-grid"><section className="card settings-card"><span className="soft-icon"><Radar size={22} /></span><h2>Monitoramento</h2><p>As preferências valem para o monitor e todos os seus dispositivos.</p><div className="setting-row"><div><strong>Monitoramento automático</strong><small>Continuar verificando mesmo com o painel fechado.</small></div><Toggle label="Monitoramento automático" value={config.enabled} onChange={enabled => settings({ enabled })} disabled={saving || !data} /></div><label>Intervalo de verificação<select value={config.interval} onChange={event => settings({ interval: Number(event.target.value) })} disabled={saving || !data}>{INTERVALS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Sua escala de trabalho<select value={config.workdays} onChange={event => { setDate('all'); settings({ workdays: event.target.value }); }} disabled={saving || !data}><option value="all">Acompanhar todos os dias</option><option value="even">Trabalho nos dias pares → RAS nos ímpares</option><option value="odd">Trabalho nos dias ímpares → RAS nos pares</option></select></label><p className="field-hint">O filtro seleciona seus dias de folga para a lista e os avisos. Sua escala oficial continua sendo a cadastrada no SCORA.</p><div className="setting-row"><div><strong>Avisar também sobre outras alterações</strong><small>Incluir mudanças de horário, encerramentos e remoções.</small></div><Toggle label="Avisar sobre outras alterações" value={config.notifyChanges} onChange={notifyChanges => settings({ notifyChanges })} disabled={saving || !data} /></div></section><section className="card settings-card"><span className="soft-icon"><Smartphone size={22} /></span><h2>Alertas no celular</h2><p>O servidor acompanha as vagas e envia as notificações para os dispositivos conectados.</p><div className="device-status"><span className={pushEnabled ? 'green-dot' : 'gray-dot'} /><div><strong>{pushEnabled ? 'Este aparelho está conectado' : 'Este aparelho ainda não recebe alertas'}</strong><small>{data?.devices || 0} dispositivo(s) cadastrado(s)</small></div></div><button className="button primary" onClick={() => setModal('push')}><Bell size={16} />Configurar notificações</button>{data?.pushError && <p className="field-error">{data.pushError}</p>}<div className="info-note"><CircleHelp size={18} /><p>Para receber com o painel fechado, o servidor precisa continuar ligado. No celular, acesse pelo endereço HTTPS do seu site.</p></div><a className="text-button" href="https://developer.mozilla.org/pt-BR/docs/Web/API/Push_API" target="_blank" rel="noreferrer">Sobre as notificações push <ArrowUpRight size={14} /></a></section></div>}
          <footer className="page-footer"><span><span className="footer-pulse" />RAS Radar <span className="footer-divider">/</span> Sempre de olho na próxima oportunidade.</span><span>Fonte: GCMDC SCORA <span className="footer-divider">·</span> Horário de Brasília</span></footer>
        </main>
      </div>
    </div>}
    {modal === 'push' && <Modal title="Leve seu radar no bolso" onClose={() => setModal(null)} toast={toast} onDismiss={() => setToast(null)}><div className="modal-illustration"><Smartphone size={42} /><span><BellRing size={20} /></span></div><p className="modal-intro">Saiba quando uma vaga abrir, mesmo com o painel fechado.</p><div className="setup-steps"><div><span>1</span><p><strong>Abra pelo endereço HTTPS</strong>O servidor deve ficar ligado para acompanhar as vagas.</p></div><div><span>2</span><p><strong>Adicione à Tela de Início</strong>No iPhone (iOS 16.4+), use Compartilhar → Adicionar à Tela de Início e abra pelo ícone. No Android, você também pode instalar o app.</p></div><div><span>3</span><p><strong>Ative e teste os avisos</strong>Permita as notificações neste aparelho. Os primeiros avisos serão sobre novas mudanças.</p></div></div>{installPrompt && <button className="button secondary full-width" onClick={async () => { await installPrompt.prompt(); setInstallPrompt(null); }}><Smartphone size={17} />Instalar no aparelho</button>}{pushEnabled ? <><div className="success-note"><Check size={18} />Este aparelho está conectado ao radar.</div><button className="button primary full-width" onClick={() => pushAction('test')} disabled={pushBusy}><BellRing size={17} />Enviar aviso de teste</button><button className="text-button centered" onClick={() => pushAction('unsubscribe')} disabled={pushBusy}>Desativar neste aparelho</button></> : <button className="button primary full-width" onClick={enablePush} disabled={pushBusy}>{pushBusy ? <LoaderCircle size={17} className="spin" /> : <Bell size={17} />}Ativar notificações neste aparelho</button>}<small className="modal-footnote">Entrega sujeita à internet, às permissões e às configurações de economia de bateria do aparelho.</small></Modal>}
    {modal === 'help' && <Modal title="Como seu radar funciona" onClose={() => setModal(null)}><div className="help-content"><p>O RAS Radar consulta a mesma API usada pelo <a href={SOURCE} target="_blank" rel="noreferrer">GCMDC SCORA</a>, no intervalo que você escolher.</p><h3>Quando chega um aviso?</h3><p>Quando um novo RAS estiver aberto, uma vaga reabrir ou o número de lugares disponíveis aumentar. A data do RAS e o prazo de candidatura também são conferidos.</p><h3>Em quanto tempo?</h3><p>Normalmente, na próxima consulta: entre 30 segundos e 10 minutos, conforme seu ajuste. Não é uma conexão instantânea. Falhas de rede aumentam o intervalo de novas tentativas.</p><h3>E com o painel fechado?</h3><p>As consultas continuam no servidor. Os avisos usam notificações push; ative no seu celular e mantenha o servidor em funcionamento.</p><h3>Como faço a candidatura?</h3><p>Abra o SCORA e entre na sua conta. Este painel apenas acompanha as vagas. A disponibilidade final e sua elegibilidade são confirmadas pelo SCORA.</p><h3>Sobre o histórico</h3><p>Os horários indicam quando o radar detectou a alteração. A API não informa a hora exata em que cada vaga foi editada.</p></div></Modal>}
    {toast && !modal && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleHelp size={18} /> : <Check size={18} />}<span>{toast.message}</span><button aria-label="Fechar aviso" onClick={() => setToast(null)}><X size={16} /></button></div>}
  </>;
}
function Stat({ icon: Icon, label, value, detail, green, small }) { return <article className={`stat-card ${green ? 'green-stat' : ''}`}><div className="stat-top"><span>{label}</span><Icon size={17} /></div><strong className={`stat-value ${small ? 'small' : ''}`}>{value}{green && <span className="stat-live-dot" />}</strong><small>{green && <span className="tiny-green-dot" />}{detail}</small></article>; }
