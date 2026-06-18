import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { medicamentos, stockObjetivo } from '@/db/schema';
import { parseCatalogoExcel } from '@/lib/catalogo-parser';
import { eq, sql } from 'drizzle-orm';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const area = (formData.get('area') as string) || 'oncologia';

    if (!file) return NextResponse.json({ error: 'Falta el archivo.' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const { rows, errors, via } = parseCatalogoExcel(buffer);

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No se encontraron filas válidas.', errors }, { status: 400 });
    }

    let insertados = 0;
    let actualizados = 0;

    for (const row of rows) {
      // Upsert medicamento
      const existing = await db.select({ cn: medicamentos.cn }).from(medicamentos)
        .where(eq(medicamentos.cn, row.cn)).get();

      if (existing) {
        await db.update(medicamentos).set({
          nombre:          row.nombre,
          principioActivo: row.principioActivo,
          via:             row.via,
          area,
          ubicacion:       row.ubicacion,
          unidadesPorCaja: row.unidadesPorCaja,
          activo:          row.activo,
          mse:             row.mse,
          actualizadoEn:   new Date().toISOString(),
        }).where(eq(medicamentos.cn, row.cn));
        actualizados++;
      } else {
        await db.insert(medicamentos).values({
          cn:              row.cn,
          nombre:          row.nombre,
          principioActivo: row.principioActivo,
          via:             row.via,
          area,
          ubicacion:       row.ubicacion,
          unidadesPorCaja: row.unidadesPorCaja,
          activo:          row.activo,
          comprable:       true,
          mse:             row.mse,
        });
        insertados++;
      }

      // Upsert stock objetivo
      const objExisting = await db.select({ id: stockObjetivo.id }).from(stockObjetivo)
        .where(eq(stockObjetivo.cn, row.cn)).get();

      if (objExisting) {
        await db.update(stockObjetivo).set({
          stockMinimo:   row.stockMinimo,
          puntoPedido:   row.puntoPedido,
          stockMaximo:   row.stockMaximo ?? undefined,
          actualizadoEn: new Date().toISOString(),
        }).where(eq(stockObjetivo.cn, row.cn));
      } else {
        await db.insert(stockObjetivo).values({
          cn:          row.cn,
          stockMinimo: row.stockMinimo,
          puntoPedido: row.puntoPedido,
          stockMaximo: row.stockMaximo ?? undefined,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      via,
      total: rows.length,
      insertados,
      actualizados,
      errores: errors,
    });
  } catch (err) {
    console.error('Error importando catálogo:', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
