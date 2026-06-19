import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { parseSapExcel } from '@/lib/sap-parser';
import { listMedicamentosByArea } from '@/lib/catalogo-neon';
import { getLineasRecuento, getRecuentoCabeceraById } from '@/lib/stock-propuesta-neon';

export const runtime = 'nodejs';

type RowComparativa = {
  cn: string;
  principioActivo: string | null;
  medicamento: string;
  unidadesPorCaja: number;
  precioCaja: number | null;
  precioUnidad: number;
  manualUnidades: number;
  sapUnidades: number;
  ajusteUnidades: number;
  manualImporte: number;
  sapImporte: number;
  ajusteImporte: number;
  materialSap: string | null;
};

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export async function POST(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const manualRecuentoId = Number(form.get('manualRecuentoId'));

    if (!Number.isFinite(manualRecuentoId) || manualRecuentoId <= 0) {
      return NextResponse.json({ error: 'manualRecuentoId no válido.' }, { status: 400 });
    }
    if (!file) return NextResponse.json({ error: 'Falta fichero SAP.' }, { status: 400 });

    const recuento = await getRecuentoCabeceraById(manualRecuentoId);
    if (!recuento) {
      return NextResponse.json({ error: 'Recuento manual no encontrado.' }, { status: 404 });
    }
    if (recuento.area !== session.area) {
      return NextResponse.json({ error: 'No autorizado para este recuento.' }, { status: 403 });
    }
    if (recuento.origen.toLowerCase() !== 'manual') {
      return NextResponse.json({ error: 'El recuento seleccionado no es manual.' }, { status: 409 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sap = parseSapExcel(buffer);
    if (sap.rows.length === 0) {
      return NextResponse.json(
        { error: 'El fichero SAP no contiene filas válidas.', errores: sap.errors },
        { status: 422 }
      );
    }

    const [manualLineas, catalogo] = await Promise.all([
      getLineasRecuento(manualRecuentoId),
      listMedicamentosByArea(session.area),
    ]);

    const manualByCn = new Map(manualLineas.map((l) => [l.cn, l]));
    const catalogoByCn = new Map(catalogo.map((m) => [m.cn, m]));

    const sapByCn = new Map<string, { unidades: number; material: string | null }>();
    for (const row of sap.rows) {
      const prev = sapByCn.get(row.cn);
      sapByCn.set(row.cn, {
        unidades: (prev?.unidades ?? 0) + Number(row.stockUnidades),
        material: prev?.material ?? row.material ?? null,
      });
    }

    const warnings = [...sap.errors.map((e) => `[SAP] ${e}`)];
    const missingPriceWarned = new Set<string>();
    for (const cn of sapByCn.keys()) {
      if (!catalogoByCn.has(cn)) {
        warnings.push(`[CATALOGO] CN ${cn}: no existe en el catálogo del área activa.`);
      }
    }

    const allCns = new Set<string>([
      ...manualByCn.keys(),
      ...sapByCn.keys(),
    ]);

    const rows: RowComparativa[] = [...allCns].map((cn) => {
      const man = manualByCn.get(cn);
      const sapRow = sapByCn.get(cn);
      const med = catalogoByCn.get(cn);

      const upc = med && Number(med.unidadesPorCaja) > 0 ? Number(med.unidadesPorCaja) : 1;
      const manualUnidades = Number(man?.stockUnidades ?? 0);
      const sapUnidades = Number(sapRow?.unidades ?? 0);
      const ajusteUnidades = manualUnidades - sapUnidades;
      const precioCaja = med?.precioCaja ?? null;
      const precioUnidad =
        med?.precioUnidad != null
          ? Number(med.precioUnidad)
          : precioCaja != null
            ? Number(precioCaja) / upc
            : 0;
      const manualImporte = manualUnidades * precioUnidad;
      const sapImporte = sapUnidades * precioUnidad;
      const ajusteImporte = ajusteUnidades * precioUnidad;

      if (precioUnidad <= 0 && !missingPriceWarned.has(cn)) {
        missingPriceWarned.add(cn);
        warnings.push(`[PRECIO] CN ${cn}: sin coste válido (precio_caja/precio_unidad) para calcular importe.`);
      }

      return {
        cn,
        principioActivo: med?.principioActivo ?? man?.principioActivo ?? null,
        medicamento: med?.nombre ?? man?.nombre ?? sapRow?.material ?? `CN ${cn}`,
        unidadesPorCaja: upc,
        precioCaja,
        precioUnidad: round3(precioUnidad),
        manualUnidades: round3(manualUnidades),
        sapUnidades: round3(sapUnidades),
        ajusteUnidades: round3(ajusteUnidades),
        manualImporte: round3(manualImporte),
        sapImporte: round3(sapImporte),
        ajusteImporte: round3(ajusteImporte),
        materialSap: sapRow?.material ?? null,
      };
    });

    rows.sort((a, b) => {
      const pa = a.principioActivo ?? '';
      const pb = b.principioActivo ?? '';
      const byPa = pa.localeCompare(pb, 'es', { sensitivity: 'base' });
      if (byPa !== 0) return byPa;
      return a.medicamento.localeCompare(b.medicamento, 'es', { sensitivity: 'base' });
    });

    const resumen = {
      totalLineas: rows.length,
      totalManualUnidades: round3(rows.reduce((acc, r) => acc + r.manualUnidades, 0)),
      totalSapUnidades: round3(rows.reduce((acc, r) => acc + r.sapUnidades, 0)),
      totalAjusteUnidades: round3(rows.reduce((acc, r) => acc + r.ajusteUnidades, 0)),
      totalManualImporte: round3(rows.reduce((acc, r) => acc + r.manualImporte, 0)),
      totalSapImporte: round3(rows.reduce((acc, r) => acc + r.sapImporte, 0)),
      totalAjusteImporte: round3(rows.reduce((acc, r) => acc + r.ajusteImporte, 0)),
    };

    return NextResponse.json({
      manualRecuento: {
        id: recuento.id,
        fechaRecuento: recuento.fechaRecuento,
        estado: recuento.estado,
        totalLineas: recuento.totalLineas,
      },
      sapFileName: file.name,
      warnings,
      resumen,
      rows,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
