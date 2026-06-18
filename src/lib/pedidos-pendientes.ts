import { neon } from '@neondatabase/serverless';

export type PedidoEstadoFiltro = 'todos' | 'pendientes' | 'recibidos' | 'anulados';

export type PedidoPendienteRow = {
  id: number;
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
  const rows = (await sql`
    SELECT
      o.id,
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
  `) as {
    id: number;
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
  }[];

  return rows.map((row) => ({
    id: row.id,
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
