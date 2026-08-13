import { neon } from '@neondatabase/serverless';
import { ensureReposicionCatalogoSchema } from '@/lib/reposicion-catalogo-neon';

function getDb() {
  const url = process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Falta REALIZAR_PEDIDOS_DATABASE_URL para conectar a Neon.');
  return neon(url);
}

/* ─── Auto-creación de tablas ─── */
export async function ensureTablesReposicion() {
  await ensureReposicionCatalogoSchema();
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS pedidos_reposicion (
      id              SERIAL PRIMARY KEY,
      area            TEXT NOT NULL,
      estado          TEXT NOT NULL DEFAULT 'borrador',
      fecha_creacion  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      fecha_finalizado TIMESTAMPTZ,
      total_lineas    INTEGER NOT NULL DEFAULT 0
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS pedidos_reposicion_lineas (
      id              SERIAL PRIMARY KEY,
      pedido_id       INTEGER NOT NULL REFERENCES pedidos_reposicion(id) ON DELETE CASCADE,
      ubicacion       TEXT NOT NULL,
      cn              TEXT NOT NULL,
      principio_activo TEXT,
      nombre          TEXT NOT NULL,
      cantidad_cajas  INTEGER NOT NULL DEFAULT 0,
      stock_maximo    NUMERIC,
      UNIQUE (pedido_id, cn)
    )
  `;
  await sql`ALTER TABLE pedidos_reposicion_lineas ADD COLUMN IF NOT EXISTS catalogo_id INTEGER;`;
  await sql`ALTER TABLE pedidos_reposicion_lineas ADD COLUMN IF NOT EXISTS codigo_item TEXT;`;
  await sql`ALTER TABLE pedidos_reposicion_lineas ADD COLUMN IF NOT EXISTS tipo_item TEXT NOT NULL DEFAULT 'medicamento';`;
  await sql`ALTER TABLE pedidos_reposicion_lineas ADD COLUMN IF NOT EXISTS area_origen TEXT;`;
  await sql`ALTER TABLE pedidos_reposicion_lineas ADD COLUMN IF NOT EXISTS ubicacion_origen TEXT;`;
  await sql`ALTER TABLE pedidos_reposicion_lineas ADD COLUMN IF NOT EXISTS unidad_pedido TEXT NOT NULL DEFAULT 'cajas';`;
  await sql`ALTER TABLE pedidos_reposicion_lineas ADD COLUMN IF NOT EXISTS punto_pedido NUMERIC;`;
  await sql`ALTER TABLE pedidos_reposicion_lineas ADD COLUMN IF NOT EXISTS notas TEXT;`;
  await sql`UPDATE pedidos_reposicion_lineas SET codigo_item = cn WHERE codigo_item IS NULL;`;
  await sql`
    ALTER TABLE pedidos_reposicion_lineas
    DROP CONSTRAINT IF EXISTS pedidos_reposicion_lineas_pedido_id_cn_key
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_reposicion_linea_pedido_ubicacion_codigo
    ON pedidos_reposicion_lineas (pedido_id, ubicacion, codigo_item)
  `;
  await sql`
    UPDATE pedidos_reposicion_lineas l
    SET catalogo_id = rc.id,
        codigo_item = rc.codigo,
        tipo_item = rc.tipo,
        area_origen = rc.area_origen,
        ubicacion_origen = rc.ubicacion_origen,
        unidad_pedido = rc.unidad_pedido,
        punto_pedido = rc.punto_pedido,
        notas = rc.notas
    FROM pedidos_reposicion p, reposicion_catalogo rc
    WHERE p.id = l.pedido_id
      AND rc.area_destino = p.area
      AND rc.ubicacion_destino = l.ubicacion
      AND rc.cn = l.cn
      AND l.catalogo_id IS NULL
  `;
  await sql`
    UPDATE pedidos_reposicion_lineas l
    SET ubicacion_origen = rc.ubicacion_origen
    FROM reposicion_catalogo rc
    WHERE rc.id = l.catalogo_id
      AND l.ubicacion_origen IS NULL
      AND rc.ubicacion_origen IS NOT NULL
  `;
  await sql`
    UPDATE pedidos_reposicion_lineas
    SET nombre = 'SOLUCIÓN DE MUCOSITIS',
        principio_activo = 'SOLUCIÓN DE MUCOSITIS'
    WHERE codigo_item = 'FM-MUCOSITIS'
      AND nombre <> 'SOLUCIÓN DE MUCOSITIS'
  `;
}

/* ─── TIPOS ─── */
export type ReposicionCabecera = {
  id: number;
  area: string;
  estado: 'borrador' | 'finalizado';
  fechaCreacion: string;
  fechaFinalizado: string | null;
  totalLineas: number;
};

export type ReposicionLinea = {
  id: number;
  pedidoId: number;
  ubicacion: string;
  cn: string;
  principioActivo: string | null;
  nombre: string;
  cantidadCajas: number;
  stockMaximo: number | null;
  puntoPedido: number | null;
  notas: string | null;
  codigo: string;
  tipo: 'medicamento' | 'formula';
  areaOrigen: string | null;
  ubicacionOrigen: string | null;
  unidadPedido: 'cajas' | 'unidades';
  catalogoId: number | null;
};

/* ─── CONSULTAS ─── */

export async function getPedidoBorrador(area: string): Promise<ReposicionCabecera | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT id, area, estado, fecha_creacion, fecha_finalizado, total_lineas
    FROM pedidos_reposicion
    WHERE area = ${area} AND estado = 'borrador'
    ORDER BY fecha_creacion DESC
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return mapCabecera(rows[0]);
}

export async function getHistorialReposicion(area: string): Promise<ReposicionCabecera[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT id, area, estado, fecha_creacion, fecha_finalizado, total_lineas
    FROM pedidos_reposicion
    WHERE area = ${area} AND estado = 'finalizado'
    ORDER BY fecha_creacion DESC
    LIMIT 50
  `;
  return rows.map(mapCabecera);
}

export async function getPedidoConLineas(
  id: number
): Promise<{ cabecera: ReposicionCabecera; lineas: ReposicionLinea[] } | null> {
  const sql = getDb();
  const cab = await sql`
    SELECT id, area, estado, fecha_creacion, fecha_finalizado, total_lineas
    FROM pedidos_reposicion WHERE id = ${id}
  `;
  if (!cab[0]) return null;
  const lin = await sql`
    SELECT id, pedido_id, ubicacion, cn, principio_activo, nombre, cantidad_cajas,
           stock_maximo, punto_pedido, notas, codigo_item, tipo_item, area_origen,
           ubicacion_origen, unidad_pedido, catalogo_id
    FROM pedidos_reposicion_lineas
    WHERE pedido_id = ${id}
    ORDER BY ubicacion, principio_activo, nombre
  `;
  return { cabecera: mapCabecera(cab[0]), lineas: lin.map(mapLinea) };
}

export async function crearPedidoBorrador(area: string): Promise<ReposicionCabecera> {
  const sql = getDb();
  const rows = await sql`
    INSERT INTO pedidos_reposicion (area, estado, total_lineas)
    VALUES (${area}, 'borrador', 0)
    RETURNING id, area, estado, fecha_creacion, fecha_finalizado, total_lineas
  `;
  return mapCabecera(rows[0]);
}

export type LineaInput = {
  ubicacion: string;
  cn: string;
  principioActivo: string | null;
  nombre: string;
  cantidadCajas: number;
  stockMaximo: number | null;
  puntoPedido: number | null;
  notas: string | null;
  codigo: string;
  tipo: 'medicamento' | 'formula';
  areaOrigen: string | null;
  ubicacionOrigen: string | null;
  unidadPedido: 'cajas' | 'unidades';
  catalogoId: number | null;
};

export async function upsertLineasReposicion(
  pedidoId: number,
  lineas: LineaInput[]
): Promise<{ upserted: number }> {
  const sql = getDb();
  let upserted = 0;
  for (const l of lineas) {
    await sql`
      INSERT INTO pedidos_reposicion_lineas
        (pedido_id, ubicacion, cn, principio_activo, nombre, cantidad_cajas,
         stock_maximo, punto_pedido, notas, codigo_item, tipo_item, area_origen,
         ubicacion_origen, unidad_pedido, catalogo_id)
      VALUES
        (${pedidoId}, ${l.ubicacion}, ${l.cn}, ${l.principioActivo ?? null},
         ${l.nombre}, ${l.cantidadCajas}, ${l.stockMaximo ?? null},
         ${l.puntoPedido ?? null}, ${l.notas ?? null}, ${l.codigo}, ${l.tipo},
         ${l.areaOrigen ?? null}, ${l.ubicacionOrigen ?? null}, ${l.unidadPedido},
         ${l.catalogoId ?? null})
      ON CONFLICT (pedido_id, ubicacion, codigo_item)
      DO UPDATE SET
        cn = EXCLUDED.cn,
        principio_activo = EXCLUDED.principio_activo,
        nombre = EXCLUDED.nombre,
        cantidad_cajas = EXCLUDED.cantidad_cajas,
        stock_maximo = EXCLUDED.stock_maximo,
        punto_pedido = EXCLUDED.punto_pedido,
        notas = EXCLUDED.notas,
        tipo_item = EXCLUDED.tipo_item,
        area_origen = EXCLUDED.area_origen,
        ubicacion_origen = EXCLUDED.ubicacion_origen,
        unidad_pedido = EXCLUDED.unidad_pedido,
        catalogo_id = EXCLUDED.catalogo_id
    `;
    upserted++;
  }
  await recalcularTotalLineas(pedidoId);
  return { upserted };
}

export async function reemplazarLineasReposicionUbicacion(
  pedidoId: number,
  ubicacion: string,
  lineas: LineaInput[],
): Promise<{ upserted: number }> {
  const sql = getDb();
  await sql`
    DELETE FROM pedidos_reposicion_lineas
    WHERE pedido_id = ${pedidoId} AND ubicacion = ${ubicacion}
  `;
  return upsertLineasReposicion(pedidoId, lineas.filter((linea) => linea.cantidadCajas > 0));
}

export async function finalizarPedido(id: number): Promise<ReposicionCabecera> {
  const sql = getDb();
  const rows = await sql`
    UPDATE pedidos_reposicion
    SET estado = 'finalizado', fecha_finalizado = NOW()
    WHERE id = ${id} AND estado = 'borrador'
    RETURNING id, area, estado, fecha_creacion, fecha_finalizado, total_lineas
  `;
  if (!rows[0]) throw new Error('Pedido no encontrado o ya finalizado.');
  return mapCabecera(rows[0]);
}

export async function eliminarPedidoReposicion(
  id: number,
  area: string,
): Promise<{ id: number; estado: string; lineasEliminadas: number } | null> {
  const sql = getDb();
  const rows = await sql`
    DELETE FROM pedidos_reposicion
    WHERE id = ${id} AND area = ${area}
    RETURNING id, estado, total_lineas
  `;
  if (!rows[0]) return null;
  return {
    id: Number(rows[0].id),
    estado: String(rows[0].estado),
    lineasEliminadas: Number(rows[0].total_lineas),
  };
}

async function recalcularTotalLineas(pedidoId: number) {
  const sql = getDb();
  await sql`
    UPDATE pedidos_reposicion
    SET total_lineas = (
      SELECT COUNT(*) FROM pedidos_reposicion_lineas WHERE pedido_id = ${pedidoId}
    )
    WHERE id = ${pedidoId}
  `;
}

/* ─── mappers ─── */
function mapCabecera(r: Record<string, unknown>): ReposicionCabecera {
  return {
    id: Number(r.id),
    area: String(r.area),
    estado: r.estado as 'borrador' | 'finalizado',
    fechaCreacion: String(r.fecha_creacion),
    fechaFinalizado: r.fecha_finalizado ? String(r.fecha_finalizado) : null,
    totalLineas: Number(r.total_lineas),
  };
}

function mapLinea(r: Record<string, unknown>): ReposicionLinea {
  return {
    id: Number(r.id),
    pedidoId: Number(r.pedido_id),
    ubicacion: String(r.ubicacion),
    cn: String(r.cn),
    principioActivo: r.principio_activo ? String(r.principio_activo) : null,
    nombre: String(r.nombre),
    cantidadCajas: Number(r.cantidad_cajas),
    stockMaximo: r.stock_maximo != null ? Number(r.stock_maximo) : null,
    puntoPedido: r.punto_pedido != null ? Number(r.punto_pedido) : null,
    notas: r.notas ? String(r.notas) : null,
    codigo: String(r.codigo_item ?? r.cn),
    tipo: r.tipo_item === 'formula' ? 'formula' : 'medicamento',
    areaOrigen: r.area_origen ? String(r.area_origen) : null,
    ubicacionOrigen: r.ubicacion_origen ? String(r.ubicacion_origen) : null,
    unidadPedido: r.unidad_pedido === 'unidades' ? 'unidades' : 'cajas',
    catalogoId: r.catalogo_id == null ? null : Number(r.catalogo_id),
  };
}
