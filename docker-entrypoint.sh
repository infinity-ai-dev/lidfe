#!/bin/sh
set -e

# Script de entrypoint que injeta variáveis de ambiente no HTML
# Antes de iniciar o Nginx
# Usar /bin/sh ao invés de bash para compatibilidade com Alpine

echo "[ENTRYPOINT] ========================================"
echo "[ENTRYPOINT] Injetando variáveis de ambiente no HTML"
echo "[ENTRYPOINT] ========================================"

# Verificar se as variáveis estão disponíveis
echo "[ENTRYPOINT] Verificando variáveis de ambiente..."
if [ -z "$GEMINI_API_KEY" ]; then
    echo "[ENTRYPOINT] ⚠️  AVISO: GEMINI_API_KEY não configurada!"
else
    echo "[ENTRYPOINT] ✅ GEMINI_API_KEY configurada (${#GEMINI_API_KEY} caracteres)"
fi

if [ -z "$SUPABASE_ANON_KEY" ]; then
    echo "[ENTRYPOINT] ⚠️  AVISO: SUPABASE_ANON_KEY não configurada!"
else
    echo "[ENTRYPOINT] ✅ SUPABASE_ANON_KEY configurada (${#SUPABASE_ANON_KEY} caracteres)"
fi

if [ -z "$SUPABASE_URL" ]; then
    SUPABASE_URL="https://xradpyucukbqaulzhdab.supabase.co"
    echo "[ENTRYPOINT] ℹ️  Usando SUPABASE_URL padrão: $SUPABASE_URL"
else
    echo "[ENTRYPOINT] ✅ SUPABASE_URL configurada: $SUPABASE_URL"
fi

# Escapar aspas simples e caracteres especiais nas variáveis para JavaScript
escape_js() {
    echo "$1" | sed "s/'/\\\\'/g" | sed 's/\\/\\\\/g'
}

GEMINI_API_KEY_ESCAPED=$(escape_js "${GEMINI_API_KEY:-}")
SUPABASE_URL_ESCAPED=$(escape_js "${SUPABASE_URL:-https://xradpyucukbqaulzhdab.supabase.co}")
SUPABASE_ANON_KEY_ESCAPED=$(escape_js "${SUPABASE_ANON_KEY:-}")

# Criar arquivo JavaScript com variáveis de ambiente
echo "[ENTRYPOINT] Criando arquivo env_config.js..."
cat > /usr/share/nginx/html/env_config.js <<EOF
// Arquivo gerado automaticamente pelo docker-entrypoint.sh em runtime
// Contém variáveis de ambiente injetadas do container
window.ENV_CONFIG = {
  GEMINI_API_KEY: '${GEMINI_API_KEY_ESCAPED}',
  SUPABASE_URL: '${SUPABASE_URL_ESCAPED}',
  SUPABASE_ANON_KEY: '${SUPABASE_ANON_KEY_ESCAPED}'
};

// Log de confirmação (apenas em desenvolvimento)
console.log('[ENV_CONFIG] Variáveis de ambiente carregadas:', {
  GEMINI_API_KEY: window.ENV_CONFIG.GEMINI_API_KEY ? '***' + window.ENV_CONFIG.GEMINI_API_KEY.substring(window.ENV_CONFIG.GEMINI_API_KEY.length - 4) : 'NÃO CONFIGURADA',
  SUPABASE_URL: window.ENV_CONFIG.SUPABASE_URL,
  SUPABASE_ANON_KEY: window.ENV_CONFIG.SUPABASE_ANON_KEY ? '***' + window.ENV_CONFIG.SUPABASE_ANON_KEY.substring(window.ENV_CONFIG.SUPABASE_ANON_KEY.length - 4) : 'NÃO CONFIGURADA'
});
EOF

# Verificar se o arquivo foi criado
if [ -f /usr/share/nginx/html/env_config.js ]; then
    echo "[ENTRYPOINT] ✅ Arquivo env_config.js criado com sucesso"
    echo "[ENTRYPOINT] Tamanho do arquivo: $(wc -c < /usr/share/nginx/html/env_config.js) bytes"
else
    echo "[ENTRYPOINT] ❌ ERRO: Falha ao criar env_config.js"
    exit 1
fi

# Verificar se index.html existe
if [ ! -f /usr/share/nginx/html/index.html ]; then
    echo "[ENTRYPOINT] ❌ ERRO: index.html não encontrado em /usr/share/nginx/html/"
    exit 1
fi

# Verificar se o script já está no index.html
if grep -q "env_config.js" /usr/share/nginx/html/index.html; then
    echo "[ENTRYPOINT] ✅ Script env_config.js já está presente no index.html"
else
    echo "[ENTRYPOINT] ⚠️  Script env_config.js não encontrado no index.html"
    echo "[ENTRYPOINT] ℹ️  O script deve ser adicionado manualmente no index.html ou via sed"
    # Tentar adicionar usando sed (compatível com Alpine)
    # Usar uma abordagem mais robusta para Alpine
    if command -v sed >/dev/null 2>&1; then
        # No Alpine, sed -i precisa de uma extensão ou arquivo temporário
        sed -i.bak '/<head>/a\
  <script src="env_config.js"></script>' /usr/share/nginx/html/index.html && rm -f /usr/share/nginx/html/index.html.bak
        echo "[ENTRYPOINT] ✅ Script env_config.js adicionado ao index.html via sed"
    else
        echo "[ENTRYPOINT] ⚠️  sed não disponível, não foi possível adicionar script automaticamente"
    fi
fi

echo "[ENTRYPOINT] ========================================"
echo "[ENTRYPOINT] ✅ Variáveis de ambiente injetadas com sucesso"
echo "[ENTRYPOINT] ========================================"
echo "[ENTRYPOINT] Iniciando Nginx..."

# Executar comando passado como argumento (geralmente nginx)
exec "$@"
