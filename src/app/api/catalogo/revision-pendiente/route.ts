import { NextRequest, NextResponse } from 'next/server';
import { isAlmacenArea } from '@/lib/almacen';
import { requireApiSession } from '@/lib/api-auth';
import {
  listRevisionesPendientes,
  marcarRevisionRevisada,
} from '@/lib/catalogo-revision-neon';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;
  if (!isAlmacenArea(session.area)) {
    return NextResponse.json({ items: [], area: session.area });
  }

  const items = await listRevisionesPendientes(session.area);
  return NextResponse.json({ area: session.area, items });
}

export async function PATCH(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;
  if (!isAlmacenArea(session.area)) {
    return NextResponse.json({ error: 'Solo disponible para el área Almacén.' }, { status: 403 });
  }

  const body = (await req.json()) as { id?: unknown };
  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'ID no válido.' }, { status: 400 });
  }

  const ok = await marcarRevisionRevisada(id, session.area);
  if (!ok) {
    return NextResponse.json({ error: 'Registro no encontrado o ya revisado.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
