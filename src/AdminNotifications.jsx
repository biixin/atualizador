import { useEffect, useState } from 'react';
import { BellRing, Check, CircleAlert, Clock3, LoaderCircle, LockKeyhole, LogOut, Monitor, RefreshCw, Send, ShieldCheck, Smartphone } from 'lucide-react';

const time = value => new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

export default function AdminNotifications({ api, onSessionChange, onSetupHosting }) {
  const [session, setSession] = useState(null);
  const [overview, setOverview] = useState(null);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [title, setTitle] = useState('Teste RAS Radar');
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState('all');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState('');
  const [report, setReport] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let active = true;
    api('/admin/session').then(result => { if (active) setSession(result); }).catch(error => { if (active) setFailure(error.message); });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { active = false; clearInterval(timer); };
  }, [api]);
  useEffect(() => {
    if (!session?.authenticated) return;
    let active = true; let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try { const result = await api('/admin/notifications'); if (active) setOverview(result); }
      catch (error) { if (active) { setFailure(error.message); if (error.status === 401) setSession(previous => ({ ...previous, authenticated: false })); } }
      finally { pending = false; }
    }
    refresh(); const timer = setInterval(refresh, 10_000);
    return () => { active = false; clearInterval(timer); };
  }, [session?.authenticated, api]);
  async function login(event) {
    event.preventDefault(); setBusy(true); setFailure('');
    try {
      const result = await api('/admin/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      setPassword(''); setSession({ configured: true, ...result }); await onSessionChange();
    } catch (error) { setFailure(error.message); } finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setFailure('');
    try {
      await api('/admin/logout', { method: 'POST', body: '{}' });
      setSession(previous => ({ ...previous, authenticated: false })); setOverview(null); setReport(null); setMessage('');
      await onSessionChange();
    } catch (error) { setFailure(error.message); } finally { setBusy(false); }
  }
  async function refreshDevices() {
    setRefreshing(true); setFailure('');
    try { setOverview(await api('/admin/notifications')); }
    catch (error) { setFailure(error.message); } finally { setRefreshing(false); }
  }
  async function send(event) {
    event.preventDefault(); setBusy(true); setFailure(''); setReport(null);
    try {
      const result = await api('/admin/notifications/test', { method: 'POST', body: JSON.stringify({ title, message, target }) });
      setReport(result.report);
      setOverview(previous => ({ ...previous, nextAllowedAt: result.nextAllowedAt, history: [result.report, ...(previous?.history || []).filter(item => item.id !== result.report.id)].slice(0, 20) }));
    } catch (error) {
      setFailure(error.message);
      if (error.status === 401) { setSession(previous => ({ ...previous, authenticated: false })); await onSessionChange(); }
    } finally { setBusy(false); }
  }

  const devices = overview?.devices || [];
  const mobileCount = devices.filter(device => device.type === 'mobile').length;
  const recipients = devices.filter(device => target === 'all' || (target === 'mobile' ? device.type === 'mobile' : device.id === target));
  const cooldown = Math.max(0, Math.ceil(((overview?.nextAllowedAt || 0) - now) / 1000));
  const errorNotice = failure && <div className="admin-error" role="alert"><CircleAlert size={18} /><span>{failure}</span></div>;

  if (!session && !failure) return <section className="card admin-loading"><LoaderCircle className="spin" size={23} />Verificando acesso de administrador…</section>;
  if (!session?.authenticated) return <section className="card admin-login"><div className="admin-lock"><LockKeyhole size={26} /></div><div className="eyebrow">ACESSO RESTRITO</div><h2>Entre como administrador</h2><p>Use seu login e senha de admin para enviar mensagens de teste aos celulares cadastrados.</p>{session?.configured === false && <div className="admin-setup-note">Defina <code>ADMIN_USERNAME</code> e <code>ADMIN_PASSWORD</code> na hospedagem para habilitar o acesso. A senha precisa ter pelo menos 12 caracteres.</div>}{errorNotice}<form onSubmit={login}><label>Login de administrador<input autoComplete="username" name="username" value={username} onChange={event => setUsername(event.target.value)} maxLength={80} required /></label><label>Senha de administrador<input type="password" autoComplete="current-password" name="password" value={password} onChange={event => setPassword(event.target.value)} maxLength={512} required placeholder="Digite sua senha" /></label><button className="button primary full-width" disabled={busy || session?.configured === false}>{busy ? <LoaderCircle size={17} className="spin" /> : <ShieldCheck size={17} />}Entrar como administrador</button></form><small>O acesso administrativo permite testar os avisos pelo computador. Você não precisa ativar notificações no PC.</small></section>;

  return <div className="admin-area"><div className="admin-session"><span><ShieldCheck size={18} /><strong>Administrador conectado</strong><span className="admin-user">{session.username}</span></span><button className="button secondary compact" onClick={logout} disabled={busy}><LogOut size={14} />Sair do admin</button></div>{errorNotice}
    {overview?.available === false && <div className="hosting-notice"><CircleAlert size={20} /><div><strong>Os dispositivos ainda precisam de armazenamento</strong><p>Conclua a configuração da hospedagem e cadastre os celulares para enviar os testes. O envio manual não depende do agendamento automático.</p></div><button className="button secondary" onClick={onSetupHosting}>Configurar hospedagem</button></div>}
    <div className="admin-grid"><div><section className="card admin-composer"><div className="section-title"><span className="soft-icon"><Send size={18} /></span><div><h2>Enviar notificação de teste</h2><p>Escreva a mensagem que deve aparecer no celular.</p></div></div><form onSubmit={send}><label>Enviar para<select value={target} onChange={event => setTarget(event.target.value)} disabled={!overview?.available || busy}><option value="all">Todos os dispositivos ({devices.length})</option>{mobileCount > 0 && <option value="mobile">Somente celulares e tablets ({mobileCount})</option>}{devices.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label><label>Título <span className="input-counter">{title.length}/80</span><input value={title} onChange={event => setTitle(event.target.value)} maxLength={80} placeholder="Teste RAS Radar" disabled={busy} /></label><label>Mensagem <span className="input-counter">{message.length}/500</span><textarea value={message} onChange={event => setMessage(event.target.value)} maxLength={500} rows={5} required placeholder="Ex.: Olá! Se você recebeu este aviso, as notificações do seu RAS Radar estão funcionando." disabled={busy} /></label><div className="admin-send-footer"><span><Smartphone size={15} />{recipients.length} dispositivo(s) selecionado(s)</span><button className="button primary" type="submit" disabled={busy || !overview?.available || !message.trim() || recipients.length === 0 || cooldown > 0}>{busy ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}{busy ? 'Enviando…' : cooldown > 0 ? `Novo teste em ${cooldown}s` : 'Enviar notificação de teste'}</button></div></form><p className="admin-delivery-note">O envio é feito pelo servidor. O celular pode estar com o site fechado, desde que os avisos já tenham sido ativados nele.</p></section>
      {report && <section className="card admin-report" aria-live="polite"><h2>Resultado do teste</h2><div className="admin-result-counts"><span className="accepted"><Check size={15} />{report.sent} aceito(s)</span><span>{report.failed} falha(s)</span><span>{report.expired} inscrição(ões) expirada(s)</span></div><p>“Aceito” significa que o serviço de push recebeu a mensagem. Confira no celular se ela apareceu.</p><div className="admin-report-list">{report.results.map(result => <div key={result.id}><span className={result.status === 'sent' ? 'green-dot' : 'gray-dot'} /><div><strong>{result.name}</strong><small>{result.detail}</small></div></div>)}</div></section>}
      <section className="card admin-test-history"><div className="section-title"><Clock3 size={17} /><h2>Testes recentes</h2></div>{!overview?.history?.length ? <p className="admin-muted">Os resultados dos seus testes aparecerão aqui.</p> : overview.history.slice(0, 5).map(item => <div className="admin-history-item" key={item.id}><span className="soft-icon"><BellRing size={16} /></span><div><strong>{item.title}</strong><p>{item.message}</p><small>{time(item.at)} · {item.status === 'sending' ? now - Date.parse(item.at) > 60_000 ? 'Sem resultado confirmado' : 'Envio em andamento' : `${item.sent}/${item.total} aceito(s)`}</small></div></div>)}</section></div>
      <aside className="admin-side"><section className="card admin-preview"><div className="eyebrow">PRÉVIA NO CELULAR</div><div className="phone-preview"><span className="phone-time">09:41</span><div className="phone-notification"><div><span className="phone-app-icon"><BellRing size={13} /></span><strong>RAS RADAR</strong><small>agora</small></div><h3>{title.trim() || 'Teste RAS Radar'}</h3><p>{message.trim() || 'Sua mensagem de teste aparecerá aqui.'}</p></div><div className="phone-home" /></div><small>O visual pode variar de acordo com o aparelho.</small></section><section className="card admin-devices"><div className="section-title"><h2>Dispositivos cadastrados <span className="count-badge">{devices.length}</span></h2><button className="icon-button" aria-label="Atualizar dispositivos" onClick={refreshDevices} disabled={refreshing || busy}><RefreshCw size={15} className={refreshing ? 'spin' : ''} /></button></div>{!devices.length ? <div className="admin-empty-devices"><Smartphone size={28} /><strong>Nenhum aparelho cadastrado</strong><p>Abra este site no celular, escolha “Configurar alertas” e permita as notificações. Depois, atualize esta lista.</p></div> : devices.map(device => <div className="admin-device" key={device.id}><span className="soft-icon">{device.type === 'desktop' ? <Monitor size={18} /> : <Smartphone size={18} />}</span><div><strong>{device.name}</strong><small>{device.type === 'unknown' ? 'Tipo não identificado' : device.type === 'desktop' ? 'Computador' : 'Celular ou tablet'}{device.registeredAt ? ` · ${time(device.registeredAt)}` : ''}</small></div><span className="green-dot" /></div>)}</section></aside></div>
  </div>;
}
