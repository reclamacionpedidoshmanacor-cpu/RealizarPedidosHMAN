import { neon } from '@neondatabase/serverless';

function getDb() {
  const url = process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Falta REALIZAR_PEDIDOS_DATABASE_URL para conectar a Neon.');
  return neon(url);
}

function num(v: unknown): number {
  return Number(v ?? 0);
}

export type InventarioLineaInput = {
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

export type InventarioResumen = {
  totalLineas: number;
  totalManualUnidades: number;
  totalSapUnidades: number;
  totalAjusteUnidades: number;
  totalManualImporte: number;
  totalSapImporte: number;
  totalAjusteImporte: number;
};

export type InventarioCabecera = {
  id: number;
  area: string;
  manualRecuentoId: number;
  manualFechaRecuento: string | null;
  manualEstado: string | null;
  sapFicheroNombre: string;
  guardadoEn: string;
  totalLineas: number;
  resumen: InventarioResumen;
  warnings: string[];
};

export type InventarioLinea = InventarioLineaInput & { id: number };

export async function ensureTablesInventario() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS inventarios (
      id SERIAL PRIMARY KEY,
      area TEXT NOT NULL,
      manual_recuento_id INTEGER NOT NULL,
      manual_fecha_recuento DATE,
      manual_estado TEXT,
      sap_fichero_nombre TEXT NOT NULL,
      guardado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      total_lineas INTEGER NOT NULL DEFAULT 0,
      total_manual_unidades NUMERIC,
      total_sap_unidades NUMERIC,
      total_ajuste_unidades NUMERIC,
      total_manual_importe NUMERIC,
      total_sap_importe NUMERIC,
      total_ajuste_importe NUMERIC,
      warnings JSONB NOT NULL DEFAULT '[]'::jsonb
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS inventarios_lineas (
      id SERIAL PRIMARY KEY,
      inventario_id INTEGER NOT NULL REFERENCES inventarios(id) ON DELETE CASCADE,
      cn TEXT NOT NULL,
      principio_activo TEXT,
      medicamento TEXT NOT NULL,
      unidades_por_caja INTEGER DEFAULT 1,
      precio_caja NUMERIC,
      precio_unidad NUMERIC DEFAULT 0,
      manual_unidades NUMERIC DEFAULT 0,
      sap_unidades NUMERIC DEFAULT 0,
      ajuste_unidades NUMERIC DEFAULT 0,
      manual_importe NUMERIC DEFAULT 0,
      sap_importe NUMERIC DEFAULT 0,
      ajuste_importe NUMERIC DEFAULT 0,
      material_sap TEXT,
      UNIQUE (inventario_id, cn)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_inventarios_area ON inventarios(area, guardado_en DESC)`;
}

export async function guardarInventario(
  area: string,
  manualRecuento: { id: number; fechaRecuento: string; estado: string; totalLineas: number },
  sapFicheroNombre: string,
  warnings: string[],
  resumen: InventarioResumen,
  lineas: InventarioLineaInput[],
): Promise<number> {
  const sql = getDb();
  await ensureTablesInventario();

  const inserted = (await sql`
    INSERT INTO inventarios (
      area, manual_recuento_id, manual_fecha_recuento, manual_estado,
      sap_fichero_nombre, total_lineas,
      total_manual_unidades, total_sap_unidades, total_ajuste_unidades,
      total_manual_importe, total_sap_importe, total_ajuste_importe,
      warnings
    )
    VALUES (
      ${area}, ${manualRecuento.id}, ${manualRecuento.fechaRecuento}, ${manualRecuento.estado},
      ${sapFicheroNombre}, ${resumen.totalLineas},
      ${resumen.totalManualUnidades}, ${resumen.totalSapUnidades}, ${resumen.totalAjusteUnidades},
      ${resumen.totalManualImporte}, ${resumen.totalSapImporte}, ${resumen.totalAjusteImporte},
      ${JSON.stringify(warnings)}::jsonb
    )
    RETURNING id
  `) as Array<{ id: number }>;

  const inventarioId = num(inserted[0]!.id);

  if (lineas.length > 0) {
    await sql`
      INSERT INTO inventarios_lineas (
        inventario_id, cn, principio_activo, medicamento,
        unidades_por_caja, precio_caja, precio_unidad,
        manual_unidades, sap_unidades, ajuste_unidades,
        manual_importe, sap_importe, ajuste_importe, material_sap
      )
      SELECT * FROM unnest(
        ${lineas.map(() => inventarioId)}::integer[],
        ${lineas.map((l) => l.cn)}::text[],
        ${lineas.map((l) => l.principioActivo)}::text[],
        ${lineas.map((l) => l.medicamento)}::text[],
        ${lineas.map((l) => l.unidadesPorCaja)}::integer[],
        ${lineas.map((l) => l.precioCaja)}::numeric[],
        ${lineas.map((l) => l.precioUnidad)}::numeric[],
        ${lineas.map((l) => l.manualUnidades)}::numeric[],
        ${lineas.map((l) => l.sapUnidades)}::numeric[],
        ${lineas.map((l) => l.ajusteUnidades)}::numeric[],
        ${lineas.map((l) => l.manualImporte)}::numeric[],
        ${lineas.map((l) => l.sapImporte)}::numeric[],
        ${lineas.map((l) => l.ajusteImporte)}::numeric[],
        ${lineas.map((l) => l.materialSap)}::text[]
      )
    `;
  }

  return inventarioId;
}

export async function listInventarios(area: string, limit = 50): Promise<InventarioCabecera[]> {
  const sql = getDb();
  await ensureTablesInventario();
  const rows = (await sql`
    SELECT
      id, area, manual_recuento_id, manual_fecha_recuento::text, manual_estado,
      sap_fichero_nombre, guardado_en::text, total_lineas,
      total_manual_unidades, total_sap_unidades, total_ajuste_unidades,
      total_manual_importe, total_sap_importe, total_ajuste_importe,
      warnings
    FROM inventarios
    WHERE area = ${area}
    ORDER BY guardado_en DESC
    LIMIT ${limit}
  `) as Array<Record<string, unknown>>;

  return rows.map(mapCabecera);
}

export async function getInventarioDetalle(
  id: number,
  area: string,
): Promise<{ cabecera: InventarioCabecera; lineas: InventarioLinea[] } | null> {
  const sql = getDb();
  await ensureTablesInventario();

  const cabRows = (await sql`
    SELECT
      id, area, manual_recuento_id, manual_fecha_recuento::text, manual_estado,
      sap_fichero_nombre, guardado_en::text, total_lineas,
      total_manual_unidades, total_sap_unidades, total_ajuste_unidades,
      total_manual_importe, total_sap_importe, total_ajuste_importe,
      warnings
    FROM inventarios
    WHERE id = ${id} AND area = ${area}
  `) as Array<Record<string, unknown>>;

  if (!cabRows[0]) return null;

  const lineRows = (await sql`
    SELECT
      id, cn, principio_activo, medicamento,
      unidades_por_caja, precio_caja, precio_unidad,
      manual_unidades, sap_unidades, ajuste_unidades,
      manual_importe, sap_importe, ajuste_importe, material_sap
    FROM inventarios_lineas
    WHERE inventario_id = ${id}
    ORDER BY principio_activo NULLS LAST, medicamento
  `) as Array<Record<string, unknown>>;

  return {
    cabecera: mapCabecera(cabRows[0]),
    lineas: lineRows.map(mapLinea),
  };
}

function mapCabecera(r: Record<string, unknown>): InventarioCabecera {
  const warningsRaw = r.warnings;
  let warnings: string[] = [];
  if (Array.isArray(warningsRaw)) {
    warnings = warningsRaw.map(String);
  } else if (typeof warningsRaw === 'string') {
    try {
      const parsed = JSON.parse(warningsRaw) as unknown;
      warnings = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      warnings = [];
    }
  }

  return {
    id: num(r.id),
    area: String(r.area),
    manualRecuentoId: num(r.manual_recuento_id),
    manualFechaRecuento: r.manual_fecha_recuento ? String(r.manual_fecha_recuento) : null,
    manualEstado: r.manual_estado ? String(r.manual_estado) : null,
    sapFicheroNombre: String(r.sap_fichero_nombre),
    guardadoEn: String(r.guardado_en),
    totalLineas: num(r.total_lineas),
    resumen: {
      totalLineas: num(r.total_lineas),
      totalManualUnidades: num(r.total_manual_unidades),
      totalSapUnidades: num(r.total_sap_unidades),
      totalAjusteUnidades: num(r.total_ajuste_unidades),
      totalManualImporte: num(r.total_manual_importe),
      totalSapImporte: num(r.total_sap_importe),
      totalAjusteImporte: num(r.total_ajuste_importe),
    },
    warnings,
  };
}

function mapLinea(r: Record<string, unknown>): InventarioLinea {
  return {
    id: num(r.id),
    cn: String(r.cn),
    principioActivo: r.principio_activo ? String(r.principio_activo) : null,
    medicamento: String(r.medicamento),
    unidadesPorCaja: num(r.unidades_por_caja) || 1,
    precioCaja: r.precio_caja != null ? num(r.precio_caja) : null,
    precioUnidad: num(r.precio_unidad),
    manualUnidades: num(r.manual_unidades),
    sapUnidades: num(r.sap_unidades),
    ajusteUnidades: num(r.ajuste_unidades),
    manualImporte: num(r.manual_importe),
    sapImporte: num(r.sap_importe),
    ajusteImporte: num(r.ajuste_importe),
    materialSap: r.material_sap ? String(r.material_sap) : null,
  };
}
