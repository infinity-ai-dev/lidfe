import { Router } from 'express';
import type { Request, Response } from 'express';
import { getServiceClient, callEdgeFunction } from '../lib/supabase';
import type { AuthLocals } from '../middleware/auth';

const router = Router();

// GET /api/prescricao — lista prescrições do usuário
router.get('/', async (_req: Request, res: Response) => {
  const { userId } = res.locals as AuthLocals;

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('prescricoes')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ prescricoes: data });
  } catch (err) {
    console.error('[BACKEND] /api/prescricao GET erro:', err);
    res.status(500).json({ error: 'Erro ao buscar prescrições' });
  }
});

// POST /api/prescricao/gerar — gera receita médica + assina em sequência
router.post('/gerar', async (req: Request, res: Response) => {
  const { userId } = res.locals as AuthLocals;
  const { medicamentos, observacoes, user_id } = req.body as {
    medicamentos: unknown[];
    observacoes?: string;
    user_id?: string;
  };

  const targetUserId = user_id || userId;

  if (!Array.isArray(medicamentos) || medicamentos.length === 0) {
    res.status(400).json({ error: 'medicamentos é obrigatório' });
    return;
  }

  // Passo 1: Gerar receita
  let receitaId: string | undefined;
  try {
    const dataGerar = await callEdgeFunction('auto-generate-prescricao-pdf', {
      user_id: targetUserId,
      medicamentos,
      observacoes: observacoes ?? '',
    }) as Record<string, unknown>;

    if (dataGerar.success === false) {
      throw new Error((dataGerar.error as string) || 'Falha ao gerar receita');
    }

    receitaId = (dataGerar.receita_id ?? dataGerar.id) as string | undefined;
    console.log(`[BACKEND] Receita gerada: id=${receitaId}`);
  } catch (err) {
    console.error('[BACKEND] /api/prescricao/gerar erro ao gerar:', err);
    res.status(500).json({ error: `Não foi possível gerar a receita: ${(err as Error).message}` });
    return;
  }

  // Passo 2: Assinar receita (não-crítico)
  try {
    const payload: Record<string, unknown> = { user_id: targetUserId };
    if (receitaId) payload.receita_id = receitaId;

    await callEdgeFunction('sign-prescricao', payload);
    console.log('[BACKEND] Receita assinada com sucesso');
    res.json({ success: true, receita_id: receitaId, signed: true });
  } catch (err) {
    console.warn('[BACKEND] Assinatura falhou (não-crítico):', err);
    res.json({ success: true, receita_id: receitaId, signed: false });
  }
});

export default router;
