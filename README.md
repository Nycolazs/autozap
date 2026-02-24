# AutoZap (Desktop + Firebase + WhatsApp Cloud API)

AutoZap agora roda como **aplicativo desktop** (macOS/Windows) com backend em Next.js/Express, integração oficial do WhatsApp (Cloud API) e persistência sincronizada com **Firebase Firestore**.

## Arquitetura

- Interface: frontend legado preservado
- Runtime: desktop (`Electron`) com bloqueio do frontend em navegador comum
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

Ao iniciar o desktop, o app verifica a última release no GitHub e, quando encontra versão mais nova, mostra popup e inicia o download automaticamente.

Configurações opcionais no `.env`:

- `AUTOZAP_AUTO_UPDATE_ENABLED=1` (default: ligado)
- `AUTOZAP_UPDATE_REPO=Nycolazs/autozap`
- `AUTOZAP_UPDATE_CHECK_DELAY_MS=10000`

O instalador baixado é salvo em:

- macOS/Windows: pasta de downloads do usuário, subpasta `AutoZap-updates`.

## CI para Windows x64

Workflow incluído:

- `.github/workflows/windows-x64.yml`

Ele gera build Windows x64 (`.exe` + `.zip`) via GitHub Actions e publica assets automaticamente em tags `v*`.

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
