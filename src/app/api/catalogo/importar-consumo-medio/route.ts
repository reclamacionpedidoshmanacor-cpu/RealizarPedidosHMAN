import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { isAlmacenArea } from '@/lib/almacen';
import { parseConsumoMedioSapExcel } from '@/lib/consumo-medio-import-parser';
import { getMedicamentoByCn, updateMedicamentoConsumoMedio } from '@/lib/catalogo-neon';

export const runtime = 'nodejs';

function roundConsumoMedio(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function POST(req: NextRequest) {
  try {
    const session = requireApiSession(req);
    if (!session.ok) return session.response;

    if (!isAlmacenArea(session.area)) {
      return NextResponse.json(
        { error: 'La importación de consumo medio solo está disponible en Almacén.' },
        { status: 403 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const mesesRaw = Number(formData.get('meses'));

    if (!file) {
      return NextResponse.json({ error: 'Falta el archivo Excel.' }, { status: 400 });
    }
    if (!Number.isFinite(mesesRaw) || mesesRaw <= 0) {
      return NextResponse.json({ error: 'Indica un número de meses válido (mayor que 0).' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseConsumoMedioSapExcel(buffer);

    if (parsed.rows.length === 0) {
      return NextResponse.json(
        {
          error: parsed.errors[0] ?? 'No se encontraron filas válidas en el Excel.',
          errores: parsed.errors,
        },
        { status: 400 }
      );
    }

    let actualizados = 0;
    const omitidos: Array<{ cn: string; material: string }> = [];

    for (const row of parsed.rows) {
      const existing = await getMedicamentoByCn(row.cn);
      if (!existing || existing.area !== session.area) {
        omitidos.push({ cn: row.cn, material: row.material });
        continue;
      }

      const consumoMedio = roundConsumoMedio(row.consumoTotal / mesesRaw);
      await updateMedicamentoConsumoMedio(row.cn, consumoMedio);
      actualizados++;
    }

    return NextResponse.json({
      ok: true,
      meses: mesesRaw,
      filasExcel: parsed.rows.length,
      actualizados,
      omitidos,
      errores: parsed.errors,
    });
  } catch (err) {
    console.error('Error importando consumo medio:', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
