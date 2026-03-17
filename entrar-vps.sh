#!/bin/bash
# ======================================================================
# Script para entrar na VPS e executar diagnóstico
# ======================================================================

VPS_IP="${VPS_IP:-145.223.30.204}"
SSH_USER="${SSH_USER:-root}"
SSH_PASSWORD="${SSH_PASSWORD:-}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-lidfe-web_frontend}"
AGENT_SERVICE="${AGENT_SERVICE:-lidfe-web_agent-ia}"

if [ -z "$SSH_PASSWORD" ]; then
  echo "ERRO: defina SSH_PASSWORD no ambiente antes de executar este script."
  echo "Exemplo: SSH_PASSWORD='sua-senha' ./entrar-vps.sh"
  exit 1
fi

echo "======================================="
echo "Conectando na VPS e executando diagnóstico"
echo "======================================="
echo ""

# Verificar se expect está disponível
if command -v expect &> /dev/null; then
  echo "✅ Usando expect para automação..."
  
  expect << EOF
    set timeout 30
    spawn ssh -o StrictHostKeyChecking=no ${SSH_USER}@${VPS_IP}
    
    expect {
      "password:" {
        send "${SSH_PASSWORD}\r"
        exp_continue
      }
      "Password:" {
        send "${SSH_PASSWORD}\r"
        exp_continue
      }
      "# " {
        send "echo '=== 1. STATUS DOS SERVIÇOS ==='\r"
        send "docker service ls\r"
        send "echo ''\r"
        send "echo '=== 2. STATUS DETALHADO DO FRONTEND ==='\r"
        send "docker service ps ${FRONTEND_SERVICE} --no-trunc 2>&1 | head -10\r"
        send "echo ''\r"
        send "echo '=== 3. STATUS DETALHADO DO AGENT-IA ==='\r"
        send "docker service ps ${AGENT_SERVICE} --no-trunc 2>&1 | head -10\r"
        send "echo ''\r"
        send "echo '=== 4. LOGS RECENTES DO FRONTEND (últimas 50 linhas) ==='\r"
        send "docker service logs --tail 50 ${FRONTEND_SERVICE} 2>&1 | tail -50\r"
        send "echo ''\r"
        send "echo '=== 5. LOGS RECENTES DO AGENT-IA (últimas 50 linhas) ==='\r"
        send "docker service logs --tail 50 ${AGENT_SERVICE} 2>&1 | tail -50\r"
        send "echo ''\r"
        send "echo '=== 6. ERROS DO FRONTEND ==='\r"
        send "docker service logs --tail 200 ${FRONTEND_SERVICE} 2>&1 | grep -iE 'error|erro|fail|exception|timeout' | tail -30\r"
        send "echo ''\r"
        send "echo '=== 7. ERROS DO AGENT-IA ==='\r"
        send "docker service logs --tail 200 ${AGENT_SERVICE} 2>&1 | grep -iE 'error|erro|fail|exception|timeout' | tail -30\r"
        send "echo ''\r"
        send "echo '=== 8. VERIFICAR IMAGENS ==='\r"
        send "docker images | grep -E 'lidfe|paxley' | head -10\r"
        send "echo ''\r"
        send "echo '=== 9. TESTAR HEALTH CHECK DO AGENT-IA ==='\r"
        send "curl -v --max-time 5 http://localhost:3002/health 2>&1 | head -20 || echo '❌ Erro ao conectar no agent-ia'\r"
        send "echo ''\r"
        send "echo '=== 10. VERIFICAR REDE ==='\r"
        send "docker network ls | grep lidfe || echo 'Nenhuma rede encontrada'\r"
        send "echo ''\r"
        send "echo '=== 11. VERIFICAR SECRETS ==='\r"
        send "docker secret ls | grep -E 'gemini|supabase|sse' || echo 'Nenhum secret encontrado'\r"
        send "echo ''\r"
        send "echo '=== 12. VERIFICAR RECURSOS ==='\r"
        send "free -h 2>/dev/null || echo 'comando free não disponível'\r"
        send "df -h | head -5\r"
        send "echo ''\r"
        send "echo '=== 13. ÚLTIMAS MENSAGENS DO AGENT-IA (últimas 100 linhas) ==='\r"
        send "docker service logs --tail 100 ${AGENT_SERVICE} 2>&1 | grep -E 'process-message|terceira|TIMEOUT|timeout|Error|ERROR|❌' | tail -50\r"
        send "echo ''\r"
        send "echo '======================================='\r"
        send "echo 'Diagnóstico concluído!'\r"
        send "echo '======================================='\r"
        send "exit\r"
      }
      timeout {
        puts "Timeout ao conectar"
        exit 1
      }
    }
    
    expect eof
