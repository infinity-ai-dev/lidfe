// Definição das tools (functions) disponíveis para o Gemini

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
}

/**
 * Retorna todas as tools disponíveis
 */
export function getTools(): ToolDefinition[] {
  return [
    {
      name: 'solicitar_exames',
      description:
        'Aciona o sistema de solicitação de exames complementares. ATENÇÃO: Você DEVE preencher TODOS os argumentos obrigatórios com os dados coletados na conversa. NUNCA chame esta função com argumentos vazios {}. O schema foi simplificado para limitar o número de perguntas (máx. 15). Use os dados EXATOS que o paciente forneceu na conversa.',
      parameters: {
        type: 'object',
        properties: {
          queixa_principal: {
            type: 'string',
            description: 'Queixa principal que motivou a consulta',
          },
          // Sintoma principal simplificado para reduzir perguntas.
          sintoma_principal: {
            type: 'object',
            properties: {
              nome: { type: 'string' },
              duracao: { type: 'string' },
              intensidade: { type: 'string' },
              caracteristica: { type: 'string' },
              localizacao: { type: 'string' },
            },
            required: ['nome', 'duracao', 'intensidade', 'caracteristica', 'localizacao'],
          },
          sintomas_associados: {
            type: 'string',
            description: 'Outros sintomas relevantes (se houver)',
          },
          fatores_agravantes_ou_melhora: {
            type: 'string',
            description: 'O que piora ou melhora os sintomas',
          },
          tratamentos_tentados: {
            type: 'string',
            description: 'Tratamentos já tentados e resposta',
          },
          idade: { type: 'string', description: 'Idade do paciente' },
          sexo: { type: 'string', description: 'Sexo biológico (masculino/feminino)' },
          antecedentes_relevantes: {
            type: 'string',
            description: 'Doenças crônicas, medicamentos de uso contínuo e alergias',
          },
          sinais_alerta_identificados: {
            type: 'string',
            description: 'Sinais de alerta presentes ou "Nenhum identificado"',
          },
          dados_conversa_completa: {
            type: 'string',
            description: 'Transcrição completa da conversa',
          },
          hipoteses_investigacao: {
            type: 'string',
            description:
              'Lista de hipóteses diagnósticas a investigar (NÃO diagnóstico definitivo). Ex: "Enxaqueca, Cefaleia tensional, Sinusite". Estas são possibilidades que justificam os exames solicitados.',
          },
          justificativa_hipoteses: {
            type: 'string',
            description:
              'Justificativa de por que essas hipóteses estão sendo investigadas, baseada nos sintomas e epidemiologia',
          },
          exames_essenciais: {
            type: 'string',
            description:
              'Exames essenciais solicitados, separados por vírgula. Ex: "Hemograma completo, PCR, Raio-X de tórax PA". Se nenhum exame for essencial no momento, escreva "Nenhum - diagnóstico clínico"',
          },
          justificativa_cada_exame: {
            type: 'string',
            description:
              'Justificativa detalhada de cada exame. Formato: "Exame 1: para investigar X e pode mostrar Y | Exame 2: necessário para avaliar Z"',
          },
          urgencia_exames: {
            type: 'string',
            description:
              'Urgência para realização dos exames: "urgente" (24h), "prioritario" (2-3 dias), "rotina" (7 dias), "eletivo" (15-30 dias)',
          },
          nivel_urgencia_geral: {
            type: 'string',
            description: 'Nível de urgência geral do caso: "emergencia", "alta", "moderada", "baixa"',
          },
        },
        required: [
          'queixa_principal',
          'sintoma_principal',
          'sintomas_associados',
          'fatores_agravantes_ou_melhora',
          'tratamentos_tentados',
          'hipoteses_investigacao',
          'justificativa_hipoteses',
          'exames_essenciais',
          'justificativa_cada_exame',
          'urgencia_exames',
          'nivel_urgencia_geral',
          'idade',
          'sexo',
          'antecedentes_relevantes',
          'sinais_alerta_identificados',
        ],
      },
    },
    // TODO: Adicionar outras tools (executar_deep_research, consultar_rag_executor) conforme necessário
  ];
}
