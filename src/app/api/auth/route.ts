import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { password, area } = await req.json();
  const APP_PASSWORD = process.env.APP_PASSWORD ?? 'farmacia2024';

  if (password !== APP_PASSWORD) {
    return NextResponse.json({ error: 'Contraseña incorrecta.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('auth_session', 'authenticated', {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 12, // 12h
  });
  res.cookies.set('area_session', area ?? 'oncologia', {
    httpOnly: false, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 12,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('auth_session');
  res.cookies.delete('area_session');
  return res;
}
