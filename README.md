# AutoZap (Desktop + Mobile Expo + Firebase + WhatsApp Cloud API)

AutoZap roda como **aplicativo desktop** (macOS/Windows) e **aplicativo mobile Expo (React Native)** com backend em Next.js/Express, integração oficial do WhatsApp (Cloud API) e persistência sincronizada com **Firebase Firestore**, com deploy de produção recomendado em **Oracle Cloud Free VM**.

## Arquitetura

- Interface: frontend legado preservado
- Runtime desktop: `Electron` com bloqueio do frontend em navegador comum
- Runtime mobile: `Expo` (React Native)
- API WhatsApp: Cloud API oficial (Meta)
- Persistência operacional local: SQLite
- Persistência central: espelhamento automático SQLite -> Firebase Firestore (users, sellers, tickets, messages, reminders, blacklist, settings etc.)
- Mídias recebidas (foto/vídeo/áudio/documento): carregadas sob demanda da própria API oficial via `/media/wa/:mediaId`

## Requisitos

- Node.js 20+
- npm
- Projeto Meta/WhatsApp Cloud API configurado
- Firebase com Service Account

## Instalação

```bash
npm install
cp .env.example .env
```

Preencha no `.env`:

- `WA_CLOUD_ACCESS_TOKEN`
- `WA_CLOUD_PHONE_NUMBER_ID`
- `WA_CLOUD_VERIFY_TOKEN`
- Firebase do projeto `autozap-4537e`:
  - `FIREBASE_PROJECT_ID=autozap-4537e`
  - `FIREBASE_SERVICE_ACCOUNT_PATH` ou (`FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`)
  - Template: `firebase-service-account.example.json`

## Rodar (desenvolvimento)

### Desktop (recomendado)

```bash
npm run desktop:dev
```

### Apenas servidor web (debug técnico)

```bash
npm run dev
```

## Build desktop

```bash
npm run desktop:dist:mac
npm run desktop:dist:win
npm run desktop:dist:win:x64
```

Saída: `dist-electron/`

Para build desktop apontando para backend remoto (cliente sem configuração local):

```bash
AUTOZAP_TARGET_SERVER_URL=https://api.seudominio.com npm run desktop:dist:mac:cloud
AUTOZAP_TARGET_SERVER_URL=https://api.seudominio.com npm run desktop:dist:win:cloud
```

Esse build grava `electron/runtime-config.json` com o endpoint remoto.

## Mobile (Expo React Native)

A parte mobile foi migrada para **React Native com Expo** no diretório `mobile-expo/`.

Scripts no projeto raiz:

```bash
npm run mobile:install
npm run mobile:dev
npm run mobile:start
npm run mobile:android
npm run mobile:ios
```

Fluxo recomendado para Android físico:

```bash
npm run mobile:adb:reverse
npm run mobile:start
```

Depois, no Expo Go, escaneie o QR Code do Metro.

Mais detalhes de build mobile estão em `mobile-expo/README.md`.

## Produção (Oracle Free VM + Firebase)

Fluxo recomendado:

- Backend/API rodando na sua VM free da Oracle (Node.js + PM2 + Nginx).
- Firebase usado para persistência central (Firestore), sem depender de Cloud Run.
- Webhook oficial da Meta aponta para sua API (`/whatsapp/webhook`) na própria VM.
- Segredos (`WA_CLOUD_ACCESS_TOKEN`, `WA_CLOUD_APP_SECRET`, service account do Firebase) ficam somente no servidor.

Scripts úteis do projeto:

```bash
npm run oracle:setup:vm
npm run oracle:deploy
npm run oracle:pm2:reload
```

Arquivos de apoio:

- `scripts/oracle/setup-vm.sh`
- `scripts/oracle/deploy.sh`
- `scripts/oracle/pm2.ecosystem.config.cjs`
- `scripts/oracle/nginx-autozap.conf.example`

### Passo a passo resumido (Oracle VM)

```bash
# 1) preparar VM (Oracle Linux 9, Ubuntu ou Debian)
sudo APP_USER=autozap APP_DIR=/opt/autozap bash ./scripts/oracle/setup-vm.sh

# 2) clonar projeto na VM e configurar .env de produção
sudo -u autozap git clone https://github.com/Nycolazs/autozap.git /opt/autozap
sudo -u autozap cp /opt/autozap/.env.example /opt/autozap/.env

# 3) deploy e subida da API em PM2
sudo -u autozap APP_DIR=/opt/autozap BRANCH=main bash /opt/autozap/scripts/oracle/deploy.sh
```

Configuração do Nginx e TLS:

```bash
sudo cp /opt/autozap/scripts/oracle/nginx-autozap.conf.example /etc/nginx/sites-available/autozap
sudo ln -sf /etc/nginx/sites-available/autozap /etc/nginx/sites-enabled/autozap
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.seudominio.com
```

No `.env` de produção (VM), ajuste ao menos:

