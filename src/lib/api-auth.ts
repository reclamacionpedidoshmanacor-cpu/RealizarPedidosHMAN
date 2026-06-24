import { NextRequest, NextResponse } from 'next/server';
import { isValidArea, type AreaId } from '@/lib/areas';

type SessionResult =
  | { ok: true; area: AreaId }
  | { ok: false; response: NextResponse };

export function requireApiSession(req: NextRequest): SessionResult {
  const auth = req.cookies.get('auth_session')?.value;
  if (auth !== 'authenticated') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Sesion no valida.' }, { status: 401 }),
    };
  }

  const area = req.cookies.get('area_session')?.value;
  if (!isValidArea(area)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Area de sesion no valida.' }, { status: 401 }),
    };
  }

  return { ok: true, area };
}

/** Sesión completa o solo área (flujo público de recuento / pasillo Almacén). */
export function requireApiSessionOrArea(req: NextRequest): SessionResult {
  const session = requireApiSession(req);
  if (session.ok) return session;

  const area = req.cookies.get('area_session')?.value;
  if (isValidArea(area)) {
    return { ok: true, area };
  }

  return session;
}
