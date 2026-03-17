import { Router } from 'express';
import type { Request, Response } from 'express';
import { getServiceClient, callEdgeFunction } from '../lib/supabase';
import type { AuthLocals } from '../middleware/auth';

const router = Router();

// GET /api/exames — lista exames do usuário autenticado
router.get('/', async (req: Request, res: Response) => {
  const { userId } = res.locals as AuthLocals;

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('tasks_listaexames')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ exames: data });
  } catch (err) {
    console.error('[BACKEND] /api/exames GET erro:', err);
    res.status(500).json({ error: 'Erro ao buscar exames' });
  }
});

// POST /api/exames — salva novos exames (usado pelo agent-ia)
router.post('/', async (req: Request, res: Response) => {
  const { userId } = res.locals as AuthLocals;
  const { thread_id, exames } = req.body as {
    thread_id: string;
    exames: { titulo: string; descricao?: string; urgencia?: string; interpretacao?: string }[];
  };

  if (!thread_id || !Array.isArray(exames) || exames.length === 0) {
    res.status(400).json({ error: 'thread_id e exames são obrigatórios' });
    return;
  }

  try {
    const supabase = getServiceClient();
    const records = exames.map((e) => ({
      user_id: userId,
      id_threadconversa: thread_id,
      titulo: e.titulo,
      descricao: e.descricao ?? '',
      urgencia: e.urgencia ?? 'media',
      interpretacao: e.interpretacao ?? '',
      status: false,
      complete: false,
    }));

    const { data, error } = await supabase
      .from('tasks_listaexames')
      .insert(records)
      .select('*');

    if (error) throw error;
    res.status(201).json({ exames: data });
  } catch (err) {
    console.error('[BACKEND] /api/exames POST erro:', err);
    res.status(500).json({ error: 'Erro ao salvar exames' });
  }
});

// POST /api/exames/gerar-guias — dispara geração de PDFs individuais + guia geral
router.post('/gerar-guias', async (req: Request, res: Response) => {
  const { userId } = res.locals as AuthLocals;
  const user_id = (req.body as { user_id?: string }).user_id || userId;

  try {
    const data = await callEdgeFunction('generate-all-exame-pdfs', {
      user_id,
      force_new: false,
      skip_guia_geral: false,
      limit: 50,
    });

    res.json(data);
  } catch (err) {
    console.error('[BACKEND] /api/exames/gerar-guias erro:', err);
    res.status(500).json({ error: 'Erro ao gerar guias de exames' });
  }
});

export default router;
