#!/bin/sh
# Script de inicialização do nginx com validação de token
# Este script injeta o token de autenticação na configuração nginx

set -e

# Ler token de autenticação da variável de ambiente
AUTH_TOKEN=${AUTH_TOKEN:-"seu-token-secreto-aqui"}

# Validar que o token foi definido
if [ "$AUTH_TOKEN" = "seu-token-secreto-aqui" ]; then
    echo "AVISO: Usando token padrão. Defina AUTH_TOKEN com um token seguro!" >&2
fi

# Criar arquivo de token para referência (opcional, para scripts futuros)
echo "$AUTH_TOKEN" > /etc/nginx/auth_token.txt
chmod 600 /etc/nginx/auth_token.txt

# O arquivo de configuração está montado como read-only
# Precisamos criar uma cópia editável em /tmp e depois substituir
# Primeiro, copiar o arquivo original para /tmp
cp /etc/nginx/conf.d/default.conf /tmp/default.conf.tmp

# Substituir placeholder na cópia temporária
# IMPORTANTE: Escapar caracteres especiais que podem quebrar a comparação do nginx
ESCAPED_TOKEN=$(echo "$AUTH_TOKEN" | sed 's/[[\.*^$()+?{|]/\\&/g')

# Substituir o placeholder na cópia temporária
sed -i "s|AUTH_TOKEN_PLACEHOLDER|$ESCAPED_TOKEN|g" /tmp/default.conf.tmp

# Verificar se a substituição foi bem-sucedida
if grep -q "AUTH_TOKEN_PLACEHOLDER" /tmp/default.conf.tmp; then
    echo "ERRO: Falha ao substituir AUTH_TOKEN_PLACEHOLDER na configuração nginx!" >&2
    exit 1
fi

# Substituir o arquivo original pela versão editada
# Como o arquivo original está em volume read-only, vamos montar a cópia editada
# sobre o arquivo original usando um bind mount temporário
mv /tmp/default.conf.tmp /etc/nginx/conf.d/default.conf

# Executar o entrypoint padrão do nginx
exec /docker-entrypoint.sh "$@"
