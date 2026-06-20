import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { parseConsumoExcel } from '@/lib/consumo-parser';
import {
  ensureConsumoTables,
  insertarImportacionConsumo,
} from '@/lib/consumo-neon';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;
  if (session.area !== 'oncologia') {
    return NextResponse.json(
      { error: 'La importación de Consumo para esta área está pendiente de configuración específica.' },
      { status: 409 }
    );
  }

  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No se recibió ningún archivo.' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const { rows, errors, periodoInicio, periodoFin } = parseConsumoExcel(buffer);

    if (errors.length && rows.length === 0) {
      return NextResponse.json({ error: errors[0], errors }, { status: 422 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'El archivo no contiene filas válidas.' }, { status: 422 });
    }

    // Asegurar tablas (idempotente, no hace nada si ya existen)
    await ensureConsumoTables();

    const importacionId = await insertarImportacionConsumo(
      session.area,
      periodoInicio!,
      periodoFin!,
      file.name,
      rows,
    );

    return NextResponse.json({
      ok: true,
      importacionId,
      totalLineas: rows.length,
      periodoInicio,
      periodoFin,
      advertencias: errors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
