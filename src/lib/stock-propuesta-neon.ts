import { neon } from '@neondatabase/serverless';
import { calcularCajasPropuestas, buildStockTransitoCajasByCn } from '@/lib/propuesta';
import { loadCantidadTransitoByCn } from '@/lib/pedidos-pendientes';
import { ALMACEN_AREA, ALMACEN_UBICACIONES_RECUENTO_STOCK, ESTADO_PEDIDO_ALMACEN, ORIGEN_PEDIDO_ALMACEN, isAlmacenArea, nombrePropuestaAlmacen, nombrePropuestaUbicacion, grupoLetrasAlmacenFar, grupoLetrasAlmacenFarFromLetter, ubicacionAlmacenUsaLetras, ubicacionAlmacenUsaRecuentoStock, type AlmacenFarGrupoLetras } from '@/lib/almacen';
import {
  normalizeNivelStock,
  normalizePedidoCajas,
  normalizeStockCajas,
  normalizeStockUnidades,
  stockCajasDesdeUnidades,
} from '@/lib/cantidades';

function getDb() {
  const url = process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Falta REALIZAR_PEDIDOS_DATABASE_URL para conectar a Neon.');
  return neon(url);
}

function num(v: unknown): number { return Number(v ?? 0); }
function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// TIPOS
// ---------------------------------------------------------------------------
export type RecuentoCabecera = {
  id: number;
  area: string;
  estado: string;
  origen: string;
  fechaRecuento: string;
  importadoEn: string;
  totalLineas: number;
  propuestaId: number | null;
  revision?: number;
  manualCompletadoEn?: string | null;
};

export type RecuentoManualResumen = {
  id: number;
  estado: string;
  fechaRecuento: string;
  importadoEn: string;
  totalLineas: number;
};

export type RecuentoLinea = {
  cn: string;
  principioActivo: string | null;
  nombre: string;
  unidadesPorCaja: number;
  stockCajas: number;
  stockUnidades: number;
  valorTotal: number | null;
};

export type PropuestaCabecera = {
  id: number;
  area: string;
  estado: string;
  fechaGeneracion: string;
  tramitadaEn: string | null;
  observaciones?: string | null;
};

export type PropuestaLinea = {
  id: number;
  cn: string;
  principioActivo: string | null;
  nombreMedicamento: string | null;
  unidadesPorCaja: number;
  stockActual: number;
  stockTransito: number;
  stockMinimoSnap: number;
  puntoPedidoSnap: number;
  stockMaximoSnap: number;
  cajasPropuestas: number;
  cajasValidadas: number | null;
  motivoAjuste: string | null;
  motivoAjusteOtro: string | null;
  ajustado: boolean;
  proveedorLocal: boolean;
};

export type PropuestaLineaUI = PropuestaLinea & {
  activo: boolean;
  editable: boolean;
};

export type PropuestaBloqueEstado = 'sin_propuesta' | 'borrador' | 'tramitada';

export type PropuestaBloqueResumen = {
  ubicacion: string;
  etiqueta: string;
  estado: PropuestaBloqueEstado;
  propuestaId: number | null;
  totalLineas: number;
  fechaGeneracion: string | null;
  tramitadaEn: string | null;
};

function sortByPrincipioNombre<T extends {
  principioActivo: string | null;
  nombre: string | null;
  cn: string;
}>(a: T, b: T): number {
  const keyA = (a.principioActivo ?? a.nombre ?? a.cn).trim();
  const keyB = (b.principioActivo ?? b.nombre ?? b.cn).trim();
  const byPa = keyA.localeCompare(keyB, 'es', { sensitivity: 'base' });
  if (byPa !== 0) return byPa;
  return (a.nombre ?? a.cn).localeCompare(b.nombre ?? b.cn, 'es', { sensitivity: 'base' });
}

// ---------------------------------------------------------------------------
// RECUENTOS
// ---------------------------------------------------------------------------
let recuentoManualSeguroSchemaPromise: Promise<void> | null = null;

export async function ensureRecuentoManualSeguroSchema(): Promise<void> {
  if (!recuentoManualSeguroSchemaPromise) {
    recuentoManualSeguroSchemaPromise = (async () => {
      const sql = getDb();
      await sql`
    ALTER TABLE importaciones_stock
    ADD COLUMN IF NOT EXISTS revision_manual INTEGER NOT NULL DEFAULT 0
  `;
      await sql`
    ALTER TABLE importaciones_stock
    ADD COLUMN IF NOT EXISTS manual_completado_en TIMESTAMPTZ
  `;
      await sql`
    ALTER TABLE importaciones_stock
    ADD COLUMN IF NOT EXISTS manual_completado_session TEXT
  `;
      await sql`
    CREATE TABLE IF NOT EXISTS recuento_cambios (
      id BIGSERIAL PRIMARY KEY,
      importacion_id BIGINT NOT NULL REFERENCES importaciones_stock(id) ON DELETE CASCADE,
      area TEXT NOT NULL,
      ubicacion TEXT,
      cn TEXT,
      stock_anterior INTEGER,
      stock_nuevo INTEGER,
      origen TEXT NOT NULL,
      session_id TEXT NOT NULL,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
      await sql`
    CREATE INDEX IF NOT EXISTS idx_recuento_cambios_importacion
    ON recuento_cambios (importacion_id, creado_en DESC)
  `;
      await sql`
    DELETE FROM stock_registros anterior
    USING stock_registros posterior
    WHERE anterior.importacion_id = posterior.importacion_id
      AND anterior.cn = posterior.cn
      AND anterior.id < posterior.id
  `;
      await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_registros_importacion_cn
    ON stock_registros (importacion_id, cn)
  `;
      await sql`
    WITH duplicadas AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY area ORDER BY id DESC) AS posicion
      FROM importaciones_stock
      WHERE estado = 'pendiente'
        AND origen <> 'Pedido-Almacen'
    )
    UPDATE importaciones_stock i
    SET estado = 'reemplazado'
    FROM duplicadas d
    WHERE i.id = d.id
      AND d.posicion > 1
  `;
      await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_importaciones_stock_area_pendiente
    ON importaciones_stock (area)
    WHERE estado = 'pendiente'
      AND origen <> 'Pedido-Almacen'
  `;
      await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_importaciones_stock_area_abierto
    ON importaciones_stock (area)
    WHERE estado IN ('pendiente', 'procesando-stock')
      AND origen <> 'Pedido-Almacen'
  `;
    })();
  }
  try {
    await recuentoManualSeguroSchemaPromise;
  } catch (error) {
    recuentoManualSeguroSchemaPromise = null;
    throw error;
  }
}

export type RecuentoFaltante = {
  cn: string;
  principioActivo: string | null;
  nombre: string;
  ubicacion: string;
};

export type UbicacionExcluidaRecuento = {
  ubicacion: string;
  totalActivos: number;
};

export type CierreRecuentoManual = {
  faltantesACero: RecuentoFaltante[];
  ubicacionesExcluidas: UbicacionExcluidaRecuento[];
};

export async function getFaltantesRecuentoManual(
  importacionId: number,
  area: string,
  ubicacion?: string,
): Promise<RecuentoFaltante[]> {
  const sql = getDb();
  const ubicacionesStockAlmacen = JSON.stringify(
    [...ALMACEN_UBICACIONES_RECUENTO_STOCK].map(normalizeUbicacionKey),
  );
  const rows = await sql`
    SELECT m.cn, m.principio_activo, m.nombre, COALESCE(m.ubicacion, '') AS ubicacion
    FROM medicamentos m
    WHERE m.area = ${area}
      AND m.activo = TRUE
      AND (
        ${area !== ALMACEN_AREA}
        OR TRANSLATE(
          LOWER(REGEXP_REPLACE(TRIM(m.ubicacion), '[[:space:]]+', ' ', 'g')),
          'áéíóúüñ',
          'aeiouun'
        ) IN (
          SELECT jsonb_array_elements_text(${ubicacionesStockAlmacen}::jsonb)
        )
      )
      AND (${ubicacion ?? null}::text IS NULL OR m.ubicacion = ${ubicacion ?? null})
      AND NOT EXISTS (
        SELECT 1
        FROM stock_registros sr
        WHERE sr.importacion_id = ${importacionId}
          AND sr.cn = m.cn
      )
    ORDER BY m.ubicacion, m.principio_activo NULLS LAST, m.nombre, m.cn
  `;
  return rows.map((row) => ({
    cn: String(row.cn),
    principioActivo: row.principio_activo ? String(row.principio_activo) : null,
    nombre: String(row.nombre),
    ubicacion: String(row.ubicacion),
  }));
}

export async function getCierreRecuentoManual(
  importacionId: number,
  area: string,
): Promise<CierreRecuentoManual> {
  const faltantes = await getFaltantesRecuentoManual(importacionId, area);
  const sql = getDb();
  const iniciadasRows = (await sql`
    SELECT DISTINCT COALESCE(m.ubicacion, '') AS ubicacion
    FROM stock_registros sr
    INNER JOIN medicamentos m ON m.cn = sr.cn AND m.area = ${area}
    WHERE sr.importacion_id = ${importacionId}
  `) as Array<{ ubicacion: string }>;
  const iniciadas = new Set(
    iniciadasRows.map((row) => normalizeUbicacionKey(row.ubicacion)),
  );

  const faltantesACero: RecuentoFaltante[] = [];
  const excluidasMap = new Map<string, UbicacionExcluidaRecuento>();
  for (const item of faltantes) {
    const key = normalizeUbicacionKey(item.ubicacion);
    if (iniciadas.has(key)) {
      faltantesACero.push(item);
      continue;
    }
    const etiqueta = item.ubicacion.trim() || 'Sin ubicación';
    const actual = excluidasMap.get(key);
    if (actual) {
      actual.totalActivos += 1;
    } else {
      excluidasMap.set(key, { ubicacion: etiqueta, totalActivos: 1 });
    }
  }

  return {
    faltantesACero,
    ubicacionesExcluidas: [...excluidasMap.values()].sort((a, b) =>
      a.ubicacion.localeCompare(b.ubicacion, 'es', { sensitivity: 'base' }),
    ),
  };
}

