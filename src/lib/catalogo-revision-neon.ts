import { neon } from '@neondatabase/serverless';

export type RevisionPendiente = {
  id: number;
  area: string;
  cn: string;
  cnAnterior: string | null;
  origen: string;
  ubicacion: string | null;
  nombreCima: string | null;
  principioActivoCima: string | null;
  presentacionCima: string | null;
  unidadesPorCaja: number | null;
  estado: 'pendiente' | 'revisado';
  creadoEn: string;
  revisadoEn: string | null;
};

export type RevisionPendienteInput = {
  area: string;
  cn: string;
  cnAnterior?: string | null;
  origen: string;
  ubicacion?: string | null;
  nombreCima?: string | null;
  principioActivoCima?: string | null;
  presentacionCima?: string | null;
  unidadesPorCaja?: number | null;
};

function getDb() {
  const url = process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Falta REALIZAR_PEDIDOS_DATABASE_URL.');
  return neon(url);
}

let ensureSchemaPromise: Promise<void> | null = null;

export async function ensureCatalogoRevisionSchema(): Promise<void> {
  if (!ensureSchemaPromise) {
    const sql = getDb();
    ensureSchemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS public.catalogo_revision_pendiente (
          id SERIAL PRIMARY KEY,
          area TEXT NOT NULL,
          cn TEXT NOT NULL,
          cn_anterior TEXT,
          origen TEXT NOT NULL DEFAULT 'sustitucion-pasillo',
          ubicacion TEXT,
          nombre_cima TEXT,
          principio_activo_cima TEXT,
          presentacion_cima TEXT,
          unidades_por_caja INTEGER,
          estado TEXT NOT NULL DEFAULT 'pendiente',
          creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
          revisado_en TIMESTAMPTZ
        );
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_catalogo_revision_area_estado
        ON public.catalogo_revision_pendiente (area, estado, creado_en DESC);
      `;
    })();
  }
  await ensureSchemaPromise;
}

function mapRow(row: {
  id: number;
  area: string;
  cn: string;
  cn_anterior: string | null;
  origen: string;
  ubicacion: string | null;
  nombre_cima: string | null;
  principio_activo_cima: string | null;
  presentacion_cima: string | null;
  unidades_por_caja: number | null;
  estado: string;
  creado_en: string;
  revisado_en: string | null;
}): RevisionPendiente {
  return {
    id: row.id,
    area: row.area,
    cn: row.cn,
    cnAnterior: row.cn_anterior,
    origen: row.origen,
    ubicacion: row.ubicacion,
    nombreCima: row.nombre_cima,
    principioActivoCima: row.principio_activo_cima,
    presentacionCima: row.presentacion_cima,
    unidadesPorCaja: row.unidades_por_caja == null ? null : Number(row.unidades_por_caja),
    estado: row.estado === 'revisado' ? 'revisado' : 'pendiente',
    creadoEn: row.creado_en,
    revisadoEn: row.revisado_en,
  };
}

export async function registrarRevisionPendiente(input: RevisionPendienteInput): Promise<RevisionPendiente> {
  await ensureCatalogoRevisionSchema();
  const sql = getDb();

  await sql`
    UPDATE public.catalogo_revision_pendiente
    SET estado = 'revisado', revisado_en = now()
    WHERE area = ${input.area} AND cn = ${input.cn} AND estado = 'pendiente';
  `;

  const rows = (await sql`
    INSERT INTO public.catalogo_revision_pendiente (
      area, cn, cn_anterior, origen, ubicacion,
      nombre_cima, principio_activo_cima, presentacion_cima, unidades_por_caja, estado
    ) VALUES (
      ${input.area}, ${input.cn}, ${input.cnAnterior ?? null}, ${input.origen}, ${input.ubicacion ?? null},
      ${input.nombreCima ?? null}, ${input.principioActivoCima ?? null},
      ${input.presentacionCima ?? null}, ${input.unidadesPorCaja ?? null}, 'pendiente'
    )
    RETURNING
      id, area, cn, cn_anterior, origen, ubicacion,
      nombre_cima, principio_activo_cima, presentacion_cima, unidades_por_caja,
      estado, creado_en::text, revisado_en::text;
  `) as Array<{
    id: number;
    area: string;
    cn: string;
    cn_anterior: string | null;
    origen: string;
    ubicacion: string | null;
    nombre_cima: string | null;
    principio_activo_cima: string | null;
    presentacion_cima: string | null;
    unidades_por_caja: number | null;
    estado: string;
    creado_en: string;
    revisado_en: string | null;
  }>;

  return mapRow(rows[0]!);
}

export async function listRevisionesPendientes(area: string): Promise<RevisionPendiente[]> {
  await ensureCatalogoRevisionSchema();
  const sql = getDb();
  const rows = (await sql`
    SELECT
      id, area, cn, cn_anterior, origen, ubicacion,
      nombre_cima, principio_activo_cima, presentacion_cima, unidades_por_caja,
      estado, creado_en::text, revisado_en::text
    FROM public.catalogo_revision_pendiente
    WHERE area = ${area} AND estado = 'pendiente'
    ORDER BY creado_en DESC;
  `) as Array<{
    id: number;
    area: string;
    cn: string;
    cn_anterior: string | null;
    origen: string;
    ubicacion: string | null;
    nombre_cima: string | null;
    principio_activo_cima: string | null;
    presentacion_cima: string | null;
    unidades_por_caja: number | null;
    estado: string;
    creado_en: string;
    revisado_en: string | null;
  }>;

  return rows.map(mapRow);
}

export async function marcarRevisionRevisada(id: number, area: string): Promise<boolean> {
  await ensureCatalogoRevisionSchema();
  const sql = getDb();
  const rows = (await sql`
    UPDATE public.catalogo_revision_pendiente
    SET estado = 'revisado', revisado_en = now()
    WHERE id = ${id} AND area = ${area} AND estado = 'pendiente'
    RETURNING id;
  `) as Array<{ id: number }>;
  return rows.length > 0;
}
