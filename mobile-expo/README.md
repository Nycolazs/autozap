# AutoZap Mobile (Expo)

App mobile nativo do AutoZap em React Native + Expo.

## Requisitos

- Node.js 20+
- Expo CLI (via `npx`)
- Backend do AutoZap rodando (local ou remoto)

## Rodar em desenvolvimento

```bash
cd mobile-expo
npm install
npm run start
```

Para abrir direto no Android:

```bash
npm run android
```

## Configurar API

Na tela de login, use **Configurar URL da API** e informe sua URL do backend:

- Local (emulador Android): `http://10.0.2.2:3000`
- Local (dispositivo fisico): `http://SEU_IP_LOCAL:3000`
- Remoto/Firebase: `https://SEU_DOMINIO`

A URL fica salva no dispositivo.

## Build

Use EAS Build para gerar APK/AAB/IPA:

```bash
npm i -g eas-cli
cd mobile-expo
eas login
eas build:configure
eas build -p android
```

## Atualização automática (APK fora da Play Store)

O app está configurado com `expo-updates` para buscar update OTA automaticamente ao abrir e ao voltar para foreground.

### Fluxo recomendado

1. Faça login no Expo:

```bash
cd mobile-expo
npx eas-cli login
```

2. Vincule o projeto (uma vez):

```bash
npx eas-cli project:init
```

3. Gere o APK inicial no canal de produção:

```bash
npx eas-cli build -p android --profile production
```

4. Para publicar atualizações de frontend/JS sem novo APK:

```bash
npm run update:production -- --message "sua mensagem de release"
```

### Publicar pelo GitHub Actions

Existe workflow em `.github/workflows/mobile-ota-update.yml`.

1. No GitHub, configure o secret `EXPO_TOKEN`.
2. Execute o workflow **Mobile OTA Update** e informe `channel` e `message`.

### Importante

- Atualizações OTA cobrem JS/TS, estilos e assets.
- Mudanças nativas (novas libs nativas, permissões, configuração Android/iOS) exigem novo APK.