export async function guardarLineasRecuentoManual(params: {
  importacionId: number;
  area: string;
  ubicacion: string;
  sessionId: string;
  revisionEsperada: number;
  origen?: 'teclado' | 'administracion';
  lineas: Array<{
    cn: string;
    stockUnidades: number;
    stockCajas: number;
    stockAnteriorEsperado: number | null;
  }>;
}): Promise<{ insertadas: number; actualizadas: number; sinCambios: number; revision: number }> {
  await ensureRecuentoManualSeguroSchema();
  const sql = getDb();
  const payload = JSON.stringify(params.lineas.map((linea) => ({
    cn: linea.cn,
    stock_unidades: linea.stockUnidades,
    stock_cajas: linea.stockCajas,
    stock_anterior_esperado: linea.stockAnteriorEsperado,
  })));
  const rows = await sql`
    WITH entrada AS (
      SELECT cn, stock_unidades, stock_cajas, stock_anterior_esperado
      FROM jsonb_to_recordset(${payload}::jsonb)
        AS x(
          cn text,
          stock_unidades integer,
          stock_cajas numeric,
          stock_anterior_esperado integer
        )
    ),
    cabecera AS MATERIALIZED (
      SELECT id
      FROM importaciones_stock
      WHERE id = ${params.importacionId}
        AND area = ${params.area}
        AND estado = 'pendiente'
        AND (
          ${params.origen === 'administracion'}
          OR manual_completado_en IS NULL
        )
        AND revision_manual = ${params.revisionEsperada}
      FOR UPDATE
    ),
    anteriores AS (
      SELECT sr.cn, sr.stock_unidades
      FROM stock_registros sr
      INNER JOIN entrada e ON e.cn = sr.cn
      INNER JOIN cabecera c ON c.id = sr.importacion_id
    ),
    validacion AS (
      SELECT COUNT(*)::int AS conflictos
      FROM entrada e
      LEFT JOIN anteriores a ON a.cn = e.cn
      WHERE a.stock_unidades IS DISTINCT FROM e.stock_anterior_esperado
    ),
    cambios AS (
      SELECT
        e.cn,
        e.stock_unidades,
        e.stock_cajas,
        e.stock_anterior_esperado AS stock_anterior
      FROM entrada e
      LEFT JOIN anteriores a ON a.cn = e.cn
      WHERE a.stock_unidades IS NOT DISTINCT FROM e.stock_anterior_esperado
        AND a.stock_unidades IS DISTINCT FROM e.stock_unidades
    ),
    actualizadas AS (
      UPDATE stock_registros sr
      SET stock_unidades = c.stock_unidades,
          stock_cajas = c.stock_cajas,
          valor_total = NULL
      FROM cambios c, cabecera cab
      WHERE sr.importacion_id = cab.id
        AND sr.cn = c.cn
        AND c.stock_anterior IS NOT NULL
        AND sr.stock_unidades IS NOT DISTINCT FROM c.stock_anterior
        AND (SELECT conflictos FROM validacion) = 0
      RETURNING sr.cn
    ),
    insertadas AS (
      INSERT INTO stock_registros (importacion_id, cn, stock_unidades, stock_cajas, valor_total)
      SELECT cab.id, c.cn, c.stock_unidades, c.stock_cajas, NULL
      FROM cambios c, cabecera cab
      WHERE c.stock_anterior IS NULL
        AND (SELECT conflictos FROM validacion) = 0
      ON CONFLICT (importacion_id, cn) DO NOTHING
      RETURNING cn
    ),
    aplicadas AS (
      SELECT c.cn, c.stock_anterior, c.stock_unidades
      FROM cambios c
      WHERE c.cn IN (SELECT cn FROM actualizadas)
         OR c.cn IN (SELECT cn FROM insertadas)
    ),
    auditoria AS (
      INSERT INTO recuento_cambios (
        importacion_id, area, ubicacion, cn, stock_anterior, stock_nuevo, origen, session_id
      )
      SELECT
        cab.id, ${params.area}, ${params.ubicacion}, a.cn,
        a.stock_anterior, a.stock_unidades, ${params.origen ?? 'teclado'}, ${params.sessionId}
      FROM aplicadas a, cabecera cab
      RETURNING id
    ),
    revision AS (
      UPDATE importaciones_stock i
      SET revision_manual = revision_manual + 1,
          total_lineas = (
            SELECT COUNT(DISTINCT sr.cn)::int
            FROM stock_registros sr
            WHERE sr.importacion_id = i.id
          ) + (SELECT COUNT(*)::int FROM insertadas)
      WHERE i.id IN (SELECT id FROM cabecera)
        AND EXISTS (SELECT 1 FROM auditoria)
      RETURNING revision_manual
    )
    SELECT
      (SELECT COUNT(DISTINCT cn)::int FROM insertadas) AS insertadas,
      (SELECT COUNT(DISTINCT cn)::int FROM actualizadas) AS actualizadas,
      (
        (SELECT COUNT(*)::int FROM entrada) -
        (SELECT COUNT(*)::int FROM cambios) -
        (SELECT conflictos FROM validacion)
      ) AS sin_cambios,
      (SELECT conflictos FROM validacion) AS conflictos,
      COALESCE(
        (SELECT revision_manual FROM revision),
        (SELECT revision_manual FROM importaciones_stock WHERE id = ${params.importacionId})
      ) AS revision,
      (SELECT COUNT(*)::int FROM cabecera) AS disponible,
      (SELECT COUNT(*)::int FROM auditoria) AS auditadas
  `;
  if (!rows[0]) throw new Error('No se pudo guardar el recuento.');
  if (num(rows[0].disponible) === 0) {
    throw new Error('CONFLICTO_REVISION_RECUENTO');
  }
  if (num(rows[0].conflictos) > 0) {
    throw new Error('CONFLICTO_LINEAS_RECUENTO');
  }
  return {
    insertadas: num(rows[0].insertadas),
    actualizadas: num(rows[0].actualizadas),
    sinCambios: num(rows[0].sin_cambios),
    revision: num(rows[0].revision),
  };
}

export async function completarRecuentoManual(params: {
  importacionId: number;
  area: string;
  revisionEsperada: number;
  sessionId: string;
}): Promise<{
  completadoEn: string;
  faltantesAnadidos: number;
  ubicacionesExcluidas: number;
  revision: number;
} | null> {
  await ensureRecuentoManualSeguroSchema();
  const sql = getDb();
  const ubicacionesStockAlmacen = JSON.stringify(
    [...ALMACEN_UBICACIONES_RECUENTO_STOCK].map(normalizeUbicacionKey),
  );
  const rows = await sql`
    WITH cabecera AS MATERIALIZED (
      SELECT id
      FROM importaciones_stock
      WHERE id = ${params.importacionId}
        AND area = ${params.area}
        AND estado = 'pendiente'
        AND manual_completado_en IS NULL
        AND revision_manual = ${params.revisionEsperada}
        AND EXISTS (
          SELECT 1 FROM stock_registros sr
          WHERE sr.importacion_id = importaciones_stock.id
        )
      FOR UPDATE
    ),
    ubicaciones_iniciadas AS (
      SELECT DISTINCT TRANSLATE(
        LOWER(REGEXP_REPLACE(TRIM(COALESCE(m.ubicacion, '')), '[[:space:]]+', ' ', 'g')),
        'áéíóúüñ',
        'aeiouun'
      ) AS ubi_key
      FROM stock_registros sr
      INNER JOIN medicamentos m ON m.cn = sr.cn AND m.area = ${params.area}
      INNER JOIN cabecera c ON c.id = sr.importacion_id
    ),
    catalogo_pendiente AS (
      SELECT
        m.cn,
        COALESCE(m.ubicacion, '') AS ubicacion,
        TRANSLATE(
          LOWER(REGEXP_REPLACE(TRIM(COALESCE(m.ubicacion, '')), '[[:space:]]+', ' ', 'g')),
          'áéíóúüñ',
          'aeiouun'
        ) AS ubi_key
      FROM medicamentos m, cabecera c
      WHERE m.area = ${params.area}
        AND m.activo = TRUE
        AND (
          ${params.area !== ALMACEN_AREA}
          OR TRANSLATE(
            LOWER(REGEXP_REPLACE(TRIM(m.ubicacion), '[[:space:]]+', ' ', 'g')),
            'áéíóúüñ',
            'aeiouun'
          ) IN (
            SELECT jsonb_array_elements_text(${ubicacionesStockAlmacen}::jsonb)
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM stock_registros sr
          WHERE sr.importacion_id = c.id AND sr.cn = m.cn
        )
    ),
    faltantes AS (
      SELECT cp.cn, cp.ubicacion
      FROM catalogo_pendiente cp
      WHERE EXISTS (
        SELECT 1 FROM ubicaciones_iniciadas ui WHERE ui.ubi_key = cp.ubi_key
      )
    ),
    excluidas AS (
      SELECT DISTINCT cp.ubi_key
      FROM catalogo_pendiente cp
      WHERE NOT EXISTS (
        SELECT 1 FROM ubicaciones_iniciadas ui WHERE ui.ubi_key = cp.ubi_key
      )
    ),
    insertadas AS (
      INSERT INTO stock_registros (importacion_id, cn, stock_unidades, stock_cajas, valor_total)
      SELECT c.id, f.cn, 0, 0, NULL
      FROM faltantes f, cabecera c
      ON CONFLICT (importacion_id, cn) DO NOTHING
      RETURNING cn
    ),
    auditoria AS (
      INSERT INTO recuento_cambios (
        importacion_id, area, ubicacion, cn, stock_anterior, stock_nuevo, origen, session_id
      )
      SELECT
        c.id, ${params.area}, f.ubicacion, f.cn,
        NULL, 0, 'faltantes_finales', ${params.sessionId}
      FROM faltantes f, cabecera c
      WHERE f.cn IN (SELECT cn FROM insertadas)
      RETURNING id
    ),
    completado AS (
      UPDATE importaciones_stock i
      SET
        manual_completado_en = NOW(),
        manual_completado_session = ${params.sessionId},
        revision_manual = revision_manual + 1,
        total_lineas = (
          SELECT COUNT(DISTINCT sr.cn)::int
          FROM stock_registros sr
          WHERE sr.importacion_id = i.id
        ) + (SELECT COUNT(*)::int FROM insertadas)
      WHERE i.id IN (SELECT id FROM cabecera)
      RETURNING manual_completado_en::text, revision_manual
    )
    SELECT
      c.manual_completado_en,
      c.revision_manual,
      (SELECT COUNT(*)::int FROM insertadas) AS faltantes_anadidos,
      (SELECT COUNT(*)::int FROM excluidas) AS ubicaciones_excluidas,
      (SELECT COUNT(*)::int FROM cabecera) AS disponible
    FROM completado c
  `;
  if (!rows[0] || num(rows[0].disponible) === 0) return null;
  return {
    completadoEn: String(rows[0].manual_completado_en),
    faltantesAnadidos: num(rows[0].faltantes_anadidos),
    ubicacionesExcluidas: num(rows[0].ubicaciones_excluidas),
    revision: num(rows[0].revision_manual),
  };
}

export async function reabrirRecuentoManual(params: {
  importacionId: number;
  area: string;
  sessionId: string;
}): Promise<boolean> {
  const sql = getDb();
  const rows = await sql`
    WITH reabierto AS (
      UPDATE importaciones_stock
      SET manual_completado_en = NULL,
          manual_completado_session = NULL,
          revision_manual = revision_manual + 1
      WHERE id = ${params.importacionId}
        AND area = ${params.area}
        AND estado = 'pendiente'
        AND manual_completado_en IS NOT NULL
      RETURNING id
    )
    INSERT INTO recuento_cambios (
      importacion_id, area, ubicacion, cn, stock_anterior, stock_nuevo, origen, session_id
    )
    SELECT id, ${params.area}, NULL, NULL, NULL, NULL, 'reapertura', ${params.sessionId}
    FROM reabierto
    RETURNING id
  `;
  return rows.length > 0;
}

export async function getRecuentosByArea(area: string): Promise<{
  pendiente: RecuentoCabecera | null;
  historico: RecuentoCabecera[];
}> {
  const sql = getDb();
  await sql`
    UPDATE importaciones_stock
    SET estado = ${ESTADO_PEDIDO_ALMACEN}
    WHERE area = ${area}
      AND origen = ${ORIGEN_PEDIDO_ALMACEN}
      AND estado = 'pendiente'
  `;
  const rows = (await sql`
    SELECT id, area, estado, origen, fecha_recuento::text, importado_en::text, total_lineas, propuesta_id
    FROM importaciones_stock
    WHERE area = ${area}
      AND origen <> ${ORIGEN_PEDIDO_ALMACEN}
    ORDER BY id DESC;
  `) as Array<{
    id: number; area: string; estado: string; origen: string;
    fecha_recuento: string; importado_en: string; total_lineas: number; propuesta_id: number | null;
  }>;

  const mapped: RecuentoCabecera[] = rows.map((r) => ({
    id: num(r.id), area: r.area, estado: r.estado, origen: r.origen,
    fechaRecuento: r.fecha_recuento, importadoEn: r.importado_en,
    totalLineas: num(r.total_lineas), propuestaId: r.propuesta_id ? num(r.propuesta_id) : null,
  }));

  const pendiente = await getPendienteRecuento(area);

  return {
    pendiente,
    historico: mapped.filter((r) => !pendiente || r.id !== pendiente.id),
  };
}

export async function getLineasRecuento(importacionId: number): Promise<RecuentoLinea[]> {
  const sql = getDb();
  const rows = (await sql`
    SELECT sr.id, sr.cn, m.principio_activo, m.nombre, m.unidades_por_caja, sr.stock_cajas, sr.stock_unidades, sr.valor_total
    FROM stock_registros sr
    INNER JOIN medicamentos m ON m.cn = sr.cn
    WHERE sr.importacion_id = ${importacionId}
    ORDER BY sr.cn ASC, sr.id DESC;
  `) as Array<{
    id: number; cn: string; principio_activo: string | null; nombre: string; unidades_por_caja: number;
    stock_cajas: string; stock_unidades: string; valor_total: string | null;
  }>;

  const dedup = new Map<string, RecuentoLinea>();
  for (const r of rows) {
    if (dedup.has(r.cn)) continue;
    dedup.set(r.cn, {
      cn: r.cn,
      principioActivo: r.principio_activo,
      nombre: r.nombre,
      unidadesPorCaja: num(r.unidades_por_caja) > 0 ? num(r.unidades_por_caja) : 1,
      stockCajas: num(r.stock_cajas),
      stockUnidades: num(r.stock_unidades),
      valorTotal: numOrNull(r.valor_total),
    });
  }

  return [...dedup.values()].sort(sortByPrincipioNombre);
}

export async function listRecuentosManualesByArea(area: string): Promise<RecuentoManualResumen[]> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, estado, fecha_recuento::text, importado_en::text, total_lineas
    FROM importaciones_stock
    WHERE area = ${area}
      AND lower(origen) = 'manual'
    ORDER BY id DESC;
  `) as Array<{
    id: number;
    estado: string;
    fecha_recuento: string;
    importado_en: string;
    total_lineas: number;
  }>;

  return rows.map((r) => ({
    id: num(r.id),
    estado: r.estado,
    fechaRecuento: r.fecha_recuento,
    importadoEn: r.importado_en,
    totalLineas: num(r.total_lineas),
  }));
}

export async function getRecuentoCabeceraById(importacionId: number): Promise<RecuentoCabecera | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, area, estado, origen, fecha_recuento::text, importado_en::text, total_lineas, propuesta_id
    FROM importaciones_stock
    WHERE id = ${importacionId}
    LIMIT 1;
  `) as Array<{
    id: number;
    area: string;
    estado: string;
    origen: string;
    fecha_recuento: string;
    importado_en: string;
    total_lineas: number;
    propuesta_id: number | null;
  }>;

  const r = rows[0];
  if (!r) return null;
  return {
    id: num(r.id),
    area: r.area,
    estado: r.estado,
    origen: r.origen,
    fechaRecuento: r.fecha_recuento,
    importadoEn: r.importado_en,
    totalLineas: num(r.total_lineas),
    propuestaId: r.propuesta_id ? num(r.propuesta_id) : null,
  };
}

