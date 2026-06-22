import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import {
  finalizeOralImport,
  parseConsumoExcelOral,
} from '@/lib/consumo-parser';
import {
  ensureConsumoTables,
  insertarImportacionConsumo,
} from '@/lib/consumo-neon';

export const runtime = 'nodejs';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export async function POST(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;
  if (session.area !== 'oncologia') {
    return NextResponse.json(
      { error: 'La importación de Consumo para esta área está pendiente de configuración específica.' },
      { status: 409 },
    );
  }

  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No se recibió ningún archivo.' }, { status: 400 });

    const anioManualRaw = form.get('anioManual');
    const mesManualRaw = form.get('mesManual');
    const anioManual = anioManualRaw != null && anioManualRaw !== '' ? Number(anioManualRaw) : NaN;
    const mesManual = mesManualRaw != null && mesManualRaw !== '' ? Number(mesManualRaw) : NaN;
    const fallback =
      Number.isFinite(anioManual) && anioManual >= 2000 && anioManual <= 2100
      && Number.isFinite(mesManual) && mesManual >= 1 && mesManual <= 12
        ? { anio: anioManual, mes: mesManual }
        : undefined;

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseConsumoExcelOral(buffer, { allowMissingYm: !!fallback });
    const { rows, errors, tieneColumnasPeriodo } = parsed;

    if (!tieneColumnasPeriodo && !fallback) {
      return NextResponse.json({
        error: parsed.errors[0] ?? 'Faltan columnas AÑO y mes en el Excel oral.',
      }, { status: 422 });
    }
    if (errors.length && rows.length === 0) {
      return NextResponse.json({ error: errors[0], errors }, { status: 422 });
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: 'El archivo no contiene filas válidas.' }, { status: 422 });
    }

    let periodoInicio: string;
    let periodoFin: string;
    let meses: { anio: number; mes: number; filas: number }[];
    try {
      ({ periodoInicio, periodoFin, meses } = finalizeOralImport(rows, fallback));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al asignar período.';
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    await ensureConsumoTables();

    const importacionId = await insertarImportacionConsumo(
      session.area,
      periodoInicio,
      periodoFin,
      file.name,
      rows,
    );

    const mesesLabel = meses
      .map((m) => `${MESES[m.mes - 1]} ${m.anio}`)
      .join(', ');

    return NextResponse.json({
      ok: true,
      importacionId,
      totalLineas: rows.length,
      periodoInicio,
      periodoFin,
      meses,
      mesesLabel,
      modo: 'oral-mensual',
      formato: 'oral',
      cantidadColumna: parsed.cantidadColumna,
      advertencias: errors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
