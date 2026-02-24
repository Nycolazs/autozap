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
