// ... existing code ...
      analises_exames: {
        Row: {
          id: number;
          created_at: string;
          updated_at: string;
          user_id: string;
          resultado_id: number | null;
          task_exame_id: number | null; // Foreign key para tasks_listaexames.id
          url_arquivo: string;
          tipo_arquivo: string;
          tipo_exame: string | null;
          valores_principais: Json | null;
          alteracoes: Json | null;
          interpretacao: string | null;
          proximos_passos: string | null;
          status: string | null;
          erro_mensagem: string | null;
          modelo_usado: string | null;
          tokens_usados: number | null;
          fontes: Json | null;
          // Campos legados (para compatibilidade)
          exame_id: number | null;
          analise: string | null;
          conclusao: string | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          resultado_id?: number | null;
          task_exame_id?: number | null;
          url_arquivo: string;
          tipo_arquivo: string;
          tipo_exame?: string | null;
          valores_principais?: Json | null;
          alteracoes?: Json | null;
          interpretacao?: string | null;
          proximos_passos?: string | null;
          status?: string | null;
          erro_mensagem?: string | null;
          modelo_usado?: string | null;
          tokens_usados?: number | null;
          fontes?: Json | null;
          // Campos legados
          exame_id?: number | null;
          analise?: string | null;
          conclusao?: string | null;
        };
        Update: {
          id?: number;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          resultado_id?: number | null;
          task_exame_id?: number | null;
          url_arquivo?: string;
          tipo_arquivo?: string;
          tipo_exame?: string | null;
          valores_principais?: Json | null;
          alteracoes?: Json | null;
          interpretacao?: string | null;
          proximos_passos?: string | null;
          status?: string | null;
          erro_mensagem?: string | null;
          modelo_usado?: string | null;
          tokens_usados?: number | null;
          fontes?: Json | null;
          // Campos legados
          exame_id?: number | null;
          analise?: string | null;
          conclusao?: string | null;
        };
      };
// ... existing code ...