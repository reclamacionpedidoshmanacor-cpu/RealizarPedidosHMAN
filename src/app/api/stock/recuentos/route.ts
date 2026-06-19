import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { parseSapExcel } from '@/lib/sap-parser';
import { parseManualStockExcel } from '@/lib/manual-stock-parser';
import {
  actualizarPreciosCatalogoDesdeSap,
  crearRecuento,
  getLineasRecuento,
  getMedicamentosParaRecuento,
  getPendienteRecuento,
  getRecuentosByArea,
  insertarLineasRecuento,
} from '@/lib/stock-propuesta-neon';

export const runtime = 'nodejs';

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundPrice(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const { pendiente, historico } = await getRecuentosByArea(session.area);
    const pendienteLineas = pendiente ? await getLineasRecuento(pendiente.id) : [];
    return NextResponse.json({ pendiente, pendienteLineas, historico });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const existente = await getPendienteRecuento(session.area);
    if (existente) {
      return NextResponse.json(
        { error: 'Ya existe un recuento pendiente para esta area. Tramitalo antes de crear otro.' },
        { status: 409 }
      );
    }

    const form = await req.formData();
    const file = form.get('file') as File | null;
    const origen = String(form.get('origen') ?? '').toUpperCase();
    const fechaRecuento =
      String(form.get('fechaRecuento') ?? '').trim() || new Date().toISOString().slice(0, 10);

    if (!file) return NextResponse.json({ error: 'Falta fichero de recuento.' }, { status: 400 });
    if (origen !== 'SAP' && origen !== 'MANUAL') {
      return NextResponse.json({ error: 'Origen no valido. Usa SAP o MANUAL.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parser = origen === 'SAP' ? parseSapExcel(buffer) : parseManualStockExcel(buffer);

    const cnList = [...new Set(parser.rows.map((r) => r.cn))];
    const meds = await getMedicamentosParaRecuento(session.area, cnList);
    const medsMap = new Map(meds.map((m) => [m.cn, m]));

    const errores = parser.errors.map((msg) => `[ARCHIVO] ${msg}`);
    const lineasInsert: Array<{ cn: string; stockUnidades: number; stockCajas: number; valorTotal: number | null }> = [];
    const preciosDesdeSap: Array<{ cn: string; precioUnidad: number; precioCaja: number }> = [];

    for (const row of parser.rows) {
      const med = medsMap.get(row.cn);
      if (!med) {
        const materialInfo =
          origen === 'SAP' && 'material' in row
            ? ` Material SAP: ${String((row as { material?: unknown }).material ?? '').trim()}.`
            : '';
        errores.push(`[CATALOGO] CN ${row.cn}: no existe en el catalogo del area activa.${materialInfo}`);
        continue;
      }

      if (origen === 'SAP') {
        const sapRow = row as { stockUnidades: number; valorTotal: number | null };
        const stockCajas = roundOneDecimal(
          med.unidadesPorCaja > 0 ? sapRow.stockUnidades / med.unidadesPorCaja : 0
        );
        lineasInsert.push({ cn: row.cn, stockUnidades: sapRow.stockUnidades, stockCajas, valorTotal: sapRow.valorTotal });

        if (sapRow.valorTotal != null) {
          const valorTotal = Number(sapRow.valorTotal);
          const stockUnidades = Number(sapRow.stockUnidades);

          if (!Number.isFinite(valorTotal) || valorTotal < 0) {
            errores.push(`[PRECIO] CN ${row.cn} (${med.nombre}): "Valor final" no válido para actualizar precios.`);
          } else if (valorTotal === 0) {
            // Valor total a cero: no actualizamos precio y no lo tratamos como advertencia.
            continue;
          } else if (!Number.isFinite(stockUnidades) || stockUnidades <= 0) {
            errores.push(`[PRECIO] CN ${row.cn} (${med.nombre}): no se puede calcular precio porque Stock de cierre es <= 0.`);
          } else {
            const precioUnidad = roundPrice(valorTotal / stockUnidades);
            const precioCaja = roundPrice(precioUnidad * med.unidadesPorCaja);
            preciosDesdeSap.push({ cn: row.cn, precioUnidad, precioCaja });
          }
        }
      } else {
        const manualRow = row as { stockCajas: number };
        const stockCajas = roundOneDecimal(manualRow.stockCajas);
        lineasInsert.push({
          cn: row.cn,
          stockCajas,
          stockUnidades: stockCajas * med.unidadesPorCaja,
          valorTotal: null,
        });
      }
    }

    if (lineasInsert.length === 0) {
      return NextResponse.json({ error: 'No se pudo generar un recuento valido.', errores }, { status: 400 });
    }

    const importacionId = await crearRecuento({
      area: session.area,
      origen: origen === 'MANUAL' ? 'Manual' : 'SAP',
      fechaRecuento,
      ficheroNombre: file.name,
      totalLineas: lineasInsert.length,
    });

    await insertarLineasRecuento(importacionId, lineasInsert);
    const preciosActualizados =
      origen === 'SAP'
        ? await actualizarPreciosCatalogoDesdeSap(session.area, preciosDesdeSap)
        : 0;

    return NextResponse.json({
      ok: true,
      importacionId,
      totalLineas: lineasInsert.length,
      errores,
      preciosActualizados,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
