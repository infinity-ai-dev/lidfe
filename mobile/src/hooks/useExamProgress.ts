import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/services/supabase/client';

type ExamProgressState = {
  total: number;
  completed: number;
  percentage: number;
  loading: boolean;
};

export type ExamProgress = ExamProgressState & {
  progress: number;
  isUnlocked: boolean;
  refresh: () => Promise<void>;
};

type UseExamProgressOptions = {
  watch?: boolean;
};

const buildProgressState = (rows: Array<{ urlfoto?: string | null }>): ExamProgressState => {
  const total = rows.length;
  const completed = rows.filter((row) => (row.urlfoto || '').trim().length > 0).length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, percentage, loading: false };
};

export function useExamProgress(options: UseExamProgressOptions = {}): ExamProgress {
  const [state, setState] = useState<ExamProgressState>({
    total: 0,
    completed: 0,
    percentage: 0,
    loading: true,
  });

  const refresh = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, loading: true }));
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setState({ total: 0, completed: 0, percentage: 0, loading: false });
        return;
      }

      const { data, error } = await supabase
        .from('tasks_listaexames')
        .select('id, urlfoto')
        .eq('user_id', user.id);

      if (error) {
        throw error;
      }

      const rows = (data || []) as Array<{ urlfoto?: string | null }>;
      setState(buildProgressState(rows));
    } catch (error) {
      console.error('[ExamProgress] Erro ao calcular progresso:', error);
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (options.watch === false) return;

    let channel: any;
    let isMounted = true;

    const setupSubscription = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !isMounted) return;

        channel = supabase
          .channel('exam-progress-updates')
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'tasks_listaexames',
              filter: `user_id=eq.${user.id}`,
            },
            () => {
              refresh();
            }
          )
          .subscribe();
      } catch (error) {
        console.warn('[ExamProgress] Falha ao assinar progresso:', error);
      }
    };

    setupSubscription();

    return () => {
      isMounted = false;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [options.watch, refresh]);

  const progress = useMemo(() => {
    if (state.total === 0) return 0;
    return Math.min(1, Math.max(0, state.completed / state.total));
  }, [state.completed, state.total]);

  const isUnlocked = useMemo(() => {
    if (state.total === 0) return true;
    return state.completed >= state.total;
  }, [state.completed, state.total]);

  return {
    ...state,
    progress,
    isUnlocked,
    refresh,
  };
}

export default useExamProgress;
