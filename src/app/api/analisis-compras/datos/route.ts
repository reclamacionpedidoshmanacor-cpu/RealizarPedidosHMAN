import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import {
  defaultDesdeAnalisisCompras,
  defaultHastaAnalisisCompras,
  getAnalisisComprasDatos,
  type VistaAnalisisCompras,
} from '@/lib/analisis-compras-neon';

export const runtime = 'nodejs';

const AREAS_COMPRAS = new Set(['upe']);

function parseVista(value: string | null): VistaAnalisisCompras {
  if (value === 'medicamento' || value === 'proveedor') return value;
  return 'global';
}

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  if (!AREAS_COMPRAS.has(session.area)) {
    return NextResponse.json(
      { error: 'El análisis de compras no está disponible para esta área.' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const desde = searchParams.get('desde') || defaultDesdeAnalisisCompras();
  const hasta = searchParams.get('hasta') || defaultHastaAnalisisCompras();
  const vista = parseVista(searchParams.get('vista'));
  const cn = searchParams.get('cn');
  const proveedor = searchParams.get('proveedor');

  try {
    const datos = await getAnalisisComprasDatos(
      session.area,
      desde,
      hasta,
      vista,
      cn,
      proveedor
    );
    return NextResponse.json(datos);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
