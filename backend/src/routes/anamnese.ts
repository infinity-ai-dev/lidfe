import { Router } from 'express';
import type { Request, Response } from 'express';
import { getServiceClient } from '../lib/supabase';
import type { AuthLocals } from '../middleware/auth';

const router = Router();

// GET /api/anamnese/:threadId — histórico de conversa de uma thread
router.get('/:threadId', async (req: Request, res: Response) => {
  const { userId } = res.locals as AuthLocals;
  const { threadId } = req.params;

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('anamnesechathistorico')
      .select('id, role, type, message, mime_type, file_name, file_size, file_type, created_at, total_tokens')
      .eq('id_threadconversa', threadId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ messages: data });
  } catch (err) {
    console.error('[BACKEND] /api/anamnese GET erro:', err);
    res.status(500).json({ error: 'Erro ao buscar histórico' });
  }
});

// GET /api/anamnese — threads do usuário (lista de conversas)
router.get('/', async (_req: Request, res: Response) => {
  const { userId } = res.locals as AuthLocals;

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('anamnesechathistorico')
      .select('id_threadconversa, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Deduplica por thread
    const seen = new Set<string>();
    const threads = (data || []).filter((row) => {
      if (seen.has(row.id_threadconversa)) return false;
      seen.add(row.id_threadconversa);
      return true;
    });

    res.json({ threads });
  } catch (err) {
    console.error('[BACKEND] /api/anamnese threads erro:', err);
    res.status(500).json({ error: 'Erro ao buscar threads' });
  }
});

export default router;
