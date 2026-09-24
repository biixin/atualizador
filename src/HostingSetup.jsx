import { Check, Circle, ExternalLink } from 'lucide-react';

export default function HostingSetup({ capabilities }) {
  const setup = capabilities?.setup || {};
  const items = [
    { done: setup.storage, title: 'Armazenamento conectado', text: <>Na Vercel, abra <strong>Storage → Create Database → Upstash Redis</strong> e conecte ao projeto. O painel usa as variáveis REST adicionadas pela integração.</> },
    { done: setup.password, title: 'Senha do painel definida', text: <>Em <strong>Settings → Environment Variables</strong>, defina <code>MONITOR_TOKEN</code> com uma senha exclusiva de pelo menos 24 caracteres. Ela protege suas preferências e os dispositivos inscritos.</> },
    { done: setup.cronSecret, title: 'Chave do agendamento definida', text: <>Adicione <code>CRON_SECRET</code> com outra senha de pelo menos 24 caracteres e faça um novo deploy para aplicar as variáveis.</> },
    { done: setup.scheduler, title: 'Agendamento automático confirmado', text: <>Configure uma chamada <code>GET</code> a <code>{window.location.origin}/api/cron</code>, a cada minuto, com o cabeçalho <code>Authorization: Bearer SUA_CRON_SECRET</code>. No plano gratuito, use um agendador externo. O indicador é confirmado quando o servidor recebe a chamada.</> },
  ];
  return <div className="hosting-setup"><p>Consultar as vagas já funciona na Vercel. Estas etapas permitem acompanhar as mudanças e avisar seu celular quando ninguém estiver com o painel aberto.</p>{items.map(item => <div className={`hosting-step ${item.done ? 'done' : ''}`} key={item.title}>{item.done ? <Check size={18} /> : <Circle size={17} />}<div><strong>{item.title}</strong><p>{item.text}</p></div></div>)}<a className="text-button" href="https://cron-job.org/en/" target="_blank" rel="noreferrer">Abrir agendador externo <ExternalLink size={14} /></a><p className="field-hint">Após concluir, ative e teste as notificações no celular. As chaves de push são guardadas no Redis e permanecem válidas após novos deploys.</p></div>;
}
