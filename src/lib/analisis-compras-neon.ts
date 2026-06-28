import { neon } from '@neondatabase/serverless';
import 'server-only';
import { listMedicamentosByArea } from '@/lib/catalogo-neon';
import { loadAlertasSuministroPorCnsSafe } from '@/lib/alertas-suministro';
import { getPedidosReadonlyClient } from '@/lib/pedidos-pendientes';

function getDb() {
  const url = process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Falta REALIZAR_PEDIDOS_DATABASE_URL');
  return neon(url);
}

export type VistaAnalisisCompras = 'global' | 'medicamento' | 'proveedor';

export type SemanaPedidos = {
  semanaKey: string;
  label: string;
  nPedidos: number;
};

export type SemanaSap = {
  semanaKey: string;
  label: string;
  emitidos: number;
  recibidos: number;
};

export type TopMedicamentoCompras = {
  cn: string;
  nombre: string;
  principioActivo: string;
  nPedidos: number;
  nRecibidos: number;
  nPendientes: number;
  nReclamados: number;
};

export type TopProveedorCompras = {
  proveedor: string;
  nPedidos: number;
  nCnsDistintos: number;
  nReclamados: number;
};

export type PedidoSapDetalle = {
  id: number;
  documentoCompras: string;
  posicion: string;
  fechaDocumento: string;
  recibidoAt: string | null;
  leadTimeDias: number | null;
  proveedorNombre: string | null;
  cajas: number;
  recibido: boolean;
  anulado: boolean;
  reclamado: boolean;
  estadoRespuesta: string | null;
};

export type SemanaMedicamentoDetalle = {
  semanaKey: string;
  label: string;
  nPedidos: number;
  cajas: number;
  pedidos: PedidoSapDetalle[];
};

export type IncidenciasMedicamento = {
  cima: boolean;
  enFalta: boolean;
  sinExistencias: boolean;
  problemaSuministro: boolean;
  situacionEspecial: boolean;
  reclamaciones: number;
};

export type SemanaProveedorCn = {
  cn: string;
  nombre: string;
  cajas: number;
  nPedidos: number;
};

export type SemanaProveedorDetalle = {
  semanaKey: string;
  label: string;
  porCn: SemanaProveedorCn[];
};

export type AnalisisComprasDatos = {
  periodo: { desde: string; hasta: string };
  kpis: {
    propuestasTramitadas: number;
    pedidosSapEmitidos: number;
    pedidosSapRecibidos: number;
    pedidosSapPendientes: number;
    pedidosReclamados: number;
    leadTimeMedianoDias: number | null;
  };
  semanalPropuestas: SemanaPedidos[];
  semanalSap: SemanaSap[];
  topMedicamentos: TopMedicamentoCompras[];
  topProveedores: TopProveedorCompras[];
  medicamentoDetalle?: {
    cn: string;
    nombre: string;
    principioActivo: string;
    incidencias: IncidenciasMedicamento;
    semanas: SemanaMedicamentoDetalle[];
    leadTimeMedianoDias: number | null;
    nPedidos: number;
  };
  proveedorDetalle?: {
    proveedor: string;
    semanas: SemanaProveedorDetalle[];
    topMedicamentos: Array<{ cn: string; nombre: string; nPedidos: number; cajas: number }>;
    nPedidos: number;
    nReclamados: number;
    leadTimeMedianoDias: number | null;
  };
};

function toCn6(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length > 6) return digits.slice(-6);
  return digits.padStart(6, '0');
}

