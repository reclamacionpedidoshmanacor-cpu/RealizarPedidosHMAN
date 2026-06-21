import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { parseConsumoExcel } from '@/lib/consumo-parser';
import {
  ensureConsumoTables,
  insertarImportacionConsumo,
} from '@/lib/consumo-neon';

export const runtime = 'nodejs';

function toIsoDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Devuelve el lunes de una semana ISO (año+semana). */
function isoWeekStartDate(anio: number, semana: number): Date {
  const base = new Date(Date.UTC(anio, 0, 1 + (semana - 1) * 7));
  const day = base.getUTCDay(); // 0 dom ... 6 sáb
  const diff = day <= 4 ? 1 - day : 8 - day;
  base.setUTCDate(base.getUTCDate() + diff);
  return base;
}

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

    const anioManual = Number(form.get('anioManual'));
    const semanaManual = Number(form.get('semanaManual'));
    if (!Number.isFinite(anioManual) || anioManual < 2000 || anioManual > 2100) {
      return NextResponse.json({ error: 'Año manual no válido.' }, { status: 400 });
    }
    if (!Number.isFinite(semanaManual) || semanaManual < 1 || semanaManual > 53) {
      return NextResponse.json({ error: 'Semana manual no válida (1-53).' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseConsumoExcel(buffer);
    const { rows, errors } = parsed;

    if (errors.length && rows.length === 0) {
      return NextResponse.json({ error: errors[0], errors }, { status: 422 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'El archivo no contiene filas válidas.' }, { status: 422 });
    }

    let periodoInicio = parsed.periodoInicio;
    let periodoFin = parsed.periodoFin;

    const monday = isoWeekStartDate(anioManual, semanaManual);
    const ymSemana = monday.getUTCFullYear() * 100 + (monday.getUTCMonth() + 1);
    if (ymSemana < 202605) {
      return NextResponse.json({
        error: 'La importación semanal aplica desde mayo 2026. Para meses anteriores usa «Importar histórico (mensual)».',
      }, { status: 400 });
    }

    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const fechaMonday = toIsoDateUTC(monday);
    for (const r of rows) {
      // Para evitar incoherencias "Dic {año manual}" en semanas ISO que arrancan en diciembre,
      // guardamos año/mes reales de la fecha asignada.
      r.anio = monday.getUTCFullYear();
      r.semanaIso = semanaManual;
      r.mes = monday.getUTCMonth() + 1;
      r.dia = null;
      r.fecha = fechaMonday;
    }
    periodoInicio = toIsoDateUTC(monday);
    periodoFin = toIsoDateUTC(sunday);

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
