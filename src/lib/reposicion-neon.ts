import { neon } from '@neondatabase/serverless';

function getDb() {
  const url = process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Falta REALIZAR_PEDIDOS_DATABASE_URL para conectar a Neon.');
  return neon(url);
}

/* ─── Auto-creación de tablas ─── */
export async function ensureTablesReposicion() {
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
    WHERE area = ${area}
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
    SELECT id, pedido_id, ubicacion, cn, principio_activo, nombre, cantidad_cajas, stock_maximo
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
        (pedido_id, ubicacion, cn, principio_activo, nombre, cantidad_cajas, stock_maximo)
      VALUES
        (${pedidoId}, ${l.ubicacion}, ${l.cn}, ${l.principioActivo ?? null},
         ${l.nombre}, ${l.cantidadCajas}, ${l.stockMaximo ?? null})
      ON CONFLICT (pedido_id, cn)
      DO UPDATE SET
        ubicacion = EXCLUDED.ubicacion,
        principio_activo = EXCLUDED.principio_activo,
        nombre = EXCLUDED.nombre,
        cantidad_cajas = EXCLUDED.cantidad_cajas,
        stock_maximo = EXCLUDED.stock_maximo
    `;
    upserted++;
  }
  await recalcularTotalLineas(pedidoId);
  return { upserted };
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
  };
}