export async function getPendienteRecuento(area: string): Promise<RecuentoCabecera | null> {
  await ensureRecuentoManualSeguroSchema();
  const sql = getDb();
  const rows = (await sql`
    SELECT id, area, estado, origen, fecha_recuento::text, importado_en::text,
           total_lineas, propuesta_id, revision_manual, manual_completado_en::text
    FROM importaciones_stock
    WHERE area = ${area} AND estado = 'pendiente' AND origen <> ${ORIGEN_PEDIDO_ALMACEN}
    ORDER BY id DESC LIMIT 1;
  `) as Array<{
    id: number; area: string; estado: string; origen: string;
    fecha_recuento: string; importado_en: string; total_lineas: number; propuesta_id: number | null;
    revision_manual: number; manual_completado_en: string | null;
  }>;

  const r = rows[0];
  if (!r) return null;
  return {
    id: num(r.id), area: r.area, estado: r.estado, origen: r.origen,
    fechaRecuento: r.fecha_recuento, importadoEn: r.importado_en,
    totalLineas: num(r.total_lineas), propuestaId: r.propuesta_id ? num(r.propuesta_id) : null,
    revision: num(r.revision_manual),
    manualCompletadoEn: r.manual_completado_en,
  };
}

export async function crearRecuento(params: {
  area: string; origen: string; fechaRecuento: string;
  ficheroNombre: string; totalLineas: number; estado?: string;
}): Promise<number> {
  const sql = getDb();
  const rows = (await sql`
    INSERT INTO importaciones_stock (area, origen, estado, fecha_recuento, fichero_nombre, total_lineas)
    VALUES (
      ${params.area},
      ${params.origen},
      ${params.estado ?? 'pendiente'},
      ${params.fechaRecuento},
      ${params.ficheroNombre},
      ${params.totalLineas}
    )
    RETURNING id;
  `) as Array<{ id: number }>;
  return num(rows[0]?.id);
}

export async function insertarLineasRecuento(
  importacionId: number,
  lineas: Array<{ cn: string; stockUnidades: number; stockCajas: number; valorTotal: number | null }>
): Promise<void> {
  if (lineas.length === 0) return;
  await ensureRecuentoManualSeguroSchema();
  const sql = getDb();
  const payload = JSON.stringify(lineas.map((linea, posicion) => ({
    posicion,
    cn: linea.cn,
    stock_unidades: normalizeStockUnidades(linea.stockUnidades),
    valor_total: linea.valorTotal,
  })));
  await sql`
    WITH entrada AS (
      SELECT posicion, cn, stock_unidades, valor_total
      FROM jsonb_to_recordset(${payload}::jsonb)
        AS x(posicion integer, cn text, stock_unidades integer, valor_total numeric)
    ),
    ultimas AS (
      SELECT DISTINCT ON (cn) cn, stock_unidades, valor_total
      FROM entrada
      ORDER BY cn, posicion DESC
    )
    INSERT INTO stock_registros (
      importacion_id, cn, stock_unidades, stock_cajas, valor_total
    )
    SELECT
      ${importacionId},
      m.cn,
      u.stock_unidades,
      round(u.stock_unidades::numeric / GREATEST(m.unidades_por_caja, 1), 4),
      u.valor_total
    FROM ultimas u
    INNER JOIN medicamentos m ON m.cn = u.cn
    ON CONFLICT (importacion_id, cn) DO UPDATE
    SET stock_unidades = EXCLUDED.stock_unidades,
        stock_cajas = EXCLUDED.stock_cajas,
        valor_total = EXCLUDED.valor_total
  `;
}

export async function getMedicamentosParaRecuento(
  area: string, cns: string[]
): Promise<Array<{
  cn: string;
  nombre: string;
  unidadesPorCaja: number;
  ubicacion: string | null;
}>> {
  if (cns.length === 0) return [];
  const sql = getDb();
  const rows = (await sql`
    SELECT cn, nombre, unidades_por_caja, ubicacion
    FROM medicamentos
    WHERE area = ${area} AND cn = ANY(${cns});
  `) as Array<{
    cn: string;
    nombre: string;
    unidades_por_caja: number;
    ubicacion: string | null;
  }>;
  return rows.map((r) => ({
    cn: r.cn,
    nombre: r.nombre,
    unidadesPorCaja: num(r.unidades_por_caja),
    ubicacion: r.ubicacion,
  }));
}

export async function getRecuentoById(id: number): Promise<{ id: number; area: string; estado: string } | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, area, estado FROM importaciones_stock WHERE id = ${id} LIMIT 1;
  `) as Array<{ id: number; area: string; estado: string }>;
  const r = rows[0];
  return r ? { id: num(r.id), area: r.area, estado: r.estado } : null;
}

export async function actualizarLineaRecuento(
  importacionId: number,
  cn: string,
  _stockCajas: number,
  stockUnidades: number,
): Promise<boolean> {
  const unidadesExactas = normalizeStockUnidades(stockUnidades);
  const sql = getDb();
  const rows = (await sql`
    UPDATE stock_registros sr
    SET
      stock_unidades = ${unidadesExactas},
      stock_cajas = round(
        ${unidadesExactas}::numeric / GREATEST(m.unidades_por_caja, 1),
        4
      )
    FROM medicamentos m
    WHERE sr.importacion_id = ${importacionId}
      AND sr.cn = ${cn}
      AND m.cn = sr.cn
    RETURNING sr.id;
  `) as Array<{ id: number }>;
  return rows.length > 0;
}

export async function upsertLineaRecuento(
  importacionId: number,
  line: { cn: string; stockUnidades: number; stockCajas: number; valorTotal: number | null }
): Promise<'updated' | 'inserted'> {
  await ensureRecuentoManualSeguroSchema();
  const updated = await actualizarLineaRecuento(
    importacionId,
    line.cn,
    line.stockCajas,
    line.stockUnidades
  );
  if (updated) {
    const sql = getDb();
    await sql`
      UPDATE stock_registros
      SET valor_total = ${line.valorTotal}
      WHERE importacion_id = ${importacionId} AND cn = ${line.cn};
    `;
    return 'updated';
  }

  const sql = getDb();
  const unidadesExactas = normalizeStockUnidades(line.stockUnidades);
  await sql`
    INSERT INTO stock_registros (importacion_id, cn, stock_unidades, stock_cajas, valor_total)
    SELECT
      ${importacionId},
      m.cn,
      ${unidadesExactas},
      round(${unidadesExactas}::numeric / GREATEST(m.unidades_por_caja, 1), 4),
      ${line.valorTotal}
    FROM medicamentos m
    WHERE m.cn = ${line.cn}
    ON CONFLICT (importacion_id, cn) DO UPDATE
    SET stock_unidades = EXCLUDED.stock_unidades,
        stock_cajas = EXCLUDED.stock_cajas,
        valor_total = EXCLUDED.valor_total;
  `;
  return 'inserted';
}

export async function eliminarLineaRecuento(importacionId: number, cn: string): Promise<boolean> {
  const sql = getDb();
  const rows = (await sql`
    DELETE FROM stock_registros
    WHERE importacion_id = ${importacionId} AND cn = ${cn}
    RETURNING id;
  `) as Array<{ id: number }>;
  return rows.length > 0;
}

function normalizeUbicacionKey(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export async function incorporarFaltantesRecuento(
  importacionId: number,
  catalogo: Array<{
    cn: string;
    activo: boolean;
    ubicacion: string | null;
    unidadesPorCaja: number;
  }>,
  options?: { ubicacionNormalizada?: string }
): Promise<{ insertadas: number; totalLineas: number }> {
  const existentes = await getLineasRecuento(importacionId);
  const existentesCn = new Set(existentes.map((l) => l.cn));
  const ubicacionKey = options?.ubicacionNormalizada ?? null;

  let insertadas = 0;
  for (const med of catalogo) {
    if (!med.activo) continue;
    if (ubicacionKey && normalizeUbicacionKey(med.ubicacion) !== ubicacionKey) continue;
    if (existentesCn.has(med.cn)) continue;

    await upsertLineaRecuento(importacionId, {
      cn: med.cn,
      stockUnidades: 0,
      stockCajas: 0,
      valorTotal: null,
    });
    existentesCn.add(med.cn);
    insertadas += 1;
  }

  const totalLineas = await recalcularTotalLineasRecuento(importacionId);
  return { insertadas, totalLineas };
}

export async function recalcularTotalLineasRecuento(importacionId: number): Promise<number> {
  const sql = getDb();
  const rows = (await sql`
    UPDATE importaciones_stock i
    SET total_lineas = sub.total
    FROM (
      SELECT COUNT(*)::int AS total
      FROM stock_registros
      WHERE importacion_id = ${importacionId}
    ) sub
    WHERE i.id = ${importacionId}
    RETURNING i.total_lineas;
  `) as Array<{ total_lineas: number }>;

  return num(rows[0]?.total_lineas ?? 0);
}

export async function sincronizarRecuentoPendienteConCatalogo(
  importacionId: number,
  area: string
): Promise<{ updated: number; cnsSinCatalogo: string[] }> {
  const sql = getDb();
  const recuento = (await sql`
    SELECT id
    FROM importaciones_stock
    WHERE id = ${importacionId} AND area = ${area} AND estado = 'pendiente'
    LIMIT 1;
  `) as Array<{ id: number }>;
  if (recuento.length === 0) {
    throw new Error('El recuento no existe o no está pendiente en el área activa.');
  }

  const updatedRows = (await sql`
    UPDATE stock_registros sr
    SET stock_cajas = round(
      sr.stock_unidades::numeric / GREATEST(m.unidades_por_caja, 1),
      4
    )
    FROM medicamentos m
    WHERE sr.importacion_id = ${importacionId}
      AND m.cn = sr.cn
      AND m.area = ${area}
    RETURNING sr.cn;
  `) as Array<{ cn: string }>;

  const sinCatalogoRows = (await sql`
    SELECT sr.cn
    FROM stock_registros sr
    LEFT JOIN medicamentos m
      ON m.cn = sr.cn
      AND m.area = ${area}
    WHERE sr.importacion_id = ${importacionId}
      AND m.cn IS NULL
    ORDER BY sr.cn;
  `) as Array<{ cn: string }>;

  return {
    updated: updatedRows.length,
    cnsSinCatalogo: sinCatalogoRows.map((r) => r.cn),
  };
}

export type EliminarRecuentoResult =
  | { ok: true; lineasEliminadas: number; propuestasEliminadas: number }
  | { ok: false; reason: 'not_found_or_not_pending' | 'linked_non_draft_proposal'; propuestaEstado?: string };

export async function eliminarRecuentoPendiente(
  importacionId: number,
  area: string
): Promise<EliminarRecuentoResult> {
  const sql = getDb();

  const recuentoRows = (await sql`
    SELECT id
    FROM importaciones_stock
    WHERE id = ${importacionId} AND area = ${area} AND estado = 'pendiente'
    LIMIT 1;
  `) as Array<{ id: number }>;

  if (recuentoRows.length === 0) {
    return { ok: false, reason: 'not_found_or_not_pending' };
  }

  const propuestas = (await sql`
    SELECT id, estado
    FROM propuestas
    WHERE importacion_stock_id = ${importacionId};
  `) as Array<{ id: number; estado: string }>;

  const propuestaNoBorrador = propuestas.find((p) => p.estado !== 'borrador');
  if (propuestaNoBorrador) {
    return { ok: false, reason: 'linked_non_draft_proposal', propuestaEstado: propuestaNoBorrador.estado };
  }

  for (const propuesta of propuestas) {
    await sql`DELETE FROM propuestas_lineas WHERE propuesta_id = ${num(propuesta.id)};`;
  }

  if (propuestas.length > 0) {
    await sql`
      DELETE FROM propuestas
      WHERE importacion_stock_id = ${importacionId} AND estado = 'borrador';
    `;
  }

  const lineasEliminadas = (await sql`
    DELETE FROM stock_registros
    WHERE importacion_id = ${importacionId}
    RETURNING id;
  `) as Array<{ id: number }>;

  const recuentoEliminado = (await sql`
    DELETE FROM importaciones_stock
    WHERE id = ${importacionId} AND area = ${area} AND estado = 'pendiente'
    RETURNING id;
  `) as Array<{ id: number }>;

  if (recuentoEliminado.length === 0) {
    return { ok: false, reason: 'not_found_or_not_pending' };
  }

  return {
    ok: true,
    lineasEliminadas: lineasEliminadas.length,
    propuestasEliminadas: propuestas.length,
  };
}

export type EliminarRecuentoHistoricoResult =
  | { ok: true; lineasEliminadas: number; propuestasEliminadas: number }
  | { ok: false; reason: 'not_found_or_pending' };

export async function eliminarRecuentoHistorico(
  importacionId: number,
  area: string
): Promise<EliminarRecuentoHistoricoResult> {
  const sql = getDb();

  const recuentoRows = (await sql`
    SELECT id
    FROM importaciones_stock
    WHERE id = ${importacionId} AND area = ${area} AND estado <> 'pendiente'
    LIMIT 1;
  `) as Array<{ id: number }>;

  if (recuentoRows.length === 0) {
    return { ok: false, reason: 'not_found_or_pending' };
  }

  const propuestas = (await sql`
    SELECT id
    FROM propuestas
    WHERE importacion_stock_id = ${importacionId} AND area = ${area};
  `) as Array<{ id: number }>;

  for (const propuesta of propuestas) {
    const propuestaId = num(propuesta.id);
    await sql`DELETE FROM propuestas_lineas WHERE propuesta_id = ${propuestaId};`;
    await sql`UPDATE importaciones_stock SET propuesta_id = NULL WHERE propuesta_id = ${propuestaId} AND area = ${area};`;
    await sql`DELETE FROM propuestas WHERE id = ${propuestaId} AND area = ${area};`;
  }

  const lineasEliminadas = (await sql`
    DELETE FROM stock_registros
    WHERE importacion_id = ${importacionId}
    RETURNING id;
  `) as Array<{ id: number }>;

  const recuentoEliminado = (await sql`
    DELETE FROM importaciones_stock
    WHERE id = ${importacionId} AND area = ${area} AND estado <> 'pendiente'
    RETURNING id;
  `) as Array<{ id: number }>;

  if (recuentoEliminado.length === 0) {
    return { ok: false, reason: 'not_found_or_pending' };
  }

  return {
    ok: true,
    lineasEliminadas: lineasEliminadas.length,
    propuestasEliminadas: propuestas.length,
  };
}

export async function actualizarPreciosCatalogoDesdeSap(
  area: string,
  updates: Array<{ cn: string; precioUnidad: number; precioCaja: number }>
): Promise<number> {
  if (updates.length === 0) return 0;

  const sql = getDb();
  let updated = 0;

  // Si el Excel trae varias líneas del mismo CN usamos el último valor recibido.
  const byCn = new Map<string, { precioUnidad: number; precioCaja: number }>();
  for (const u of updates) byCn.set(u.cn, { precioUnidad: u.precioUnidad, precioCaja: u.precioCaja });

  for (const [cn, values] of byCn.entries()) {
    const rows = (await sql`
      UPDATE medicamentos
      SET
        precio_unidad = ${values.precioUnidad},
        precio_caja = ${values.precioCaja},
        actualizado_en = now()
      WHERE area = ${area} AND cn = ${cn}
      RETURNING cn;
    `) as Array<{ cn: string }>;

    if (rows.length > 0) updated += 1;
  }

  return updated;
}

export async function getMedicamentoByCnArea(
  cn: string, area: string
): Promise<{ cn: string; unidadesPorCaja: number } | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT cn, unidades_por_caja FROM medicamentos WHERE cn = ${cn} AND area = ${area} LIMIT 1;
  `) as Array<{ cn: string; unidades_por_caja: number }>;
  const r = rows[0];
  return r ? { cn: r.cn, unidadesPorCaja: num(r.unidades_por_caja) } : null;
}