function isoWeekKey(date: Date): { key: string; label: string } {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  const year = tmp.getUTCFullYear();
  return {
    key: `${year}-W${String(week).padStart(2, '0')}`,
    label: `S${week} ${year}`,
  };
}

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const d = new Date(value.slice(0, 10) + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(fromIso: string, toIso: string): number | null {
  const a = parseDateOnly(fromIso);
  const b = parseDateOnly(toIso);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

type CatalogoMed = { cn: string; nombre: string; principioActivo: string; unidadesPorCaja: number };

async function loadCatalogoUpe(area: string): Promise<{ cns: string[]; byCn: Map<string, CatalogoMed> }> {
  const rows = await listMedicamentosByArea(area);
  const byCn = new Map<string, CatalogoMed>();
  for (const med of rows) {
    const cn = toCn6(med.cn);
    if (!cn) continue;
    byCn.set(cn, {
      cn,
      nombre: med.nombre,
      principioActivo: med.principioActivo ?? '',
      unidadesPorCaja: Number(med.unidadesPorCaja) > 0 ? Number(med.unidadesPorCaja) : 1,
    });
  }
  return { cns: [...byCn.keys()], byCn };
}

function unidadesACajas(unidades: number, unidadesPorCaja: number): number {
  if (!Number.isFinite(unidades) || unidades <= 0) return 0;
  const upc = unidadesPorCaja > 0 ? unidadesPorCaja : 1;
  return Math.round((unidades / upc) * 10) / 10;
}

type SapRow = {
  id: number;
  cn6: string;
  documento_compras: string;
  posicion: string;
  fecha_documento: string;
  recibido_at: string | null;
  proveedor_nombre: string | null;
  cantidad_pedido: string | null;
  recibido: boolean;
  anulado: boolean;
  reclamado: boolean;
  en_falta: boolean;
  estado_respuesta: string | null;
};

async function loadPedidosSapRango(
  cns: string[],
  desde: string,
  hasta: string
): Promise<SapRow[]> {
  if (cns.length === 0) return [];
  const sql = getPedidosReadonlyClient();
  return (await sql`
    SELECT
      o.id,
      lpad(right(regexp_replace(o.n_mate_prov::text, '[^0-9]', '', 'g'), 6), 6, '0') AS cn6,
      o.documento_compras,
      o.posicion,
      o.fecha_documento::text AS fecha_documento,
      o.recibido_at::text AS recibido_at,
      o.proveedor_nombre,
      o.cantidad_pedido::text AS cantidad_pedido,
      o.recibido,
      o.anulado,
      o.reclamado,
      o.en_falta,
      rl.estado_actual::text AS estado_respuesta
    FROM public.orders o
    LEFT JOIN public.respuestas_proveedor rp ON rp.documento_compras = o.documento_compras
    LEFT JOIN public.respuestas_lineas rl ON rl.respuesta_id = rp.id AND rl.posicion = o.posicion
    WHERE o.n_mate_prov IS NOT NULL
      AND regexp_replace(o.n_mate_prov::text, '[^0-9]', '', 'g') <> ''
      AND lpad(right(regexp_replace(o.n_mate_prov::text, '[^0-9]', '', 'g'), 6), 6, '0') = ANY(${cns})
      AND (
        (o.fecha_documento >= ${desde}::date AND o.fecha_documento <= ${hasta}::date)
        OR (o.recibido_at IS NOT NULL AND o.recibido_at::date >= ${desde}::date AND o.recibido_at::date <= ${hasta}::date)
        OR (o.recibido = false AND o.anulado = false AND o.fecha_documento <= ${hasta}::date)
      )
  `) as SapRow[];
}

async function loadPropuestasTramitadasSemanal(
  area: string,
  desde: string,
  hasta: string
): Promise<SemanaPedidos[]> {
  const sql = getDb();
  const rows = (await sql`
    SELECT tramitada_en::text AS tramitada_en
    FROM propuestas
    WHERE area = ${area}
      AND estado = 'tramitada'
      AND tramitada_en IS NOT NULL
      AND tramitada_en::date >= ${desde}::date
      AND tramitada_en::date <= ${hasta}::date
    ORDER BY tramitada_en ASC;
  `) as Array<{ tramitada_en: string }>;

  const map = new Map<string, SemanaPedidos>();
  for (const row of rows) {
    const d = parseDateOnly(row.tramitada_en);
    if (!d) continue;
    const { key, label } = isoWeekKey(d);
    const prev = map.get(key);
    if (prev) prev.nPedidos += 1;
    else map.set(key, { semanaKey: key, label, nPedidos: 1 });
  }
  return [...map.values()].sort((a, b) => a.semanaKey.localeCompare(b.semanaKey));
}

function mapSapToDetalle(row: SapRow, byCn: Map<string, CatalogoMed>): PedidoSapDetalle {
  const med = byCn.get(row.cn6);
  const unidades = Number(row.cantidad_pedido ?? 0);
  const cajas = unidadesACajas(unidades, med?.unidadesPorCaja ?? 1);
  const recibidoAt = row.recibido_at?.slice(0, 10) ?? null;
  const leadTimeDias =
    row.recibido && recibidoAt
      ? daysBetween(row.fecha_documento, recibidoAt)
      : null;

  return {
    id: row.id,
    documentoCompras: row.documento_compras,
    posicion: row.posicion,
    fechaDocumento: row.fecha_documento,
    recibidoAt,
    leadTimeDias,
    proveedorNombre: row.proveedor_nombre,
    cajas,
    recibido: row.recibido,
    anulado: row.anulado,
    reclamado: row.reclamado,
    estadoRespuesta: row.estado_respuesta,
  };
}

function buildSemanalSap(rows: SapRow[], desde: string, hasta: string): SemanaSap[] {
  const emitMap = new Map<string, SemanaSap>();
  const recMap = new Map<string, number>();

  for (const row of rows) {
    if (row.anulado) continue;

    const fd = parseDateOnly(row.fecha_documento);
    if (fd && row.fecha_documento >= desde && row.fecha_documento <= hasta) {
      const { key, label } = isoWeekKey(fd);
      const prev = emitMap.get(key);
      if (prev) prev.emitidos += 1;
      else emitMap.set(key, { semanaKey: key, label, emitidos: 1, recibidos: 0 });
    }

    if (row.recibido && row.recibido_at) {
      const rd = parseDateOnly(row.recibido_at);
      const recDate = row.recibido_at.slice(0, 10);
      if (rd && recDate >= desde && recDate <= hasta) {
        const { key } = isoWeekKey(rd);
        recMap.set(key, (recMap.get(key) ?? 0) + 1);
      }
    }
  }

  for (const [key, n] of recMap) {
    const existing = emitMap.get(key);
    if (existing) existing.recibidos = n;
    else {
      const d = key.match(/^(\d{4})-W(\d{2})$/);
      const label = d ? `S${Number(d[2])} ${d[1]}` : key;
      emitMap.set(key, { semanaKey: key, label, emitidos: 0, recibidos: n });
    }
  }

  return [...emitMap.values()].sort((a, b) => a.semanaKey.localeCompare(b.semanaKey));
}

function buildTopMedicamentos(
  rows: SapRow[],
  byCn: Map<string, CatalogoMed>
): TopMedicamentoCompras[] {
  const map = new Map<string, TopMedicamentoCompras>();
  for (const row of rows) {
    if (row.anulado) continue;
    const med = byCn.get(row.cn6);
    if (!med) continue;
    let item = map.get(row.cn6);
    if (!item) {
      item = {
        cn: row.cn6,
        nombre: med.nombre,
        principioActivo: med.principioActivo,
        nPedidos: 0,
        nRecibidos: 0,
        nPendientes: 0,
        nReclamados: 0,
      };
      map.set(row.cn6, item);
    }
    item.nPedidos += 1;
    if (row.recibido) item.nRecibidos += 1;
    else item.nPendientes += 1;
    if (row.reclamado) item.nReclamados += 1;
  }
  return [...map.values()]
    .sort((a, b) => b.nPedidos - a.nPedidos || a.cn.localeCompare(b.cn))
    .slice(0, 10);
}

function buildTopProveedores(rows: SapRow[], byCn: Map<string, CatalogoMed>): TopProveedorCompras[] {
  const map = new Map<string, TopProveedorCompras & { cns: Set<string> }>();
  for (const row of rows) {
    if (row.anulado) continue;
    if (!byCn.has(row.cn6)) continue;
    const proveedor = (row.proveedor_nombre ?? 'Sin proveedor').trim() || 'Sin proveedor';
    let item = map.get(proveedor);
    if (!item) {
      item = { proveedor, nPedidos: 0, nCnsDistintos: 0, nReclamados: 0, cns: new Set() };
      map.set(proveedor, item);
    }
    item.nPedidos += 1;
    item.cns.add(row.cn6);
    if (row.reclamado) item.nReclamados += 1;
  }
  return [...map.values()]
    .map(({ cns, ...rest }) => ({ ...rest, nCnsDistintos: cns.size }))
    .sort((a, b) => b.nPedidos - a.nPedidos || a.proveedor.localeCompare(b.proveedor))
    .slice(0, 10);
}

async function buildIncidenciasMedicamento(
  cn: string,
  rows: SapRow[],
  desde: string,
  hasta: string
): Promise<IncidenciasMedicamento> {
  const cnRows = rows.filter(
    (r) =>
      r.cn6 === cn &&
      !r.anulado &&
      r.fecha_documento >= desde &&
      r.fecha_documento <= hasta
  );
  const reclamaciones = cnRows.filter((r) => r.reclamado).length;
  const alertas = await loadAlertasSuministroPorCnsSafe([cn]);
  const alerta = alertas[cn] ?? null;

  return {
    cima: alerta?.tipo === 'cima',
    enFalta: cnRows.some((r) => r.en_falta) || alerta?.tipo === 'en_falta',
    sinExistencias:
      cnRows.some((r) => r.estado_respuesta === 'sin_existencias') ||
      alerta?.tipo === 'sin_existencias',
    problemaSuministro:
      cnRows.some((r) => r.estado_respuesta === 'suministro') ||
      alerta?.tipo === 'problema_suministro',
    situacionEspecial:
      cnRows.some((r) => r.estado_respuesta === 'aemps') || alerta?.tipo === 'situacion_especial',
    reclamaciones,
  };
}

function buildMedicamentoDetalle(
  cn: string,
  rows: SapRow[],
  byCn: Map<string, CatalogoMed>,
  desde: string,
  hasta: string
) {
  const med = byCn.get(cn);
  if (!med) return undefined;

  const cnRows = rows.filter((r) => r.cn6 === cn && !r.anulado);
  const pedidos = cnRows
    .filter((r) => r.fecha_documento >= desde && r.fecha_documento <= hasta)
    .map((r) => mapSapToDetalle(r, byCn));

  const weekMap = new Map<string, SemanaMedicamentoDetalle>();
  for (const p of pedidos) {
    const d = parseDateOnly(p.fechaDocumento);
    if (!d) continue;
    const { key, label } = isoWeekKey(d);
    let bucket = weekMap.get(key);
    if (!bucket) {
      bucket = { semanaKey: key, label, nPedidos: 0, cajas: 0, pedidos: [] };
      weekMap.set(key, bucket);
    }
    bucket.nPedidos += 1;
    bucket.cajas += p.cajas;
    bucket.pedidos.push(p);
  }

  const leadTimes = pedidos
    .map((p) => p.leadTimeDias)
    .filter((v): v is number => v != null && v >= 0);

  return {
    cn,
    nombre: med.nombre,
    principioActivo: med.principioActivo,
    semanas: [...weekMap.values()].sort((a, b) => a.semanaKey.localeCompare(b.semanaKey)),
    leadTimeMedianoDias: median(leadTimes),
    nPedidos: pedidos.length,
  };
}

function buildProveedorDetalle(
  proveedor: string,
  rows: SapRow[],
  byCn: Map<string, CatalogoMed>,
  desde: string,
  hasta: string
) {
  const provNorm = proveedor.trim().toLowerCase();
  const provRows = rows.filter((r) => {
    if (r.anulado) return false;
    if (!byCn.has(r.cn6)) return false;
    const name = (r.proveedor_nombre ?? 'Sin proveedor').trim().toLowerCase() || 'sin proveedor';
    return name === provNorm;
  });

  const weekMap = new Map<string, Map<string, SemanaProveedorCn>>();
  const medTotals = new Map<string, { cn: string; nombre: string; nPedidos: number; cajas: number }>();

  for (const row of provRows) {
    if (row.fecha_documento < desde || row.fecha_documento > hasta) continue;
    const med = byCn.get(row.cn6)!;
    const det = mapSapToDetalle(row, byCn);

    const fd = parseDateOnly(row.fecha_documento);
    if (!fd) continue;
    const { key, label } = isoWeekKey(fd);

    let cnMap = weekMap.get(key);
    if (!cnMap) {
      cnMap = new Map();
      weekMap.set(key, cnMap);
    }
    const cnEntry = cnMap.get(row.cn6) ?? {
      cn: row.cn6,
      nombre: med.nombre,
      cajas: 0,
      nPedidos: 0,
    };
    cnEntry.nPedidos += 1;
    cnEntry.cajas += det.cajas;
    cnMap.set(row.cn6, cnEntry);

    const mt = medTotals.get(row.cn6) ?? {
      cn: row.cn6,
      nombre: med.nombre,
      nPedidos: 0,
      cajas: 0,
    };
    mt.nPedidos += 1;
    mt.cajas += det.cajas;
    medTotals.set(row.cn6, mt);
  }

  const semanas: SemanaProveedorDetalle[] = [...weekMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([semanaKey, cnMap]) => {
      const first = [...cnMap.values()][0];
      const d = semanaKey.match(/^(\d{4})-W(\d{2})$/);
      const label = d ? `S${Number(d[2])} ${d[1]}` : semanaKey;
      return {
        semanaKey,
        label,
        porCn: [...cnMap.values()].sort((a, b) => b.cajas - a.cajas || a.cn.localeCompare(b.cn)),
      };
    });

  const leadTimes = provRows
    .filter((r) => r.recibido && r.recibido_at)
    .map((r) => daysBetween(r.fecha_documento, r.recibido_at!.slice(0, 10)))
    .filter((v): v is number => v != null && v >= 0);

  return {
    proveedor,
    semanas,
    topMedicamentos: [...medTotals.values()]
      .sort((a, b) => b.nPedidos - a.nPedidos)
      .slice(0, 10),
    nPedidos: provRows.filter((r) => r.fecha_documento >= desde && r.fecha_documento <= hasta).length,
    nReclamados: provRows.filter((r) => r.reclamado).length,
    leadTimeMedianoDias: median(leadTimes),
  };
}

export async function getAnalisisComprasDatos(
  area: string,
  desde: string,
  hasta: string,
  vista: VistaAnalisisCompras,
  cnFiltro?: string | null,
  proveedorFiltro?: string | null
): Promise<AnalisisComprasDatos> {
  const { cns, byCn } = await loadCatalogoUpe(area);
  const [semanalPropuestas, sapRows] = await Promise.all([
    loadPropuestasTramitadasSemanal(area, desde, hasta),
    loadPedidosSapRango(cns, desde, hasta),
  ]);

  const activos = sapRows.filter((r) => !r.anulado && byCn.has(r.cn6));
  const enRangoEmit = activos.filter(
    (r) => r.fecha_documento >= desde && r.fecha_documento <= hasta
  );
  const recibidos = activos.filter((r) => r.recibido);
  const pendientes = activos.filter((r) => !r.recibido);
  const reclamados = activos.filter((r) => r.reclamado);

  const leadTimes = recibidos
    .filter((r) => r.recibido_at)
    .map((r) => daysBetween(r.fecha_documento, r.recibido_at!.slice(0, 10)))
    .filter((v): v is number => v != null && v >= 0);

  const sql = getDb();
  const propCountRows = (await sql`
    SELECT COUNT(*)::int AS n
    FROM propuestas
    WHERE area = ${area}
      AND estado = 'tramitada'
      AND tramitada_en::date >= ${desde}::date
      AND tramitada_en::date <= ${hasta}::date;
  `) as Array<{ n: number }>;

  const base: AnalisisComprasDatos = {
    periodo: { desde, hasta },
    kpis: {
      propuestasTramitadas: Number(propCountRows[0]?.n ?? 0),
      pedidosSapEmitidos: enRangoEmit.length,
      pedidosSapRecibidos: recibidos.filter((r) => {
        const rec = r.recibido_at?.slice(0, 10);
        return rec && rec >= desde && rec <= hasta;
      }).length,
      pedidosSapPendientes: pendientes.length,
      pedidosReclamados: reclamados.length,
      leadTimeMedianoDias: median(leadTimes),
    },
    semanalPropuestas,
    semanalSap: buildSemanalSap(sapRows, desde, hasta),
    topMedicamentos: buildTopMedicamentos(sapRows, byCn),
    topProveedores: buildTopProveedores(sapRows, byCn),
  };

  const cn = toCn6(cnFiltro);
  if (vista === 'medicamento' && cn && byCn.has(cn)) {
    const detalle = buildMedicamentoDetalle(cn, sapRows, byCn, desde, hasta);
    if (detalle) {
      base.medicamentoDetalle = {
        ...detalle,
        incidencias: await buildIncidenciasMedicamento(cn, sapRows, desde, hasta),
      };
    }
  }

  if (vista === 'proveedor' && proveedorFiltro?.trim()) {
    base.proveedorDetalle = buildProveedorDetalle(
      proveedorFiltro.trim(),
      sapRows,
      byCn,
      desde,
      hasta
    );
  }

  return base;
}

export function defaultDesdeAnalisisCompras(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().slice(0, 10);
}

export function defaultHastaAnalisisCompras(): string {
  return new Date().toISOString().slice(0, 10);
}
