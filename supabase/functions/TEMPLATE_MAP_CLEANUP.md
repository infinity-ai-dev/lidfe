# Limpeza de Mapeamento de Templates

## Status

O arquivo `auto-generate-exame-pdf/index.ts` ainda contém código antigo duplicado (linhas 11-68).

## Solução Necessária

Remover manualmente as linhas 11-68 do arquivo `auto-generate-exame-pdf/index.ts` que contêm o mapeamento antigo duplicado.

O arquivo deve conter apenas:
```typescript
import { EXAME_TEMPLATE_MAP, normalizeExameTitle } from '../shared/exame-template-map.ts';
```

E não deve ter o mapeamento inline duplicado.

## Arquivo Corrigido

O arquivo `supabase/functions/shared/exame-template-map.ts` já contém o mapeamento expandido com **280+ variações** baseadas em compêndios médicos brasileiros.

## Arquivos a Atualizar

1. ✅ `supabase/functions/shared/exame-template-map.ts` - CRIADO com mapeamento expandido
2. ✅ `supabase/functions/utils/exame-template-helper.ts` - ATUALIZADO para importar de shared
3. ⚠️ `supabase/functions/auto-generate-exame-pdf/index.ts` - PRECISA REMOVER linhas 11-68 (mapeamento antigo)

## Próximos Passos

1. Remover manualmente o mapeamento antigo de `auto-generate-exame-pdf/index.ts`
2. Verificar se outros arquivos também precisam ser atualizados
3. Testar se o import do shared funciona corretamente