export async function recuperarRecuentoGenerado(
  importacionId: number,
  area: string
): Promise<boolean> {
  const sql = getDb();
  const rows = (await sql`
    UPDATE importaciones_stock
    SET estado = 'pendiente', generado_en = NULL, propuesta_id = NULL
    WHERE id = ${importacionId} AND area = ${area} AND estado = 'generado'
    RETURNING id;
  `) as Array<{ id: number }>;
  return rows.length > 0;
}

type ResumenPropuestasRecuento = {
  total: number;
  borradores: number;
  tramitadas: number;
  propuestaIdSugerida: number | null;
};

async function getResumenPropuestasRecuento(
  area: string,
  importacionStockId: number
): Promise<ResumenPropuestasRecuento> {
  const sql = getDb();
  const propuestas = (await sql`
    SELECT id, estado
    FROM propuestas
    WHERE area = ${area}
      AND importacion_stock_id = ${importacionStockId}
    ORDER BY
      CASE
        WHEN estado = 'tramitada' THEN 0
        WHEN estado = 'borrador' THEN 1
        ELSE 2
      END,
      id DESC;
  `) as Array<{ id: number; estado: string }>;

  const borradores = propuestas.filter((propuesta) => propuesta.estado === 'borrador').length;
  const tramitadas = propuestas.filter((propuesta) => propuesta.estado === 'tramitada').length;

  return {
    total: propuestas.length,
    borradores,
    tramitadas,
    propuestaIdSugerida: propuestas[0] ? num(propuestas[0].id) : null,
  };
}

async function marcarRecuentoComoGenerado(
  importacionId: number,
  area: string,
  propuestaId: number | null
): Promise<boolean> {
  const sql = getDb();
  const rows = (await sql`
    UPDATE importaciones_stock
    SET
      estado = 'generado',
      generado_en = now(),
      propuesta_id = ${propuestaId},
      manual_completado_en = COALESCE(manual_completado_en, now())
    WHERE id = ${importacionId}
      AND area = ${area}
      AND origen <> ${ORIGEN_PEDIDO_ALMACEN}
      AND estado IN ('pendiente', 'procesando-stock', 'validado')
    RETURNING id;
  `) as Array<{ id: number }>;
  return rows.length > 0;
}

async function marcarRecuentoComoValidado(
  importacionId: number,
  area: string,
  propuestaId: number | null
): Promise<boolean> {
  const sql = getDb();
  const rows = (await sql`
    UPDATE importaciones_stock
    SET estado = 'validado', generado_en = now(), propuesta_id = ${propuestaId}
    WHERE id = ${importacionId}
      AND area = ${area}
      AND estado = 'procesando-stock'
      AND origen <> ${ORIGEN_PEDIDO_ALMACEN}
    RETURNING id;
  `) as Array<{ id: number }>;
  return rows.length > 0;
}

export async function finalizarRecuentoDesdeStock(
  importacionId: number,
  area: string
): Promise<
  | { ok: true; propuestaId: number | null }
  | {
      ok: false;
      reason:
        | 'not_found_or_not_pending'
        | 'manual_not_completed'
        | 'linked_draft_proposals'
        | 'no_proposals_generated';
    }
> {
  await ensureRecuentoManualSeguroSchema();
  const sql = getDb();
  const recuentoRows = (await sql`
    UPDATE importaciones_stock
    SET estado = 'procesando-stock'
    WHERE id = ${importacionId}
      AND area = ${area}
      AND estado = 'pendiente'
      AND (
        LOWER(origen) <> 'manual'
        OR fichero_nombre IS DISTINCT FROM 'APP Recuento Manual'
        OR manual_completado_en IS NOT NULL
      )
    RETURNING id
  `) as Array<{ id: number }>;

  if (recuentoRows.length === 0) {
    const sinCompletar = await sql`
      SELECT id
    FROM importaciones_stock
      WHERE id = ${importacionId}
        AND area = ${area}
        AND estado = 'pendiente'
        AND LOWER(origen) = 'manual'
        AND fichero_nombre = 'APP Recuento Manual'
        AND manual_completado_en IS NULL
      LIMIT 1
    `;
    if (sinCompletar.length > 0) {
      return { ok: false, reason: 'manual_not_completed' };
    }
    return { ok: false, reason: 'not_found_or_not_pending' };
  }

  const restaurarPendiente = async () => {
    await sql`
      UPDATE importaciones_stock
      SET estado = 'pendiente'
      WHERE id = ${importacionId}
        AND area = ${area}
        AND estado = 'procesando-stock'
    `;
  };

  try {
    if (isAlmacenArea(area)) {
      await syncTodasPropuestasUbicacionDesdeRecuento(area, importacionId, {
        createIfMissing: true,
      });
      const borradores = await listBorradoresPropuestaAlmacen(area, importacionId);
      if (borradores.length === 0) {
        await restaurarPendiente();
        return { ok: false, reason: 'no_proposals_generated' };
      }
      const propuestaId = borradores[0]?.id ?? null;
      const validado = await marcarRecuentoComoValidado(importacionId, area, propuestaId);
      if (!validado) await restaurarPendiente();
      return validado
        ? { ok: true, propuestaId }
        : { ok: false, reason: 'not_found_or_not_pending' };
    }

    const resumen = await getResumenPropuestasRecuento(area, importacionId);
    if (resumen.borradores > 0) {
      await restaurarPendiente();
      return { ok: false, reason: 'linked_draft_proposals' };
    }

    const propuestaId = resumen.tramitadas > 0 ? resumen.propuestaIdSugerida : null;
    const generado = await marcarRecuentoComoGenerado(importacionId, area, propuestaId);
    if (!generado) {
      await restaurarPendiente();
      return { ok: false, reason: 'not_found_or_not_pending' };
    }
    return { ok: true, propuestaId };
  } catch (error) {
    await restaurarPendiente();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// PROPUESTAS
// ---------------------------------------------------------------------------
export async function getBorradorPropuesta(
  area: string, importacionStockId: number
): Promise<PropuestaCabecera | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, area, estado, fecha_generacion::text, tramitada_en::text, observaciones
    FROM propuestas
    WHERE area = ${area} AND importacion_stock_id = ${importacionStockId} AND estado = 'borrador'
    ORDER BY id DESC LIMIT 1;
  `) as Array<{
    id: number; area: string; estado: string;
    fecha_generacion: string; tramitada_en: string | null; observaciones: string | null;
  }>;
  const r = rows[0];
  if (!r) return null;
  return {
    id: num(r.id), area: r.area, estado: r.estado,
    fechaGeneracion: r.fecha_generacion, tramitadaEn: r.tramitada_en,
    observaciones: r.observaciones,
  };
}

export async function getBorradorPropuestaAlmacenPorNombre(
  area: string,
  importacionStockId: number,
  nombreGrupo: string
): Promise<PropuestaCabecera | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, area, estado, fecha_generacion::text, tramitada_en::text, observaciones
    FROM propuestas
    WHERE area = ${area}
      AND importacion_stock_id = ${importacionStockId}
      AND estado = 'borrador'
      AND observaciones = ${nombreGrupo}
    ORDER BY id DESC LIMIT 1;
  `) as Array<{
    id: number; area: string; estado: string;
    fecha_generacion: string; tramitada_en: string | null; observaciones: string | null;
  }>;
  const r = rows[0];
  if (!r) return null;
  return {
    id: num(r.id), area: r.area, estado: r.estado,
    fechaGeneracion: r.fecha_generacion, tramitadaEn: r.tramitada_en,
    observaciones: r.observaciones,
  };
}