- `NODE_ENV=production`
- `TRUST_PROXY=1`
- `FRONTEND_REQUIRE_DESKTOP=0`
- `WA_CLOUD_ACCESS_TOKEN`, `WA_CLOUD_PHONE_NUMBER_ID`, `WA_CLOUD_VERIFY_TOKEN`
- `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_PATH` (ou `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`)

## Atualização automática (GitHub Releases)

Ao iniciar o desktop, o app verifica a última release no GitHub e, quando encontra versão mais nova, baixa automaticamente o instalador e tenta abrir o instalador sozinho (`.exe` no Windows, `.dmg` no macOS).

Configurações opcionais no `.env`:

- `AUTOZAP_AUTO_UPDATE_ENABLED=1` (default: ligado)
- `AUTOZAP_UPDATE_REPO=Nycolazs/autozap`
- `AUTOZAP_UPDATE_CHECK_DELAY_MS=10000`
- `AUTOZAP_AUTO_LAUNCH_INSTALLER=1` (default: ligado)
- `AUTOZAP_UPDATE_SILENT=0` (default: desligado)
- `AUTOZAP_UPDATE_ALLOW_PRERELEASE=0` (default: desligado)

O instalador baixado é salvo em:

- macOS/Windows: pasta de downloads do usuário, subpasta `AutoZap-updates`.

Para publicar novas atualizações, gere uma nova versão e uma nova tag:

```bash
npm version patch
git push origin main --follow-tags
```

## CI de release desktop (macOS + Windows)

Workflow incluído:

- `.github/workflows/desktop-release.yml`

Ele gera build macOS x64 (`.dmg` + `.zip`) e Windows x64 (`.exe` + `.zip`) via GitHub Actions e publica os assets automaticamente em tags `v*`.

### Notarização macOS (Apple Developer)

Para o `.dmg` sair assinado/notarizado automaticamente no workflow, configure os seguintes secrets no GitHub:

- `CSC_LINK`: certificado `Developer ID Application` em base64 (`.p12`)
- `CSC_KEY_PASSWORD`: senha do `.p12`
- `APPLE_API_KEY_ID`: Key ID da API Key do App Store Connect
- `APPLE_API_ISSUER`: Issuer ID da API Key
- `APPLE_API_KEY_P8`: conteúdo do arquivo `.p8` (texto completo)

O workflow detecta esses secrets:

- se existir tudo, ele assina + notariza + valida com `stapler`;
- se faltar algo, ele gera build macOS sem assinatura/notarização.

Pré-requisitos locais para notarização manual no macOS:

- Xcode completo instalado (não apenas Command Line Tools)
- certificado `Developer ID Application` instalado no Keychain com chave privada

Comandos úteis para validar no seu Mac:

```bash
security find-identity -v -p codesigning
xcrun notarytool --version
```

## Webhook oficial (Meta) direto na API da VM

Com API em produção na Oracle VM, configure o webhook da Meta diretamente no backend principal:

- Callback URL: `https://api.seudominio.com/whatsapp/webhook`
- Verify Token: mesmo valor de `WA_CLOUD_VERIFY_TOKEN` do `.env` do servidor
- Evento: `messages`

Validação opcional de assinatura:

- Defina `WA_CLOUD_APP_SECRET` no servidor
- Mantenha o App Secret correto no app Meta para validar `X-Hub-Signature-256`

Observação: o modo serverless com Firebase Functions continua disponível como fallback, mas não é necessário para produção em VM.

## Rotas principais

- `GET /whatsapp/qr`: estado da integração oficial
- `GET /whatsapp/webhook`: verificação do webhook
- `POST /whatsapp/webhook`: recebimento de eventos/mensagens
- `GET /media/wa/:mediaId`: proxy autenticado para mídia da API oficial

## Observações

- `FRONTEND_REQUIRE_DESKTOP=1` mantém o frontend acessível apenas via app desktop.
- O Firestore é sincronizado automaticamente após mutações no banco local.
- O consumidor de fila de webhook no Firestore é opcional e vem desativado por padrão (`FIREBASE_WEBHOOK_QUEUE_ENABLED=0`).
- Em troca de conta ativa, o sistema tenta restaurar dados do Firebase para o SQLite local.
- Se o banco estiver limpo (sem admin), o app inicia em `/welcome` e pede criação do primeiro admin.

## Armazenamento local (mídias/banco/sessão)

- Em desenvolvimento (`npm run dev`): usa a pasta do projeto (`/data` e `/media`).
- Em produção desktop (`.exe`/`.dmg`): usa pasta do usuário automaticamente:
  - Windows: `%APPDATA%\\AutoZap\\data` e `%APPDATA%\\AutoZap\\media`
  - macOS: `~/Library/Application Support/AutoZap/data` e `~/Library/Application Support/AutoZap/media`
- Overrides opcionais:
  - `AUTOZAP_STORAGE_MODE=project|appdata`
  - `AUTOZAP_DATA_DIR=/caminho/personalizado`
  - `AUTOZAP_MEDIA_DIR=/caminho/personalizado`
