# Templates de Guias de Exames

## Visão Geral

O sistema utiliza templates PDF pré-gerados para criar guias de exames personalizadas. Os templates são armazenados no bucket `guias-exames-templates` do Supabase Storage e são preenchidos automaticamente com os dados do paciente quando uma guia é solicitada.

## Fluxo de Geração

1. **Criação do Exame**: Quando um exame é criado na tabela `tasks_listaexames`, um webhook aciona a Edge Function `auto-generate-exame-pdf`
2. **Busca do Template**: A função busca o template correspondente no bucket `guias-exames-templates` baseado no título do exame
3. **Preenchimento**: O template é preenchido com dados do paciente e médico usando a função `preencherTemplate`
4. **Assinatura Digital**: O PDF preenchido é assinado digitalmente pela Edge Function `sign-pdf`
5. **Upload**: O PDF assinado é enviado para o bucket `pdfs` ou `guiapdf` e a URL é salva em `tasks_listaexames.urlpdf`

## Estrutura de Templates

### Nomenclatura

Os templates devem seguir a nomenclatura: `{nome_template}.pdf`

Exemplos:
- `hemograma_completo.pdf`
- `glicemia_jejum.pdf`
- `tgo_tgp.pdf`
- `ultrassonografia_abdomen.pdf`

### Mapeamento de Exames para Templates

O mapeamento está definido em `auto-generate-exame-pdf/index.ts` e `utils/exame-template-helper.ts`:

```typescript
const EXAME_TEMPLATE_MAP: Record<string, string> = {
  'hemograma completo': 'hemograma_completo',
  'glicemia': 'glicemia',
  'glicemia em jejum': 'glicemia_jejum',
  // ... mais mapeamentos
};
```

### Campos Preenchíveis

Os templates podem usar dois métodos de preenchimento:

#### 1. Campos de Formulário PDF (AcroForm) - Recomendado

Se o template contém campos de formulário PDF, eles serão preenchidos automaticamente. Os nomes de campos suportados são:

- `nome_paciente` ou `paciente` → Nome completo do paciente
- `cpf_paciente` ou `cpf` → CPF do paciente
- `nome_medico` ou `medico` → Nome do médico
- `crm_medico` ou `crm` → CRM do médico
- `rqe_medico` → RQE do médico
- `especialidade_medico` → Especialidade do médico
- `cpf_medico` → CPF do médico
- `endereco_medico` → Endereço do consultório
- `telefone_medico` → Telefone do consultório
- `data_emissao` ou `data` → Data de emissão (formato DD/MM/AAAA)
- `titulo_exame` ou `exame` → Título do exame
- `descricao_exame` → Descrição detalhada do exame

#### 2. Desenho de Texto sobre Template

Se o template não possui campos de formulário, o sistema desenha texto sobre o template nas posições padrão. Este método é menos preciso e requer que o template tenha áreas em branco ou espaços reservados.

## Dados do Paciente

Os dados do paciente são obtidos da tabela `usuarios`:

- `nome completo` ou `nome` → Nome do paciente
- `CPF` → CPF do paciente

## Dados do Médico

Os dados do médico são configurados via variáveis de ambiente (com fallback para valores padrão):

- `MEDICO_NOME` → Nome completo do médico
- `MEDICO_CRM` → CRM do médico
- `MEDICO_RQE` → RQE do médico
- `MEDICO_ESPECIALIDADE` → Especialidade
- `MEDICO_CPF` → CPF do médico
- `MEDICO_ENDERECO` → Endereço do consultório
- `MEDICO_TELEFONE` → Telefone do consultório

## Assinatura Digital

Após o preenchimento, o PDF é assinado digitalmente pela Edge Function `sign-pdf`:

1. **Metadados**: Adiciona metadados de assinatura ao PDF
2. **Hash SHA-256**: Gera hash do documento para validação
3. **XML de Assinatura**: Gera XML XAdES simplificado com informações da assinatura
4. **Certificado Digital**: Usa certificado ICP-Brasil armazenado no bucket `certificado-digital`

### XML de Assinatura (XAdES)

O XML de assinatura contém:
- Hash SHA-256 do documento
- Nome e CRM do assinante
- Data/hora da assinatura
- Tipo de documento
- Informações do certificado digital

O XML é retornado no campo `signature_info.signature_xml` da resposta da função `sign-pdf`.

## Como Criar um Novo Template

1. **Criar o PDF**: Crie um PDF com o layout desejado
2. **Adicionar Campos (Opcional)**: Se possível, adicione campos de formulário PDF com os nomes listados acima
3. **Upload**: Faça upload do template para o bucket `guias-exames-templates` com o nome `{nome_template}.pdf`
4. **Mapeamento**: Adicione o mapeamento em `EXAME_TEMPLATE_MAP` se necessário

## Exemplo de Uso

```typescript
// Quando um exame é criado:
// 1. Webhook aciona auto-generate-exame-pdf
// 2. Busca template: hemograma_completo.pdf
// 3. Preenche com dados do paciente
// 4. Assina digitalmente
// 5. Salva URL em tasks_listaexames.urlpdf
```

## Validação

O documento assinado pode ser validado em:
- URL: https://lidfe.mayacrm.shop/consulta
- Hash do documento está disponível em `signature_info.document_hash`
- XML de assinatura está disponível em `signature_info.signature_xml`