export async function getUltimaPropuestaPorNombre(
  area: string,
  importacionStockId: number,
  nombreGrupo: string
): Promise<PropuestaCabecera | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, area, estado, fecha_generacion::text, tramitada_en::text, observaciones
    FROM propuestas
    WHERE area = ${area}
      AND importacion_stock_id = ${importacionStockId}
      AND observaciones = ${nombreGrupo}
    ORDER BY
      CASE
        WHEN estado = 'borrador' THEN 0
        WHEN estado = 'tramitada' THEN 1
        ELSE 2
      END,
      id DESC
    LIMIT 1;
  `) as Array<{
    id: number; area: string; estado: string;
    fecha_generacion: string; tramitada_en: string | null; observaciones: string | null;
  }>;

  const r = rows[0];
  if (!r) return null;
  return {
    id: num(r.id),
    area: r.area,
    estado: r.estado,
    fechaGeneracion: r.fecha_generacion,
    tramitadaEn: r.tramitada_en,
    observaciones: r.observaciones,
  };
}

export async function listBorradoresPropuestaAlmacen(
  area: string,
  importacionStockId: number
): Promise<Array<PropuestaCabecera & { totalLineas: number }>> {
  const sql = getDb();
  const rows = (await sql`
    SELECT
      p.id,
      p.area,
      p.estado,
      p.fecha_generacion::text AS fecha_generacion,
      p.tramitada_en::text AS tramitada_en,
      p.observaciones,
      COUNT(DISTINCT pl.cn) FILTER (WHERE COALESCE(pl.cajas_validadas, pl.cajas_propuestas) > 0)::int AS total_lineas
    FROM propuestas p
    LEFT JOIN propuestas_lineas pl ON pl.propuesta_id = p.id
    WHERE p.area = ${area}
      AND p.importacion_stock_id = ${importacionStockId}
      AND p.estado = 'borrador'
    GROUP BY p.id
    ORDER BY p.observaciones ASC NULLS LAST, p.id ASC;
  `) as Array<{
    id: number; area: string; estado: string;
    fecha_generacion: string; tramitada_en: string | null;
    observaciones: string | null; total_lineas: number;
  }>;

  return rows.map((r) => ({
    id: num(r.id),
    area: r.area,
    estado: r.estado,
    fechaGeneracion: r.fecha_generacion,
    tramitadaEn: r.tramitada_en,
    observaciones: r.observaciones,
    totalLineas: num(r.total_lineas),
  }));
}

/**
 * Borradores visibles en Propuestas de Almacén:
 * - pedidos directos de la sesión técnica;
 * - propuestas creadas después de validar un recuento real en Stock.
 */
export async function listBorradoresActivosAlmacen(
  area: string
): Promise<Array<PropuestaCabecera & {
  totalLineas: number;
  importacionStockId: number;
  recuentoOrigen: string;
}>> {
  const sql = getDb();
  const rows = (await sql`
    SELECT
      p.id,
      p.area,
      p.estado,
      p.fecha_generacion::text AS fecha_generacion,
      p.tramitada_en::text AS tramitada_en,
      p.observaciones,
      p.importacion_stock_id,
      i.origen AS recuento_origen,
      COUNT(DISTINCT pl.cn)
        FILTER (WHERE COALESCE(pl.cajas_validadas, pl.cajas_propuestas) > 0)::int
        AS total_lineas
    FROM propuestas p
    INNER JOIN importaciones_stock i ON i.id = p.importacion_stock_id
    LEFT JOIN propuestas_lineas pl ON pl.propuesta_id = p.id
    WHERE p.area = ${area}
      AND p.estado = 'borrador'
      AND (
        i.origen = ${ORIGEN_PEDIDO_ALMACEN}
        OR (
          i.origen <> ${ORIGEN_PEDIDO_ALMACEN}
          AND i.estado = 'validado'
        )
      )
    GROUP BY p.id, i.origen
    ORDER BY p.fecha_generacion DESC, p.id DESC;
  `) as Array<{
    id: number;
    area: string;
    estado: string;
    fecha_generacion: string;
    tramitada_en: string | null;
    observaciones: string | null;
    importacion_stock_id: number;
    recuento_origen: string;
    total_lineas: number;
  }>;

  return rows.map((r) => ({
    id: num(r.id),
    area: r.area,
    estado: r.estado,
    fechaGeneracion: r.fecha_generacion,
    tramitadaEn: r.tramitada_en,
    observaciones: r.observaciones,
    totalLineas: num(r.total_lineas),
    importacionStockId: num(r.importacion_stock_id),
    recuentoOrigen: r.recuento_origen,
  }));
}

export async function listBloquesPropuestaRecuento(
  area: string,
  importacionStockId: number
): Promise<PropuestaBloqueResumen[]> {
  const ubicacionesRecuento = await listUbicacionesConStockEnRecuento(importacionStockId, area);
  const ubicaciones = isAlmacenArea(area)
    ? ubicacionesRecuento.filter((ubicacion) =>
        ubicacionAlmacenUsaRecuentoStock(ubicacion)
      )
    : ubicacionesRecuento;
  if (ubicaciones.length === 0) return [];

  const sql = getDb();
  const propuestasRows = (await sql`
    SELECT
      p.id,
      p.estado,
      p.fecha_generacion::text AS fecha_generacion,
      p.tramitada_en::text AS tramitada_en,
      p.observaciones,
      COUNT(DISTINCT pl.cn) FILTER (WHERE COALESCE(pl.cajas_validadas, pl.cajas_propuestas) > 0)::int AS total_lineas
    FROM propuestas p
    LEFT JOIN propuestas_lineas pl ON pl.propuesta_id = p.id
    WHERE p.area = ${area}
      AND p.importacion_stock_id = ${importacionStockId}
    GROUP BY p.id
    ORDER BY p.id DESC;
  `) as Array<{
    id: number;
    estado: string;
    fecha_generacion: string;
    tramitada_en: string | null;
    observaciones: string | null;
    total_lineas: number;
  }>;

  const canonicalByEtiqueta = new Map<string, {
    id: number;
    estado: string;
    fechaGeneracion: string;
    tramitadaEn: string | null;
    observaciones: string | null;
    totalLineas: number;
  }>();

  for (const row of propuestasRows) {
    const etiqueta = String(row.observaciones ?? '').trim();
    if (!etiqueta) continue;
    const current = canonicalByEtiqueta.get(etiqueta);
    if (!current) {
      canonicalByEtiqueta.set(etiqueta, {
        id: num(row.id),
        estado: row.estado,
        fechaGeneracion: row.fecha_generacion,
        tramitadaEn: row.tramitada_en,
        observaciones: row.observaciones,
        totalLineas: num(row.total_lineas),
      });
      continue;
    }
    if (current.estado !== 'borrador' && row.estado === 'borrador') {
      canonicalByEtiqueta.set(etiqueta, {
        id: num(row.id),
        estado: row.estado,
        fechaGeneracion: row.fecha_generacion,
        tramitadaEn: row.tramitada_en,
        observaciones: row.observaciones,
        totalLineas: num(row.total_lineas),
      });
    }
  }

  return ubicaciones.map((ubicacion) => {
    const etiqueta = nombrePropuestaUbicacion(ubicacion);
    const propuesta = canonicalByEtiqueta.get(etiqueta);
    return {
      ubicacion,
      etiqueta,
      estado: propuesta ? (propuesta.estado as PropuestaBloqueEstado) : 'sin_propuesta',
      propuestaId: propuesta?.id ?? null,
      totalLineas: propuesta?.totalLineas ?? 0,
      fechaGeneracion: propuesta?.fechaGeneracion ?? null,
      tramitadaEn: propuesta?.tramitadaEn ?? null,
    };
  });
}

export async function getOrCreatePropuestaAlmacenGrupo(
  area: string,
  importacionStockId: number,
  ubicacion: string,
  principioActivo: string | null,
  nombre: string
): Promise<number> {
  const grupoLetras: AlmacenFarGrupoLetras | null = ubicacionAlmacenUsaLetras(ubicacion)
    ? grupoLetrasAlmacenFar(principioActivo, nombre)
    : null;
  const etiqueta = nombrePropuestaAlmacen(ubicacion, grupoLetras);

  const existing = await getBorradorPropuestaAlmacenPorNombre(area, importacionStockId, etiqueta);
  if (existing) return existing.id;

  const created = await crearPropuesta(area, importacionStockId, etiqueta);
  return created.id;
}

export async function crearPropuesta(
  area: string,
  importacionStockId: number,
  observaciones?: string | null
): Promise<PropuestaCabecera> {
  const sql = getDb();
  const obs = observaciones?.trim() || null;
  const rows = (await sql`
    INSERT INTO propuestas (area, estado, importacion_stock_id, fecha_generacion, observaciones)
    VALUES (${area}, 'borrador', ${importacionStockId}, now(), ${obs})
    RETURNING id, area, estado, fecha_generacion::text, tramitada_en::text, observaciones;
  `) as Array<{
    id: number; area: string; estado: string;
    fecha_generacion: string; tramitada_en: string | null; observaciones: string | null;
  }>;
  const r = rows[0]!;
  return {
    id: num(r.id), area: r.area, estado: r.estado,
    fechaGeneracion: r.fecha_generacion, tramitadaEn: r.tramitada_en,
    observaciones: r.observaciones,
  };
}

export async function getLineasPropuesta(propuestaId: number): Promise<PropuestaLinea[]> {
  const sql = getDb();
  const rows = (await sql`
    SELECT pl.id, pl.cn, pl.nombre_medicamento, pl.unidades_por_caja,
           m.principio_activo,
           stock_actual, stock_transito_snap, stock_minimo_snap, punto_pedido_snap, stock_maximo_snap,
           cajas_propuestas, cajas_validadas, motivo_ajuste, motivo_ajuste_otro, ajustado,
           pl.proveedor_local
    FROM propuestas_lineas pl
    LEFT JOIN medicamentos m ON m.cn = pl.cn
    WHERE pl.propuesta_id = ${propuestaId}
    ORDER BY pl.cn ASC, pl.id DESC;
  `) as Array<{
    id: number; cn: string; nombre_medicamento: string | null; unidades_por_caja: number;
    principio_activo: string | null;
    stock_actual: string; stock_transito_snap: string; stock_minimo_snap: number; punto_pedido_snap: number; stock_maximo_snap: number;
    cajas_propuestas: number; cajas_validadas: number | null;
    motivo_ajuste: string | null; motivo_ajuste_otro: string | null; ajustado: boolean;
    proveedor_local: boolean | null;
  }>;

  const dedup = new Map<string, PropuestaLinea>();
  for (const r of rows) {
    if (dedup.has(r.cn)) continue;
    dedup.set(r.cn, {
      id: num(r.id),
      cn: r.cn,
      principioActivo: r.principio_activo,
      nombreMedicamento: r.nombre_medicamento,
      unidadesPorCaja: num(r.unidades_por_caja),
      stockActual: num(r.stock_actual),
      stockTransito: num(r.stock_transito_snap),
      stockMinimoSnap: num(r.stock_minimo_snap),
      puntoPedidoSnap: num(r.punto_pedido_snap),
      stockMaximoSnap: num(r.stock_maximo_snap),
      cajasPropuestas: num(r.cajas_propuestas),
      cajasValidadas: r.cajas_validadas != null ? num(r.cajas_validadas) : null,
      motivoAjuste: r.motivo_ajuste,
      motivoAjusteOtro: r.motivo_ajuste_otro,
      ajustado: r.ajustado,
      proveedorLocal: r.proveedor_local === true,
    });
  }

  return [...dedup.values()].sort((a, b) =>
    sortByPrincipioNombre(
      { cn: a.cn, principioActivo: a.principioActivo, nombre: a.nombreMedicamento },
      { cn: b.cn, principioActivo: b.principioActivo, nombre: b.nombreMedicamento }
    )
  );
}

export async function getRecuentoConStockParaPropuesta(
  importacionId: number,
  area: string,
  ubicacion?: string | null
) {
  const sql = getDb();
  const rows = (await sql`
    SELECT
      sr.id, sr.cn, sr.stock_unidades,
      m.nombre, m.unidades_por_caja, m.ubicacion,
      m.principio_activo,
      so.stock_minimo, so.punto_pedido, so.stock_maximo
    FROM stock_registros sr
    INNER JOIN medicamentos m ON m.cn = sr.cn AND m.area = ${area} AND m.activo = true
    LEFT JOIN stock_objetivo so ON so.cn = sr.cn
    WHERE sr.importacion_id = ${importacionId}
    ORDER BY sr.cn ASC, sr.id DESC;
  `) as Array<{
    id: number; cn: string; stock_unidades: string;
    nombre: string; unidades_por_caja: number; ubicacion: string | null; principio_activo: string | null;
    stock_minimo: number | null; punto_pedido: number | null; stock_maximo: number | null;
  }>;

  const normalizedRows = rows.map((row) => ({
    ...row,
    stock_cajas: stockCajasDesdeUnidades(
      Number(row.stock_unidades),
      Number(row.unidades_por_caja)
    ),
  }));
  const dedup = new Map<string, typeof normalizedRows[number]>();
  for (const row of normalizedRows) {
    if (!dedup.has(row.cn)) dedup.set(row.cn, row);
  }
  const uniqueRows = [...dedup.values()].sort((a, b) =>
    sortByPrincipioNombre(
      { cn: a.cn, principioActivo: a.principio_activo, nombre: a.nombre },
      { cn: b.cn, principioActivo: b.principio_activo, nombre: b.nombre }
    )
  );

  if (!ubicacion?.trim()) return uniqueRows;

  const ubicacionKey = normalizeUbicacionKey(ubicacion);
  return uniqueRows.filter((row) => normalizeUbicacionKey(row.ubicacion) === ubicacionKey);
}

export async function listUbicacionesConStockEnRecuento(
  importacionId: number,
  area: string
): Promise<string[]> {
  const sql = getDb();
  const rows = (await sql`
    SELECT DISTINCT trim(m.ubicacion) AS ubicacion
    FROM stock_registros sr
    INNER JOIN medicamentos m ON m.cn = sr.cn AND m.area = ${area}
    WHERE sr.importacion_id = ${importacionId}
      AND m.ubicacion IS NOT NULL
      AND trim(m.ubicacion) <> ''
    ORDER BY ubicacion ASC;
  `) as Array<{ ubicacion: string }>;

  const map = new Map<string, string>();
  for (const row of rows) {
    const trimmed = String(row.ubicacion ?? '').trim();
    if (!trimmed) continue;
    const key = normalizeUbicacionKey(trimmed);
    if (!map.has(key)) map.set(key, trimmed);
  }
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

export async function eliminarBorradorPropuestaSinEtiqueta(
  area: string,
  importacionStockId: number
): Promise<void> {
  const sql = getDb();
  await sql`
    DELETE FROM propuestas_lineas pl
    USING propuestas p
    WHERE pl.propuesta_id = p.id
      AND p.area = ${area}
      AND p.importacion_stock_id = ${importacionStockId}
      AND p.estado = 'borrador'
      AND (p.observaciones IS NULL OR trim(p.observaciones) = '');
  `;
  await sql`
    DELETE FROM propuestas
    WHERE area = ${area}
      AND importacion_stock_id = ${importacionStockId}
      AND estado = 'borrador'
      AND (observaciones IS NULL OR trim(observaciones) = '');
  `;
}

export async function syncPropuestaUbicacionDesdeRecuento(
  area: string,
  importacionId: number,
  ubicacion: string,
  stockTransitoByCn?: Record<string, number>,
  options?: { createIfMissing?: boolean }
): Promise<number> {
  if (isAlmacenArea(area) && !ubicacionAlmacenUsaRecuentoStock(ubicacion)) {
    return 0;
  }

  const etiqueta = nombrePropuestaUbicacion(ubicacion);
  let propuesta = await getBorradorPropuestaAlmacenPorNombre(area, importacionId, etiqueta);
  if (!propuesta) {
    if (options?.createIfMissing !== true) return 0;
    propuesta = await crearPropuesta(area, importacionId, etiqueta);
  }

  const filas = await getRecuentoConStockParaPropuesta(importacionId, area, ubicacion);
  let transito = stockTransitoByCn ?? {};
  if (filas.length > 0 && Object.keys(transito).length === 0) {
    try {
      const transitoUnidades = await loadCantidadTransitoByCn(filas.map((r) => r.cn));
      transito = buildStockTransitoCajasByCn(
        transitoUnidades,
        filas.map((r) => ({ cn: r.cn, unidadesPorCaja: Number(r.unidades_por_caja) }))
      );
    } catch {
      transito = {};
    }
  }

  return reemplazarLineasPropuestaDesdeRecuento(
    propuesta.id,
    importacionId,
    area,
    transito,
    ubicacion
  );
}

export async function syncTodasPropuestasUbicacionDesdeRecuento(
  area: string,
  importacionId: number,
  options?: { createIfMissing?: boolean }
): Promise<void> {
  await eliminarBorradorPropuestaSinEtiqueta(area, importacionId);
  const ubicacionesRecuento = await listUbicacionesConStockEnRecuento(importacionId, area);
  const ubicaciones = isAlmacenArea(area)
    ? ubicacionesRecuento.filter((ubicacion) =>
        ubicacionAlmacenUsaRecuentoStock(ubicacion)
      )
    : ubicacionesRecuento;
  if (ubicaciones.length === 0) return;

  const todasFilas = await getRecuentoConStockParaPropuesta(importacionId, area);
  let stockTransitoByCn: Record<string, number> = {};
  if (todasFilas.length > 0) {
    try {
      const transitoUnidades = await loadCantidadTransitoByCn(todasFilas.map((r) => r.cn));
      stockTransitoByCn = buildStockTransitoCajasByCn(
        transitoUnidades,
        todasFilas.map((r) => ({ cn: r.cn, unidadesPorCaja: Number(r.unidades_por_caja) }))
      );
    } catch {
      stockTransitoByCn = {};
    }
  }

  for (const ubicacion of ubicaciones) {
    await syncPropuestaUbicacionDesdeRecuento(
      area,
      importacionId,
      ubicacion,
      stockTransitoByCn,
      options
    );
  }
}

export async function recuentoTieneTodosLosBloquesTramitados(
  area: string,
  importacionStockId: number
): Promise<boolean> {
  const bloques = await listBloquesPropuestaRecuento(area, importacionStockId);
  return bloques.length > 0 && bloques.every((bloque) => bloque.estado === 'tramitada');
}

export async function abrirPropuestaUbicacionDesdeRecuento(
  area: string,
  importacionId: number,
  ubicacion: string
): Promise<PropuestaCabecera> {
  if (isAlmacenArea(area) && !ubicacionAlmacenUsaRecuentoStock(ubicacion)) {
    throw new Error('Esta ubicación de Almacén utiliza pedido directo.');
  }

  const etiqueta = nombrePropuestaUbicacion(ubicacion);
  const existente = await getUltimaPropuestaPorNombre(area, importacionId, etiqueta);
  if (existente) {
    if (existente.estado === 'borrador') {
      const lineas = await getLineasPropuesta(existente.id);
      if (lineas.length === 0) {
        await syncPropuestaUbicacionDesdeRecuento(area, importacionId, ubicacion);
      }
    }
    return existente;
  }

  const propuesta = await crearPropuesta(area, importacionId, etiqueta);
  await syncPropuestaUbicacionDesdeRecuento(area, importacionId, ubicacion);
  return propuesta;
}

export async function getRecuentoInactivosParaVisualizacion(
  importacionId: number,
  area: string,
  ubicacion?: string | null
) {
  const sql = getDb();
  const rows = (await sql`
    SELECT
      sr.id, sr.cn, sr.stock_unidades,
      m.nombre, m.principio_activo, m.unidades_por_caja, m.ubicacion,
      so.stock_minimo, so.punto_pedido, so.stock_maximo
    FROM stock_registros sr
    INNER JOIN medicamentos m ON m.cn = sr.cn AND m.area = ${area} AND m.activo = false
    LEFT JOIN stock_objetivo so ON so.cn = sr.cn
    WHERE sr.importacion_id = ${importacionId}
    ORDER BY sr.cn ASC, sr.id DESC;
  `) as Array<{
    id: number; cn: string; stock_unidades: string;
    nombre: string; principio_activo: string | null; unidades_por_caja: number; ubicacion: string | null;
    stock_minimo: number | null; punto_pedido: number | null; stock_maximo: number | null;
  }>;

  const normalizedRows = rows.map((row) => ({
    ...row,
    stock_cajas: stockCajasDesdeUnidades(
      Number(row.stock_unidades),
      Number(row.unidades_por_caja)
    ),
  }));
  const dedup = new Map<string, typeof normalizedRows[number]>();
  for (const row of normalizedRows) {
    if (!dedup.has(row.cn)) dedup.set(row.cn, row);
  }
  const uniqueRows = [...dedup.values()].sort((a, b) =>
    sortByPrincipioNombre(
      { cn: a.cn, principioActivo: a.principio_activo, nombre: a.nombre },
      { cn: b.cn, principioActivo: b.principio_activo, nombre: b.nombre }
    )
  );

  if (!ubicacion?.trim()) return uniqueRows;

  const ubicacionKey = normalizeUbicacionKey(ubicacion);
  return uniqueRows.filter((row) => normalizeUbicacionKey(row.ubicacion) === ubicacionKey);
}

function sortLineasPropuestaUI(a: PropuestaLineaUI, b: PropuestaLineaUI): number {
  const nameA = (a.principioActivo ?? a.nombreMedicamento ?? a.cn).trim();
  const nameB = (b.principioActivo ?? b.nombreMedicamento ?? b.cn).trim();
  return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
}

/** Todas las áreas: líneas activas pedibles + inactivas del recuento en solo lectura. */
export async function buildLineasPropuestaParaUi(
  propuestaId: number,
  importacionId: number,
  area: string,
  propuestaEstado: string,
  stockTransitoByCn: Record<string, number>,
  ubicacion?: string | null
): Promise<PropuestaLineaUI[]> {
  const activas = await getLineasPropuesta(propuestaId);
  const inactivas = await getRecuentoInactivosParaVisualizacion(importacionId, area, ubicacion);

  const activasUi: PropuestaLineaUI[] = activas.map((linea) => ({
    ...linea,
    // Usar el snapshot guardado para que el borrador muestre el tránsito del momento
    // en que se creó/guardó. El tránsito en vivo se usa solo si no hay snapshot.
    stockTransito: Number(linea.stockTransito ?? stockTransitoByCn[linea.cn] ?? 0),
    activo: true,
    editable: propuestaEstado === 'borrador',
  }));

  const inactivasUi: PropuestaLineaUI[] = inactivas.map((r, idx) => {
    const stockActual = normalizeStockCajas(Number(r.stock_cajas));
    const stockMinimo = normalizeNivelStock(Number(r.stock_minimo ?? 0));
    const puntoPedido = normalizeNivelStock(Number(r.punto_pedido ?? 0));
    const stockMaximo = normalizeNivelStock(Number(r.stock_maximo ?? r.stock_minimo ?? 0));
    return {
      id: -(idx + 1),
      cn: r.cn,
      principioActivo: r.principio_activo,
      nombreMedicamento: r.nombre,
      unidadesPorCaja: num(r.unidades_por_caja) > 0 ? num(r.unidades_por_caja) : 1,
      stockActual,
      stockTransito: 0,
      stockMinimoSnap: stockMinimo,
      puntoPedidoSnap: puntoPedido,
      stockMaximoSnap: stockMaximo,
      cajasPropuestas: 0,
      cajasValidadas: null,
      motivoAjuste: null,
      motivoAjusteOtro: null,
      ajustado: false,
      proveedorLocal: false,
      activo: false,
      editable: false,
    };
  });

  return [...activasUi, ...inactivasUi].sort(sortLineasPropuestaUI);
}

export async function insertarLineasPropuesta(
  propuestaId: number,
  area: string,
  rows: Array<{
    cn: string; nombre: string; unidadesPorCaja: number; stockCajas: number;
    stockMinimo: number; puntoPedido: number; stockMaximo: number; stockTransito: number;
  }>
): Promise<void> {
  const sql = getDb();
  for (const r of rows) {
    const stockCajas = normalizeStockCajas(r.stockCajas);
    const stockMinimo = normalizeNivelStock(r.stockMinimo);
    const puntoPedido = normalizeNivelStock(r.puntoPedido);
    const stockMaximo = normalizeNivelStock(r.stockMaximo);
    const stockTransito = normalizeStockCajas(r.stockTransito);
    const cajasPropuestas = normalizePedidoCajas(
      calcularCajasPropuestas(
        stockCajas,
        puntoPedido,
        stockMaximo,
        stockTransito,
        r.unidadesPorCaja
      )
    );
    await sql`
      INSERT INTO propuestas_lineas (
        propuesta_id, cn, nombre_medicamento, unidades_por_caja,
        stock_actual, stock_transito_snap, stock_minimo_snap, punto_pedido_snap, stock_maximo_snap, stock_objetivo_snap,
        cajas_propuestas, cajas_validadas, ajustado
      ) VALUES (
        ${propuestaId}, ${r.cn}, ${r.nombre}, ${r.unidadesPorCaja},
        ${stockCajas}, ${stockTransito}, ${stockMinimo}, ${puntoPedido}, ${stockMaximo}, ${stockMaximo},
        ${cajasPropuestas}, ${cajasPropuestas}, false
      );
    `;
  }
}

export async function reemplazarLineasPropuestaDesdeRecuento(
  propuestaId: number,
  importacionId: number,
  area: string,
  stockTransitoByCn: Record<string, number>,
  ubicacion?: string | null
): Promise<number> {
  const sql = getDb();
  const filas = await getRecuentoConStockParaPropuesta(importacionId, area, ubicacion);

  await sql`DELETE FROM propuestas_lineas WHERE propuesta_id = ${propuestaId};`;
  if (filas.length === 0) return 0;

  for (const r of filas) {
    const unidadesPorCaja = Number(r.unidades_por_caja);
    const stockTransito = normalizeStockCajas(Number(stockTransitoByCn[r.cn] ?? 0));
    const stockMinimo = normalizeNivelStock(Number(r.stock_minimo ?? 0));
    const puntoPedido = normalizeNivelStock(Number(r.punto_pedido ?? 0));
    const stockMaximo = normalizeNivelStock(Number(r.stock_maximo ?? r.stock_minimo ?? 0));
    const stockActual = normalizeStockCajas(Number(r.stock_cajas));
    const cajasPropuestas = normalizePedidoCajas(
      calcularCajasPropuestas(
        stockActual,
        puntoPedido,
        stockMaximo,
        stockTransito,
        unidadesPorCaja
      )
    );

    await sql`
      INSERT INTO propuestas_lineas (
        propuesta_id, cn, nombre_medicamento, unidades_por_caja,
        stock_actual, stock_transito_snap, stock_minimo_snap, punto_pedido_snap, stock_maximo_snap, stock_objetivo_snap,
        cajas_propuestas, cajas_validadas, ajustado
      ) VALUES (
        ${propuestaId}, ${r.cn}, ${r.nombre}, ${unidadesPorCaja},
        ${stockActual}, ${stockTransito}, ${stockMinimo}, ${puntoPedido}, ${stockMaximo}, ${stockMaximo},
        ${cajasPropuestas}, ${cajasPropuestas}, false
      );
    `;
  }

  return filas.length;
}

export async function actualizarStockTransitoSnapshot(
  propuestaId: number,
  stockTransitoByCn: Record<string, number>
): Promise<void> {
  const sql = getDb();
  const cns = Object.keys(stockTransitoByCn);
  if (cns.length === 0) return;

  for (const cn of cns) {
    const value = normalizeStockCajas(Number(stockTransitoByCn[cn] ?? 0));
    await sql`
      UPDATE propuestas_lineas
      SET stock_transito_snap = ${value}
      WHERE propuesta_id = ${propuestaId} AND cn = ${cn};
    `;
  }
}

export async function getLineaConPropuesta(lineaId: number): Promise<{
  id: number; cajasPropuestas: number; propuestaId: number;
  estadoPropuesta: string; areaPropuesta: string; unidadesPorCaja: number;
} | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT pl.id, pl.cajas_propuestas, pl.propuesta_id, pl.unidades_por_caja,
           p.estado AS estado_propuesta, p.area AS area_propuesta
    FROM propuestas_lineas pl
    INNER JOIN propuestas p ON p.id = pl.propuesta_id
    WHERE pl.id = ${lineaId}
    LIMIT 1;
  `) as Array<{
    id: number; cajas_propuestas: number; propuesta_id: number;
    unidades_por_caja: number; estado_propuesta: string; area_propuesta: string;
  }>;
  const r = rows[0];
  if (!r) return null;
  return {
    id: num(r.id), cajasPropuestas: num(r.cajas_propuestas),
    propuestaId: num(r.propuesta_id), unidadesPorCaja: num(r.unidades_por_caja),
    estadoPropuesta: r.estado_propuesta, areaPropuesta: r.area_propuesta,
  };
}

