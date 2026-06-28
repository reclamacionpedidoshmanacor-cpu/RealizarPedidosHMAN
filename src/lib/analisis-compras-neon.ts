import { neon } from '@neondatabase/serverless';
import 'server-only';
import { listMedicamentosByArea } from '@/lib/catalogo-neon';
import { loadAlertasSuministroPorCnsSafe } from '@/lib/alertas-suministro';
import { cantidadUdsDesdePedido, getPedidosReadonlyClient } from '@/lib/pedidos-pendientes';
import type { AlertaSuministroCn } from '@/lib/pedidos-pendientes';

function getDb() {
  const url = process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Falta REALIZAR_PEDIDOS_DATABASE_URL');
  return neon(url);
}

export type VistaAnalisisCompras = 'global' | 'medicamento' | 'proveedor';

export type SemanaRef = {
  semanaKey: string;
  label: string;
  lunesRef: string;
};

export type SemanaActividad = SemanaRef & {
  nPropuestas: number;
  nPedidosSap: number;
  cajasSap: number;
  cajasPropuesta: number;
};

export type SemanaSap = SemanaRef & {
  emitidos: number;
  recibidos: number;
  cajasEmitidas: number;
  cajasRecibidas: number;
};

export type TopMedicamentoCompras = {
  cn: string;
  nombre: string;
  principioActivo: string;
  nPedidos: number;
  nCajas: number;
  nRecibidos: number;
  nPendientes: number;
  nReclamados: number;
  alerta: AlertaSuministroCn | null;
};

export type TopProveedorCompras = {
  proveedor: string;
  nPedidos: number;
  nCajas: number;
  nCnsDistintos: number;
  nReclamados: number;
  nCnsConAlerta: number;
  alertasResumen: string[];
};

export type SemanaMedicamentoAnalisis = SemanaRef & {
  nPedidosSap: number;
  cajasPedidas: number;
  tienePropuesta: boolean;
  stockActual: number | null;
  stockMinimo: number | null;
  puntoPedido: number | null;
  stockMaximo: number | null;
  cajasPropuesta: number | null;
  bajoMinimo: boolean;
  enPuntoPedido: boolean;
  superaMaximo: boolean;
};

export type IncidenciasMedicamento = {
  cima: boolean;
  enFalta: boolean;
  sinExistencias: boolean;
  problemaSuministro: boolean;
  situacionEspecial: boolean;
  reclamaciones: number;
};

export type SemanaProveedorAnalisis = SemanaRef & {
  nPedidos: number;
  cajas: number;
  porCn: Array<{ cn: string; nombre: string; nPedidos: number; cajas: number }>;
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
    cajasPedidas: number;
    cajasRecibidas: number;
  };
  semanalActividad: SemanaActividad[];
  semanalSap: SemanaSap[];
  medicamentos: TopMedicamentoCompras[];
  proveedores: TopProveedorCompras[];
  medicamentoDetalle?: {
    cn: string;
    nombre: string;
    principioActivo: string;
    unidadesPorCaja: number;
    stockMinimo: number;
    puntoPedido: number;
    stockMaximo: number | null;
    incidencias: IncidenciasMedicamento;
    semanas: SemanaMedicamentoAnalisis[];
    leadTimeMedianoDias: number | null;
    nPedidos: number;
    nCajas: number;
  };
  proveedorDetalle?: {
    proveedor: string;
    semanas: SemanaProveedorAnalisis[];
    medicamentos: Array<{ cn: string; nombre: string; nPedidos: number; cajas: number }>;
    nPedidos: number;
    nCajas: number;
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

function mondayOfDate(date: Date): Date {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
}

function fmtLunesRef(monday: Date): string {
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const day = String(monday.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtLabelSemana(monday: Date, week: number, year: number): string {
  const d = String(monday.getUTCDate()).padStart(2, '0');
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
  return `${d}/${m} (S${week})`;
}

function isoWeekKey(date: Date): SemanaRef {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  const year = tmp.getUTCFullYear();
  const monday = mondayOfDate(date);
  const lunesRef = fmtLunesRef(monday);
  return {
    semanaKey: `${year}-W${String(week).padStart(2, '0')}`,
    label: fmtLabelSemana(monday, week, year),
    lunesRef,
  };
}

function semanaRefFromKey(semanaKey: string): SemanaRef {
  const m = semanaKey.match(/^(\d{4})-W(\d{2})$/);
  if (!m) return { semanaKey, label: semanaKey, lunesRef: '' };
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const monday = new Date(mondayWeek1);
  monday.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);
  const lunesRef = fmtLunesRef(monday);
  return { semanaKey, label: fmtLabelSemana(monday, week, year), lunesRef };
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

type CatalogoMed = {
  cn: string;
  nombre: string;
  principioActivo: string;
  unidadesPorCaja: number;
  stockMinimo: number;
  puntoPedido: number;
  stockMaximo: number | null;
};

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
      stockMinimo: Number(med.stockMinimo ?? 0),
      puntoPedido: Number(med.puntoPedido ?? 0),
      stockMaximo: med.stockMaximo != null ? Number(med.stockMaximo) : null,
    });
  }
  return { cns: [...byCn.keys()], byCn };
}

