import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { importacionesStock, medicamentos, stockRegistros } from '@/db/schema';
import { requireApiSession } from '@/lib/api-auth';
import { parseSapExcel } from '@/lib/sap-parser';
import { parseManualStockExcel } from '@/lib/manual-stock-parser';

export const runtime = 'nodejs';

type RecuentoLineaDTO = {
  cn: string;
  nombre: string;
  stockCajas: number;
  stockUnidades: number;
  valorTotal: number | null;
};

async function fetchLineas(importacionId: number): Promise<RecuentoLineaDTO[]> {
  const rows = await db
    .select({
      cn: stockRegistros.cn,
      nombre: medicamentos.nombre,
      stockCajas: stockRegistros.stockCajas,
      stockUnidades: stockRegistros.stockUnidades,
      valorTotal: stockRegistros.valorTotal,
    })
    .from(stockRegistros)
    .innerJoin(medicamentos, eq(medicamentos.cn, stockRegistros.cn))
    .where(eq(stockRegistros.importacionId, importacionId));

  return rows;
}

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  const cabeceras = await db
    .select({
      id: importacionesStock.id,
      estado: importacionesStock.estado,
      origen: importacionesStock.origen,
      fechaRecuento: importacionesStock.fechaRecuento,
      importadoEn: importacionesStock.importadoEn,
      totalLineas: importacionesStock.totalLineas,
      propuestaId: importacionesStock.propuestaId,
    })
    .from(importacionesStock)
    .where(eq(importacionesStock.area, session.area))
    .orderBy(desc(importacionesStock.id));

  const pendiente = cabeceras.find((it) => it.estado === 'pendiente') ?? null;
  const historico = cabeceras.filter((it) => it.estado !== 'pendiente');

  const pendienteLineas = pendiente ? await fetchLineas(pendiente.id) : [];
  return NextResponse.json({ pendiente, pendienteLineas, historico });
}

export async function POST(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  const existingPendiente = await db
    .select({ id: importacionesStock.id })
    .from(importacionesStock)
    .where(and(eq(importacionesStock.area, session.area), eq(importacionesStock.estado, 'pendiente')))
    .get();

  if (existingPendiente) {
    return NextResponse.json(
      { error: 'Ya existe un recuento pendiente para esta area. Tramitalo antes de crear otro.' },
      { status: 409 }
    );
  }

  const form = await req.formData();
  const file = form.get('file') as File | null;
  const origen = String(form.get('origen') ?? '').toUpperCase();
  const fechaRecuento = String(form.get('fechaRecuento') ?? '').trim() || new Date().toISOString().slice(0, 10);

  if (!file) return NextResponse.json({ error: 'Falta fichero de recuento.' }, { status: 400 });
  if (origen !== 'SAP' && origen !== 'MANUAL') {
    return NextResponse.json({ error: 'Origen no valido. Usa SAP o MANUAL.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parser = origen === 'SAP' ? parseSapExcel(buffer) : parseManualStockExcel(buffer);

  const cnSet = new Set(parser.rows.map((row) => row.cn));
  const meds = cnSet.size
    ? await db
        .select({
          cn: medicamentos.cn,
          nombre: medicamentos.nombre,
          unidadesPorCaja: medicamentos.unidadesPorCaja,
        })
        .from(medicamentos)
        .where(and(eq(medicamentos.area, session.area), inArray(medicamentos.cn, Array.from(cnSet))))
    : [];
  const medsMap = new Map(meds.map((m) => [m.cn, m]));

  const errores = [...parser.errors];
  const lineasInsert: Array<{
    cn: string;
    stockUnidades: number;
    stockCajas: number;
    valorTotal: number | null;
  }> = [];

  for (const row of parser.rows) {
    const med = medsMap.get(row.cn);
    if (!med) {
      errores.push(`CN ${row.cn}: no existe en el catalogo del area activa.`);
      continue;
    }

    if (origen === 'SAP') {
      const sapRow = row as { stockUnidades: number; valorTotal: number | null };
      const stockUnidades = sapRow.stockUnidades;
      const stockCajas = med.unidadesPorCaja > 0 ? stockUnidades / med.unidadesPorCaja : 0;
      lineasInsert.push({ cn: row.cn, stockUnidades, stockCajas, valorTotal: sapRow.valorTotal });
      continue;
    }

    const manualRow = row as { stockCajas: number };
    const stockCajas = manualRow.stockCajas;
    const stockUnidades = stockCajas * med.unidadesPorCaja;
    lineasInsert.push({ cn: row.cn, stockUnidades, stockCajas, valorTotal: null });
  }

  if (lineasInsert.length === 0) {
    return NextResponse.json(
      { error: 'No se pudo generar un recuento valido.', errores },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const cabecera = await db
    .insert(importacionesStock)
    .values({
      area: session.area,
      origen: origen === 'MANUAL' ? 'Manual' : 'SAP',
      estado: 'pendiente',
      fechaRecuento,
      importadoEn: now,
      ficheroNombre: file.name,
      totalLineas: lineasInsert.length,
    })
    .returning({ id: importacionesStock.id })
    .get();

  await db.insert(stockRegistros).values(
    lineasInsert.map((linea) => ({
      importacionId: cabecera.id,
      cn: linea.cn,
      stockUnidades: linea.stockUnidades,
      stockCajas: linea.stockCajas,
      valorTotal: linea.valorTotal,
    }))
  );

  return NextResponse.json({
    ok: true,
    importacionId: cabecera.id,
    totalLineas: lineasInsert.length,
    errores,
  });
}