export async function actualizarLineaPropuesta(
  lineaId: number,
  propuestaId: number,
  area: string,
  cajasValidadas: number,
  unidadesFinal: number,
  motivoAjuste: string | null,
  motivoAjusteOtro: string | null,
  ajustado: boolean,
  proveedorLocal?: boolean,
): Promise<void> {
  const sql = getDb();
  const cajas = normalizePedidoCajas(cajasValidadas);
  if (proveedorLocal !== undefined) {
    await sql`
      UPDATE propuestas_lineas
      SET cajas_validadas = ${cajas},
          motivo_ajuste = ${motivoAjuste},
          motivo_ajuste_otro = ${motivoAjusteOtro},
          ajustado = ${ajustado},
          unidades_final = ${unidadesFinal},
          proveedor_local = ${proveedorLocal},
          requiere_revision_cn = FALSE
      WHERE id = ${lineaId} AND propuesta_id = ${propuestaId};
    `;
  } else {
    await sql`
      UPDATE propuestas_lineas
      SET cajas_validadas = ${cajas},
          motivo_ajuste = ${motivoAjuste},
          motivo_ajuste_otro = ${motivoAjusteOtro},
          ajustado = ${ajustado},
          unidades_final = ${unidadesFinal},
          requiere_revision_cn = FALSE
      WHERE id = ${lineaId} AND propuesta_id = ${propuestaId};
    `;
  }
}

