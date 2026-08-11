import { neon } from '@neondatabase/serverless';
import { remapReposicionCatalogoCn } from '@/lib/reposicion-catalogo-neon';
import { ensureTablesReposicion } from '@/lib/reposicion-neon';

function getDb() {
  const url = process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Falta REALIZAR_PEDIDOS_DATABASE_URL para conectar a Neon.');
  return neon(url);
}

export type GrupoIntercambio = {
  id: number;
  cnVigente: string;
  miembros: string[];
  historial: Array<{
    id: number;
    area: string;
    ubicacion: string | null;
    cnAnterior: string;
    cnNuevo: string;
    origen: string;
    creadoEn: string;
  }>;
};

let ensurePromise: Promise<void> | null = null;

export async function ensureCnEquivalenciaSchema(): Promise<void> {
  if (!ensurePromise) {
    const sql = getDb();
    ensurePromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS cn_intercambio_grupos (
          id              SERIAL PRIMARY KEY,
          cn_vigente      TEXT NOT NULL,
          creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS cn_intercambio_miembros (
          grupo_id   INTEGER NOT NULL REFERENCES cn_intercambio_grupos(id) ON DELETE CASCADE,
          cn         TEXT NOT NULL,
          creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (grupo_id, cn),
          UNIQUE (cn)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS cn_intercambio_historial (
          id           SERIAL PRIMARY KEY,
          grupo_id     INTEGER NOT NULL REFERENCES cn_intercambio_grupos(id) ON DELETE CASCADE,
          area         TEXT NOT NULL,
          ubicacion    TEXT,
          cn_anterior  TEXT NOT NULL,
          cn_nuevo     TEXT NOT NULL,
          origen       TEXT NOT NULL,
          creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_cn_intercambio_historial_grupo
        ON cn_intercambio_historial (grupo_id, creado_en DESC)
      `;
      await sql`
        ALTER TABLE propuestas_lineas
        ADD COLUMN IF NOT EXISTS requiere_revision_cn BOOLEAN NOT NULL DEFAULT FALSE
      `;
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  await ensurePromise;
}

async function grupoIdPorCn(cn: string): Promise<number | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT grupo_id
    FROM cn_intercambio_miembros
    WHERE cn = ${cn}
    LIMIT 1
  `;
  return rows[0] ? Number(rows[0].grupo_id) : null;
}

async function fusionarGrupos(destinoId: number, origenId: number): Promise<void> {
  if (destinoId === origenId) return;
  const sql = getDb();
  await sql`
    INSERT INTO cn_intercambio_miembros (grupo_id, cn)
    SELECT ${destinoId}, cn
    FROM cn_intercambio_miembros
    WHERE grupo_id = ${origenId}
    ON CONFLICT (cn) DO UPDATE SET grupo_id = EXCLUDED.grupo_id
  `;
  await sql`
    UPDATE cn_intercambio_historial
    SET grupo_id = ${destinoId}
    WHERE grupo_id = ${origenId}
  `;
  await sql`DELETE FROM cn_intercambio_grupos WHERE id = ${origenId}`;
}

export async function registrarIntercambio(params: {
  area: string;
  ubicacion?: string | null;
  cnAnterior: string;
  cnNuevo: string;
  origen: 'catalogo' | 'pasillo';
}): Promise<GrupoIntercambio> {
  await ensureCnEquivalenciaSchema();
  const sql = getDb();
  const [grupoAnterior, grupoNuevo] = await Promise.all([
    grupoIdPorCn(params.cnAnterior),
    grupoIdPorCn(params.cnNuevo),
  ]);

  let grupoId = grupoAnterior ?? grupoNuevo;
  if (!grupoId) {
    const rows = await sql`
      INSERT INTO cn_intercambio_grupos (cn_vigente)
      VALUES (${params.cnNuevo})
      RETURNING id
    `;
    grupoId = Number(rows[0].id);
  }
  if (grupoAnterior && grupoNuevo && grupoAnterior !== grupoNuevo) {
    await fusionarGrupos(grupoAnterior, grupoNuevo);
    grupoId = grupoAnterior;
  }

  await sql`
    INSERT INTO cn_intercambio_miembros (grupo_id, cn)
    VALUES (${grupoId}, ${params.cnAnterior}), (${grupoId}, ${params.cnNuevo})
    ON CONFLICT (cn) DO UPDATE SET grupo_id = EXCLUDED.grupo_id
  `;
  await sql`
    UPDATE cn_intercambio_grupos
    SET cn_vigente = ${params.cnNuevo}, actualizado_en = NOW()
    WHERE id = ${grupoId}
  `;
  await sql`
    INSERT INTO cn_intercambio_historial (
      grupo_id, area, ubicacion, cn_anterior, cn_nuevo, origen
    )
    VALUES (
      ${grupoId}, ${params.area}, ${params.ubicacion ?? null},
      ${params.cnAnterior}, ${params.cnNuevo}, ${params.origen}
    )
  `;

  await remapReposicionCatalogoCn(params.cnAnterior, params.cnNuevo, grupoId);
  await remapReposicionBorradores(params.cnAnterior, params.cnNuevo);
  await remapPropuestasBorrador(params.area, params.cnAnterior, params.cnNuevo);
  return (await getGrupoIntercambio(params.cnNuevo))!;
}

async function remapPropuestasBorrador(
  area: string,
  cnAnterior: string,
  cnNuevo: string,
): Promise<void> {
  const sql = getDb();
  const medicamentos = await sql`
    SELECT nombre, unidades_por_caja
    FROM medicamentos
    WHERE cn = ${cnNuevo}
    LIMIT 1
  `;
  if (!medicamentos[0]) return;
  const nombre = String(medicamentos[0].nombre);
  const unidadesPorCaja = Math.max(1, Number(medicamentos[0].unidades_por_caja) || 1);
  await sql`
    UPDATE propuestas_lineas l
    SET cn = ${cnNuevo},
        nombre_medicamento = ${nombre},
        unidades_por_caja = ${unidadesPorCaja},
        unidades_final = CASE
          WHEN l.cajas_validadas IS NULL THEN NULL
          ELSE l.cajas_validadas * ${unidadesPorCaja}
        END,
        requiere_revision_cn = TRUE,
        observaciones = CONCAT_WS(
          E'\n',
          NULLIF(l.observaciones, ''),
          ${`CN sustituido ${cnAnterior} → ${cnNuevo}. Revisar cantidad y niveles antes de tramitar.`}
        )
    FROM propuestas p
    WHERE p.id = l.propuesta_id
      AND p.area = ${area}
      AND p.estado = 'borrador'
      AND l.cn = ${cnAnterior}
  `;
}

export async function getGrupoIntercambio(cn: string): Promise<GrupoIntercambio | null> {
  await ensureCnEquivalenciaSchema();
  const sql = getDb();
  const grupos = await sql`
    SELECT g.id, g.cn_vigente
    FROM cn_intercambio_grupos g
    JOIN cn_intercambio_miembros m ON m.grupo_id = g.id
    WHERE m.cn = ${cn}
    LIMIT 1
  `;
  if (!grupos[0]) return null;
  const grupoId = Number(grupos[0].id);
  const [miembros, historial] = await Promise.all([
    sql`
      SELECT cn FROM cn_intercambio_miembros
      WHERE grupo_id = ${grupoId}
      ORDER BY creado_en, cn
    `,
    sql`
      SELECT id, area, ubicacion, cn_anterior, cn_nuevo, origen, creado_en
      FROM cn_intercambio_historial
      WHERE grupo_id = ${grupoId}
      ORDER BY creado_en DESC, id DESC
    `,
  ]);
  return {
    id: grupoId,
    cnVigente: String(grupos[0].cn_vigente),
    miembros: miembros.map((row) => String(row.cn)),
    historial: historial.map((row) => ({
      id: Number(row.id),
      area: String(row.area),
      ubicacion: row.ubicacion ? String(row.ubicacion) : null,
      cnAnterior: String(row.cn_anterior),
      cnNuevo: String(row.cn_nuevo),
      origen: String(row.origen),
      creadoEn: String(row.creado_en),
    })),
  };
}

async function remapReposicionBorradores(cnAnterior: string, cnNuevo: string): Promise<void> {
  await ensureTablesReposicion();
  const sql = getDb();
  await sql`
    UPDATE pedidos_reposicion_lineas destino
    SET cantidad_cajas = destino.cantidad_cajas + origen.cantidad_cajas
    FROM pedidos_reposicion_lineas origen, pedidos_reposicion p
    WHERE p.id = destino.pedido_id
      AND p.estado = 'borrador'
      AND origen.pedido_id = destino.pedido_id
      AND origen.ubicacion = destino.ubicacion
      AND origen.cn = ${cnAnterior}
      AND destino.cn = ${cnNuevo}
  `;
  await sql`
    DELETE FROM pedidos_reposicion_lineas origen
    USING pedidos_reposicion p
    WHERE p.id = origen.pedido_id
      AND p.estado = 'borrador'
      AND origen.cn = ${cnAnterior}
      AND EXISTS (
        SELECT 1
        FROM pedidos_reposicion_lineas destino
        WHERE destino.pedido_id = origen.pedido_id
          AND destino.ubicacion = origen.ubicacion
          AND destino.cn = ${cnNuevo}
      )
  `;
  await sql`
    UPDATE pedidos_reposicion_lineas l
    SET cn = ${cnNuevo}, codigo_item = ${cnNuevo}
    FROM pedidos_reposicion p
    WHERE p.id = l.pedido_id
      AND p.estado = 'borrador'
      AND l.cn = ${cnAnterior}
  `;
}
