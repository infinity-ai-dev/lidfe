import { supabase } from './supabase/client';
import { databaseService } from './supabase/database/tables';
import type { AnaliseExame, AnaliseExameInsert } from './supabase/database/tables';

export interface AnalyzeExameRequest {
  fileUrl: string;
  fileType: 'image' | 'pdf';
  resultadoId?: number;
  taskExameId?: number; // ID do exame sugerido em tasks_listaexames
}

export const exameAnalysisService = {
  async analyzeExame(
    request: AnalyzeExameRequest
  ): Promise<AnaliseExame> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Usuário não autenticado');
      }

      console.log('[EXAME-ANALYSIS] Iniciando análise de exame');
      console.log('[EXAME-ANALYSIS] URL:', request.fileUrl);
      console.log('[EXAME-ANALYSIS] Tipo:', request.fileType);

      if (request.fileType !== 'image' && request.fileType !== 'pdf') {
        throw new Error('Tipo de arquivo inválido. Use "image" ou "pdf"');
      }

      // Chamar Edge Function do Supabase
      const { data, error } = await supabase.functions.invoke('analyze-exame', {
        body: {
          file_url: request.fileUrl,
          file_type: request.fileType,
          resultado_id: request.resultadoId,
          task_exame_id: request.taskExameId,
          user_id: user.id,
        },
      });

      if (error) {
        throw new Error(error.message || 'Erro ao processar análise');
      }

      if (!data || data.error || !data.success) {
        throw new Error(data?.error || 'Erro desconhecido na análise');
      }

      // A Edge Function já salva o registro no banco
      // Apenas buscar o registro salvo usando o analise_id retornado
      if (!data.analise_id) {
        throw new Error('ID da análise não retornado pela Edge Function');
      }

      // Buscar o registro salvo pela Edge Function
      const { data: analiseData, error: selectError } = await supabase
        .from('analises_exames')
        .select('*')
        .eq('id', data.analise_id)
        .single();

      if (selectError) {
        console.error('[EXAME-ANALYSIS] Erro ao buscar análise salva:', selectError);
        // Se não conseguir buscar, retornar dados da resposta da Edge Function
        // (mas sem id válido do banco)
        // Fallback: retornar dados da resposta da Edge Function
      // Mapear interpretacao para analise (compatibilidade com schema)
      return {
          id: data.analise_id,
          user_id: user.id,
          exame_id: null,
          analise: data.interpretacao || null, // Mapear interpretacao para analise
          conclusao: null, // Campo não usado pela Edge Function
          created_at: new Date().toISOString(),
        } as AnaliseExame;
      }

      return analiseData;
    } catch (error: any) {
      console.error('[EXAME-ANALYSIS] Erro:', error);
      throw error;
    }
  },

  async getAnaliseByExameId(exameId: number): Promise<AnaliseExame | null> {
    try {
      const { data, error } = await supabase
        .from('analises_exames')
        .select('*')
        .eq('exame_id', exameId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // Nenhum resultado encontrado
          return null;
        }
        throw new Error(error.message);
      }

      return data;
    } catch (error: any) {
      console.error('[EXAME-ANALYSIS] Erro ao buscar análise:', error);
      throw error;
    }
  },

  async getAnaliseByTaskExameId(taskExameId: number): Promise<AnaliseExame | null> {
    try {
      const { data, error } = await supabase
        .from('analises_exames')
        .select('*')
        .eq('task_exame_id', taskExameId)
        .eq('status', 'concluida')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // Nenhum resultado encontrado
          return null;
        }
        throw new Error(error.message);
      }

      return data;
    } catch (error: any) {
      console.error('[EXAME-ANALYSIS] Erro ao buscar análise por task_exame_id:', error);
      throw error;
    }
  },
};

export default exameAnalysisService;