export async function actualizarCalculoAutomaticoLineaPropuesta(
  lineaId: number,
  propuestaId: number,
  cajasPropuestas: number,
  unidadesPorCaja: number,
  area: string
): Promise<void> {
  const sql = getDb();
  const cajas = normalizePedidoCajas(cajasPropuestas);
  await sql`
    UPDATE propuestas_lineas
    SET cajas_propuestas = ${cajas},
        cajas_validadas = ${cajas},
        ajustado = false,
        motivo_ajuste = NULL,
        motivo_ajuste_otro = NULL,
        unidades_final = ${Math.round(cajas * unidadesPorCaja)}
    WHERE id = ${lineaId} AND propuesta_id = ${propuestaId};
  `;
}

export async function getPropuestaById(propuestaId: number): Promise<{
  id: number; area: string; estado: string;
  importacionStockId: number | null; fechaGeneracion: string;
  tramitadaEn: string | null;
  observaciones: string | null;
} | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, area, estado, importacion_stock_id, fecha_generacion::text, tramitada_en::text, observaciones
    FROM propuestas WHERE id = ${propuestaId} LIMIT 1;
  `) as Array<{
    id: number; area: string; estado: string;
    importacion_stock_id: number | null; fecha_generacion: string;
    tramitada_en: string | null; observaciones: string | null;
  }>;
  const r = rows[0];
  if (!r) return null;
  return {
    id: num(r.id), area: r.area, estado: r.estado,
    importacionStockId: r.importacion_stock_id ? num(r.importacion_stock_id) : null,
    fechaGeneracion: r.fecha_generacion,
    tramitadaEn: r.tramitada_en,
    observaciones: r.observaciones,
  };
}

export type SincronizarCatalogoPropuestaResult = {
  lineas: number;
  cambiosUdsCaja: number;
  omitidas: number;
};

/** Relee uds/caja y nombre del catálogo; recalcula unidades_final sin cambiar cajas. */
export async function sincronizarPropuestaDesdeCatalogoAlmacen(
  propuestaId: number,
  area: string
): Promise<SincronizarCatalogoPropuestaResult> {
  const propuesta = await getPropuestaById(propuestaId);
  if (!propuesta) {
    throw new Error('Propuesta no encontrada.');
  }
  if (propuesta.area !== area) {
    throw new Error('No autorizado para esta propuesta.');
  }
  if (propuesta.estado !== 'borrador') {
    throw new Error('Solo se puede actualizar desde catálogo en propuestas en borrador.');
  }

  const lineas = await getLineasPropuesta(propuestaId);
  if (lineas.length === 0) {
    return { lineas: 0, cambiosUdsCaja: 0, omitidas: 0 };
  }

  const sql = getDb();
  const cns = lineas.map((l) => l.cn);
  const meds = (await sql`
    SELECT cn, nombre, unidades_por_caja
    FROM medicamentos
    WHERE area = ${area} AND cn = ANY(${cns});
  `) as Array<{ cn: string; nombre: string; unidades_por_caja: number }>;

  const medByCn = new Map(
    meds.map((m) => [m.cn, { nombre: m.nombre?.trim() || '', unidadesPorCaja: Math.max(1, num(m.unidades_por_caja)) }])
  );

  let cambiosUdsCaja = 0;
  let omitidas = 0;

  for (const linea of lineas) {
    const med = medByCn.get(linea.cn);
    if (!med) {
      omitidas += 1;
      continue;
    }

    const cajas = normalizePedidoCajas(
      linea.cajasValidadas ?? linea.cajasPropuestas
    );
    const unidadesFinal = Math.round(cajas * med.unidadesPorCaja);
    const nombre = med.nombre || linea.nombreMedicamento;

    if (med.unidadesPorCaja !== linea.unidadesPorCaja) {
      cambiosUdsCaja += 1;
    }

    await sql`
      UPDATE propuestas_lineas
      SET
        unidades_por_caja = ${med.unidadesPorCaja},
        nombre_medicamento = ${nombre},
        unidades_final = ${unidadesFinal}
      WHERE id = ${linea.id} AND propuesta_id = ${propuestaId};
    `;
  }

  return {
    lineas: lineas.length - omitidas,
    cambiosUdsCaja,
    omitidas,
  };
}

export async function tramitarPropuesta(
  propuestaId: number,
  importacionStockId: number,
  area?: string
): Promise<{ recuentoGenerado: boolean }> {
  const sql = getDb();

  const lineas = (await sql`
    SELECT id, cajas_propuestas, cajas_validadas, unidades_por_caja,
           COALESCE(requiere_revision_cn, FALSE) AS requiere_revision_cn
    FROM propuestas_lineas WHERE propuesta_id = ${propuestaId};
  `) as Array<{
    id: number; cajas_propuestas: number;
    cajas_validadas: number | null; unidades_por_caja: number;
    requiere_revision_cn: boolean;
  }>;

  if (lineas.some((linea) => linea.requiere_revision_cn)) {
    throw new Error(
      'Hay líneas con un CN intercambiado. Revisa y guarda sus cantidades antes de tramitar.',
    );
  }

  for (const l of lineas) {
    const cajasFinales = normalizePedidoCajas(
      num(l.cajas_validadas ?? l.cajas_propuestas)
    );
    await sql`
      UPDATE propuestas_lineas
      SET cajas_validadas = ${cajasFinales},
          unidades_final = ${Math.round(cajasFinales * num(l.unidades_por_caja))}
      WHERE id = ${num(l.id)} AND propuesta_id = ${propuestaId};
    `;
  }

  await sql`
    UPDATE propuestas
    SET estado = 'tramitada', tramitada_en = now(), validada_en = now()
    WHERE id = ${propuestaId};
  `;

  const recuentoGenerado = Boolean(
    area &&
      (await recuentoTieneTodosLosBloquesTramitados(area, importacionStockId)) &&
      (await marcarRecuentoComoGenerado(importacionStockId, area, propuestaId)),
  );

  return { recuentoGenerado };
}

export async function deshacerPropuesta(
  propuestaId: number,
  importacionStockId: number,
  area?: string
): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE propuestas
    SET estado = 'borrador', tramitada_en = null, validada_en = null
    WHERE id = ${propuestaId};
  `;
  await sql`
    UPDATE importaciones_stock
    SET
      estado = CASE
        WHEN origen = ${ORIGEN_PEDIDO_ALMACEN} THEN ${ESTADO_PEDIDO_ALMACEN}
        WHEN area = ${ALMACEN_AREA} THEN 'validado'
        ELSE 'pendiente'
      END,
      generado_en = CASE
        WHEN origen = ${ORIGEN_PEDIDO_ALMACEN} OR area <> ${ALMACEN_AREA} THEN null
        ELSE generado_en
      END,
      propuesta_id = null
    WHERE id = ${importacionStockId};
  `;
}

export type EliminarPropuestaResult =
  | { ok: true; lineasEliminadas: number }
  | { ok: false; reason: 'not_found' };

export async function eliminarPropuestaById(
  propuestaId: number,
  area: string
): Promise<EliminarPropuestaResult> {
  const sql = getDb();
  const propuestaRows = (await sql`
    SELECT id
    FROM propuestas
    WHERE id = ${propuestaId} AND area = ${area}
    LIMIT 1;
  `) as Array<{ id: number }>;

  if (propuestaRows.length === 0) {
    return { ok: false, reason: 'not_found' };
  }

  const lineasEliminadas = (await sql`
    DELETE FROM propuestas_lineas
    WHERE propuesta_id = ${propuestaId}
    RETURNING id;
  `) as Array<{ id: number }>;

  await sql`
    UPDATE importaciones_stock
    SET propuesta_id = NULL
    WHERE propuesta_id = ${propuestaId} AND area = ${area};
  `;

  await sql`
    DELETE FROM propuestas
    WHERE id = ${propuestaId} AND area = ${area};
  `;

  return { ok: true, lineasEliminadas: lineasEliminadas.length };
}

export async function getLineasParaExcel(propuestaId: number): Promise<Array<{
  cn: string; nombreMedicamento: string | null; principioActivo: string | null;
  cajasPropuestas: number; cajasValidadas: number | null; unidadesPorCaja: number;
  proveedorLocal: boolean;
}>> {
  const lineas = await getLineasPropuesta(propuestaId);
  return lineas.map((linea) => ({
    cn: linea.cn,
    nombreMedicamento: linea.nombreMedicamento,
    principioActivo: linea.principioActivo,
    cajasPropuestas: linea.cajasPropuestas,
    cajasValidadas: linea.cajasValidadas,
    unidadesPorCaja: linea.unidadesPorCaja,
    proveedorLocal: linea.proveedorLocal,
  }));
}

export type PropuestaResumen = {
  id: number;
  estado: string;
  fechaGeneracion: string;
  tramitadaEn: string | null;
  totalLineas: number;
  recuentoId: number | null;
  recuentoFecha: string | null;
  recuentoOrigen: string | null;
  excelGeneradoEn: string | null;
  observaciones: string | null;
};

export async function listPropuestasByArea(area: string): Promise<PropuestaResumen[]> {
  const sql = getDb();
  const rows = (await sql`
    SELECT
      p.id,
      p.estado,
      p.fecha_generacion::text   AS fecha_generacion,
      p.tramitada_en::text       AS tramitada_en,
      p.excel_generado_en::text  AS excel_generado_en,
      p.observaciones,
      p.importacion_stock_id     AS recuento_id,
      i.fecha_recuento::text     AS recuento_fecha,
      i.origen                   AS recuento_origen,
      COUNT(DISTINCT pl.cn)::int AS total_lineas
    FROM propuestas p
    LEFT JOIN importaciones_stock i ON i.id = p.importacion_stock_id
    LEFT JOIN propuestas_lineas pl ON pl.propuesta_id = p.id
    WHERE p.area = ${area}
    GROUP BY p.id, i.fecha_recuento, i.origen, p.observaciones
    ORDER BY p.id DESC
    LIMIT 50;
  `) as Array<{
    id: number; estado: string; fecha_generacion: string;
    tramitada_en: string | null; excel_generado_en: string | null;
    observaciones: string | null;
    recuento_id: number | null; recuento_fecha: string | null;
    recuento_origen: string | null; total_lineas: number;
  }>;
  return rows.map(r => ({
    id: num(r.id),
    estado: r.estado,
    fechaGeneracion: r.fecha_generacion,
    tramitadaEn: r.tramitada_en,
    excelGeneradoEn: r.excel_generado_en,
    observaciones: r.observaciones,
    recuentoId: r.recuento_id ? num(r.recuento_id) : null,
    recuentoFecha: r.recuento_fecha,
    recuentoOrigen: r.recuento_origen,
    totalLineas: num(r.total_lineas),
  }));
}

