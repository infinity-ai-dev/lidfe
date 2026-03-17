# Dockerfile para Agente IA - Serviço separado
FROM node:20-alpine AS build

WORKDIR /app

# Copiar arquivos de dependências
COPY package.json package-lock.json* ./

# Instalar TODAS as dependências (incluindo dev para build TypeScript)
# Usar npm ci se package-lock.json existir, senão usar npm install
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi && npm cache clean --force

# Copiar código fonte
COPY . .

# Compilar TypeScript
RUN npm run build

# Remover dependências de desenvolvimento após build
RUN npm prune --production

# Stage 2: Runtime
FROM node:20-alpine

WORKDIR /app

# Copiar apenas arquivos necessários
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

# Criar usuário não-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expor porta
EXPOSE 3002

# Healthcheck removido para evitar chamadas frequentes

# Comando para iniciar
CMD ["node", "dist/index.js"]
