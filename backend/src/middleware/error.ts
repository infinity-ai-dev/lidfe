import type { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error('[BACKEND] Erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
}