export async function marcarExcelGenerado(propuestaId: number, area: string): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE propuestas SET excel_generado_en = now()
    WHERE id = ${propuestaId} AND area = ${area};
  `;
}

// ---------------------------------------------------------------------------
// Resumen operativo para el panel Inicio
// ---------------------------------------------------------------------------
export type ResumenOperativo = {
  recuentosPendientes: number;
  propuestasBorrador: number;
  ultimaPropuestaTramitadaEn: string | null;
  ultimoRecuentoFecha: string | null;
  bajoMinimo: number;     // CNs cuyo stock en cajas < stock_minimo en el último recuento
  bajoOPunto: number;     // CNs cuyo stock_unidades <= punto_pedido en el último recuento
};

export type MedicamentoBajoMinimo = {
  cn: string;
  principioActivo: string | null;
  nombre: string;
  stockActualCajas: number;
  stockActualUnidades: number;
  stockMinimo: number;
  puntoPedido: number;
};

export async function getMedicamentosBajoMinimo(area: string): Promise<MedicamentoBajoMinimo[]> {
  const sql = getDb();
  const rows = (await sql`
    WITH ultimo AS (
      SELECT id
      FROM importaciones_stock
      WHERE area = ${area}
      ORDER BY id DESC
      LIMIT 1
    )
    SELECT
      sr.cn,
      m.principio_activo,
      m.nombre,
      sr.stock_cajas,
      sr.stock_unidades,
      so.stock_minimo,
      so.punto_pedido
    FROM stock_registros sr
    JOIN ultimo u ON sr.importacion_id = u.id
    JOIN medicamentos m ON m.cn = sr.cn AND m.area = ${area} AND m.activo = TRUE
    JOIN stock_objetivo so ON so.cn = sr.cn
    WHERE sr.stock_cajas::numeric < so.stock_minimo
    ORDER BY m.principio_activo ASC NULLS LAST, m.nombre ASC;
  `) as Array<{
    cn: string;
    principio_activo: string | null;
    nombre: string;
    stock_cajas: number | string;
    stock_unidades: number | string;
    stock_minimo: number | string;
    punto_pedido: number | string;
  }>;

  return rows.map((r) => ({
    cn: r.cn,
    principioActivo: r.principio_activo,
    nombre: r.nombre,
    stockActualCajas: num(r.stock_cajas),
    stockActualUnidades: num(r.stock_unidades),
    stockMinimo: num(r.stock_minimo),
    puntoPedido: num(r.punto_pedido),
  }));
}

export async function getResumenOperativo(area: string): Promise<ResumenOperativo> {
  const sql = getDb();

  // Recuentos pendientes y última fecha de recuento
  const recuentos = (await sql`
    SELECT
      COUNT(*) FILTER (WHERE estado = 'pendiente')::int AS pendientes,
      MAX(fecha_recuento)::text AS ultimo_recuento
    FROM importaciones_stock
    WHERE area = ${area}
      AND origen <> ${ORIGEN_PEDIDO_ALMACEN};
  `) as Array<{ pendientes: number; ultimo_recuento: string | null }>;

  // Propuestas en borrador y última propuesta tramitada
  const propuestas = (await sql`
    SELECT
      COUNT(*) FILTER (WHERE estado = 'borrador')::int   AS borradores,
      MAX(tramitada_en) FILTER (WHERE estado = 'tramitada')::text AS ultima_tramitada
    FROM propuestas
    WHERE area = ${area};
  `) as Array<{ borradores: number; ultima_tramitada: string | null }>;

  // Alertas de stock: comparar el stock del último recuento (pendiente o tramitado) con stock_objetivo
  const alertas = (await sql`
    WITH ultimo AS (
      SELECT id FROM importaciones_stock
      WHERE area = ${area}
        AND origen <> ${ORIGEN_PEDIDO_ALMACEN}
      ORDER BY id DESC LIMIT 1
    )
    SELECT
      COUNT(*) FILTER (WHERE sr.stock_cajas::numeric < so.stock_minimo)::int   AS bajo_minimo,
      COUNT(*) FILTER (WHERE sr.stock_cajas::numeric <= so.punto_pedido)::int  AS bajo_o_punto
    FROM stock_registros sr
    JOIN ultimo u ON sr.importacion_id = u.id
    JOIN medicamentos m ON m.cn = sr.cn AND m.area = ${area} AND m.activo = TRUE
    JOIN stock_objetivo so ON so.cn = sr.cn;
  `) as Array<{ bajo_minimo: number; bajo_o_punto: number }>;

  return {
    recuentosPendientes: num(recuentos[0]?.pendientes ?? 0),
    propuestasBorrador:  num(propuestas[0]?.borradores ?? 0),
    ultimaPropuestaTramitadaEn: propuestas[0]?.ultima_tramitada ?? null,
    ultimoRecuentoFecha: recuentos[0]?.ultimo_recuento ?? null,
    bajoMinimo:   num(alertas[0]?.bajo_minimo ?? 0),
    bajoOPunto:   num(alertas[0]?.bajo_o_punto ?? 0),
  };
}

// ---------------------------------------------------------------------------
// PEDIDO ALMACÉN (propuesta directa sin recuento de stock)
// ---------------------------------------------------------------------------
export async function getPedidoAlmacenPendiente(area: string): Promise<RecuentoCabecera | null> {
  const sql = getDb();
  // Las sesiones antiguas se creaban como recuentos pendientes. Se migran a
  // un estado técnico propio para que nunca bloqueen ni aparezcan en Stock.
  await sql`
    UPDATE importaciones_stock
    SET estado = ${ESTADO_PEDIDO_ALMACEN}
    WHERE area = ${area}
      AND origen = ${ORIGEN_PEDIDO_ALMACEN}
      AND estado = 'pendiente'
  `;
  const rows = (await sql`
    SELECT id, area, estado, origen, fecha_recuento::text, importado_en::text, total_lineas, propuesta_id
    FROM importaciones_stock
    WHERE area = ${area}
      AND estado = ${ESTADO_PEDIDO_ALMACEN}
      AND origen = ${ORIGEN_PEDIDO_ALMACEN}
    ORDER BY id DESC LIMIT 1;
  `) as Array<{
    id: number; area: string; estado: string; origen: string;
    fecha_recuento: string; importado_en: string; total_lineas: number; propuesta_id: number | null;
  }>;

  const r = rows[0];
  if (!r) return null;
  return {
    id: num(r.id), area: r.area, estado: r.estado, origen: r.origen,
    fechaRecuento: r.fecha_recuento, importadoEn: r.importado_en,
    totalLineas: num(r.total_lineas), propuestaId: r.propuesta_id != null ? num(r.propuesta_id) : null,
  };
}

export async function ensureSesionPedidoAlmacen(area: string): Promise<{
  importacionId: number;
}> {
  const pendiente = await getPedidoAlmacenPendiente(area);
  if (pendiente) {
    return { importacionId: pendiente.id };
  }

  const fechaRecuento = new Date().toISOString().slice(0, 10);
  const importacionId = await crearRecuento({
    area,
    origen: ORIGEN_PEDIDO_ALMACEN,
    fechaRecuento,
    ficheroNombre: 'APP Pedido Almacén',
    totalLineas: 0,
    estado: ESTADO_PEDIDO_ALMACEN,
  });
  return { importacionId };
}

export async function getCantidadesPedidoAlmacen(propuestaId: number): Promise<Record<string, number>> {
  const sql = getDb();
  const rows = (await sql`
    SELECT cn, COALESCE(cajas_validadas, cajas_propuestas) AS cajas
    FROM propuestas_lineas
    WHERE propuesta_id = ${propuestaId};
  `) as Array<{ cn: string; cajas: string | number }>;

  const map: Record<string, number> = {};
  for (const row of rows) {
    map[row.cn] = num(row.cajas);
  }
  return map;
}

export async function getCantidadesPedidoAlmacenParaVista(
  area: string,
  importacionId: number,
  ubicacion: string,
  letra: string | null
): Promise<Record<string, number>> {
  const grupoLetras =
    ubicacionAlmacenUsaLetras(ubicacion) && letra
      ? grupoLetrasAlmacenFarFromLetter(letra)
      : null;
  const etiqueta = nombrePropuestaAlmacen(ubicacion, grupoLetras);
  const propuesta = await getBorradorPropuestaAlmacenPorNombre(area, importacionId, etiqueta);
  if (!propuesta) return {};
  return getCantidadesPedidoAlmacen(propuesta.id);
}

export async function eliminarLineaPedidoAlmacenPorCnEnSesion(
  importacionId: number,
  cn: string
): Promise<boolean> {
  const sql = getDb();
  const deleted = (await sql`
    DELETE FROM propuestas_lineas pl
    USING propuestas p
    WHERE pl.propuesta_id = p.id
      AND p.importacion_stock_id = ${importacionId}
      AND pl.cn = ${cn}
    RETURNING pl.id;
  `) as Array<{ id: number }>;
  return deleted.length > 0;
}

export async function eliminarLineaPedidoAlmacenPorCn(
  propuestaId: number,
  cn: string
): Promise<boolean> {
  const sql = getDb();
  const deleted = (await sql`
    DELETE FROM propuestas_lineas
    WHERE propuesta_id = ${propuestaId} AND cn = ${cn}
    RETURNING id;
  `) as Array<{ id: number }>;
  return deleted.length > 0;
}

export async function upsertLineasPedidoAlmacen(
  propuestaId: number,
  lineas: Array<{
    cn: string;
    nombre: string;
    unidadesPorCaja: number;
    cajasPedidas: number;
    stockMinimo: number | null;
    puntoPedido: number | null;
    stockMaximo: number | null;
  }>
): Promise<{ upserted: number; eliminadas: number }> {
  const sql = getDb();
  let upserted = 0;
  let eliminadas = 0;

  for (const linea of lineas) {
    const existing = (await sql`
      SELECT id FROM propuestas_lineas
      WHERE propuesta_id = ${propuestaId} AND cn = ${linea.cn}
      LIMIT 1;
    `) as Array<{ id: number }>;

    if (linea.cajasPedidas <= 0) {
      if (existing[0]) {
        await sql`DELETE FROM propuestas_lineas WHERE id = ${existing[0].id};`;
        eliminadas += 1;
      }
      continue;
    }

    const cajasPedidas = normalizePedidoCajas(linea.cajasPedidas);
    const stockMin = normalizeNivelStock(linea.stockMinimo ?? 0);
    const punto = normalizeNivelStock(linea.puntoPedido ?? 0);
    const stockMax = normalizeNivelStock(linea.stockMaximo ?? 0);
    const unidadesFinal = cajasPedidas * Math.trunc(linea.unidadesPorCaja);

    if (existing[0]) {
      await sql`
        UPDATE propuestas_lineas
        SET
          nombre_medicamento = ${linea.nombre},
          unidades_por_caja = ${linea.unidadesPorCaja},
          stock_actual = 0,
          stock_transito_snap = 0,
          stock_minimo_snap = ${stockMin},
          punto_pedido_snap = ${punto},
          stock_maximo_snap = ${stockMax},
          stock_objetivo_snap = ${stockMax},
          cajas_propuestas = ${cajasPedidas},
          cajas_validadas = ${cajasPedidas},
          unidades_final = ${unidadesFinal},
          ajustado = true,
          motivo_ajuste = NULL,
          motivo_ajuste_otro = NULL
        WHERE id = ${existing[0].id};
      `;
    } else {
      await sql`
        INSERT INTO propuestas_lineas (
          propuesta_id, cn, nombre_medicamento, unidades_por_caja,
          stock_actual, stock_transito_snap, stock_minimo_snap, punto_pedido_snap, stock_maximo_snap, stock_objetivo_snap,
          cajas_propuestas, cajas_validadas, unidades_final, ajustado
        ) VALUES (
          ${propuestaId}, ${linea.cn}, ${linea.nombre}, ${linea.unidadesPorCaja},
          0, 0, ${stockMin}, ${punto}, ${stockMax}, ${stockMax},
          ${cajasPedidas}, ${cajasPedidas}, ${unidadesFinal}, true
        );
      `;
    }
    upserted += 1;
  }

  return { upserted, eliminadas };
}

export async function recalcularTotalLineasPedidoAlmacen(importacionId: number): Promise<number> {
  const sql = getDb();
  const rows = (await sql`
    SELECT COUNT(*)::int AS total
    FROM propuestas_lineas pl
    INNER JOIN propuestas p ON p.id = pl.propuesta_id
    WHERE p.importacion_stock_id = ${importacionId}
      AND COALESCE(pl.cajas_validadas, pl.cajas_propuestas) > 0;
  `) as Array<{ total: number }>;
  const total = num(rows[0]?.total);
  await sql`
    UPDATE importaciones_stock
    SET total_lineas = ${total}
    WHERE id = ${importacionId};
  `;
  return total;
}
