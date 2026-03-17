#!/bin/bash
# ======================================================================
# Deploy Agent-IA para VPS
# ======================================================================
set -e

VPS_IP="${VPS_IP:-145.223.30.204}"
SSH_USER="${SSH_USER:-root}"
SSH_PASSWORD="${SSH_PASSWORD:-}"
SERVICE_NAME="${SERVICE_NAME:-lidfe-web_agent-ia}"

if [ -z "$SSH_PASSWORD" ]; then
  echo "ERRO: defina SSH_PASSWORD no ambiente antes de executar este script."
  echo "Exemplo: SSH_PASSWORD='sua-senha' ./deploy-agent-ia.sh"
  exit 1
fi

echo "======================================="
echo "Deploy Agent-IA para VPS"
echo "======================================="
echo ""

sshpass -p "$SSH_PASSWORD" ssh -o StrictHostKeyChecking=no "${SSH_USER}@${VPS_IP}" << EOF
  echo "Atualizando serviço ${SERVICE_NAME}..."
  docker service update --image paxley/lidfe-agent-ia:latest ${SERVICE_NAME}
  
  echo ""
  echo "Aguardando serviço estabilizar (30s)..."
  sleep 30
  
  echo ""
  echo "Status do serviço:"
  docker service ps ${SERVICE_NAME} --no-trunc | head -5
  
  echo ""
  echo "Logs recentes (últimas 50 linhas):"
  docker service logs --tail 50 ${SERVICE_NAME}
EOF

echo ""
echo "Deploy concluído!"
