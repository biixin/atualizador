# Corrigir o deploy na Vercel

O endereço `https://atualizador-dusky.vercel.app` publicou o frontend, mas as rotas `/api/auth`, `/api/status` e `/api/health` retornavam **404**. A versão original utilizava um servidor Node contínuo e não tinha uma entrada de Vercel Function.

Esta versão inclui `api/index.js`, `vercel.json` e um adaptador de API que funciona por requisição, sem escrever no disco da Vercel nem depender de timers após a resposta.

## 1. Atualizar os arquivos publicados

Envie **o projeto completo atualizado** para o repositório ou diretório usado no deploy. Inclua:

- `api/`
- `server/`
- `src/`
- `public/`
- `vercel.json`, `vite.config.js`, `index.html`, `package.json`, `package-lock.json`

Não envie `data/`, `.env`, `node_modules/` ou arquivos pessoais. Não publique só a pasta `dist`: a Vercel precisa dos arquivos da função para criar a API.

Configuração do projeto na Vercel:

| Campo | Valor |
| --- | --- |
| Framework Preset | Vite |
| Root Directory | A pasta que contém `package.json` e `vercel.json` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Node.js Version | 24.x ou 22.x |

Se o projeto estiver ligado ao GitHub, envie um commit com esses arquivos e aguarde o novo deployment. Clicar em **Redeploy** num deployment antigo, sem atualizar o código, não incorpora a correção.

Depois do deploy, abra:

**https://atualizador-dusky.vercel.app/api/health**

O esperado é JSON com `"ok": true`, `"runtime": "vercel"` e `"version": "2"`. Se aparecer 404 ou HTML, a nova função ainda não foi publicada: confira o diretório raiz, o commit e se a pasta `api` está no código enviado.

Sem nenhuma variável extra, as vagas já podem ser consultadas. O painel informa que preferências, histórico persistente e notificações com o site fechado ainda precisam ser configurados. O modo de consulta não grava dados na Vercel nem promete monitoramento com a página fechada.

## 2. Conectar armazenamento e proteger o painel

Para receber no celular, o servidor precisa lembrar o último estado das vagas, os dispositivos e as chaves de push entre invocações e deploys.

1. Na Vercel, abra o projeto → **Storage** → crie/conecte um **Upstash Redis** usando a integração disponível no Marketplace.
2. Conecte ao ambiente **Production**. A integração deve criar as variáveis REST. São aceitos os dois conjuntos:
   - `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`;
   - ou `KV_REST_API_URL` e `KV_REST_API_TOKEN`.
3. Em **Settings → Environment Variables**, adicione:

| Variável | O que colocar |
| --- | --- |
| `MONITOR_TOKEN` | Uma senha exclusiva com pelo menos 24 caracteres. Será a senha para entrar neste painel. |
| `ADMIN_USERNAME` | Login para a área de testes administrativos, por exemplo `admin`. |
| `ADMIN_PASSWORD` | Outra senha exclusiva com pelo menos 12 caracteres, usada somente no login de admin. |
| `CRON_SECRET` | Outra chave exclusiva, diferente da senha acima, com pelo menos 24 caracteres. |
| `VAPID_SUBJECT` | `mailto:seu-email@exemplo.com` |

Use as variáveis de acesso completo do Redis, não o token somente de leitura. Não coloque nenhuma dessas chaves em variáveis com prefixo `VITE_`, no código do navegador ou no GitHub.

4. Faça um **novo deployment** para aplicar as variáveis.
5. Abra o site e entre com a senha definida em `MONITOR_TOKEN`.

As chaves VAPID são geradas automaticamente e guardadas no Redis. Não é necessário copiá-las do computador. Se você já havia inscrito um dispositivo no servidor local, reative as notificações no endereço da Vercel.

## 3. Verificar mesmo com o painel fechado

