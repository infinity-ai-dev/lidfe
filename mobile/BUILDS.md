# Guia de Builds - LIDFE App

O app LIDFE é desenvolvido em React Native/Expo e suporta **3 plataformas**:
- 🌐 **Web** (navegadores)
- 📱 **iOS** (iPhone/iPad)
- 🤖 **Android** (smartphones/tablets)

## Estrutura

O código é **único** para todas as plataformas. Apenas o processo de build é diferente:

```
mobile/
├── src/              # Código compartilhado (web, iOS, Android)
├── Dockerfile        # Build para WEB
├── build-push-web.sh # Script de build/push WEB
├── build-mobile.sh   # Script de build MOBILE (iOS/Android)
└── eas.json          # Configuração EAS Build (mobile)
```

## Builds Disponíveis

### 🌐 Web (Navegadores)

**Status**: ✅ Implementado e deployado

**Como buildar:**
```bash
cd mobile
./build-push-web.sh
```

**O que faz:**
- Build do Expo para web (`expo export --platform web`)
- Cria imagem Docker unificada (`backend/Dockerfile`) para servir o bundle web
- Faz push para `infinitytools/lidfe:latest`
- Deploy via Docker Swarm

**Deploy:**
```bash
# Na VPS
docker service update --image infinitytools/lidfe:latest lidfe-web_frontend
```

### 📱 iOS (iPhone/iPad)

**Status**: ⏳ Configurado, aguardando build

**Pré-requisitos:**
- Conta Expo (gratuita)
- EAS CLI instalado: `npm install -g eas-cli`
- Login: `eas login`

**Como buildar:**
```bash
cd mobile
./build-mobile.sh
# Escolher opção 1 (iOS)
```

**Ou manualmente:**
```bash
cd mobile
npm run build:ios
```

**O que faz:**
- Build nativo iOS via EAS Build
- Gera arquivo `.ipa` para App Store
- Upload automático para Expo

**Distribuição:**
- App Store Connect (via EAS Submit)
- TestFlight (beta testing)

### 🤖 Android (Smartphones/Tablets)

**Status**: ⏳ Configurado, aguardando build

**Pré-requisitos:**
- Conta Expo (gratuita)
- EAS CLI instalado: `npm install -g eas-cli`
- Login: `eas login`

**Como buildar:**
```bash
cd mobile
./build-mobile.sh
# Escolher opção 2 (Android)
```

**Ou manualmente:**
```bash
cd mobile
npm run build:android
```

**O que faz:**
- Build nativo Android via EAS Build
- Gera arquivo `.apk` ou `.aab` (Google Play)
- Upload automático para Expo

**Distribuição:**
- Google Play Store (via EAS Submit)
- APK direto (distribuição interna)

## Variáveis de Ambiente

As variáveis `EXPO_PUBLIC_*` são incluídas no bundle durante o build:

**Web (Dockerfile):**
```dockerfile
ARG EXPO_PUBLIC_SUPABASE_ANON_KEY
ENV EXPO_PUBLIC_SUPABASE_ANON_KEY=${EXPO_PUBLIC_SUPABASE_ANON_KEY}
```

**Mobile (eas.json):**
```json
{
  "build": {
    "production": {
      "env": {
        "EXPO_PUBLIC_SUPABASE_URL": "...",
        "EXPO_PUBLIC_AGENT_IA_URL": "..."
      }
    }
  }
}
```

**Importante**: A chave `EXPO_PUBLIC_SUPABASE_ANON_KEY` deve ser definida:
- **Web**: Via `--build-arg` no Dockerfile ou `docker-compose.yml`
- **Mobile**: Via `eas.json` ou variável de ambiente no EAS

## Scripts Disponíveis

```bash
# Desenvolvimento
npm start              # Expo Dev Server (todas as plataformas)
npm run android        # Android emulador
npm run ios            # iOS simulador
npm run web            # Web no navegador

# Builds
npm run build:web      # Build web (export)
npm run build:ios      # Build iOS (EAS)
npm run build:android  # Build Android (EAS)
npm run build:all      # Build iOS + Android (EAS)

# Scripts auxiliares
./build-push-web.sh    # Build e push web para Docker Hub
./build-mobile.sh      # Build mobile (iOS/Android) via EAS
```

## Diferenças entre Plataformas

### Web
- ✅ Build via Docker (Nginx)
- ✅ Deploy via Docker Swarm
- ✅ Acesso via navegador
- ⚠️ PDF generation usa stub/API (não usa @react-pdf/renderer diretamente)

### Mobile (iOS/Android)
- ✅ Build nativo via EAS Build
- ✅ Acesso a recursos nativos (câmera, microfone, etc.)
- ✅ Performance nativa
- ✅ Distribuição via App Stores
- ✅ PDF generation funciona nativamente

## Próximos Passos

1. ✅ **Web**: Já implementado e deployado
2. ⏳ **iOS**: Configurar certificados e fazer primeiro build
3. ⏳ **Android**: Configurar keystore e fazer primeiro build
4. ⏳ **EAS Submit**: Configurar submissão automática para stores

---

**Nota**: O código é o mesmo para todas as plataformas. Apenas o processo de build e distribuição é diferente.
