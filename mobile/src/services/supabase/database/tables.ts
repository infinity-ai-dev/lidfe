import { supabase } from '../client';
import type { Database } from '@/types/database.types';

type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
type Inserts<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
type Updates<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];

export type AnamneseChatHistorico = Tables<'anamnesechathistorico'>;
export type AnamneseChatHistoricoInsert = Inserts<'anamnesechathistorico'>;
export type AnamneseChatHistoricoUpdate = Updates<'anamnesechathistorico'>;

export type Usuario = Tables<'usuarios'>;
export type UsuarioInsert = Inserts<'usuarios'>;
export type UsuarioUpdate = Updates<'usuarios'>;

export type Exame = Tables<'exames'>;
export type ExameInsert = Inserts<'exames'>;
export type ExameUpdate = Updates<'exames'>;

export type Resultado = Tables<'resultados'>;
export type ResultadoInsert = Inserts<'resultados'>;
export type ResultadoUpdate = Updates<'resultados'>;

export type TaskListaExames = Tables<'tasks_listaexames'>;
export type TaskListaExamesInsert = Inserts<'tasks_listaexames'>;
export type TaskListaExamesUpdate = Updates<'tasks_listaexames'>;

export type GoalPrescricao = Tables<'goals_prescricao'>;
export type GoalPrescricaoInsert = Inserts<'goals_prescricao'>;
export type GoalPrescricaoUpdate = Updates<'goals_prescricao'>;

export type UserTwoFactorAuth = Tables<'user_two_factor_auth'>;
export type UserTwoFactorAuthInsert = Inserts<'user_two_factor_auth'>;
export type UserTwoFactorAuthUpdate = Updates<'user_two_factor_auth'>;

export type AnaliseExame = Tables<'analises_exames'>;
export type AnaliseExameInsert = Inserts<'analises_exames'>;
export type AnaliseExameUpdate = Updates<'analises_exames'>;

export const databaseService = {
  anamneseChatHistorico: {
    async getAll(filters?: { userId?: string; threadId?: string; afterId?: number; limit?: number }) {
      let query = supabase.from('anamnesechathistorico').select('*');
      
      if (filters?.userId) {
        query = query.eq('user_id', filters.userId);
      }
      if (filters?.threadId) {
        query = query.eq('id_threadconversa', filters.threadId);
      }
      if (typeof filters?.afterId === 'number' && Number.isFinite(filters.afterId)) {
        query = query.gt('id', filters.afterId);
      }
      
      query = query.order('created_at', { ascending: true });
      if (typeof filters?.limit === 'number' && Number.isFinite(filters.limit)) {
        query = query.limit(filters.limit);
      }

      const { data, error } = await query;
      return { data, error };
    },

    async insert(row: AnamneseChatHistoricoInsert) {
      const { data, error } = await supabase
        .from('anamnesechathistorico')
        .insert(row)
        .select()
        .single();
      return { data, error };
    },

    async update(id: number, updates: AnamneseChatHistoricoUpdate) {
      const { data, error } = await supabase
        .from('anamnesechathistorico')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      return { data, error };
    },

    async delete(id: number) {
      const { error } = await supabase
        .from('anamnesechathistorico')
        .delete()
        .eq('id', id);
      return { error };
    },
  },

  usuarios: {
    async getByUserId(userId: string) {
      const { data, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('user_id', userId)
        .single();
      return { data, error };
    },

    async insert(row: UsuarioInsert) {
      const { data, error } = await supabase
        .from('usuarios')
        .insert(row)
        .select()
        .single();
      return { data, error };
    },

    async update(userId: string, updates: UsuarioUpdate) {
      const { data, error } = await supabase
        .from('usuarios')
        .update(updates)
        .eq('user_id', userId)
        .select()
        .single();
      return { data, error };
    },
  },

  exames: {
    async getAll(filters?: { userId?: string }) {
      let query = supabase.from('exames').select('*');
      
      if (filters?.userId) {
        query = query.eq('user_id', filters.userId);
      }
      
      const { data, error } = await query.order('created_at', { ascending: false });
      return { data, error };
    },

    async getById(exameId: number) {
      const { data, error } = await supabase
        .from('exames')
        .select('*')
        .eq('exame_id', exameId)
        .single();
      return { data, error };
    },

    async insert(row: ExameInsert) {
      const { data, error } = await supabase
        .from('exames')
        .insert(row)
        .select()
        .single();
      return { data, error };
    },

    async update(exameId: number, updates: ExameUpdate) {
      const { data, error } = await supabase
        .from('exames')
        .update(updates)
        .eq('exame_id', exameId)
        .select()
        .single();
      return { data, error };
    },
  },

  resultados: {
    async getByExameId(exameId: number) {
      const { data, error } = await supabase
        .from('resultados')
        .select('*')
        .eq('exame_id', exameId)
        .order('created_at', { ascending: false });
      return { data, error };
    },

    async insert(row: ResultadoInsert) {
      const { data, error } = await supabase
        .from('resultados')
        .insert(row)
        .select()
        .single();
      return { data, error };
    },
  },
};

export default databaseService;