No plano **Hobby**, o cron nativo da Vercel permite apenas uma execução diária, insuficiente para acompanhar vagas. Por isso `vercel.json` não inclui um cron que impediria o deploy gratuito. [Limites oficiais de cron da Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Use um agendador HTTP externo. O [cron-job.org](https://cron-job.org/en/) oferece chamadas a cada minuto e permite cabeçalhos personalizados. Crie uma tarefa com:

| Campo | Valor |
| --- | --- |
| URL | `https://atualizador-dusky.vercel.app/api/cron` |
| Método | `GET` |
| Frequência | A cada 1 minuto |
| Nome do cabeçalho | `Authorization` |
| Valor do cabeçalho | `Bearer VALOR_DA_SUA_CRON_SECRET` |

Substitua `VALOR_DA_SUA_CRON_SECRET` pelo valor configurado na Vercel. Não coloque a chave na URL. O agendador precisa dessa chave para chamar seu monitor.

Execute o teste do agendador. A resposta normal tem `"ok": true`. O status 202 indica que outra consulta já está em andamento; não significa uma falha. Uma resposta 401 significa que o cabeçalho/chave está incorreto ou ausente. Abrir `/api/cron` diretamente no navegador retorna 401 porque o navegador não envia esse cabeçalho.

O painel só marca o agendamento como confirmado depois de receber uma chamada autenticada. Se ficar mais de três minutos sem chamadas (na cadência padrão), volta a mostrar o aviso de agendamento pendente. As novas consultas continuam respeitando o intervalo e a pausa escolhidos no painel.

Na Vercel, o menor intervalo oferecido é **1 minuto**. O tempo real depende também do agendador, da API de origem e do serviço de push. Intervalos maiores podem ser escolhidos no painel. O limite e a disponibilidade dos serviços contratados continuam valendo.

### Se você usa Vercel Pro

Como alternativa ao serviço externo, acrescente ao objeto de `vercel.json`:

```json
"crons": [
  { "path": "/api/cron", "schedule": "* * * * *" }
]
```

Mantenha `CRON_SECRET` configurada. A Vercel a envia no cabeçalho de autorização. Não use simultaneamente os dois agendadores; a trava impede duplicação concorrente, mas as chamadas extras são desnecessárias.

## 4. Ativar no celular

1. Abra o endereço HTTPS no celular e entre com a senha do painel.
2. No iPhone, adicione à Tela de Início e abra pelo ícone.
3. Escolha **Configurar alertas → Ativar notificações neste aparelho** e permita os avisos.
4. Envie um aviso de teste e confira se o painel também mostra o agendamento confirmado.

O envio de teste confirma a inscrição do dispositivo; o indicador de agendamento confirma a execução automática. Ambos precisam funcionar para acompanhar vagas com o painel fechado.

## 5. Enviar mensagens de teste pelo computador

Depois de publicar o código atualizado e configurar `ADMIN_USERNAME` e `ADMIN_PASSWORD`, abra **Admin** no menu ou **https://atualizador-dusky.vercel.app/#admin**. Entre com essas credenciais, escolha os destinatários, escreva título e mensagem e clique em **Enviar notificação de teste**.

O login de admin também libera o acesso ao painel. A senha comum `MONITOR_TOKEN` não permite entrar na administração. A sessão administrativa dura oito horas e pode ser encerrada em **Sair do admin**.

Os celulares precisam ter ativado os avisos **nesse endereço da Vercel** e aparecer na lista de dispositivos. O computador não precisa ativar notificações. Se a lista estiver vazia, cadastre primeiro o celular e use **Atualizar dispositivos**. Os cadastros e resultados ficam no Redis; sem ele, o envio não está disponível.

O envio manual funciona sem agendamento, inclusive com o painel do celular fechado. O resultado informa quais envios foram aceitos pelo serviço de push e quais falharam. Confira a chegada no aparelho. Aguarde 30 segundos entre os testes. O cron continua necessário para detectar novas vagas automaticamente com o site fechado.

## Testar localmente o adaptador da Vercel

```powershell
npm.cmd run build
npm.cmd run preview:vercel
```

Abra `http://localhost:3002`. Sem variáveis de Redis, essa prévia funciona em modo de consulta. `npm.cmd run dev` continua executando o servidor original, com armazenamento em disco e monitoramento contínuo.

Os testes automatizados de Vercel simulam o Redis e o envio push, incluindo concorrência, reinício das funções, autenticação, cron sem aba aberta e recuperação da fila. A validação em produção exige republicar os arquivos, conectar o Redis real e autorizar o aparelho.

Referências: [Vercel Functions em Node.js](https://vercel.com/docs/functions/runtimes/node-js), [gerenciamento e autenticação de cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [REST do Upstash Redis](https://upstash.com/docs/redis/features/restapi), [agendamento e cabeçalhos no cron-job.org](https://cron-job.org/en/faq/).
