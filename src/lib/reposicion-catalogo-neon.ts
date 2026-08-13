import { neon } from '@neondatabase/serverless';
import { getMedicamentoByCn } from '@/lib/catalogo-neon';

export const REPOSICION_AREAS = ['upe', 'oncologia'] as const;
export type ReposicionArea = typeof REPOSICION_AREAS[number];

export function isReposicionArea(area: string | null | undefined): area is ReposicionArea {
  return REPOSICION_AREAS.includes(area as ReposicionArea);
}

function getDb() {
  const url = process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Falta REALIZAR_PEDIDOS_DATABASE_URL para conectar a Neon.');
  return neon(url);
}

export type ReposicionCatalogoItem = {
  id: number;
  areaDestino: ReposicionArea;
  ubicacionDestino: string;
  codigo: string;
  cn: string | null;
  tipo: 'medicamento' | 'formula';
  areaOrigen: string | null;
  ubicacionOrigen: string | null;
  principioActivo: string | null;
  nombre: string;
  unidadesPorCaja: number;
  unidadPedido: 'cajas' | 'unidades';
  stockMaximo: number | null;
  puntoPedido: number | null;
  notas: string | null;
  activo: boolean;
  grupoIntercambioId: number | null;
};

let ensurePromise: Promise<void> | null = null;

