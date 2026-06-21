import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getAnalisisDatos } from '@/lib/analisis-neon';

export const runtime = 'nodejs';

function defaultDesde(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function defaultHasta(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  // Solo disponible para Oncología (área que tiene datos de consumo)
  if (session.area !== 'oncologia') {
    return NextResponse.json(
      { error: 'El análisis de consumo sólo está disponible para el área de Oncología.' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const desde    = searchParams.get('desde')    || defaultDesde();
  const hasta    = searchParams.get('hasta')    || defaultHasta();
  const grupo    = searchParams.get('grupo')    || null;
  const servicio = searchParams.get('servicio') || null;

  try {
    const datos = await getAnalisisDatos(session.area, desde, hasta, grupo, servicio);
    return NextResponse.json(datos);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
