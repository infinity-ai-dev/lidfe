#!/bin/bash
# ======================================================================
# Script de Diagnóstico VPS - Verificar Status dos Serviços
# ======================================================================

VPS_IP="${VPS_IP:-145.223.30.204}"
SSH_USER="${SSH_USER:-root}"
SSH_PASSWORD="${SSH_PASSWORD:-}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-lidfe-web_frontend}"
AGENT_SERVICE="${AGENT_SERVICE:-lidfe-web_agent-ia}"

if [ -z "$SSH_PASSWORD" ]; then
  echo "ERRO: defina SSH_PASSWORD no ambiente antes de executar este script."
  echo "Exemplo: SSH_PASSWORD='sua-senha' ./verificar-vps.sh"
  exit 1
fi

echo "======================================="
echo "Diagnóstico VPS - Lidfe"
echo "======================================="
echo ""

# Comandos para executar na VPS
sshpass -p "$SSH_PASSWORD" ssh -o StrictHostKeyChecking=no "${SSH_USER}@${VPS_IP}" << EOF
  echo "=== 1. STATUS DOS SERVIÇOS ==="
  docker service ls
  echo ""
  
  echo "=== 2. STATUS DETALHADO DO FRONTEND ==="
  docker service ps ${FRONTEND_SERVICE} --no-trunc | head -10
  echo ""
  
  echo "=== 3. STATUS DETALHADO DO AGENT-IA ==="
  docker service ps ${AGENT_SERVICE} --no-trunc | head -10
  echo ""
  
  echo "=== 4. LOGS RECENTES DO FRONTEND (últimas 30 linhas) ==="
  docker service logs --tail 30 ${FRONTEND_SERVICE} 2>&1 | tail -30
  echo ""
  
  echo "=== 5. LOGS RECENTES DO AGENT-IA (últimas 30 linhas) ==="
  docker service logs --tail 30 ${AGENT_SERVICE} 2>&1 | tail -30
  echo ""
  
  echo "=== 6. ERROS DO FRONTEND (últimas 20 linhas) ==="
  docker service logs --tail 100 ${FRONTEND_SERVICE} 2>&1 | grep -i "error\|erro\|fail\|exception" | tail -20
  echo ""
  
  echo "=== 7. ERROS DO AGENT-IA (últimas 20 linhas) ==="
  docker service logs --tail 100 ${AGENT_SERVICE} 2>&1 | grep -i "error\|erro\|fail\|exception" | tail -20
  echo ""
  
  echo "=== 8. IMAGENS DOCKER DISPONÍVEIS ==="
  docker images | grep -E "lidfe|paxley" | head -10
  echo ""
  
  echo "=== 9. VERIFICAR CONECTIVIDADE DOS SERVIÇOS ==="
  echo "Testando frontend (porta 80):"
  curl -I http://localhost:80 2>&1 | head -5 || echo "Erro ao conectar no frontend"
  echo ""
  echo "Testando agent-ia (porta 3002):"
  curl -I http://localhost:3002/health 2>&1 | head -5 || echo "Erro ao conectar no agent-ia"
  echo ""
  
  echo "=== 10. VERIFICAR RECURSOS DO SISTEMA ==="
  echo "Memória:"
  free -h
  echo ""
  echo "Disco:"
  df -h | head -5
  echo ""
  echo "CPU (últimos processos):"
  top -bn1 | head -10
  echo ""
  
  echo "=== 11. VERIFICAR REDE DOCKER ==="
  docker network ls | grep lidfe
  echo ""
  
  echo "=== 12. VERIFICAR SECRETS ==="
  docker secret ls | grep -E "gemini|supabase|sse"
  echo ""
  
  echo "======================================="
  echo "Diagnóstico concluído!"
  echo "======================================="
EOF

echo ""
echo "Script de diagnóstico executado!"