function unidadesACajas(unidades: number, unidadesPorCaja: number): number {
  if (!Number.isFinite(unidades) || unidades <= 0) return 0;
  const upc = unidadesPorCaja > 0 ? unidadesPorCaja : 1;
  return Math.round((unidades / upc) * 10) / 10;
}

function sapUds(row: SapRow): number {
  return cantidadUdsDesdePedido(row);
}

/** SAP guarda cantidad_pedido en uds; el análisis se expresa en cajas. */
function sapCajas(row: SapRow, unidadesPorCaja: number): number {
  return unidadesACajas(sapUds(row), unidadesPorCaja);
}

function roundCajas(n: number): number {
  return Math.round(n * 10) / 10;
}

function propuestaCajas(pl: PropuestaLineaRow): number {
  return roundCajas(Number(pl.cajas_final));
}

type SapRow = {
  id: number;
  cn6: string;
  documento_compras: string;
  posicion: string;
  fecha_documento: string;
  recibido_at: string | null;
  proveedor_nombre: string | null;
  por_entregar_cantidad: string | null;
  cantidad_recibida: string | null;
  cantidad_pedido: string | null;
  recibido: boolean;
  anulado: boolean;
  reclamado: boolean;
  en_falta: boolean;
  estado_respuesta: string | null;
};

