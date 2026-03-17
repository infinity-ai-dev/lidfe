# ─── Stage 1: Build do frontend Expo Web ────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /app

# Args do Expo (embutidos no bundle durante o build)
ARG USE_PREBUILT_WEB=false
ARG EXPO_PUBLIC_SUPABASE_URL=https://xradpyucukbqaulzhdab.supabase.co
ARG EXPO_PUBLIC_SUPABASE_ANON_KEY
ARG EXPO_PUBLIC_AGENT_IA_URL=https://lidfe.mayacrm.shop/agent
ARG EXPO_PUBLIC_AGENT_IA_AUTH_TOKEN
ARG EXPO_PUBLIC_SSE_AUTH_TOKEN
ARG EXPO_PUBLIC_BACKEND_URL=https://lidfe.mayacrm.shop/api

ENV EXPO_PUBLIC_SUPABASE_URL=$EXPO_PUBLIC_SUPABASE_URL
ENV EXPO_PUBLIC_SUPABASE_ANON_KEY=$EXPO_PUBLIC_SUPABASE_ANON_KEY
ENV EXPO_PUBLIC_AGENT_IA_URL=$EXPO_PUBLIC_AGENT_IA_URL
ENV EXPO_PUBLIC_AGENT_IA_AUTH_TOKEN=$EXPO_PUBLIC_AGENT_IA_AUTH_TOKEN
ENV EXPO_PUBLIC_SSE_AUTH_TOKEN=$EXPO_PUBLIC_SSE_AUTH_TOKEN
ENV EXPO_PUBLIC_BACKEND_URL=$EXPO_PUBLIC_BACKEND_URL

COPY mobile/package*.json ./
RUN npm ci --legacy-peer-deps

COPY mobile/ .
RUN if [ "$USE_PREBUILT_WEB" = "true" ]; then \
      test -f dist/index.html || (echo "mobile/dist ausente; execute npm run build:web antes do docker build" && exit 1); \
      echo "Using prebuilt mobile/dist"; \
    else \
      npm run build:web; \
    fi

# ─── Stage 2: Build do backend TypeScript ────────────────────────────────────
FROM node:20-alpine AS backend-build
WORKDIR /app

COPY backend/package*.json ./
RUN npm ci

COPY backend/ .
RUN npm run build

# ─── Stage 3: Imagem de produção ─────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Dependências de produção do backend
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Backend compilado
COPY --from=backend-build /app/dist ./dist

# Frontend estático (resultado do expo export)
COPY --from=frontend-build /app/dist ./public

ENV NODE_ENV=production
ENV PORT=3000
ENV PUBLIC_DIR=public

EXPOSE 3000

CMD ["node", "dist/server.js"]