export async function ensureReposicionCatalogoSchema(): Promise<void> {
  if (!ensurePromise) {
    const sql = getDb();
    ensurePromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS reposicion_catalogo (
          id                    SERIAL PRIMARY KEY,
          area_destino          TEXT NOT NULL,
          ubicacion_destino     TEXT NOT NULL,
          codigo                TEXT NOT NULL,
          cn                    TEXT,
          tipo                  TEXT NOT NULL DEFAULT 'medicamento',
          area_origen           TEXT,
          principio_activo      TEXT,
          nombre                TEXT NOT NULL,
          unidades_por_caja     INTEGER NOT NULL DEFAULT 1,
          unidad_pedido         TEXT NOT NULL DEFAULT 'cajas',
          stock_maximo          NUMERIC(14,4),
          punto_pedido          NUMERIC(14,4),
          notas                 TEXT,
          activo                BOOLEAN NOT NULL DEFAULT TRUE,
          grupo_intercambio_id  INTEGER,
          creado_en             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (area_destino, ubicacion_destino, codigo)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_reposicion_catalogo_area
        ON reposicion_catalogo (area_destino, activo, ubicacion_destino)
      `;
      await sql`ALTER TABLE reposicion_catalogo ADD COLUMN IF NOT EXISTS ubicacion_origen TEXT;`;
      await sql`
        INSERT INTO reposicion_catalogo (
          area_destino, ubicacion_destino, codigo, cn, tipo, area_origen,
          principio_activo, nombre, unidades_por_caja, unidad_pedido,
          stock_maximo, punto_pedido
        )
        SELECT
          'upe', COALESCE(NULLIF(BTRIM(m.ubicacion), ''), 'Sin ubicación'),
          m.cn, m.cn, 'medicamento', m.area, m.principio_activo, m.nombre,
          GREATEST(m.unidades_por_caja, 1), 'cajas', so.stock_maximo, so.punto_pedido
        FROM medicamentos m
        LEFT JOIN stock_objetivo so ON so.cn = m.cn
        WHERE m.area = 'upe' AND m.activo = TRUE
        ON CONFLICT (area_destino, ubicacion_destino, codigo) DO NOTHING
      `;
      const oncologiaSeeds = [
        ['Nevera NEA', '705605', 14, 8, 'cajas', null],
        ['Nevera NEA', '705607', 12, 8, 'cajas', null],
        ['Nevera NEA', '731332', 2, 1, 'cajas', null],
        ['Nevera NEA', '665973', 12, 6, 'cajas', null],
        ['Nevera NEA', '665971', 8, 6, 'cajas', null],
        ['Nevera NEA', '714133', 2, 1, 'cajas', null],
        ['Nevera NEA', '663010', 2, 1, 'cajas', null],
        ['Nevera NEA', '663007', 2, 1, 'cajas', null],
        ['Cajonera NEA', '688760', 4, 2, 'cajas', null],
        ['Cajonera NEA', '661560', 2, 1, 'cajas', 'Solamente presentación reenvasada'],
        ['Cajonera NEA', '030602', 30, 20, 'unidades', null],
        ['Cajonera NEA', '730111', 3, 1, 'cajas', null],
      ] as const;
      for (const [ubicacion, cn, stockMaximo, puntoPedido, unidad, notas] of oncologiaSeeds) {
        await sql`
          INSERT INTO reposicion_catalogo (
            area_destino, ubicacion_destino, codigo, cn, tipo, area_origen,
            principio_activo, nombre, unidades_por_caja, unidad_pedido,
            stock_maximo, punto_pedido, notas
          )
          SELECT
            'oncologia', ${ubicacion}, m.cn, m.cn, 'medicamento', m.area,
            m.principio_activo, m.nombre, GREATEST(m.unidades_por_caja, 1),
            ${unidad}, ${stockMaximo}, ${puntoPedido}, ${notas}
          FROM medicamentos m
          WHERE m.cn = ${cn}
          ON CONFLICT (area_destino, ubicacion_destino, codigo) DO NOTHING
        `;
      }
      await sql`
        INSERT INTO reposicion_catalogo (
          area_destino, ubicacion_destino, codigo, tipo, principio_activo,
          nombre, unidades_por_caja, unidad_pedido, stock_maximo, punto_pedido
        )
        VALUES (
          'oncologia', 'Cajonera NEA', 'FM-MUCOSITIS', 'formula',
          'SOLUCIÓN DE MUCOSITIS', 'SOLUCIÓN DE MUCOSITIS', 1, 'unidades', 3, 2
        )
        ON CONFLICT (area_destino, ubicacion_destino, codigo) DO NOTHING
      `;
      await sql`
        UPDATE reposicion_catalogo
        SET nombre = 'SOLUCIÓN DE MUCOSITIS',
            principio_activo = 'SOLUCIÓN DE MUCOSITIS'
        WHERE codigo = 'FM-MUCOSITIS'
          AND nombre <> 'SOLUCIÓN DE MUCOSITIS'
      `;
      await sql`
        UPDATE reposicion_catalogo rc
        SET ubicacion_origen = m.ubicacion
        FROM medicamentos m
        WHERE m.cn = rc.cn
          AND rc.ubicacion_origen IS DISTINCT FROM m.ubicacion
      `;
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  await ensurePromise;
}

function mapItem(row: Record<string, unknown>): ReposicionCatalogoItem {
  return {
    id: Number(row.id),
    areaDestino: String(row.area_destino) as ReposicionArea,
    ubicacionDestino: String(row.ubicacion_destino),
    codigo: String(row.codigo),
    cn: row.cn ? String(row.cn) : null,
    tipo: row.tipo === 'formula' ? 'formula' : 'medicamento',
    areaOrigen: row.area_origen ? String(row.area_origen) : null,
    ubicacionOrigen: row.ubicacion_origen ? String(row.ubicacion_origen) : null,
    principioActivo: row.principio_activo ? String(row.principio_activo) : null,
    nombre: String(row.nombre),
    unidadesPorCaja: Math.max(1, Number(row.unidades_por_caja) || 1),
    unidadPedido: row.unidad_pedido === 'unidades' ? 'unidades' : 'cajas',
    stockMaximo: row.stock_maximo == null ? null : Number(row.stock_maximo),
    puntoPedido: row.punto_pedido == null ? null : Number(row.punto_pedido),
    notas: row.notas ? String(row.notas) : null,
    activo: Boolean(row.activo),
    grupoIntercambioId: row.grupo_intercambio_id == null ? null : Number(row.grupo_intercambio_id),
  };
}

export async function listReposicionCatalogo(
  areaDestino: ReposicionArea,
  includeInactive = false,
): Promise<ReposicionCatalogoItem[]> {
  await ensureReposicionCatalogoSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT *
    FROM reposicion_catalogo
    WHERE area_destino = ${areaDestino}
      AND (${includeInactive} OR activo = TRUE)
    ORDER BY ubicacion_destino, principio_activo NULLS LAST, nombre, codigo
  `;
  return rows.map(mapItem);
}

export async function getReposicionCatalogoItem(
  id: number,
  areaDestino?: ReposicionArea,
): Promise<ReposicionCatalogoItem | null> {
  await ensureReposicionCatalogoSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT *
    FROM reposicion_catalogo
    WHERE id = ${id}
      AND (${areaDestino ?? null}::text IS NULL OR area_destino = ${areaDestino ?? null})
    LIMIT 1
  `;
  return rows[0] ? mapItem(rows[0]) : null;
}

export type ReposicionCatalogoInput = {
  areaDestino: ReposicionArea;
  ubicacionDestino: string;
  cn?: string | null;
  codigo?: string;
  tipo?: 'medicamento' | 'formula';
  nombre?: string;
  principioActivo?: string | null;
  unidadesPorCaja?: number;
  unidadPedido?: 'cajas' | 'unidades';
  stockMaximo?: number | null;
  puntoPedido?: number | null;
  notas?: string | null;
  activo?: boolean;
};

export async function upsertReposicionCatalogoItem(
  input: ReposicionCatalogoInput,
  id?: number,
): Promise<ReposicionCatalogoItem> {
  await ensureReposicionCatalogoSchema();
  const ubicacion = input.ubicacionDestino.trim();
  if (!ubicacion) throw new Error('La ubicación destino es obligatoria.');

  const tipo = input.tipo === 'formula' ? 'formula' : 'medicamento';
  const cn = input.cn?.trim() || null;
  let codigo = input.codigo?.trim() || cn || '';
  let areaOrigen: string | null = null;
  let ubicacionOrigen: string | null = null;
  let nombre = input.nombre?.trim() || '';
  let principioActivo = input.principioActivo?.trim() || null;
  let unidadesPorCaja = Math.max(1, Math.trunc(Number(input.unidadesPorCaja) || 1));

  if (tipo === 'medicamento') {
    if (!cn) throw new Error('El CN es obligatorio para un medicamento.');
    const medicamento = await getMedicamentoByCn(cn);
    if (!medicamento) throw new Error(`CN ${cn} no encontrado en ningún catálogo.`);
    codigo = cn;
    areaOrigen = medicamento.area;
    ubicacionOrigen = medicamento.ubicacion?.trim() || null;
    nombre = medicamento.nombre;
    principioActivo = medicamento.principioActivo;
    unidadesPorCaja = Math.max(1, Number(medicamento.unidadesPorCaja) || 1);
  } else if (!codigo || !nombre) {
    throw new Error('Las fórmulas necesitan código interno y nombre.');
  }

  const stockMaximo = input.stockMaximo == null ? null : Math.max(0, Number(input.stockMaximo));
  const puntoPedido = input.puntoPedido == null ? null : Math.max(0, Number(input.puntoPedido));
  const sql = getDb();

  const rows = id
    ? await sql`
        UPDATE reposicion_catalogo
        SET ubicacion_destino = ${ubicacion},
            codigo = ${codigo},
            cn = ${cn},
            tipo = ${tipo},
            area_origen = ${areaOrigen},
            ubicacion_origen = ${ubicacionOrigen},
            principio_activo = ${principioActivo},
            nombre = ${nombre},
            unidades_por_caja = ${unidadesPorCaja},
            unidad_pedido = ${input.unidadPedido === 'unidades' ? 'unidades' : 'cajas'},
            stock_maximo = ${stockMaximo},
            punto_pedido = ${puntoPedido},
            notas = ${input.notas?.trim() || null},
            activo = ${input.activo ?? true},
            actualizado_en = NOW()
        WHERE id = ${id} AND area_destino = ${input.areaDestino}
        RETURNING *
      `
    : await sql`
        INSERT INTO reposicion_catalogo (
          area_destino, ubicacion_destino, codigo, cn, tipo, area_origen,
          ubicacion_origen, principio_activo, nombre, unidades_por_caja, unidad_pedido,
          stock_maximo, punto_pedido, notas, activo
        )
        VALUES (
          ${input.areaDestino}, ${ubicacion}, ${codigo}, ${cn}, ${tipo}, ${areaOrigen},
          ${ubicacionOrigen}, ${principioActivo}, ${nombre}, ${unidadesPorCaja},
          ${input.unidadPedido === 'unidades' ? 'unidades' : 'cajas'},
          ${stockMaximo}, ${puntoPedido}, ${input.notas?.trim() || null}, ${input.activo ?? true}
        )
        ON CONFLICT (area_destino, ubicacion_destino, codigo)
        DO UPDATE SET
          cn = EXCLUDED.cn,
          tipo = EXCLUDED.tipo,
          area_origen = EXCLUDED.area_origen,
          ubicacion_origen = EXCLUDED.ubicacion_origen,
          principio_activo = EXCLUDED.principio_activo,
          nombre = EXCLUDED.nombre,
          unidades_por_caja = EXCLUDED.unidades_por_caja,
          unidad_pedido = EXCLUDED.unidad_pedido,
          stock_maximo = EXCLUDED.stock_maximo,
          punto_pedido = EXCLUDED.punto_pedido,
          notas = EXCLUDED.notas,
          activo = EXCLUDED.activo,
          actualizado_en = NOW()
        RETURNING *
      `;

  if (!rows[0]) throw new Error('No se pudo guardar el artículo de reposición.');
  return mapItem(rows[0]);
}

export async function remapReposicionCatalogoCn(
  cnAnterior: string,
  cnNuevo: string,
  grupoId: number,
): Promise<number> {
  await ensureReposicionCatalogoSchema();
  const medicamento = await getMedicamentoByCn(cnNuevo);
  if (!medicamento) return 0;
  const nuevasUnidadesPorCaja = Math.max(1, medicamento.unidadesPorCaja || 1);
  const sql = getDb();
  const activados = await sql`
    UPDATE reposicion_catalogo vigente
    SET activo = TRUE,
        area_origen = ${medicamento.area},
        ubicacion_origen = ${medicamento.ubicacion?.trim() || null},
        principio_activo = ${medicamento.principioActivo},
        nombre = ${medicamento.nombre},
        unidades_por_caja = ${nuevasUnidadesPorCaja},
        unidad_pedido = anterior.unidad_pedido,
        stock_maximo = CASE
          WHEN anterior.unidad_pedido = 'cajas' AND anterior.stock_maximo IS NOT NULL
          THEN CEIL(
            anterior.stock_maximo * GREATEST(anterior.unidades_por_caja, 1)::numeric
            / ${nuevasUnidadesPorCaja}
          )
          ELSE anterior.stock_maximo
        END,
        punto_pedido = CASE
          WHEN anterior.unidad_pedido = 'cajas' AND anterior.punto_pedido IS NOT NULL
          THEN CEIL(
            anterior.punto_pedido * GREATEST(anterior.unidades_por_caja, 1)::numeric
            / ${nuevasUnidadesPorCaja}
          )
          ELSE anterior.punto_pedido
        END,
        notas = anterior.notas,
        grupo_intercambio_id = ${grupoId},
        actualizado_en = NOW()
    FROM reposicion_catalogo anterior
    WHERE anterior.cn = ${cnAnterior}
      AND anterior.activo = TRUE
      AND vigente.cn = ${cnNuevo}
      AND vigente.area_destino = anterior.area_destino
      AND vigente.ubicacion_destino = anterior.ubicacion_destino
    RETURNING vigente.id
  `;
  await sql`
    UPDATE reposicion_catalogo anterior
    SET activo = FALSE,
        grupo_intercambio_id = ${grupoId},
        actualizado_en = NOW()
    WHERE anterior.cn = ${cnAnterior}
      AND EXISTS (
        SELECT 1
        FROM reposicion_catalogo vigente
        WHERE vigente.area_destino = anterior.area_destino
          AND vigente.ubicacion_destino = anterior.ubicacion_destino
          AND vigente.codigo = ${cnNuevo}
      )
  `;
  const rows = await sql`
    UPDATE reposicion_catalogo
    SET cn = ${cnNuevo},
        codigo = ${cnNuevo},
        area_origen = ${medicamento.area},
        ubicacion_origen = ${medicamento.ubicacion?.trim() || null},
        principio_activo = ${medicamento.principioActivo},
        nombre = ${medicamento.nombre},
        stock_maximo = CASE
          WHEN unidad_pedido = 'cajas' AND stock_maximo IS NOT NULL
          THEN CEIL(
            stock_maximo * GREATEST(unidades_por_caja, 1)::numeric
            / ${nuevasUnidadesPorCaja}
          )
          ELSE stock_maximo
        END,
        punto_pedido = CASE
          WHEN unidad_pedido = 'cajas' AND punto_pedido IS NOT NULL
          THEN CEIL(
            punto_pedido * GREATEST(unidades_por_caja, 1)::numeric
            / ${nuevasUnidadesPorCaja}
          )
          ELSE punto_pedido
        END,
        unidades_por_caja = ${nuevasUnidadesPorCaja},
        grupo_intercambio_id = ${grupoId},
        actualizado_en = NOW()
    WHERE cn = ${cnAnterior}
      AND activo = TRUE
    RETURNING id
  `;
  return activados.length + rows.length;
}
