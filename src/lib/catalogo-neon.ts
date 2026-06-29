import { neon } from '@neondatabase/serverless';
import { isMSE } from './utils';

export type CatalogoMedicamento = {
  cn: string;
  nombre: string;
  principioActivo: string | null;
  presentacion: string | null;
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
  consumoMedio: number | null;
  ppioActivoCima: boolean;
  cimaConsultado: boolean;
};

export type MedicamentoBase = {
  cn: string;
  nombre: string;
  principioActivo: string | null;
  presentacion?: string | null;
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
  consumoMedio?: number | null;
  ppioActivoCima?: boolean | null;
  cimaConsultado?: boolean;
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

let ensureMedicamentosSchemaPromise: Promise<void> | null = null;
let ensureStockObjetivoDecimalPromise: Promise<void> | null = null;

async function ensureStockObjetivoDecimalCajas(): Promise<void> {
  if (!ensureStockObjetivoDecimalPromise) {
    const sql = getCatalogoClient();
    ensureStockObjetivoDecimalPromise = (async () => {
      await sql`
        ALTER TABLE public.stock_objetivo
          ALTER COLUMN stock_minimo TYPE NUMERIC(12,1)
          USING round(stock_minimo::numeric, 1);
      `;
      await sql`
        ALTER TABLE public.stock_objetivo
          ALTER COLUMN punto_pedido TYPE NUMERIC(12,1)
          USING round(punto_pedido::numeric, 1);
      `;
      await sql`
        ALTER TABLE public.stock_objetivo
          ALTER COLUMN stock_maximo TYPE NUMERIC(12,1)
          USING round(stock_maximo::numeric, 1);
      `;
    })().catch((err) => {
      ensureStockObjetivoDecimalPromise = null;
      throw err;
    });
  }
  await ensureStockObjetivoDecimalPromise;
}

export async function ensureMedicamentosSchema(): Promise<void> {
  if (!ensureMedicamentosSchemaPromise) {
    const sql = getCatalogoClient();
    ensureMedicamentosSchemaPromise = (async () => {
      await sql`ALTER TABLE public.medicamentos ADD COLUMN IF NOT EXISTS presentacion TEXT;`;
      await sql`ALTER TABLE public.medicamentos ADD COLUMN IF NOT EXISTS ppio_activo_cima TEXT;`;
      await sql`ALTER TABLE public.medicamentos ADD COLUMN IF NOT EXISTS cima_consultado BOOLEAN DEFAULT FALSE;`;
      await sql`ALTER TABLE public.medicamentos ADD COLUMN IF NOT EXISTS consumo_medio NUMERIC(12,2);`;

      const col = (await sql`
        SELECT data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'medicamentos'
          AND column_name = 'ppio_activo_cima'
        LIMIT 1;
      `) as Array<{ data_type: string }>;

      const dataType = col[0]?.data_type?.toLowerCase() ?? '';
      if (dataType === 'text' || dataType === 'character varying') {
        await sql`
          ALTER TABLE public.medicamentos
          ALTER COLUMN ppio_activo_cima TYPE BOOLEAN
          USING (
            CASE
              WHEN ppio_activo_cima IS NULL OR BTRIM(ppio_activo_cima::text) = '' THEN FALSE
              WHEN LOWER(BTRIM(ppio_activo_cima::text)) IN ('false', 'f', '0', 'no', 'n') THEN FALSE
              WHEN LOWER(BTRIM(ppio_activo_cima::text)) IN ('true', 't', '1', 'si', 's', 'yes') THEN TRUE
              ELSE TRUE
            END
          );
        `;
      } else if (!col[0]) {
        await sql`
          ALTER TABLE public.medicamentos
          ADD COLUMN IF NOT EXISTS ppio_activo_cima BOOLEAN NOT NULL DEFAULT FALSE;
        `;
      }
    })().catch((err) => {
      ensureMedicamentosSchemaPromise = null;
      throw err;
    });
  }
  await ensureMedicamentosSchemaPromise;
}

export async function listMedicamentosByArea(area: string): Promise<CatalogoMedicamento[]> {
  await ensureMedicamentosSchema();
  const sql = getCatalogoClient();
  const rows = (await sql`
    SELECT
      m.cn,
      m.nombre,
      m.principio_activo,
      m.presentacion,
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
      so.stock_maximo,
      m.consumo_medio,
      COALESCE(m.ppio_activo_cima, FALSE) AS ppio_activo_cima,
      COALESCE(m.cima_consultado, FALSE)  AS cima_consultado
    FROM public.medicamentos m
    LEFT JOIN public.stock_objetivo so ON so.cn = m.cn
    WHERE m.area = ${area}
    ORDER BY m.principio_activo ASC NULLS LAST, m.nombre ASC;
  `) as Array<{
    cn: string;
    nombre: string;
    principio_activo: string | null;
    presentacion: string | null;
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
    consumo_medio: number | string | null;
    ppio_activo_cima: boolean;
    cima_consultado: boolean;
  }>;

  return rows.map((row) => ({
    cn: row.cn,
    nombre: row.nombre,
    principioActivo: row.principio_activo,
    presentacion: row.presentacion?.trim() || null,
    via: row.via,
    area: row.area,
    ubicacion: row.ubicacion,
    unidadesPorCaja: Number(row.unidades_por_caja),
    activo: row.activo,
    comprable: row.comprable,
    mse: isMSE(row.cn),
    tipoMse: row.tipo_mse?.trim() || null,
    precioUnidad: numOrNull(row.precio_unidad),
    precioCaja: numOrNull(row.precio_caja),
    stockMinimo: row.stock_minimo == null ? null : Number(row.stock_minimo),
    puntoPedido: row.punto_pedido == null ? null : Number(row.punto_pedido),
    stockMaximo: row.stock_maximo == null ? null : Number(row.stock_maximo),
    consumoMedio: numOrNull(row.consumo_medio),
    ppioActivoCima: row.ppio_activo_cima ?? false,
    cimaConsultado: row.cima_consultado ?? false,
  }));
}

export async function getMedicamentoByCn(cn: string): Promise<MedicamentoBase | null> {
  await ensureMedicamentosSchema();
  const sql = getCatalogoClient();
  const rows = (await sql`
    SELECT
      cn, nombre, principio_activo, presentacion, via, area, ubicacion,
      unidades_por_caja, activo, comprable, mse, tipo_mse, precio_unidad, precio_caja,
      consumo_medio
    FROM public.medicamentos
    WHERE cn = ${cn}
    LIMIT 1;
  `) as Array<{
    cn: string;
    nombre: string;
    principio_activo: string | null;
    presentacion: string | null;
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
    consumo_medio: number | string | null;
  }>;

  const row = rows[0];
  if (!row) return null;
  return {
    cn: row.cn,
    nombre: row.nombre,
    principioActivo: row.principio_activo,
    presentacion: row.presentacion?.trim() || null,
    via: row.via,
    area: row.area,
    ubicacion: row.ubicacion,
    unidadesPorCaja: Number(row.unidades_por_caja),
    activo: row.activo,
    comprable: row.comprable,
    mse: isMSE(row.cn),
    tipoMse: row.tipo_mse?.trim() || null,
    precioUnidad: numOrNull(row.precio_unidad),
    precioCaja: numOrNull(row.precio_caja),
    consumoMedio: numOrNull(row.consumo_medio),
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
  await ensureMedicamentosSchema();
  const sql = getCatalogoClient();
  const mse = isMSE(row.cn);
  const ppioActivoCima = row.ppioActivoCima ?? false;
  const cimaConsultado = row.cimaConsultado ?? false;
  const consumoMedio = row.consumoMedio ?? null;
  await sql`
    INSERT INTO public.medicamentos (
      cn, nombre, principio_activo, presentacion, via, area, ubicacion,
      unidades_por_caja, activo, comprable, mse, tipo_mse, precio_unidad, precio_caja,
      ppio_activo_cima, cima_consultado, consumo_medio, actualizado_en
    ) VALUES (
      ${row.cn}, ${row.nombre}, ${row.principioActivo}, ${row.presentacion ?? null}, ${row.via}, ${row.area}, ${row.ubicacion},
      ${row.unidadesPorCaja}, ${row.activo}, ${row.comprable}, ${mse}, ${row.tipoMse}, ${row.precioUnidad}, ${row.precioCaja},
      ${ppioActivoCima}, ${cimaConsultado}, ${consumoMedio}, now()
    );
  `;
}

export async function updateMedicamento(row: MedicamentoBase) {
  await ensureMedicamentosSchema();
  const sql = getCatalogoClient();
  const mse = isMSE(row.cn);
  const actualizaCima =
    row.ppioActivoCima !== undefined || row.cimaConsultado !== undefined;

  if (actualizaCima) {
    await sql`
      UPDATE public.medicamentos
      SET
        nombre = ${row.nombre},
        principio_activo = ${row.principioActivo},
        presentacion = ${row.presentacion ?? null},
        via = ${row.via},
        area = ${row.area},
        ubicacion = ${row.ubicacion},
        unidades_por_caja = ${row.unidadesPorCaja},
        activo = ${row.activo},
        comprable = ${row.comprable},
        mse = ${mse},
        tipo_mse = ${row.tipoMse},
        precio_unidad = ${row.precioUnidad},
        precio_caja = ${row.precioCaja},
        ppio_activo_cima = ${row.ppioActivoCima ?? false},
        cima_consultado = ${row.cimaConsultado ?? false},
        actualizado_en = now()
      WHERE cn = ${row.cn};
    `;
    return;
  }

  await sql`
    UPDATE public.medicamentos
    SET
      nombre = ${row.nombre},
      principio_activo = ${row.principioActivo},
      presentacion = ${row.presentacion ?? null},
      via = ${row.via},
      area = ${row.area},
      ubicacion = ${row.ubicacion},
      unidades_por_caja = ${row.unidadesPorCaja},
      activo = ${row.activo},
      comprable = ${row.comprable},
      mse = ${mse},
      tipo_mse = ${row.tipoMse},
      precio_unidad = ${row.precioUnidad},
      precio_caja = ${row.precioCaja},
      actualizado_en = now()
    WHERE cn = ${row.cn};
  `;
}

export async function upsertStockObjetivo(cn: string, stockMinimo: number, puntoPedido: number, stockMaximo: number | null) {
  await ensureStockObjetivoDecimalCajas();
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

export async function updateMedicamentoConsumoMedio(cn: string, consumoMedio: number | null): Promise<void> {
  await ensureMedicamentosSchema();
  const sql = getCatalogoClient();
  await sql`
    UPDATE public.medicamentos
    SET consumo_medio = ${consumoMedio}, actualizado_en = now()
    WHERE cn = ${cn};
  `;
}

export async function deleteStockObjetivo(cn: string): Promise<void> {
  const sql = getCatalogoClient();
  await sql`DELETE FROM public.stock_objetivo WHERE cn = ${cn};`;
}

export async function deleteMedicamentoByCn(cn: string) {
  const sql = getCatalogoClient();
  await sql`DELETE FROM public.medicamentos WHERE cn = ${cn};`;
}
