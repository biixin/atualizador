# RAS Radar

Painel em português para acompanhar os RAS do [GCMDC SCORA](https://gcmdc-scora.netlify.app/ras), com monitoramento no servidor e notificações push no celular mesmo com o painel fechado.

## Publicou na Vercel?

Use o [guia de deploy na Vercel](./VERCEL.md). O projeto agora inclui uma API própria para Vercel Functions. Basta republicar **o projeto completo** para consultar as vagas. Para preservar histórico, preferências e receber avisos com o painel fechado, conecte Redis, defina a senha do painel e configure o agendamento descrito no guia.

Há dois modos de servidor: **Node contínuo**, explicado abaixo, e **Vercel Functions**, explicado em `VERCEL.md`. A Vercel não executa o monitor contínuo do computador. No plano gratuito, use um agendador externo para chamadas a cada minuto.

## Rodar no computador

Requisito: Node.js 22 ou superior (recomendado: 24).

```powershell
npm.cmd install
npm.cmd run dev
```

Abra **http://localhost:5173**. No Windows, use `npm.cmd` se o PowerShell bloquear `npm.ps1`.

Para servir o site compilado em **http://localhost:3001**:

```powershell
npm.cmd run build
npm.cmd start
```

O servidor consulta a API mesmo sem nenhuma aba aberta. Fechar o terminal, desligar ou suspender o computador interrompe o monitoramento. Uma hospedagem que permaneça ligada elimina essa dependência do computador.

## O que já está conectado

- Consulta de leitura `POST /rest/v1/rpc/listar_ras_disponiveis`, no Supabase usado pelo SCORA. Em 23/09/2026, a consulta respondeu sem login com a chave **publicável**, já presente no JavaScript público do site de origem.
- Informações reais: data, local, horário, total, ocupação, lugares restantes e prazo de candidatura.
- Intervalos de 30 segundos, 1, 2, 5 e 10 minutos, pausa e verificação manual.
- Comparação entre consultas; alertas para novo RAS aberto, reabertura ou aumento de vagas disponíveis. Opcionalmente, avisos de outras alterações.
- Filtro por dias de folga: quem trabalha em dias pares acompanha os ímpares, e vice-versa. O filtro é local e **não altera a escala cadastrada no SCORA**.
- Histórico das últimas 200 alterações, preservado junto às preferências e ao último resultado.
- Push com fila de nova tentativa, remoção de assinaturas revogadas e descarte de avisos de vagas já encerradas.
- Aplicativo instalável (PWA), compatível com navegadores que oferecem Web Push.

A primeira consulta cria a referência para comparar as próximas; as vagas já existentes aparecem na tela, sem uma enxurrada de notificações. Uma vaga com lugares restantes **não está aberta se o prazo venceu**. Os horários do histórico indicam quando a mudança foi detectada, pois a API não fornece a hora exata da edição.

É atualização **periódica**, não um canal instantâneo. A latência normal é até o intervalo escolhido, mais o tempo da rede e do push. Em falhas da API, preservamos a última resposta válida e aumentamos o intervalo progressivamente até 15 minutos. Mudanças que aconteçam e sejam revertidas entre duas consultas podem não ser vistas. Candidaturas são feitas exclusivamente no SCORA.

## Receber avisos no celular com o site fechado

1. Hospede este servidor com disco persistente e funcionamento contínuo, em um endereço **HTTPS**.
2. Abra esse endereço no celular e entre com a senha do seu painel.
3. No **iPhone/iPad com iOS 16.4+**, use Compartilhar → Adicionar à Tela de Início, e abra o site pelo ícone criado. No Android, abra em um navegador compatível e, se quiser, instale o app.
4. No painel, escolha **Configurar alertas → Ativar notificações neste aparelho** e aceite a permissão do sistema.
5. Use **Enviar aviso de teste** para confirmar a permissão e a inscrição do aparelho. Os avisos de futuras vagas serão enviados automaticamente, mesmo com o painel fechado.

Os avisos reais são disparados pelo servidor, não por um timer na aba. O aparelho precisa de internet, permissão de notificações e suporte a Web Push. O serviço de push e o sistema do celular controlam a entrega final. A lista de serviços de push aceitos inclui Google, Mozilla, Apple e Windows; outros provedores exigem ajuste em `server/index.js`.

**O localhost é apenas para desenvolvimento no computador.** O celular não consegue abrir o localhost de outro dispositivo. Um endereço HTTP da rede local também não atende ao requisito de contexto seguro para Push.

Referências: [Push API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Push_API), [Service Workers e HTTPS (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API), [Web Push no iPhone (Apple)](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).

## Administração e testes de notificações

No computador, abra **Admin** no menu ou acesse o endereço do site com `/#admin` no final. Também há um botão **Entrar como administrador** na tela de acesso do painel.

Configure no servidor:

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=sua-senha-exclusiva-com-pelo-menos-12-caracteres
```

No desenvolvimento, use o arquivo `.env` e reinicie `npm.cmd run dev` depois de alterá-lo. Na Vercel, defina as duas variáveis em **Settings → Environment Variables → Production** e faça um novo deployment com o código atualizado. Não envie o arquivo `.env` ao repositório ou à hospedagem.

1. Abra o site publicado nos celulares e ative as notificações em cada aparelho.
2. Entre na área **Admin** pelo computador com `ADMIN_USERNAME` e `ADMIN_PASSWORD`.
3. Escolha todos os dispositivos, somente celulares/tablets ou um aparelho específico.
4. Preencha título e mensagem e clique em **Enviar notificação de teste**.
5. Confira o resultado por aparelho e a notificação recebida no celular. Há um intervalo de 30 segundos entre testes.

O PC não precisa estar inscrito para receber notificações. Os aparelhos já cadastrados aparecem na lista; cadastros antigos podem aparecer como “Dispositivo” sem identificação do tipo. Reative os alertas nesses aparelhos para atualizar a identificação.

A senha de admin é independente de `MONITOR_TOKEN` e da conta SCORA. O acesso comum ao painel não autoriza envios administrativos. O login de admin também abre o painel e expira em oito horas; use **Sair do admin** ao terminar. Trocar a senha no servidor invalida as sessões antigas.

Na Vercel, o envio requer Redis conectado e a proteção do painel configurada conforme o [guia de hospedagem](./VERCEL.md). **O teste manual não depende do cron.** O resultado “aceito” confirma que o serviço de push aceitou a mensagem; a exibição final deve ser conferida no celular. Os últimos 20 testes ficam registrados, e os cinco mais recentes aparecem na tela.

## Publicar com Docker e HTTPS

Incluídos `Dockerfile`, `compose.yaml` e Caddy para HTTPS automático. Em um servidor Linux com Docker Compose, um domínio apontado para seu IP e portas 80/443 disponíveis:

1. Copie o projeto para o servidor.
2. Crie `.env` usando `.env.example` como referência e inclua:

```dotenv
DOMAIN=radar.seudominio.com
MONITOR_TOKEN=uma-senha-longa-exclusiva-com-24-ou-mais-caracteres
VAPID_SUBJECT=mailto:seu-email@exemplo.com
```

3. Suba o serviço:

```sh
docker compose up -d --build
```

4. Acesse `https://radar.seudominio.com` e informe `MONITOR_TOKEN` no formulário de acesso. É uma senha do painel, separada da conta SCORA.

O volume `radar_data` preserva os dados e as chaves push. **Não apague esse volume em uma atualização.** Se as chaves push forem perdidas, os celulares precisam se inscrever novamente. Execute somente uma instância do monitor por diretório de dados.

Também é possível usar qualquer serviço de hospedagem Node.js/Docker que ofereça processo contínuo, HTTPS e volume persistente. Configure `HOST=0.0.0.0`, `APP_ORIGIN=https://seu-endereco`, `MONITOR_TOKEN` (24+ caracteres), `DATA_DIR` no volume e `VAPID_SUBJECT` com seu e-mail. O servidor recusa exposição externa sem origem HTTPS e senha. Hospedagem exclusivamente estática não executa o monitor. Na Vercel, use o adaptador de funções com Redis e agendamento do [guia específico](./VERCEL.md).

## Dados e manutenção

- `data/state.json`: preferências, última resposta, histórico, fila e assinaturas push.
- `data/push-keys.json`: chaves VAPID geradas automaticamente e mantidas entre reinícios.
- Esses arquivos não são publicados no site e estão no `.gitignore`. Faça backup do diretório `data` junto da configuração do servidor.
- A integração usa somente a consulta de leitura do SCORA. Não pede matrícula, CPF ou senha de trabalho.
- Se o SCORA mudar o contrato ou passar a exigir autenticação, o painel mostrará erro e a integração precisará ser atualizada. Nenhum mecanismo contorna autenticação.
- `GET /api/health`: verificação de saúde do processo. `GET /api/status`: estado do monitor, protegido pela senha quando configurada.

## Verificações

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:ui
npm.cmd run test:ui:admin
```

Os testes de domínio cobrem prazo vencido, fuso horário, escala, reabertura, ausência de duplicatas, erro da API, persistência, simultaneidade e recuperação de push. Os testes de admin verificam autenticação, isolamento do acesso comum, destinatários, resultados parciais e intervalo entre envios. Os testes visuais usam Chrome instalado no Windows ou Chromium do Playwright. `test:ui` requer `npm run dev` em execução; `test:ui:admin` inicia um servidor isolado com o site compilado, dados fictícios e push simulado. O envio real ao celular depende da inscrição e da permissão do proprietário do aparelho; não pode ser validado apenas com simulações.
