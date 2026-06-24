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

/** Clave de cruce con pedidos SAP (6 dígitos finales del CN). */
export function cnClavePedidos(cn: string): string | null {
  return toCn6(cn);
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
      recibido_at::text AS recibido_at,
      por_entregar_cantidad::text AS por_entregar_cantidad,
      cantidad_recibida::text AS cantidad_recibida
    FROM public.orders
    WHERE anulado  = FALSE
      -- Regla funcional: si tiene fecha de recibido, se considera recibido.
      AND recibido_at IS NOT NULL
      AND fecha_documento >= ${fechaDesde}::date
      AND n_mate_prov IS NOT NULL
      AND lpad(right(regexp_replace(n_mate_prov::text, '[^0-9]', '', 'g'), 6), 6, '0') = ${cn6}
    ORDER BY fecha_documento ASC;
  `) as Array<{
    fecha_documento: string;
    recibido_at: string | null;
    cantidad_recibida: string | null;
    por_entregar_cantidad: string | null;
  }>;

  const monthMap = new Map<string, PedidoMesItem>();
  for (const row of rows) {
    const d = new Date(row.fecha_documento);
    if (Number.isNaN(d.getTime())) continue;
    const anio = d.getFullYear();
    const mes = d.getMonth() + 1;
    const key = `${anio}-${mes}`;
    const prev = monthMap.get(key) ?? { anio, mes, cantidad: 0 };
    // Regla funcional acordada: tomamos por_entregar_cantidad como cantidad recibida
    // cuando existe fecha de recibido.
    const qty =
      parseNumberMaybe(row.por_entregar_cantidad) ??
      parseNumberMaybe(row.cantidad_recibida) ??
      0;
    monthMap.set(key, { ...prev, cantidad: prev.cantidad + qty });
  }

  return Array.from(monthMap.values()).sort((a, b) =>
    a.anio !== b.anio ? a.anio - b.anio : a.mes - b.mes
  );
}

// ---------------------------------------------------------------------------
// Recepciones semanales (últimas N semanas) para una lista de CNs.
// Agrupa por semana ISO a partir de recibido_at.
// ---------------------------------------------------------------------------
export type RecepcionSemanalItem = {
  semana: number;
  anio: number;
  cantidad: number;
};

export async function loadRecepcionesSemanalPorCns(
  cns6: string[],
  diasAtras = 112,
): Promise<Record<string, RecepcionSemanalItem[]>> {
  if (cns6.length === 0) return {};
  const sql = getPedidosReadonlyClient();

  const rows = (await sql`
    SELECT
      lpad(right(regexp_replace(n_mate_prov::text, '[^0-9]', '', 'g'), 6), 6, '0') AS cn6,
      EXTRACT(ISOYEAR FROM recibido_at)::int AS iso_year,
      EXTRACT(WEEK     FROM recibido_at)::int AS iso_week,
      por_entregar_cantidad::text  AS por_entregar_cantidad,
      cantidad_recibida::text      AS cantidad_recibida
    FROM public.orders
    WHERE recibido_at IS NOT NULL
      AND anulado = FALSE
      AND recibido_at > NOW() - (${diasAtras}::text || ' days')::interval
      AND n_mate_prov IS NOT NULL
      AND regexp_replace(n_mate_prov::text, '[^0-9]', '', 'g') <> ''
      AND lpad(right(regexp_replace(n_mate_prov::text, '[^0-9]', '', 'g'), 6), 6, '0') = ANY(${cns6})
    ORDER BY cn6, iso_year, iso_week;
  `) as Array<{
    cn6: string;
    iso_year: number;
    iso_week: number;
    por_entregar_cantidad: string | null;
    cantidad_recibida: string | null;
  }>;

  const result: Record<string, RecepcionSemanalItem[]> = {};
  for (const r of rows) {
    const qty =
      parseNumberMaybe(r.por_entregar_cantidad) ??
      parseNumberMaybe(r.cantidad_recibida) ??
      0;
    const key = `${r.cn6}`;
    if (!result[key]) result[key] = [];
    const week = result[key].find(
      w => w.semana === Number(r.iso_week) && w.anio === Number(r.iso_year)
    );
    if (week) {
      week.cantidad += qty;
    } else {
      result[key].push({ semana: Number(r.iso_week), anio: Number(r.iso_year), cantidad: qty });
    }
  }
  return result;
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

export type PedidoResumenAlmacenCn = {
  pedidosRecibidos14d: number;
  unidadesRecibidas14d: number;
  pedidosPendientes: number;
  unidadesPendientes: number;
  /** Si no hay recibos en 14 días: fecha del último pedido recibido (ISO yyyy-MM-dd). */
  ultimoRecibidoFecha: string | null;
  /** Unidades del último pedido recibido (solo si ultimoRecibidoFecha está informado). */
  ultimoRecibidoUnidades: number;
};

const PEDIDO_RESUMEN_ALMACEN_VACIO: PedidoResumenAlmacenCn = {
  pedidosRecibidos14d: 0,
  unidadesRecibidas14d: 0,
  pedidosPendientes: 0,
  unidadesPendientes: 0,
  ultimoRecibidoFecha: null,
  ultimoRecibidoUnidades: 0,
};

function cantidadPedidoOrder(row: {
  por_entregar_cantidad: string | null;
  cantidad_recibida: string | null;
}): number {
  return (
    parseNumberMaybe(row.por_entregar_cantidad) ??
    parseNumberMaybe(row.cantidad_recibida) ??
    0
  );
}

/** Resumen de pedidos recibidos (últimas 2 semanas) y pendientes por CN — recuento almacén. */
export async function loadPedidosResumenAlmacenPorCns(
  cns: string[]
): Promise<Record<string, PedidoResumenAlmacenCn>> {
  const normalizedCns = [...new Set(cns.map((cn) => toCn6(cn)).filter((cn): cn is string => !!cn))];
  const result: Record<string, PedidoResumenAlmacenCn> = {};
  for (const cn of normalizedCns) {
    result[cn] = { ...PEDIDO_RESUMEN_ALMACEN_VACIO };
  }
  if (normalizedCns.length === 0) return result;

  const sql = getPedidosReadonlyClient();
  const rows = (await sql`
    SELECT
      lpad(right(regexp_replace(o.n_mate_prov::text, '[^0-9]', '', 'g'), 6), 6, '0') AS cn6,
      o.recibido,
      o.anulado,
      o.recibido_at::text AS recibido_at,
      o.por_entregar_cantidad::text AS por_entregar_cantidad,
      o.cantidad_recibida::text AS cantidad_recibida
    FROM public.orders o
    WHERE o.n_mate_prov IS NOT NULL
      AND regexp_replace(o.n_mate_prov::text, '[^0-9]', '', 'g') <> ''
      AND lpad(right(regexp_replace(o.n_mate_prov::text, '[^0-9]', '', 'g'), 6), 6, '0') = ANY(${normalizedCns});
  `) as Array<{
    cn6: string;
    recibido: boolean;
    anulado: boolean;
    recibido_at: string | null;
    por_entregar_cantidad: string | null;
    cantidad_recibida: string | null;
  }>;

  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const ultimoRecibidoPorCn = new Map<string, { ms: number; fechaIso: string; unidades: number }>();

  for (const row of rows) {
    const cn6 = toCn6(row.cn6);
    if (!cn6 || !result[cn6]) continue;

    const qty = cantidadPedidoOrder(row);
    const bucket = result[cn6]!;

    if (!row.anulado && !row.recibido) {
      bucket.pedidosPendientes += 1;
      if (qty > 0) bucket.unidadesPendientes += qty;
      continue;
    }

    if (row.anulado || !row.recibido_at) continue;
    const recibidoAt = new Date(row.recibido_at);
    if (Number.isNaN(recibidoAt.getTime())) continue;

    const recibidoMs = recibidoAt.getTime();
    const fechaIso = row.recibido_at.slice(0, 10);

    if (recibidoMs >= cutoff) {
      bucket.pedidosRecibidos14d += 1;
      if (qty > 0) bucket.unidadesRecibidas14d += qty;
    }

    const prev = ultimoRecibidoPorCn.get(cn6);
    if (!prev || recibidoMs > prev.ms) {
      ultimoRecibidoPorCn.set(cn6, { ms: recibidoMs, fechaIso, unidades: qty > 0 ? qty : 0 });
    } else if (recibidoMs === prev.ms && qty > 0) {
      prev.unidades += qty;
    }
  }

  for (const [cn6, last] of ultimoRecibidoPorCn) {
    const bucket = result[cn6];
    if (!bucket || bucket.pedidosRecibidos14d > 0) continue;
    bucket.ultimoRecibidoFecha = last.fechaIso;
    bucket.ultimoRecibidoUnidades = last.unidades;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Alertas de suministro por CN (CIMA, en falta, respuesta proveedor)
// ---------------------------------------------------------------------------

export type TipoAlertaSuministro =
  | 'cima'
  | 'en_falta'
  | 'sin_existencias'
  | 'problema_suministro'
  | 'situacion_especial';

export type AlertaSuministroCn = {
  tipo: TipoAlertaSuministro;
  etiqueta: string;
  detalle: string | null;
  fecha: string;
};

const ESTADOS_PROVEEDOR_ALERTA: Record<
  string,
  { tipo: TipoAlertaSuministro; etiqueta: string }
> = {
  sin_existencias: { tipo: 'sin_existencias', etiqueta: 'Sin existencias' },
  suministro: { tipo: 'problema_suministro', etiqueta: 'Problema de suministro' },
  aemps: { tipo: 'situacion_especial', etiqueta: 'Situación especial AEMPS' },
};

type CandidatoAlerta = AlertaSuministroCn & { ms: number };

function parseTs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function elegirAlertaMasReciente(candidatos: CandidatoAlerta[]): AlertaSuministroCn | null {
  if (candidatos.length === 0) return null;
  const mejor = candidatos.reduce((a, b) => (b.ms > a.ms ? b : a));
  return {
    tipo: mejor.tipo,
    etiqueta: mejor.etiqueta,
    detalle: mejor.detalle,
    fecha: mejor.fecha,
  };
}

export function alertaSuministroParaCn(
  map: Record<string, AlertaSuministroCn | null>,
  cn: string,
): AlertaSuministroCn | null {
  const key = cnClavePedidos(cn);
  if (!key) return null;
  return map[key] ?? null;
}

/** Alerta vigente más reciente por CN: CIMA, en falta o respuesta proveedor problemática. */
export async function loadAlertasSuministroPorCns(
  cns: string[],
): Promise<Record<string, AlertaSuministroCn | null>> {
  const normalizedCns = [...new Set(cns.map((cn) => toCn6(cn)).filter((cn): cn is string => !!cn))];
  const out: Record<string, AlertaSuministroCn | null> = {};
  for (const cn6 of normalizedCns) out[cn6] = null;
  if (normalizedCns.length === 0) return out;

  const sql = getPedidosReadonlyClient();
  const candidatosPorCn = new Map<string, CandidatoAlerta[]>();

  const push = (cn6: string | null, candidato: CandidatoAlerta) => {
    if (!cn6 || !(cn6 in out)) return;
    const list = candidatosPorCn.get(cn6) ?? [];
    list.push(candidato);
    candidatosPorCn.set(cn6, list);
  };

  try {
    const cimaRows = (await sql`
      SELECT cn, nombre, descripcion, updated_at::text AS updated_at
      FROM public.suministro_alertas
      WHERE resuelto = false
        AND estado = 'Activo'
        AND cn IS NOT NULL
        AND regexp_replace(cn::text, '[^0-9]', '', 'g') <> ''
        AND lpad(right(regexp_replace(cn::text, '[^0-9]', '', 'g'), 6), 6, '0') = ANY(${normalizedCns});
    `) as Array<{
      cn: string;
      nombre: string | null;
      descripcion: string | null;
      updated_at: string;
    }>;

    for (const row of cimaRows) {
      const cn6 = toCn6(row.cn);
      const ms = parseTs(row.updated_at);
      if (!cn6 || ms == null) continue;
      push(cn6, {
        tipo: 'cima',
        etiqueta: 'CIMA — problema suministro',
        detalle: row.descripcion?.trim() || row.nombre?.trim() || null,
        fecha: row.updated_at,
        ms,
      });
    }
  } catch (err) {
    console.warn(
      '[alertas-suministro] No se pudieron leer alertas CIMA:',
      err instanceof Error ? err.message : err,
    );
  }

  try {
    const faltaRows = (await sql`
      SELECT
        lpad(right(regexp_replace(o.n_mate_prov::text, '[^0-9]', '', 'g'), 6), 6, '0') AS cn6,
        o.updated_at::text AS updated_at
      FROM public.orders o
      WHERE o.en_falta = true
        AND o.recibido = false
        AND o.anulado = false
        AND o.n_mate_prov IS NOT NULL
        AND regexp_replace(o.n_mate_prov::text, '[^0-9]', '', 'g') <> ''
        AND lpad(right(regexp_replace(o.n_mate_prov::text, '[^0-9]', '', 'g'), 6), 6, '0') = ANY(${normalizedCns});
    `) as Array<{ cn6: string; updated_at: string }>;

    for (const row of faltaRows) {
      const cn6 = toCn6(row.cn6);
      const ms = parseTs(row.updated_at);
      if (!cn6 || ms == null) continue;
      push(cn6, {
        tipo: 'en_falta',
        etiqueta: 'En falta',
        detalle: null,
        fecha: row.updated_at,
        ms,
      });
    }
  } catch (err) {
    console.warn(
      '[alertas-suministro] No se pudieron leer pedidos en falta:',
      err instanceof Error ? err.message : err,
    );
  }

  try {
    const proveedorRows = (await sql`
      SELECT
        lpad(right(regexp_replace(o.n_mate_prov::text, '[^0-9]', '', 'g'), 6), 6, '0') AS cn6,
        rl.estado_actual::text AS estado,
        rl.texto_libre,
        rl.updated_at::text AS updated_at
      FROM public.orders o
      INNER JOIN public.respuestas_proveedor rp ON rp.documento_compras = o.documento_compras
      INNER JOIN public.respuestas_lineas rl
        ON rl.respuesta_id = rp.id AND rl.posicion = o.posicion
      WHERE o.recibido = false
        AND o.anulado = false
        AND rl.estado_actual IN ('sin_existencias', 'suministro', 'aemps')
        AND o.n_mate_prov IS NOT NULL
        AND regexp_replace(o.n_mate_prov::text, '[^0-9]', '', 'g') <> ''
        AND lpad(right(regexp_replace(o.n_mate_prov::text, '[^0-9]', '', 'g'), 6), 6, '0') = ANY(${normalizedCns});
    `) as Array<{
      cn6: string;
      estado: string;
      texto_libre: string | null;
      updated_at: string;
    }>;

    for (const row of proveedorRows) {
      const cn6 = toCn6(row.cn6);
      const ms = parseTs(row.updated_at);
      const meta = ESTADOS_PROVEEDOR_ALERTA[row.estado];
      if (!cn6 || ms == null || !meta) continue;
      const detalle = row.texto_libre?.trim() || null;
      push(cn6, {
        tipo: meta.tipo,
        etiqueta: meta.etiqueta,
        detalle,
        fecha: row.updated_at,
        ms,
      });
    }
  } catch (err) {
    console.warn(
      '[alertas-suministro] No se pudieron leer respuestas de proveedor:',
      err instanceof Error ? err.message : err,
    );
  }

  for (const cn6 of normalizedCns) {
    out[cn6] = elegirAlertaMasReciente(candidatosPorCn.get(cn6) ?? []);
  }

  return out;
}

export async function loadAlertasSuministroPorCnsSafe(
  cns: string[],
): Promise<Record<string, AlertaSuministroCn | null>> {
  try {
    return await loadAlertasSuministroPorCns(cns);
  } catch {
    const fallback: Record<string, AlertaSuministroCn | null> = {};
    for (const cn of cns) {
      const key = cnClavePedidos(cn);
      if (key) fallback[key] = null;
    }
    return fallback;
  }
}
