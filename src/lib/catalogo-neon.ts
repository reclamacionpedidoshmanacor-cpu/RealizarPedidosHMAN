import { neon } from '@neondatabase/serverless';

export type CatalogoMedicamento = {
  cn: string;
  nombre: string;
  principioActivo: string | null;
  via: string | null;
  area: string;
  ubicacion: string | null;
  unidadesPorCaja: number;
  activo: boolean;
  comprable: boolean;
  mse: boolean;
  tipoMse: string | null;
  precioUnidad: number | null;
  precioCaja: number | null;
  stockMinimo: number | null;
  puntoPedido: number | null;
  stockMaximo: number | null;
};

export type MedicamentoBase = {
  cn: string;
  nombre: string;
  principioActivo: string | null;
  via: string | null;
  area: string;
  ubicacion: string | null;
  unidadesPorCaja: number;
  activo: boolean;
  comprable: boolean;
  mse: boolean;
  tipoMse: string | null;
  precioUnidad: number | null;
  precioCaja: number | null;
};

export type StockObjetivo = {
  cn: string;
  stockMinimo: number;
  puntoPedido: number;
  stockMaximo: number | null;
};

function getCatalogoClient() {
  const connectionString = process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Falta REALIZAR_PEDIDOS_DATABASE_URL (o DATABASE_URL) para catálogo en Neon.');
  }
  return neon(connectionString);
}

