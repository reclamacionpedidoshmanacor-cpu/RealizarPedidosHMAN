import { neon } from '@neondatabase/serverless';

export type PedidoEstadoFiltro = 'todos' | 'pendientes' | 'recibidos' | 'anulados';

export type PedidoPendienteRow = {
  id: number;
  cnRaw: string | null;
  documentoCompras: string;
  posicion: string;
  fechaDocumento: string;
  proveedorNombre: string | null;
  textoBreve: string | null;
  porEntregarCantidad: string | null;
  cantidadPedido: string | null;
  recibido: boolean;
  anulado: boolean;
  reclamado: boolean;
  respuestaId: number | null;
  estadoRespuesta: string | null;
  textoRespuesta: string | null;
  historialEstado: string | null;
  historialTexto: string | null;
  historialRegistradoAt: string | null;
};

export type PedidosPendientesResumen = {
  totalOrders: number;
  pendientes: number;
  recibidos: number;
  anulados: number;
  reclamados: number;
};

type LoadPedidosParams = {
  estado: PedidoEstadoFiltro;
  soloReclamados: boolean;
  limit: number;
};

function toCn6(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length > 6) return digits.slice(-6);
  return digits.padStart(6, '0');
}

function parseNumberMaybe(raw: string | null): number | null {
  if (raw == null) return null;
  const compact = String(raw).trim().replace(/\s/g, '');
  if (!compact) return null;

  let normalized = compact;
  if (compact.includes('.') && compact.includes(',')) {
    const lastDot = compact.lastIndexOf('.');
    const lastComma = compact.lastIndexOf(',');
    normalized =
      lastComma > lastDot
        ? compact.replace(/\./g, '').replace(',', '.')
        : compact.replace(/,/g, '');
  } else if (compact.includes(',')) {
    normalized = compact.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(compact)) {
    normalized = compact.replace(/\./g, '');
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function getPedidosReadonlyClient() {
  const connectionString = process.env.PEDIDOS_PENDIENTES_DATABASE_URL;
  if (!connectionString) {
    throw new Error('Falta PEDIDOS_PENDIENTES_DATABASE_URL para leer PedidosPendientes.');
  }
  return neon(connectionString);
}

export async function loadPedidosResumen(): Promise<PedidosPendientesResumen> {
  const sql = getPedidosReadonlyClient();
  const rows = (await sql`
    SELECT
      COUNT(*)::text AS total_orders,
      COUNT(*) FILTER (WHERE recibido = false AND anulado = false)::text AS pendientes,
      COUNT(*) FILTER (WHERE recibido = true)::text AS recibidos,
      COUNT(*) FILTER (WHERE anulado = true)::text AS anulados,
      COUNT(*) FILTER (WHERE reclamado = true)::text AS reclamados
    FROM public.orders;
  `) as {
    total_orders: string;
    pendientes: string;
    recibidos: string;
    anulados: string;
    reclamados: string;
  }[];

  const row = rows[0];
  return {
    totalOrders: Number(row?.total_orders ?? 0),
    pendientes: Number(row?.pendientes ?? 0),
    recibidos: Number(row?.recibidos ?? 0),
    anulados: Number(row?.anulados ?? 0),
    reclamados: Number(row?.reclamados ?? 0),
  };
}

export async function loadPedidosConRespuestas(params: LoadPedidosParams): Promise<PedidoPendienteRow[]> {
  const sql = getPedidosReadonlyClient();
  type PedidoRaw = {
    id: number;
    cn_raw: string | null;
    documento_compras: string;
    posicion: string;
    fecha_documento: string;
    proveedor_nombre: string | null;
    texto_breve: string | null;
    por_entregar_cantidad: string | null;
    cantidad_pedido: string | null;
    recibido: boolean;
    anulado: boolean;
    reclamado: boolean;
    respuesta_id: number | null;
    estado_respuesta: string | null;
    texto_respuesta: string | null;
    historial_estado: string | null;
    historial_texto: string | null;
    historial_registrado_at: string | null;
  };

  const rows = (await sql`
    SELECT
      o.id,
      o.n_mate_prov::text AS cn_raw,
      o.documento_compras,
      o.posicion,
      o.fecha_documento::text,
      o.proveedor_nombre,
      o.texto_breve,
      o.por_entregar_cantidad::text,
      o.cantidad_pedido::text,
      o.recibido,
      o.anulado,
      o.reclamado,
      rp.id AS respuesta_id,
      rl.estado_actual::text AS estado_respuesta,
      rl.texto_libre AS texto_respuesta,
      rh.estado::text AS historial_estado,
      rh.texto_libre AS historial_texto,
      rh.registrado_at::text AS historial_registrado_at
    FROM public.orders o
    LEFT JOIN public.respuestas_proveedor rp
      ON rp.documento_compras = o.documento_compras
    LEFT JOIN public.respuestas_lineas rl
      ON rl.respuesta_id = rp.id
    AND rl.posicion = o.posicion
    LEFT JOIN LATERAL (
      SELECT h.estado, h.texto_libre, h.registrado_at
      FROM public.respuestas_historial h
      WHERE h.respuesta_linea_id = rl.id
      ORDER BY h.registrado_at DESC
      LIMIT 1
    ) rh ON true
    WHERE (
      (${params.estado} = 'pendientes' AND o.recibido = false AND o.anulado = false)
      OR (${params.estado} = 'recibidos' AND o.recibido = true)
      OR (${params.estado} = 'anulados' AND o.anulado = true)
      OR (${params.estado} = 'todos')
    )
    AND (${params.soloReclamados} = false OR o.reclamado = true)
    ORDER BY o.fecha_documento DESC, o.documento_compras DESC, o.posicion ASC
    LIMIT ${params.limit};
  `) as PedidoRaw[];

  return rows.map((row) => ({
    id: row.id,
    cnRaw: row.cn_raw,
    documentoCompras: row.documento_compras,
    posicion: row.posicion,
    fechaDocumento: row.fecha_documento,
    proveedorNombre: row.proveedor_nombre,
    textoBreve: row.texto_breve,
    porEntregarCantidad: row.por_entregar_cantidad,
    cantidadPedido: row.cantidad_pedido,
    recibido: row.recibido,
    anulado: row.anulado,
    reclamado: row.reclamado,
    respuestaId: row.respuesta_id,
    estadoRespuesta: row.estado_respuesta,
    textoRespuesta: row.texto_respuesta,
    historialEstado: row.historial_estado,
    historialTexto: row.historial_texto,
    historialRegistradoAt: row.historial_registrado_at,
  }));
}

// ---------------------------------------------------------------------------
// Pedidos no anulados (recibidos + pendientes) agrupados por mes para un CN.
// Se usa en la curva de Inicio para representar compras emitidas.
// ---------------------------------------------------------------------------
export type PedidoMesItem = { anio: number; mes: number; cantidad: number };

export async function loadPedidosRecibidosPorMesByCn(
  cn6: string,
  fechaDesde: string,   // ISO yyyy-MM-dd
): Promise<PedidoMesItem[]> {
  const sql = getPedidosReadonlyClient();
  const rows = (await sql`
    SELECT
      fecha_documento::text AS fecha_documento,
      cantidad_pedido::text AS cantidad_pedido
    FROM public.orders
    WHERE anulado  = FALSE
      AND fecha_documento >= ${fechaDesde}::date
      AND n_mate_prov IS NOT NULL
      AND lpad(right(regexp_replace(n_mate_prov::text, '[^0-9]', '', 'g'), 6), 6, '0') = ${cn6}
    ORDER BY fecha_documento ASC;
  `) as Array<{ fecha_documento: string; cantidad_pedido: string | null }>;

  const monthMap = new Map<string, PedidoMesItem>();
  for (const row of rows) {
    const d = new Date(row.fecha_documento);
    if (Number.isNaN(d.getTime())) continue;
    const anio = d.getFullYear();
    const mes = d.getMonth() + 1;
    const key = `${anio}-${mes}`;
    const prev = monthMap.get(key) ?? { anio, mes, cantidad: 0 };
    const qty = parseNumberMaybe(row.cantidad_pedido) ?? 0;
    monthMap.set(key, { ...prev, cantidad: prev.cantidad + qty });
  }

  return Array.from(monthMap.values()).sort((a, b) =>
    a.anio !== b.anio ? a.anio - b.anio : a.mes - b.mes
  );
}

export async function loadCantidadTransitoByCn(cns: string[]): Promise<Record<string, number>> {
  const normalizedCns = [...new Set(cns.map((cn) => toCn6(cn)).filter((cn): cn is string => !!cn))];
  if (normalizedCns.length === 0) return {};

  const sql = getPedidosReadonlyClient();
  const rows = (await sql`
    -- En tránsito = pedidos pendientes (no recibido y no anulado),
    -- medido por la cantidad pendiente por entregar.
    WITH base AS (
      SELECT
        lpad(right(regexp_replace(o.n_mate_prov::text, '[^0-9]', '', 'g'), 6), 6, '0') AS cn6,
        o.por_entregar_cantidad::text AS por_entregar_cantidad
      FROM public.orders o
      WHERE o.recibido = false
        AND o.anulado = false
        AND o.n_mate_prov IS NOT NULL
        AND regexp_replace(o.n_mate_prov::text, '[^0-9]', '', 'g') <> ''
    )
    SELECT cn6 AS cn_raw, por_entregar_cantidad
    FROM base
    WHERE cn6 = ANY(${normalizedCns});
  `) as Array<{
    cn_raw: string | null;
    por_entregar_cantidad: string | null;
  }>;

  const totals: Record<string, number> = {};

  for (const row of rows) {
    const cn6 = toCn6(row.cn_raw);
    if (!cn6) continue;

    const cantidadTransito = parseNumberMaybe(row.por_entregar_cantidad) ?? 0;
    if (cantidadTransito <= 0) continue;

    totals[cn6] = (totals[cn6] ?? 0) + cantidadTransito;
  }

  return totals;
}
