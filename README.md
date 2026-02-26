# AutoZap (Desktop + Mobile Expo + Firebase + WhatsApp Cloud API)

AutoZap roda como **aplicativo desktop** (macOS/Windows) e **aplicativo mobile Expo (React Native)** com backend em Next.js/Express, integração oficial do WhatsApp (Cloud API) e persistência sincronizada com **Firebase Firestore**.

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

## Distribuição sem configuração do cliente

Fluxo recomendado:

- Você mantém backend + webhook em Firebase Functions/Cloud Run.
- Segredos (`WA_CLOUD_ACCESS_TOKEN`, `WA_CLOUD_APP_SECRET`, service account do Firebase) ficam só no servidor.
- O cliente só baixa `.exe`/`.dmg`, abre e faz login.

Scripts úteis:

```bash
npm run desktop:config:local
npm run desktop:config:cloud
```

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

## Webhook oficial (Meta) sem VPS

Este projeto suporta webhook serverless com **Firebase Functions**:

- A Function pública recebe os eventos da Meta.
- O payload é enfileirado no Firestore.
- O app desktop consome a fila (`_whatsapp_webhooks`) e grava tickets/mensagens localmente.

### 1) Preparar Function

```bash
cd functions
npm install
cp .env.example .env
```

Preencha `functions/.env`:

- `AUTOZAP_FUNCTION_REGION=us-central1`
- `WA_CLOUD_VERIFY_TOKEN` (o mesmo do painel Meta)
- `WA_CLOUD_APP_SECRET` (opcional, recomendado para validar assinatura)
- `AUTOZAP_DB_ROOT=autozap`
- `AUTOZAP_ACCOUNT_ID=default`
- `AUTOZAP_WEBHOOK_QUEUE_COLLECTION=_whatsapp_webhooks`

### 2) Deploy da Function

```bash
cd /Users/nycolazs/Documents/autozap
npx firebase-tools deploy --only functions:whatsappWebhook --project autozap-4537e
```

URL final de callback (padrão):

- `https://us-central1-autozap-4537e.cloudfunctions.net/whatsappWebhook`

### 3) Configurar no Meta Developers

- Callback URL: URL da Function acima
- Verify Token: igual ao `WA_CLOUD_VERIFY_TOKEN` da Function
- Assinar evento `messages`

Se definir `WA_CLOUD_APP_SECRET` na Function, mantenha o App Secret correto no app Meta para assinatura `X-Hub-Signature-256`.

## Rotas principais

- `GET /whatsapp/qr`: estado da integração oficial
- `GET /whatsapp/webhook`: verificação do webhook
- `POST /whatsapp/webhook`: recebimento de eventos/mensagens
- `GET /media/wa/:mediaId`: proxy autenticado para mídia da API oficial

## Observações

- `FRONTEND_REQUIRE_DESKTOP=1` mantém o frontend acessível apenas via app desktop.
- O Firestore é sincronizado automaticamente após mutações no banco local.
- O backend desktop também pode consumir webhooks enfileirados no Firestore (`FIREBASE_WEBHOOK_QUEUE_ENABLED=1`).
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