type PropuestaLineaRow = {
  tramitada_en: string;
  cn: string;
  stock_actual: string;
  stock_minimo_snap: number;
  punto_pedido_snap: number;
  stock_maximo_snap: number;
  cajas_final: number;
  unidades_por_caja: number;
  unidades_final: number | null;
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
      o.por_entregar_cantidad::text AS por_entregar_cantidad,
      o.cantidad_recibida::text AS cantidad_recibida,
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

async function loadPropuestasLineasTramitadas(
  area: string,
  desde: string,
  hasta: string
): Promise<PropuestaLineaRow[]> {
  const sql = getDb();
  return (await sql`
    SELECT
      p.tramitada_en::text AS tramitada_en,
      pl.cn,
      pl.stock_actual::text AS stock_actual,
      pl.stock_minimo_snap,
      pl.punto_pedido_snap,
      pl.stock_maximo_snap,
      COALESCE(pl.cajas_validadas, pl.cajas_propuestas)::numeric AS cajas_final,
      pl.unidades_por_caja,
      pl.unidades_final
    FROM propuestas p
    INNER JOIN propuestas_lineas pl ON pl.propuesta_id = p.id
    WHERE p.area = ${area}
      AND p.estado = 'tramitada'
      AND p.tramitada_en IS NOT NULL
      AND p.tramitada_en::date >= ${desde}::date
      AND p.tramitada_en::date <= ${hasta}::date
      AND COALESCE(pl.cajas_validadas, pl.cajas_propuestas) > 0
    ORDER BY p.tramitada_en ASC;
  `) as PropuestaLineaRow[];
}

function buildSemanalActividad(
  sapRows: SapRow[],
  propLineas: PropuestaLineaRow[],
  byCn: Map<string, CatalogoMed>,
  desde: string,
  hasta: string
): SemanaActividad[] {
  const map = new Map<string, SemanaActividad>();
  const propuestasPorSemana = new Set<string>();

  for (const row of sapRows) {
    if (row.anulado || !byCn.has(row.cn6)) continue;
    if (row.fecha_documento < desde || row.fecha_documento > hasta) continue;
    const fd = parseDateOnly(row.fecha_documento);
    if (!fd) continue;
    const { semanaKey, label, lunesRef } = isoWeekKey(fd);
    const med = byCn.get(row.cn6);
    if (!med) continue;
    const cajas = sapCajas(row, med.unidadesPorCaja);
    let bucket = map.get(semanaKey);
    if (!bucket) {
      bucket = { semanaKey, label, lunesRef, nPropuestas: 0, nPedidosSap: 0, cajasSap: 0, cajasPropuesta: 0 };
      map.set(semanaKey, bucket);
    }
    bucket.nPedidosSap += 1;
    bucket.cajasSap = roundCajas(bucket.cajasSap + cajas);
  }

  for (const pl of propLineas) {
    const d = parseDateOnly(pl.tramitada_en);
    if (!d) continue;
    const { semanaKey, label, lunesRef } = isoWeekKey(d);
    let bucket = map.get(semanaKey);
    if (!bucket) {
      bucket = { semanaKey, label, lunesRef, nPropuestas: 0, nPedidosSap: 0, cajasSap: 0, cajasPropuesta: 0 };
      map.set(semanaKey, bucket);
    }
    bucket.cajasPropuesta = roundCajas(bucket.cajasPropuesta + propuestaCajas(pl));
    if (!propuestasPorSemana.has(`${semanaKey}:${pl.tramitada_en.slice(0, 10)}`)) {
      propuestasPorSemana.add(`${semanaKey}:${pl.tramitada_en.slice(0, 10)}`);
      bucket.nPropuestas += 1;
    }
  }

  return [...map.values()].sort((a, b) => a.semanaKey.localeCompare(b.semanaKey));
}

function buildSemanalSap(rows: SapRow[], byCn: Map<string, CatalogoMed>, desde: string, hasta: string): SemanaSap[] {
  const emitMap = new Map<string, SemanaSap>();
  const recMap = new Map<string, { n: number; cajas: number }>();

  for (const row of rows) {
    if (row.anulado || !byCn.has(row.cn6)) continue;
    const upc = byCn.get(row.cn6)!.unidadesPorCaja;
    const cajas = sapCajas(row, upc);

    const fd = parseDateOnly(row.fecha_documento);
    if (fd && row.fecha_documento >= desde && row.fecha_documento <= hasta) {
      const { semanaKey, label, lunesRef } = isoWeekKey(fd);
      const prev = emitMap.get(semanaKey);
      if (prev) {
        prev.emitidos += 1;
        prev.cajasEmitidas = roundCajas(prev.cajasEmitidas + cajas);
      } else {
        emitMap.set(semanaKey, { semanaKey, label, lunesRef, emitidos: 1, recibidos: 0, cajasEmitidas: cajas, cajasRecibidas: 0 });
      }
    }

    if (row.recibido && row.recibido_at) {
      const rd = parseDateOnly(row.recibido_at);
      const recDate = row.recibido_at.slice(0, 10);
      if (rd && recDate >= desde && recDate <= hasta) {
        const { semanaKey } = isoWeekKey(rd);
        const prev = recMap.get(semanaKey) ?? { n: 0, cajas: 0 };
        prev.n += 1;
        prev.cajas = roundCajas(prev.cajas + cajas);
        recMap.set(semanaKey, prev);
      }
    }
  }

  for (const [key, { n, cajas }] of recMap) {
    const existing = emitMap.get(key);
    if (existing) {
      existing.recibidos = n;
      existing.cajasRecibidas = cajas;
    } else {
      const ref = semanaRefFromKey(key);
      emitMap.set(key, { ...ref, emitidos: 0, recibidos: n, cajasEmitidas: 0, cajasRecibidas: cajas });
    }
  }

  return [...emitMap.values()].sort((a, b) => a.semanaKey.localeCompare(b.semanaKey));
}

function buildMedicamentos(
  rows: SapRow[],
  byCn: Map<string, CatalogoMed>,
  desde: string,
  hasta: string
): TopMedicamentoCompras[] {
  const map = new Map<string, TopMedicamentoCompras>();
  for (const row of rows) {
    if (row.anulado) continue;
    if (row.fecha_documento < desde || row.fecha_documento > hasta) continue;
    const med = byCn.get(row.cn6);
    if (!med) continue;
    const cajas = sapCajas(row, med.unidadesPorCaja);
    let item = map.get(row.cn6);
    if (!item) {
      item = {
        cn: row.cn6,
        nombre: med.nombre,
        principioActivo: med.principioActivo,
        nPedidos: 0,
        nCajas: 0,
        nRecibidos: 0,
        nPendientes: 0,
        nReclamados: 0,
        alerta: null,
      };
      map.set(row.cn6, item);
    }
    item.nPedidos += 1;
    item.nCajas = roundCajas(item.nCajas + cajas);
    if (row.recibido) item.nRecibidos += 1;
    else item.nPendientes += 1;
    if (row.reclamado) item.nReclamados += 1;
  }
  return [...map.values()].sort((a, b) => b.nPedidos - a.nPedidos || a.cn.localeCompare(b.cn));
}

function buildProveedores(rows: SapRow[], byCn: Map<string, CatalogoMed>, desde: string, hasta: string): TopProveedorCompras[] {
  const map = new Map<string, TopProveedorCompras & { cns: Set<string> }>();
  for (const row of rows) {
    if (row.anulado) continue;
    if (row.fecha_documento < desde || row.fecha_documento > hasta) continue;
    if (!byCn.has(row.cn6)) continue;
    const med = byCn.get(row.cn6)!;
    const proveedor = (row.proveedor_nombre ?? 'Sin proveedor').trim() || 'Sin proveedor';
    const cajas = sapCajas(row, med.unidadesPorCaja);
    let item = map.get(proveedor);
    if (!item) {
      item = {
        proveedor,
        nPedidos: 0,
        nCajas: 0,
        nCnsDistintos: 0,
        nReclamados: 0,
        nCnsConAlerta: 0,
        alertasResumen: [],
        cns: new Set(),
      };
      map.set(proveedor, item);
    }
    item.nPedidos += 1;
    item.nCajas = roundCajas(item.nCajas + cajas);
    item.cns.add(row.cn6);
    if (row.reclamado) item.nReclamados += 1;
  }
  return [...map.values()]
    .map(({ cns, ...rest }) => ({
      ...rest,
      nCnsDistintos: cns.size,
      nCnsConAlerta: 0,
      alertasResumen: [] as string[],
      _cns: cns,
    }))
    .sort((a, b) => b.nPedidos - a.nPedidos || a.proveedor.localeCompare(b.proveedor));
}

async function enrichMedicamentosConAlertas(
  meds: TopMedicamentoCompras[]
): Promise<TopMedicamentoCompras[]> {
  if (meds.length === 0) return meds;
  const alertas = await loadAlertasSuministroPorCnsSafe(meds.map((m) => m.cn));
  return meds.map((m) => ({ ...m, alerta: alertas[m.cn] ?? null }));
}

type ProveedorConCns = TopProveedorCompras & { _cns: Set<string> };

async function enrichProveedoresConAlertas(proveedores: ProveedorConCns[]): Promise<TopProveedorCompras[]> {
  const allCns = [...new Set(proveedores.flatMap((p) => [...p._cns]))];
  const alertas = await loadAlertasSuministroPorCnsSafe(allCns);

  return proveedores.map(({ _cns, ...p }) => {
    const etiquetas = new Set<string>();
    let nCnsConAlerta = 0;
    for (const cn of _cns) {
      const alerta = alertas[cn];
      if (alerta) {
        nCnsConAlerta += 1;
        etiquetas.add(alerta.etiqueta);
      }
    }
    return {
      ...p,
      nCnsConAlerta,
      alertasResumen: [...etiquetas].sort(),
    };
  });
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
  propLineas: PropuestaLineaRow[],
  byCn: Map<string, CatalogoMed>,
  desde: string,
  hasta: string
) {
  const med = byCn.get(cn);
  if (!med) return undefined;

  const upc = med.unidadesPorCaja;
  const stockMinimo = med.stockMinimo;
  const puntoPedido = med.puntoPedido;
  const stockMaximo = med.stockMaximo;

  const cnRows = rows.filter(
    (r) => r.cn6 === cn && !r.anulado && r.fecha_documento >= desde && r.fecha_documento <= hasta
  );

  const weekMap = new Map<string, SemanaMedicamentoAnalisis>();
  let totalCajas = 0;
  const leadTimes: number[] = [];

  for (const row of cnRows) {
    const fd = parseDateOnly(row.fecha_documento);
    if (!fd) continue;
    const { semanaKey, label, lunesRef } = isoWeekKey(fd);
    const cajas = sapCajas(row, upc);
    totalCajas = roundCajas(totalCajas + cajas);

    if (row.recibido && row.recibido_at) {
      const lt = daysBetween(row.fecha_documento, row.recibido_at.slice(0, 10));
      if (lt != null && lt >= 0) leadTimes.push(lt);
    }

    let bucket = weekMap.get(semanaKey);
    if (!bucket) {
      bucket = {
        semanaKey,
        label,
        lunesRef,
        nPedidosSap: 0,
        cajasPedidas: 0,
        tienePropuesta: false,
        stockActual: null,
        stockMinimo: null,
        puntoPedido: null,
        stockMaximo: null,
        cajasPropuesta: null,
        bajoMinimo: false,
        enPuntoPedido: false,
        superaMaximo: false,
      };
      weekMap.set(semanaKey, bucket);
    }
    bucket.nPedidosSap += 1;
    bucket.cajasPedidas = roundCajas(bucket.cajasPedidas + cajas);
  }

  const cnPropLineas = propLineas.filter((pl) => toCn6(pl.cn) === cn);
  for (const pl of cnPropLineas) {
    const d = parseDateOnly(pl.tramitada_en);
    if (!d) continue;
    const { semanaKey, label, lunesRef } = isoWeekKey(d);
    const cajasProp = propuestaCajas(pl);
    const stockActual = roundCajas(Number(pl.stock_actual));
    const minCajas = roundCajas(Number(pl.stock_minimo_snap));
    const ppCajas = roundCajas(Number(pl.punto_pedido_snap));
    const maxCajas = roundCajas(Number(pl.stock_maximo_snap));

    let bucket = weekMap.get(semanaKey);
    if (!bucket) {
      bucket = {
        semanaKey,
        label,
        lunesRef,
        nPedidosSap: 0,
        cajasPedidas: 0,
        tienePropuesta: false,
        stockActual: null,
        stockMinimo: null,
        puntoPedido: null,
        stockMaximo: null,
        cajasPropuesta: null,
        bajoMinimo: false,
        enPuntoPedido: false,
        superaMaximo: false,
      };
      weekMap.set(semanaKey, bucket);
    }

    bucket.tienePropuesta = true;
    bucket.stockActual = stockActual;
    bucket.stockMinimo = minCajas;
    bucket.puntoPedido = ppCajas;
    bucket.stockMaximo = maxCajas;
    bucket.cajasPropuesta = roundCajas((bucket.cajasPropuesta ?? 0) + cajasProp);
    bucket.bajoMinimo = stockActual <= minCajas;
    bucket.enPuntoPedido = stockActual <= ppCajas;
    bucket.superaMaximo = maxCajas > 0 && stockActual + cajasProp > maxCajas;
  }

  const semanas = [...weekMap.values()].sort((a, b) => a.semanaKey.localeCompare(b.semanaKey));

  return {
    cn,
    nombre: med.nombre,
    principioActivo: med.principioActivo,
    unidadesPorCaja: upc,
    stockMinimo,
    puntoPedido,
    stockMaximo,
    semanas,
    leadTimeMedianoDias: median(leadTimes),
    nPedidos: cnRows.length,
    nCajas: totalCajas,
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

  const weekMap = new Map<string, SemanaProveedorAnalisis>();
  const medTotals = new Map<string, { cn: string; nombre: string; nPedidos: number; cajas: number }>();
  let totalCajas = 0;

  for (const row of provRows) {
    if (row.fecha_documento < desde || row.fecha_documento > hasta) continue;
    const med = byCn.get(row.cn6)!;
    const cajas = sapCajas(row, med.unidadesPorCaja);
    totalCajas = roundCajas(totalCajas + cajas);

    const fd = parseDateOnly(row.fecha_documento);
    if (!fd) continue;
    const { semanaKey, label, lunesRef } = isoWeekKey(fd);

    let week = weekMap.get(semanaKey);
    if (!week) {
      week = { semanaKey, label, lunesRef, nPedidos: 0, cajas: 0, porCn: [] };
      weekMap.set(semanaKey, week);
    }
    week.nPedidos += 1;
    week.cajas = roundCajas(week.cajas + cajas);

    const cnIdx = week.porCn.findIndex((c) => c.cn === row.cn6);
    if (cnIdx >= 0) {
      week.porCn[cnIdx]!.nPedidos += 1;
      week.porCn[cnIdx]!.cajas = roundCajas(week.porCn[cnIdx]!.cajas + cajas);
    } else {
      week.porCn.push({ cn: row.cn6, nombre: med.nombre, nPedidos: 1, cajas });
    }

    const mt = medTotals.get(row.cn6) ?? {
      cn: row.cn6,
      nombre: med.nombre,
      nPedidos: 0,
      cajas: 0,
    };
    mt.nPedidos += 1;
    mt.cajas = roundCajas(mt.cajas + cajas);
    medTotals.set(row.cn6, mt);
  }

  const semanas = [...weekMap.values()]
    .sort((a, b) => a.semanaKey.localeCompare(b.semanaKey))
    .map((w) => ({
      ...w,
      porCn: [...w.porCn].sort((a, b) => b.cajas - a.cajas || a.cn.localeCompare(b.cn)),
    }));

  const leadTimes = provRows
    .filter((r) => r.recibido && r.recibido_at)
    .map((r) => daysBetween(r.fecha_documento, r.recibido_at!.slice(0, 10)))
    .filter((v): v is number => v != null && v >= 0);

  const enRango = provRows.filter((r) => r.fecha_documento >= desde && r.fecha_documento <= hasta);

  return {
    proveedor,
    semanas,
    medicamentos: [...medTotals.values()].sort((a, b) => b.cajas - a.cajas || a.cn.localeCompare(b.cn)),
    nPedidos: enRango.length,
    nCajas: totalCajas,
    nReclamados: provRows.filter((r) => r.reclamado).length,
    leadTimeMedianoDias: median(leadTimes),
  };
}

function mergeMedicamentosConPropuestas(
  meds: TopMedicamentoCompras[],
  propLineas: PropuestaLineaRow[],
  byCn: Map<string, CatalogoMed>
): TopMedicamentoCompras[] {
  const map = new Map(meds.map((m) => [m.cn, m]));
  for (const pl of propLineas) {
    const cn = toCn6(pl.cn);
    if (!cn || map.has(cn)) continue;
    const med = byCn.get(cn);
    if (!med) continue;
    map.set(cn, {
      cn,
      nombre: med.nombre,
      principioActivo: med.principioActivo,
      nPedidos: 0,
      nCajas: propuestaCajas(pl),
      nRecibidos: 0,
      nPendientes: 0,
      nReclamados: 0,
      alerta: null,
    });
  }
  return [...map.values()].sort((a, b) => b.nPedidos - a.nPedidos || b.nCajas - a.nCajas || a.cn.localeCompare(b.cn));
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
  const [propLineas, sapRows] = await Promise.all([
    loadPropuestasLineasTramitadas(area, desde, hasta),
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

  const cajasPedidas = enRangoEmit.reduce(
    (acc, r) => acc + sapCajas(r, byCn.get(r.cn6)!.unidadesPorCaja),
    0
  );
  const cajasRecibidas = recibidos
    .filter((r) => {
      const rec = r.recibido_at?.slice(0, 10);
      return rec && rec >= desde && rec <= hasta;
    })
    .reduce((acc, r) => acc + sapCajas(r, byCn.get(r.cn6)!.unidadesPorCaja), 0);

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
      cajasPedidas: roundCajas(cajasPedidas),
      cajasRecibidas: roundCajas(cajasRecibidas),
    },
    semanalActividad: buildSemanalActividad(sapRows, propLineas, byCn, desde, hasta),
    semanalSap: buildSemanalSap(sapRows, byCn, desde, hasta),
    medicamentos: await enrichMedicamentosConAlertas(
      mergeMedicamentosConPropuestas(
        buildMedicamentos(sapRows, byCn, desde, hasta),
        propLineas,
        byCn
      )
    ),
    proveedores: await enrichProveedoresConAlertas(
      buildProveedores(sapRows, byCn, desde, hasta) as ProveedorConCns[]
    ),
  };

  const cn = toCn6(cnFiltro);
  if (vista === 'medicamento' && cn && byCn.has(cn)) {
    const detalle = buildMedicamentoDetalle(cn, sapRows, propLineas, byCn, desde, hasta);
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
