import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { guardarInventario, type InventarioLineaInput, type InventarioResumen } from '@/lib/inventario-neon';
import { getRecuentoCabeceraById } from '@/lib/stock-propuesta-neon';

export const runtime = 'nodejs';

type GuardarBody = {
  manualRecuento?: {
    id: number;
    fechaRecuento: string;
    estado: string;
    totalLineas: number;
  };
  sapFileName?: string;
  warnings?: string[];
  resumen?: InventarioResumen;
  rows?: InventarioLineaInput[];
};

export async function POST(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const body = (await req.json()) as GuardarBody;
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No hay filas para guardar.' }, { status: 400 });
    }
    if (!body.manualRecuento?.id) {
      return NextResponse.json({ error: 'Falta recuento manual.' }, { status: 400 });
    }
    if (!body.sapFileName?.trim()) {
      return NextResponse.json({ error: 'Falta nombre del fichero SAP.' }, { status: 400 });
    }
    if (!body.resumen) {
      return NextResponse.json({ error: 'Falta resumen de la comparativa.' }, { status: 400 });
    }

    const recuento = await getRecuentoCabeceraById(body.manualRecuento.id);
    if (!recuento) {
      return NextResponse.json({ error: 'Recuento manual no encontrado.' }, { status: 404 });
    }
    if (recuento.area !== session.area) {
      return NextResponse.json({ error: 'No autorizado para este recuento.' }, { status: 403 });
    }

    const inventarioId = await guardarInventario(
      session.area,
      body.manualRecuento,
      body.sapFileName.trim(),
      Array.isArray(body.warnings) ? body.warnings.map(String) : [],
      body.resumen,
      rows,
    );

    return NextResponse.json({ ok: true, inventarioId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