function numOrNull(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export async function listMedicamentosByArea(area: string): Promise<CatalogoMedicamento[]> {
  const sql = getCatalogoClient();
  const rows = (await sql`
    SELECT
      m.cn,
      m.nombre,
      m.principio_activo,
      m.via,
      m.area,
      m.ubicacion,
      m.unidades_por_caja,
      m.activo,
      m.comprable,
      m.mse,
      m.tipo_mse,
      m.precio_unidad,
      m.precio_caja,
      so.stock_minimo,
      so.punto_pedido,
      so.stock_maximo
    FROM public.medicamentos m
    LEFT JOIN public.stock_objetivo so ON so.cn = m.cn
    WHERE m.area = ${area}
    ORDER BY m.principio_activo ASC NULLS LAST, m.nombre ASC;
  `) as Array<{
    cn: string;
    nombre: string;
    principio_activo: string | null;
    via: string | null;
    area: string;
    ubicacion: string | null;
    unidades_por_caja: number;
    activo: boolean;
    comprable: boolean;
    mse: boolean;
    tipo_mse: string | null;
    precio_unidad: string | number | null;
    precio_caja: string | number | null;
    stock_minimo: number | null;
    punto_pedido: number | null;
    stock_maximo: number | null;
  }>;

  return rows.map((row) => ({
    cn: row.cn,
    nombre: row.nombre,
    principioActivo: row.principio_activo,
    via: row.via,
    area: row.area,
    ubicacion: row.ubicacion,
    unidadesPorCaja: Number(row.unidades_por_caja),
    activo: row.activo,
    comprable: row.comprable,
    mse: row.mse,
    tipoMse: row.tipo_mse,
    precioUnidad: numOrNull(row.precio_unidad),
    precioCaja: numOrNull(row.precio_caja),
    stockMinimo: row.stock_minimo == null ? null : Number(row.stock_minimo),
    puntoPedido: row.punto_pedido == null ? null : Number(row.punto_pedido),
    stockMaximo: row.stock_maximo == null ? null : Number(row.stock_maximo),
  }));
}

export async function getMedicamentoByCn(cn: string): Promise<MedicamentoBase | null> {
  const sql = getCatalogoClient();
  const rows = (await sql`
    SELECT
      cn, nombre, principio_activo, via, area, ubicacion,
      unidades_por_caja, activo, comprable, mse, tipo_mse, precio_unidad, precio_caja
    FROM public.medicamentos
    WHERE cn = ${cn}
    LIMIT 1;
  `) as Array<{
    cn: string;
    nombre: string;
    principio_activo: string | null;
    via: string | null;
    area: string;
    ubicacion: string | null;
    unidades_por_caja: number;
    activo: boolean;
    comprable: boolean;
    mse: boolean;
    tipo_mse: string | null;
    precio_unidad: string | number | null;
    precio_caja: string | number | null;
  }>;

  const row = rows[0];
  if (!row) return null;
  return {
    cn: row.cn,
    nombre: row.nombre,
    principioActivo: row.principio_activo,
    via: row.via,
    area: row.area,
    ubicacion: row.ubicacion,
    unidadesPorCaja: Number(row.unidades_por_caja),
    activo: row.activo,
    comprable: row.comprable,
    mse: row.mse,
    tipoMse: row.tipo_mse,
    precioUnidad: numOrNull(row.precio_unidad),
    precioCaja: numOrNull(row.precio_caja),
  };
}

export async function getStockObjetivoByCn(cn: string): Promise<StockObjetivo | null> {
  const sql = getCatalogoClient();
  const rows = (await sql`
    SELECT cn, stock_minimo, punto_pedido, stock_maximo
    FROM public.stock_objetivo
    WHERE cn = ${cn}
    LIMIT 1;
  `) as Array<{
    cn: string;
    stock_minimo: number;
    punto_pedido: number;
    stock_maximo: number | null;
  }>;

  const row = rows[0];
  if (!row) return null;
  return {
    cn: row.cn,
    stockMinimo: Number(row.stock_minimo),
    puntoPedido: Number(row.punto_pedido),
    stockMaximo: row.stock_maximo == null ? null : Number(row.stock_maximo),
  };
}

export async function insertMedicamento(row: MedicamentoBase) {
  const sql = getCatalogoClient();
  await sql`
    INSERT INTO public.medicamentos (
      cn, nombre, principio_activo, via, area, ubicacion,
      unidades_por_caja, activo, comprable, mse, tipo_mse, precio_unidad, precio_caja, actualizado_en
    ) VALUES (
      ${row.cn}, ${row.nombre}, ${row.principioActivo}, ${row.via}, ${row.area}, ${row.ubicacion},
      ${row.unidadesPorCaja}, ${row.activo}, ${row.comprable}, ${row.mse}, ${row.tipoMse}, ${row.precioUnidad}, ${row.precioCaja}, now()
    );
  `;
}

export async function updateMedicamento(row: MedicamentoBase) {
  const sql = getCatalogoClient();
  await sql`
    UPDATE public.medicamentos
    SET
      nombre = ${row.nombre},
      principio_activo = ${row.principioActivo},
      via = ${row.via},
      area = ${row.area},
      ubicacion = ${row.ubicacion},
      unidades_por_caja = ${row.unidadesPorCaja},
      activo = ${row.activo},
      comprable = ${row.comprable},
      mse = ${row.mse},
      tipo_mse = ${row.tipoMse},
      precio_unidad = ${row.precioUnidad},
      precio_caja = ${row.precioCaja},
      actualizado_en = now()
    WHERE cn = ${row.cn};
  `;
}

export async function upsertStockObjetivo(cn: string, stockMinimo: number, puntoPedido: number, stockMaximo: number | null) {
  const sql = getCatalogoClient();
  await sql`
    INSERT INTO public.stock_objetivo (cn, stock_minimo, punto_pedido, stock_maximo, actualizado_en)
    VALUES (${cn}, ${stockMinimo}, ${puntoPedido}, ${stockMaximo}, now())
    ON CONFLICT (cn) DO UPDATE
      SET
        stock_minimo = EXCLUDED.stock_minimo,
        punto_pedido = EXCLUDED.punto_pedido,
        stock_maximo = EXCLUDED.stock_maximo,
        actualizado_en = now();
  `;
}

export async function deleteMedicamentoByCn(cn: string) {
  const sql = getCatalogoClient();
  await sql`DELETE FROM public.medicamentos WHERE cn = ${cn};`;
}
