import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: { sub: string; email: string; role: string };
}

async function validateWithSupabase(token: string) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes');
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase Auth rejeitou token (${response.status})`);
  }

  return response.json();
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Não autorizado — token ausente' });
  }

  const token = authHeader.slice(7);
  try {
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    let decoded: any;

    if (jwtSecret) {
      try {
        decoded = jwt.verify(token, jwtSecret) as any;
      } catch (e: any) {
        console.warn('[Auth] JWT local falhou, validando via Supabase:', e.message);
        decoded = await validateWithSupabase(token);
      }
    } else {
      decoded = await validateWithSupabase(token);
    }

    req.user = {
      sub: decoded.sub || decoded.id,
      email: decoded.email || '',
      role: decoded.role || 'authenticated',
    };
    next();
  } catch (e: any) {
    console.warn('[Auth] Token rejeitado:', e.message);
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}
