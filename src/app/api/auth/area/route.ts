import { NextRequest, NextResponse } from 'next/server';
import { isValidArea } from '@/lib/areas';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let area: string | null = null;
  try {
    const body = await req.json();
    area = String(body?.area ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Payload no valido.' }, { status: 400 });
  }

  if (!isValidArea(area)) {
    return NextResponse.json({ error: 'Area no valida.' }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true, area });
  res.cookies.set('area_session', area, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12, // 12h
  });
  return res;
}
