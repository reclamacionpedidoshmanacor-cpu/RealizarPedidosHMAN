import { NextRequest, NextResponse } from 'next/server';
import { parseCatalogoExcel } from '@/lib/catalogo-parser';
import { isValidArea } from '@/lib/areas';
import { requireApiSession } from '@/lib/api-auth';
import { isMSE } from '@/lib/utils';
import {
  getMedicamentoByCn,
  insertMedicamento,
  updateMedicamento,
  upsertStockObjetivo,
} from '@/lib/catalogo-neon';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const session = requireApiSession(req);
    if (!session.ok) return session.response;

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const areaValue = formData.get('area') as string | null;
    const area = areaValue ?? session.area;

    if (!file) return NextResponse.json({ error: 'Falta el archivo.' }, { status: 400 });
    if (!isValidArea(area)) {
      return NextResponse.json({ error: 'Area no valida.' }, { status: 400 });
    }
    if (area !== session.area) {
      return NextResponse.json({ error: 'No autorizado para importar en otra area.' }, { status: 403 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { rows, errors, via } = parseCatalogoExcel(buffer);

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No se encontraron filas válidas.', errors }, { status: 400 });
    }

    let insertados = 0;
    let actualizados = 0;
    const omitidos: Array<{ cn: string; nombre: string; areaExistente: string }> = [];

    for (const row of rows) {
      const existing = await getMedicamentoByCn(row.cn);

      if (existing && existing.area !== area) {
        omitidos.push({ cn: existing.cn, nombre: row.nombre, areaExistente: existing.area });
        continue;
      }

      if (existing) {
        await updateMedicamento({
          ...existing,
          nombre: row.nombre,
          principioActivo: row.principioActivo,
          via: row.via,
          ubicacion: row.ubicacion,
          unidadesPorCaja: row.unidadesPorCaja,
          activo: row.activo,
          mse: isMSE(row.cn),
        });
        actualizados++;
      } else {
        await insertMedicamento({
          cn:              row.cn,
          nombre:          row.nombre,
          principioActivo: row.principioActivo,
          via:             row.via,
          area,
          ubicacion:       row.ubicacion,
          unidadesPorCaja: row.unidadesPorCaja,
          activo:          row.activo,
          comprable:       true,
          mse:             isMSE(row.cn),
          tipoMse:         null,
          precioUnidad:    null,
          precioCaja:      null,
        });
        insertados++;
      }

      await upsertStockObjetivo(
        row.cn,
        row.stockMinimo,
        row.puntoPedido,
        row.stockMaximo ?? null
      );
    }

    return NextResponse.json({
      ok: true,
      via,
      total: rows.length,
      insertados,
      actualizados,
      omitidos,
      errores: errors,
    });
  } catch (err) {
    console.error('Error importando catálogo:', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
