# Servidor SSE - LIDFE Chat

Servidor dedicado para Server-Sent Events (SSE) do LIDFE Chat.

## Funcionalidades

- ✅ Conexões SSE persistentes
- ✅ Integração com Redis pub/sub
- ✅ Página de debug para desenvolvimento
- ✅ API de status
- ✅ Endpoint de teste

## Configuração

### Variáveis de Ambiente

```bash
PORT=3001
REDIS_URL=redis://localhost:6379
```

## Endpoints

- `GET /sse?user_id=X&thread_id=Y` - Conexão SSE
- `GET /debug` - Página de debug
- `GET /status` - Status do servidor (API)
- `POST /test` - Enviar mensagem de teste

## Desenvolvimento

```bash
npm install
npm run dev
```

## Produção

```bash
npm run build
npm run start:prod
```

## Docker

```bash
docker build -t lidfe-sse-server .
docker run -p 3001:3001 -e REDIS_URL=redis://host.docker.internal:6379 lidfe-sse-server
```
