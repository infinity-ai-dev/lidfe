#!/bin/bash

# Script para build e push da versão WEB do app React Native/Expo

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

IMAGE_NAME="${IMAGE_NAME:-paxley/lidfe-web}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Build e Push - LIDFE Web (Expo)${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Verificar se estamos no diretório correto
if [ ! -f "package.json" ]; then
    echo -e "${RED}Erro: package.json não encontrado${NC}"
    echo -e "${YELLOW}Execute este script do diretório mobile/${NC}"
    exit 1
fi

# Verificar se Docker está rodando
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Erro: Docker não está rodando${NC}"
    exit 1
fi

# Login Docker Hub (necessário para push)
# - Se já existir credencial local, segue
# - Se DOCKER_HUB_USERNAME/DOCKER_HUB_PASSWORD estiverem setados, faz login non-interactive
# - Caso contrário, falha com instrução (evita prompt interativo)
echo -e "${YELLOW}Verificando autenticação no Docker Hub...${NC}"

if [ -f "$HOME/.docker/config.json" ] && grep -q '"auths"' "$HOME/.docker/config.json" 2>/dev/null; then
  echo -e "${GREEN}Docker: credenciais encontradas (config.json)${NC}"
elif [ -n "${DOCKER_HUB_USERNAME}" ] && [ -n "${DOCKER_HUB_PASSWORD}" ]; then
  echo -e "${YELLOW}Docker: realizando login via variáveis de ambiente...${NC}"
  if ! echo "$DOCKER_HUB_PASSWORD" | docker login -u "$DOCKER_HUB_USERNAME" --password-stdin; then
    echo -e "${RED}Erro ao fazer login no Docker Hub via variáveis de ambiente${NC}"
    exit 1
  fi
  echo -e "${GREEN}Login realizado com sucesso${NC}"
else
  echo -e "${RED}Erro: não há credenciais do Docker Hub disponíveis${NC}"
  echo -e "${YELLOW}Defina DOCKER_HUB_USERNAME e DOCKER_HUB_PASSWORD (ou faça login localmente) e rode novamente.${NC}"
  exit 1
fi

echo ""

# Build da imagem Docker (chaves estão hardcoded no código)
echo -e "${YELLOW}Construindo imagem Docker (Web)...${NC}"
echo -e "${BLUE}   Isso pode levar alguns minutos...${NC}"
echo ""

# Build com output em tempo real
if ! docker build --platform linux/amd64 --progress=plain -t ${IMAGE_NAME}:${IMAGE_TAG} -f Dockerfile .; then
    echo ""
    echo -e "${RED}Erro ao construir imagem${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}Imagem construída com sucesso${NC}"
echo ""

# Verificar tamanho da imagem
IMAGE_SIZE=$(docker images ${IMAGE_NAME}:${IMAGE_TAG} --format "{{.Size}}")
echo -e "${BLUE}Tamanho da imagem: ${IMAGE_SIZE}${NC}"
echo ""

# Push para Docker Hub
echo -e "${YELLOW}Fazendo push para Docker Hub...${NC}"
echo -e "${BLUE}   Isso pode levar alguns minutos dependendo do tamanho...${NC}"
echo ""

# Push com output em tempo real
if ! docker push ${IMAGE_NAME}:${IMAGE_TAG}; then
    echo ""
    echo -e "${RED}Erro ao fazer push${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}Push concluído com sucesso${NC}"
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Build e Push Web Concluido${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Imagem: ${IMAGE_NAME}:${IMAGE_TAG}${NC}"
echo -e "${BLUE}Tamanho: ${IMAGE_SIZE}${NC}"
echo -e "${BLUE}Plataforma: Web (Navegadores)${NC}"
echo ""
