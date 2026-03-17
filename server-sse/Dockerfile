# Dockerfile para Servidor SSE LIDFE
FROM node:20-alpine

WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./
COPY tsconfig.json ./

# Instalar dependências (incluindo dev para build)
# npm ci requer package-lock.json, se não existir usa npm install
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copiar código fonte
COPY src/ ./src/
COPY public/ ./public/

# Build TypeScript
RUN npm run build

# Remover dependências de desenvolvimento
RUN npm prune --production

# Expor porta
EXPOSE 3001

# Comando de inicialização
CMD ["node", "dist/server.js"]
