# Dockerfile para LIDFE App Web (React Native/Expo)
# Build e serve do app Expo Web usando Nginx

# Stage 1: Build do Expo Web
FROM node:20-alpine AS build

WORKDIR /app

# Nota: Chaves estão hardcoded no código (anon key é pública e aparece no navegador)
# Variáveis EXPO_PUBLIC_* podem ser passadas via ARG/ENV se necessário sobrescrever

# Copiar arquivos de configuração
COPY package*.json ./
COPY app.json ./
COPY tsconfig.json ./
COPY babel.config.js ./
COPY .eslintrc.js ./
COPY .prettierrc ./

# Instalar dependências (usar --legacy-peer-deps para resolver conflitos de peer dependencies)
# Ajustar npm para reduzir falhas intermitentes de rede (ECONNRESET/ETIMEDOUT)
RUN set -eux; \
  npm config set fetch-retries 10; \
  npm config set fetch-retry-mintimeout 20000; \
  npm config set fetch-retry-maxtimeout 120000; \
  npm config set fetch-timeout 600000; \
  n=0; \
  until [ "$n" -ge 3 ]; do \
    npm install --legacy-peer-deps --no-audit --no-fund && break; \
    n=$((n+1)); \
    echo "npm install falhou (rede). Tentando novamente $n/3 em 10s..." >&2; \
    sleep 10; \
  done; \
  [ "$n" -lt 3 ]

# Instalar dependências web do Expo
RUN npx expo install react-native-web react-dom

# Copiar código fonte
COPY src/ ./src/
COPY assets/ ./assets/

# Build para web (variáveis EXPO_PUBLIC_* serão incluídas no bundle)
RUN npx expo export --platform web --output-dir dist

# Stage 2: Servir com Nginx
FROM nginx:alpine

# Copiar arquivos buildados
COPY --from=build /app/dist /usr/share/nginx/html

# Configurar Nginx para SPA (Single Page Application)
RUN echo 'server { \
    listen 80; \
    server_name _; \
    root /usr/share/nginx/html; \
    index index.html; \
    \
    # Gzip compression \
    gzip on; \
    gzip_vary on; \
    gzip_min_length 1024; \
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/javascript application/json; \
    \
    # favicon: evitar cache agressivo para permitir trocas rápidas \
    location = /favicon.ico { \
        add_header Cache-Control "no-cache, no-store, must-revalidate"; \
        add_header Pragma "no-cache"; \
        add_header Expires "0"; \
    } \
    # Cache static assets (exceto favicon.ico) \
    location ~* \.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|webp)$ { \
        expires 1y; \
        add_header Cache-Control "public, immutable"; \
    } \
    \
    # SPA routing - todas as rotas vão para index.html \
    location / { \
        try_files $uri $uri/ /index.html; \
        add_header Cache-Control "no-cache, no-store, must-revalidate"; \
        add_header Pragma "no-cache"; \
        add_header Expires "0"; \
    } \
    \
    # Forçar atualização do index.html e bundle.js \
    location ~* ^/(index\.html|_next/.*|static/.*)$ { \
        add_header Cache-Control "no-cache, no-store, must-revalidate"; \
        add_header Pragma "no-cache"; \
        add_header Expires "0"; \
    } \
    \
    # Security headers \
    add_header X-Frame-Options "SAMEORIGIN" always; \
    add_header X-Content-Type-Options "nosniff" always; \
    add_header X-XSS-Protection "1; mode=block" always; \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