EOF

else
  echo "⚠️  expect não encontrado. Usando SSH interativo..."
  echo ""
  
  # Criar script temporário para executar na VPS
  cat > /tmp/diagnostico_vps.sh << SCRIPT_EOF
#!/bin/bash
echo "=== 1. STATUS DOS SERVIÇOS ==="
docker service ls
echo ""

echo "=== 2. STATUS DETALHADO DO FRONTEND ==="
docker service ps "${FRONTEND_SERVICE}" --no-trunc 2>&1 | head -10
echo ""

echo "=== 3. STATUS DETALHADO DO AGENT-IA ==="
docker service ps "${AGENT_SERVICE}" --no-trunc 2>&1 | head -10
echo ""

echo "=== 4. LOGS RECENTES DO FRONTEND (últimas 50 linhas) ==="
docker service logs --tail 50 "${FRONTEND_SERVICE}" 2>&1 | tail -50
echo ""

echo "=== 5. LOGS RECENTES DO AGENT-IA (últimas 50 linhas) ==="
docker service logs --tail 50 "${AGENT_SERVICE}" 2>&1 | tail -50
echo ""

echo "=== 6. ERROS DO FRONTEND ==="
docker service logs --tail 200 "${FRONTEND_SERVICE}" 2>&1 | grep -iE "error|erro|fail|exception|timeout" | tail -30
echo ""

echo "=== 7. ERROS DO AGENT-IA ==="
docker service logs --tail 200 "${AGENT_SERVICE}" 2>&1 | grep -iE "error|erro|fail|exception|timeout" | tail -30
echo ""

echo "=== 8. VERIFICAR IMAGENS ==="
docker images | grep -E "lidfe|paxley" | head -10
echo ""

echo "=== 9. TESTAR HEALTH CHECK DO AGENT-IA ==="
curl -v --max-time 5 http://localhost:3002/health 2>&1 | head -20 || echo "❌ Erro ao conectar no agent-ia"
echo ""

echo "=== 10. VERIFICAR REDE ==="
docker network ls | grep lidfe || echo "Nenhuma rede encontrada"
echo ""

echo "=== 11. VERIFICAR SECRETS ==="
docker secret ls | grep -E "gemini|supabase|sse" || echo "Nenhum secret encontrado"
echo ""

echo "=== 12. VERIFICAR RECURSOS ==="
echo "Memória:"
free -h 2>/dev/null || echo "comando free não disponível"
echo ""
echo "Disco:"
df -h | head -5
echo ""

echo "=== 13. ÚLTIMAS MENSAGENS DO AGENT-IA (últimas 100 linhas) ==="
docker service logs --tail 100 "${AGENT_SERVICE}" 2>&1 | grep -E "process-message|terceira|TIMEOUT|timeout|Error|ERROR|❌" | tail -50
echo ""

echo "======================================="
echo "Diagnóstico concluído!"
echo "======================================="
SCRIPT_EOF

  chmod +x /tmp/diagnostico_vps.sh
  
  echo "Copiando script para VPS..."
  scp -o StrictHostKeyChecking=no /tmp/diagnostico_vps.sh ${SSH_USER}@${VPS_IP}:/tmp/ 2>/dev/null || echo "⚠️  Não foi possível copiar script. Execute manualmente."
  
  echo ""
  echo "Conectando na VPS..."
  echo "Quando conectar, execute: bash /tmp/diagnostico_vps.sh"
  echo ""
  
  ssh -o StrictHostKeyChecking=no ${SSH_USER}@${VPS_IP}
fi

echo ""
echo "✅ Script concluído!"
