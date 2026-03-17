# LIDFE Mobile - React Native

Aplicativo mobile do sistema LIDFE, migrado de Flutter para React Native.

## Stack Tecnológica

- **React Native** 0.74+ com Expo
- **TypeScript**
- **Expo Router** para navegação
- **React Native Paper** para UI
- **Zustand** para estado global
- **TanStack Query** para cache/estado servidor
- **Supabase JS Client** para backend
- **Expo AV** para áudio

## Estrutura do Projeto

```
mobile/
├── src/
│   ├── app/              # Navegação (Expo Router)
│   ├── screens/          # Telas
│   ├── components/       # Componentes reutilizáveis
│   ├── services/         # Serviços/API
│   ├── hooks/           # Custom hooks
│   ├── store/           # Estado global (Zustand)
│   ├── utils/           # Utilitários
│   └── types/           # TypeScript types
├── assets/              # Assets (imagens, fontes, etc)
└── package.json
```

## Configuração

1. Instalar dependências:
```bash
cd mobile
npm install
```

2. Configurar variáveis de ambiente:
```bash
cp .env.example .env
# Editar .env com suas credenciais
```

3. Iniciar o projeto:
```bash
npm start
```

## Build

### Android
```bash
npm run android
# ou
npx expo run:android
```

### iOS
```bash
npm run ios
# ou
npx expo run:ios
```

## Desenvolvimento

- **Lint**: `npm run lint`
- **Format**: `npm run format`
- **Type Check**: `npm run type-check`

## Status da Migração

- ✅ Fase 1: Setup e Infraestrutura Base
- ⏳ Fase 2: Autenticação e Onboarding (próxima)
- ⏳ Fase 3: Backend e Serviços
- ⏳ Fase 4: Chat com IA (Core)
- ⏳ Fase 5: Geração de PDFs
- ⏳ Fase 6: Telas Secundárias
