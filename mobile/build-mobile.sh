#!/bin/bash

# Script para build das versões MOBILE (iOS e Android) do app React Native/Expo
# Usa EAS Build (Expo Application Services) para builds nativos

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Build Mobile - LIDFE (iOS/Android)${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Verificar se estamos no diretório correto
if [ ! -f "package.json" ]; then
    echo -e "${RED}Erro: package.json não encontrado${NC}"
    echo -e "${YELLOW}Execute este script do diretório mobile/${NC}"
    exit 1
fi

# Verificar se EAS CLI está instalado
if ! command -v eas &> /dev/null; then
    echo -e "${YELLOW}Instalando EAS CLI...${NC}"
    npm install -g eas-cli
fi

# Verificar se está logado no EAS
if ! eas whoami &> /dev/null; then
    echo -e "${YELLOW}Fazendo login no EAS...${NC}"
    eas login
fi

# Menu de opções
echo -e "${BLUE}Escolha a plataforma:${NC}"
echo -e "1) iOS"
echo -e "2) Android"
echo -e "3) Ambas (iOS + Android)"
echo ""
read -p "Opção [1-3]: " PLATFORM

case $PLATFORM in
    1)
        PLATFORMS="ios"
        ;;
    2)
        PLATFORMS="android"
        ;;
    3)
        PLATFORMS="all"
        ;;
    *)
        echo -e "${RED}Opção inválida${NC}"
        exit 1
        ;;
esac

# Build usando EAS
echo -e "${YELLOW}🔨 Iniciando build(s)...${NC}"
echo ""

if [ "$PLATFORMS" = "all" ]; then
    echo -e "${BLUE}Build iOS...${NC}"
    eas build --platform ios --profile production
    
    echo ""
    echo -e "${BLUE}🤖 Build Android...${NC}"
    eas build --platform android --profile production
else
    eas build --platform $PLATFORMS --profile production
fi

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  🎉 Build Mobile Concluído!             ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Próximos passos:${NC}"
echo -e "1. Verificar builds em: https://expo.dev/accounts/[seu-account]/projects/lidfe-mobile/builds"
echo -e "2. Baixar APK/IPA quando concluído"
echo -e "3. Distribuir via App Store / Google Play"
echo ""
