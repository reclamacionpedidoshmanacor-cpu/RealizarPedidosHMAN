import { neon } from '@neondatabase/serverless';
import 'server-only';
import {
  classifyDiagnostico,
  type DiagnosticoGrupo,
  type Servicio,
  GRUPO_LABELS,
  GRUPO_ORDER,
  gruposParaServicio,
  getServicioFromGrupo,
} from './diagnostico-grupos';
import {
  type ModoComparativa,
  resolvePeriodoBase,
  etiquetaComparativa,
  parseModoComparativa,
} from './analisis-comparativa';
import {
  cantidadUdsDesdePedido,
  cnClavePedidos,
  getPedidosReadonlyClient,
} from './pedidos-pendientes';

export type { ModoComparativa } from './analisis-comparativa';
export { parseModoComparativa, MODO_COMPARATIVA_LABELS } from './analisis-comparativa';

function getDb() {
  const url = process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Falta REALIZAR_PEDIDOS_DATABASE_URL');
  return neon(url);
}

function num(v: unknown): number { return Number(v ?? 0); }

const MESES_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function weekLabel(anio: number, semana: number | null, mes: number): string {
  const m  = MESES_SHORT[(mes - 1) % 12] ?? '?';
  const yy = String(anio).slice(2);
  return semana != null ? `S${semana} ${m}'${yy}` : `${m} ${anio}`;
}

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function mondayOfDate(date: Date): Date {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
}

function weekRefFromIsoDate(iso: string): { lunesRef: string; label: string } {
  const parsed = parseDateOnly(iso);
  if (!parsed) return { lunesRef: '', label: '—' };
  const monday = mondayOfDate(parsed);
  const tmp = new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  const d = String(monday.getUTCDate()).padStart(2, '0');
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
  return {
    lunesRef: fmtIsoDate(monday),
    label: `${d}/${m} (S${String(week).padStart(2, '0')})`,
  };
}

function addDays(iso: string, days: number): string {
  const d = parseDateOnly(iso);
  if (!d) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return fmtIsoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())));
}

function maxIsoDate(a: string, b: string): string {
  return a > b ? a : b;
}

function daysBetweenIso(desde: string, hasta: string): number {
  const a = parseDateOnly(desde);
  const b = parseDateOnly(hasta);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function servicioLabel(raw: string | null | undefined): string {
  const cleaned = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return cleaned || 'Sin servicio';
}

function servicioKey(raw: string | null | undefined): string {
  return servicioLabel(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function computeYoy(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current / previous) - 1) * 1000) / 10;
}

// Fecha a partir de la cual el dato SEMANAL es real. Antes de esta fecha la semana
// era una estimación (el dato fiable es el MENSUAL). Por eso:
//  · Histórico (antes de esta fecha)  → se agrega y muestra por MESES (correcto).
//  · Reciente (a partir de esta fecha) → se muestra por SEMANAS reales.
// Cuando se disponga de más histórico semanal real, basta con adelantar esta fecha.
export const SEMANA_REAL_DESDE = '2026-05-04';
const CUT_YM = 2026 * 100 + 5; // may 2026 — mensual fiable hasta el 3; semanal real desde el lunes 4
/** Último mes con dato mensual fiable completo (mayo 2026). YoY del año en curso no pasa de aquí. */
const YOY_MES_MAX_FIABLE = 5;

function ymKey(y: number, m: number): number { return y * 100 + m; }
function isoToYM(iso: string): { y: number; m: number } {
  const [y, m] = iso.split('-').map(Number);
  return { y: y!, m: m! };
}

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type GastoAnual = {
  anio: number;
  gasto: number;
  preparaciones: number;
  costePorPreparacion: number;
  variacionYoy: number | null;
};

/** Gasto anual por servicio clínico real (campo `servicio` de consumo_registros). */
export type GastoAnualServicioReal = {
  anio: number;
  servicioKey: string;
  servicio: string;
  gasto: number;
};

// Gasto anual histórico desglosado por servicio. La variación YoY del año en curso
// se calcula contra el MISMO PERÍODO del año anterior (no contra el año completo).
export type GastoAnualServicio = {
  anio: number;
  gastoTotal: number;
  gastoOnco: number;
  gastoHemato: number;
  variacionYoy: number | null;
  variacionYoyOnco: number | null;
  variacionYoyHemato: number | null;
  parcial: boolean;            // true para el año en curso (incompleto)
  mesHasta: number | null;     // último mes con datos (solo año en curso)
};

export type KpisAnalisis = {
  totalGasto: number;
  totalPreparaciones: number;
  totalViales: number;
  totalUnidades: number;
  mediaPackientesSemana: number;
  protocolosActivos: number;
  medicamentosDistintos: number;
  serviciosActivos: number;
  costePorPreparacion: number;
  variacionYoy: number | null;
};

export type GrupoCard = {
  grupo: DiagnosticoGrupo;
  label: string;
  totalGasto: number;
  totalPreparaciones: number;
  totalViales: number;
  totalUnidades: number;
  medicamentosDistintos: number;
  protocolosActivos: number;
  pctGasto: number;
  variacionYoy: number | null;
  gastoPorAnio: { anio: number; gasto: number }[];
};

export type TemporalPoint = {
  anio: number;
  mes: number;
  semana: number | null;
  label: string;
  viales: number;
  unidades: number;
  gasto: number;
  preparaciones: number;
  pacientes: number;
  lunesRef?: string | null;
};

export type MedicamentoEnProtocolo = {
  cn: string;
  principioActivo: string;
  nombre: string;
  totalViales: number;
  totalUnidades: number;
  totalGasto: number;
  totalPreparaciones: number;
};

export type ProtocoloDetalle = {
  protocolo: string;
  totalGasto: number;
  totalPreparaciones: number;
  totalViales: number;
  mediaPackientesSemana: number;
  costePorPreparacion: number;
  medicamentos: MedicamentoEnProtocolo[];
};

export type IndicacionDetalle = {
  indicacion: string;
  totalGasto: number;
  totalPreparaciones: number;
  protocolos: ProtocoloDetalle[];
};

export type DiagnosticoDetalle = {
  diagnostico: string;
  grupo: DiagnosticoGrupo;
  totalGasto: number;
  totalPreparaciones: number;
  indicaciones: IndicacionDetalle[];
};

export type TopProtocolo = {
  protocolo: string;
  totalGasto: number;
  totalPreparaciones: number;
  totalViales: number;
  totalUnidades: number;
  medicamentosDistintos: number;
  costePorPreparacion: number;
};

export type DxBreakdown = {
  diagnostico: string;
  indicacion: string;
  grupo: DiagnosticoGrupo;
  servicio: string;
  viales: number;
  unidades: number;
  gasto: number;
  preparaciones: number;
};

export type TemporalStackSegment = {
  id: string;
  label: string;
  gasto: number;
  pctOfMes: number;
};

export type TemporalMesStacked = {
  anio: number;
  mes: number;
  label: string;
  gastoTotal: number;
  segmentos: TemporalStackSegment[];
};

export type TopMed = {
  cn: string;
  principioActivo: string;
  nombre: string;
  totalViales: number;
  totalUnidades: number;
  totalGasto: number;
  totalPreparaciones: number;
  costePorPreparacion: number;
  variacionYoy: number | null;
  grupo: DiagnosticoGrupo;
  servicios: string[];
  temporalMensual: TemporalPoint[];
  temporalPorGrupo: TemporalMesStacked[];  // evolución mensual apilada por tipo tumoral
  temporalPorDx: TemporalMesStacked[];     // evolución mensual apilada por dx/indicación
  desgloseByDx: DxBreakdown[];
};

export type GrupoDetalle = {
  grupo: DiagnosticoGrupo;
  label: string;
  kpis: {
    totalGasto: number;
    totalPreparaciones: number;
    totalViales: number;
    totalUnidades: number;
    mediaPackientesSemana: number;
    costePorPreparacion: number;
    variacionYoy: number | null;
    medicamentosDistintos: number;
    protocolosActivos: number;
  };
  gastoPorAnio: { anio: number; gasto: number; costePorPrep: number }[];
  temporalHistorico: TemporalPoint[];
  temporalReciente: TemporalPoint[];
  topProtocolos: TopProtocolo[];
  topMedicamentos: TopMed[];
  diagnosticos: DiagnosticoDetalle[];
};

export type AbcItem = {
  cn: string;
  principioActivo: string;
  nombre: string;
  gasto: number;
  pctTotal: number;
  pctAcumulado: number;
  clase: 'A' | 'B' | 'C';
};

export type CostePacienteCiclo = {
  protocolo: string;
  indicacion: string;
  grupo: DiagnosticoGrupo;
  gasto: number;
  pacientes: number;
  preparaciones: number;
  costeMedio: number;
};

export type OutlierItem = {
  cn: string;
  principioActivo: string;
  protocolo: string;
  semanaLabel: string;
  gastoSemana: number;
  mediaSemanal: number;
  desviacion: number;
  ratio: number;
};

export type ComparativaInfo = {
  modo: ModoComparativa;
  etiqueta: string;
  base: { desde: string; hasta: string };
};

export type ServicioCard = {
  servicio: string;
  servicioKey: string;
  totalGasto: number;
  totalPreparaciones: number;
  totalViales: number;
  totalUnidades: number;
  pctGasto: number;
  variacionYoy: number | null;
  gruposDominantes: Array<{ grupo: DiagnosticoGrupo; label: string; pctServicio: number }>;
  gastoPorAnio: Array<{ anio: number; gasto: number; viales: number }>;
};

export type MedicamentoListItem = {
  cn: string;
  principioActivo: string;
  nombre: string;
  grupo: DiagnosticoGrupo;
  totalGasto: number;
  totalViales: number;
  totalUnidades: number;
  totalPreparaciones: number;
  variacionYoy: number | null;
};

export type MedicamentoTemporalPoint = {
  anio: number;
  mes: number;
  semana: number | null;
  label: string;
  lunesRef: string | null;
  consumoCajas: number;
  consumoUnidades: number;
  consumoGasto: number;
  comprasCajas: number;
  comprasUnidades: number;
  comprasGasto: number;
  preparaciones: number;
};

export type MedicamentoDetalle = {
  cn: string;
  principioActivo: string;
  nombre: string;
  grupo: DiagnosticoGrupo;
  unidadesPorCaja: number;
  precioUnidad: number;
  contextoCompras: 'area';
  comparativaEtiqueta: string;
  consumo: {
    totalGasto: number;
    totalViales: number;
    totalUnidades: number;
    totalPreparaciones: number;
    variacionYoy: number | null;
  };
  compras: {
    totalGasto: number;
    totalViales: number;
    totalUnidades: number;
    nPedidosRecibidos: number;
  };
  porServicio: ServicioCard[];
  porGrupo: GrupoCard[];
  topProtocolos: TopProtocolo[];
  topDiagnosticos: DxBreakdown[];
  temporalMensual: MedicamentoTemporalPoint[];
  temporalSemanal: MedicamentoTemporalPoint[];
};

export type AnalisisDatos = {
  periodo: { desde: string; hasta: string };
  scope: { servicio: string | null; grupo: string | null; cn: string | null };
  comparativa: ComparativaInfo;
  yoyEtiqueta: string;
  kpis: KpisAnalisis;
  gastoPorAnio: GastoAnual[];
  gastoAnualServicio: GastoAnualServicio[];
  gastoAnualServicioReal: GastoAnualServicioReal[];
  servicios: ServicioCard[];
  grupos: GrupoCard[];
  medicamentos: MedicamentoListItem[];
  topProtocolos: TopProtocolo[];
  topMedicamentos: TopMed[];
  temporalHistorico: TemporalPoint[];
  temporalReciente: TemporalPoint[];
  pareto: AbcItem[];
  costePacienteCiclo: CostePacienteCiclo[];
  outliers: OutlierItem[];
  grupoDetalle: GrupoDetalle | null;
  medicamentoDetalle: MedicamentoDetalle | null;
};

// ---------------------------------------------------------------------------
// Fila interna clasificada
// ---------------------------------------------------------------------------
type ClassifiedRow = {
  anio: number;
  mes: number;
  semana_iso: number | null;
  fecha_min: string;      // fecha real ISO yyyy-MM-dd para el corte histórico/reciente
  servicio: string;
  servicioKey: string;
  diagnostico: string;
  indicacion: string;
  protocolo: string;
  cn: string;
  principio_activo: string;
  nombre: string;
  unidadesPorCaja: number;
  precioUnidad: number;
  unidades: number;
  viales: number;
  pacientes: number;
  preparaciones: number;
  gasto: number;
  grupo: DiagnosticoGrupo;
};

// ---------------------------------------------------------------------------
// Query principal: filas agregadas por semana+cn+diagnóstico+protocolo
// ---------------------------------------------------------------------------
async function getAnalisisRaw(
  area: string,
  desde: string,
  hasta: string,
): Promise<ClassifiedRow[]> {
  const sql = getDb();
  const { y: yD, m: mD } = isoToYM(desde);
  const { y: yH, m: mH } = isoToYM(hasta);
  const ymDesde = ymKey(yD, mD);
  const ymHasta = ymKey(yH, mH);

  const rows = (await sql`
    SELECT
      cr.anio::int                                                            AS anio,
      cr.mes::int                                                             AS mes,
      cr.semana_iso::int                                                      AS semana_iso,
      COALESCE(cr.servicio, '')                                               AS servicio,
      COALESCE(cr.diagnostico, '')                                            AS diagnostico,
      COALESCE(cr.indicacion,  '')                                            AS indicacion,
      COALESCE(cr.protocolo,   '')                                            AS protocolo,
      cr.cn,
      MAX(COALESCE(m.principio_activo, cr.componente, ''))                    AS principio_activo,
      MAX(COALESCE(m.nombre,           cr.medicamento, ''))                   AS nombre,
      COALESCE(MAX(NULLIF(m.unidades_por_caja, 0)), 1)::float                 AS unidades_por_caja,
      COALESCE(MAX(m.precio_unidad), 0)::float                                AS precio_unidad,
      SUM(cr.viales_dispensados)::float                                       AS unidades,
      SUM(
        cr.viales_dispensados::numeric / COALESCE(NULLIF(m.unidades_por_caja, 0), 1)
      )::float                                                                AS viales,
      SUM(cr.num_pacientes)::int                                              AS pacientes,
      COUNT(*)::int                                                           AS preparaciones,
      SUM(cr.viales_dispensados * COALESCE(m.precio_unidad, 0))::float       AS gasto,
      MIN(cr.fecha)::text                                                     AS fecha_min
    FROM consumo_registros cr
    JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
    JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area}
    WHERE ic.area = ${area}
      AND (cr.anio * 100 + cr.mes) >= ${ymDesde}
      AND (cr.anio * 100 + cr.mes) <= ${ymHasta}
      AND lower(COALESCE(cr.tipo_componente, '')) NOT IN ('fungible', 'fluido')
    GROUP BY cr.anio, cr.mes, cr.semana_iso, cr.servicio, cr.diagnostico, cr.indicacion, cr.protocolo, cr.cn
    ORDER BY cr.anio, cr.mes, cr.semana_iso, cr.servicio, cr.cn
  `) as Array<{
    anio: number; mes: number; semana_iso: number | null;
    servicio: string; diagnostico: string; indicacion: string; protocolo: string;
    cn: string; principio_activo: string; nombre: string;
    unidades_por_caja: number; precio_unidad: number; unidades: number; viales: number;
    pacientes: number; preparaciones: number; gasto: number;
    fecha_min: string;
  }>;

  return rows.map(r => ({
    anio: num(r.anio), mes: num(r.mes),
    semana_iso: r.semana_iso != null ? num(r.semana_iso) : null,
    fecha_min: r.fecha_min,
    servicio: servicioLabel(r.servicio),
    servicioKey: servicioKey(r.servicio),
    diagnostico: r.diagnostico, indicacion: r.indicacion, protocolo: r.protocolo,
    cn: r.cn, principio_activo: r.principio_activo, nombre: r.nombre,
    unidadesPorCaja: Number(r.unidades_por_caja) > 0 ? Number(r.unidades_por_caja) : 1,
    precioUnidad: Number(r.precio_unidad),
    unidades: Number(r.unidades),
    viales: Number(r.viales), pacientes: num(r.pacientes),
    preparaciones: num(r.preparaciones), gasto: Number(r.gasto),
    grupo: classifyDiagnostico(r.diagnostico),
  }));
}

// ---------------------------------------------------------------------------
// Gasto total por año — todos los años disponibles (sin filtro de período)
// ---------------------------------------------------------------------------
async function getGastoByYear(area: string): Promise<GastoAnual[]> {
  const sql = getDb();
  const rows = (await sql`
    SELECT
      EXTRACT(YEAR FROM cr.fecha)::int                                       AS anio,
      SUM(cr.viales_dispensados * COALESCE(m.precio_unidad, 0))::float      AS gasto,
      COUNT(*)::int                                                          AS preparaciones
    FROM consumo_registros cr
    JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
    JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area}
    WHERE ic.area = ${area}
      AND lower(COALESCE(cr.tipo_componente, '')) NOT IN ('fungible', 'fluido')
    GROUP BY EXTRACT(YEAR FROM cr.fecha)
    ORDER BY EXTRACT(YEAR FROM cr.fecha)
  `) as Array<{ anio: number; gasto: number; preparaciones: number }>;

  return rows.map((r, i) => {
    const g = Number(r.gasto); const p = num(r.preparaciones);
    return {
      anio: num(r.anio), gasto: g, preparaciones: p,
      costePorPreparacion: p > 0 ? g / p : 0,
      variacionYoy: i > 0 ? computeYoy(g, Number(rows[i - 1]!.gasto)) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Gasto anual por servicio clínico real (campo `servicio` de consumo_registros).
// Devuelve todos los años y todos los servicios sin filtro de fecha.
// ---------------------------------------------------------------------------
async function getGastoAnualPorServicioReal(area: string): Promise<GastoAnualServicioReal[]> {
  const sql = getDb();
  const rows = (await sql`
    SELECT
      EXTRACT(YEAR FROM cr.fecha)::int                                           AS anio,
      COALESCE(NULLIF(TRIM(cr.servicio), ''), 'Sin servicio')                   AS servicio,
      SUM(cr.viales_dispensados * COALESCE(m.precio_unidad, 0))::float          AS gasto
    FROM consumo_registros cr
    JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
    JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area}
    WHERE ic.area = ${area}
      AND lower(COALESCE(cr.tipo_componente, '')) NOT IN ('fungible', 'fluido')
    GROUP BY EXTRACT(YEAR FROM cr.fecha), COALESCE(NULLIF(TRIM(cr.servicio), ''), 'Sin servicio')
    ORDER BY EXTRACT(YEAR FROM cr.fecha), gasto DESC
  `) as Array<{ anio: number; servicio: string; gasto: number }>;

  return rows.map((r) => ({
    anio: num(r.anio),
    servicio: String(r.servicio),
    servicioKey: servicioKey(r.servicio),
    gasto: Number(r.gasto),
  }));
}

// ---------------------------------------------------------------------------
// Gasto anual histórico desglosado por servicio (Onco sólida / Hematología).
// YoY año en curso: mismos meses fiables vs año anterior (sin doble conteo semanal).
// ---------------------------------------------------------------------------

function gastoCeldaFiable(mensual: number, semanal: number, anio: number, mes: number): number {
  const ym = ymKey(anio, mes);
  if (ym >= CUT_YM) return semanal > 0 ? semanal : mensual;
  return mensual > 0 ? mensual : semanal;
}

type YAcc = {
  total: number; onco: number; hemato: number;
  porMes: Map<number, number>;
  oncoPorMes: Map<number, number>;
  hematoPorMes: Map<number, number>;
};

function computeMesHastaYoy(yearMap: Map<number, YAcc>, realYear: number): number {
  const cur = yearMap.get(realYear);
  const prev = yearMap.get(realYear - 1);
  if (!cur || !prev) return 12;

  let mesHasta = 0;
  for (let m = 1; m <= 12; m++) {
    if ((cur.porMes.get(m) ?? 0) > 0 && (prev.porMes.get(m) ?? 0) > 0) mesHasta = m;
  }
  if (mesHasta === 0) mesHasta = 12;

  if (realYear === new Date().getFullYear() && mesHasta > YOY_MES_MAX_FIABLE) {
    if ((cur.porMes.get(YOY_MES_MAX_FIABLE) ?? 0) > 0 && (prev.porMes.get(YOY_MES_MAX_FIABLE) ?? 0) > 0) {
      mesHasta = YOY_MES_MAX_FIABLE;
    }
  }
  return mesHasta;
}

async function getGastoAnualPorServicio(area: string): Promise<GastoAnualServicio[]> {
  const sql = getDb();
  const rows = (await sql`
    SELECT
      cr.anio::int                                                            AS anio,
      cr.mes::int                                                             AS mes,
      cr.semana_iso::int                                                      AS semana_iso,
      COALESCE(cr.diagnostico, '')                                            AS diagnostico,
      SUM(cr.viales_dispensados * COALESCE(m.precio_unidad, 0))::float        AS gasto
    FROM consumo_registros cr
    JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
    JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area}
    WHERE ic.area = ${area}
      AND lower(COALESCE(cr.tipo_componente, '')) NOT IN ('fungible', 'fluido')
    GROUP BY cr.anio, cr.mes, cr.semana_iso, cr.diagnostico
  `) as Array<{ anio: number; mes: number; semana_iso: number | null; diagnostico: string; gasto: number }>;

  type Celda = { mensual: number; semanal: number; servicio: ReturnType<typeof getServicioFromGrupo> };
  const celdas = new Map<string, Celda>();

  for (const r of rows) {
    const anio = num(r.anio);
    const mes  = num(r.mes);
    const g    = Number(r.gasto);
    const key  = `${anio}|${mes}|${r.diagnostico}`;
    const isMensual = r.semana_iso == null || r.semana_iso === 0;
    let c = celdas.get(key);
    if (!c) {
      c = { mensual: 0, semanal: 0, servicio: getServicioFromGrupo(classifyDiagnostico(r.diagnostico)) };
      celdas.set(key, c);
    }
    if (isMensual) c.mensual += g; else c.semanal += g;
  }

  const yearMap = new Map<number, YAcc>();

  for (const [key, c] of celdas) {
    const [anioStr, mesStr] = key.split('|', 3);
    const anio = num(anioStr);
    const mes  = num(mesStr);
    const g    = gastoCeldaFiable(c.mensual, c.semanal, anio, mes);

    let y = yearMap.get(anio);
    if (!y) {
      y = { total: 0, onco: 0, hemato: 0, porMes: new Map(), oncoPorMes: new Map(), hematoPorMes: new Map() };
      yearMap.set(anio, y);
    }
    y.total += g;
    y.porMes.set(mes, (y.porMes.get(mes) ?? 0) + g);
    if (c.servicio === 'hematologia') {
      y.hemato += g;
      y.hematoPorMes.set(mes, (y.hematoPorMes.get(mes) ?? 0) + g);
    } else {
      y.onco += g;
      y.oncoPorMes.set(mes, (y.oncoPorMes.get(mes) ?? 0) + g);
    }
  }

  const years = [...yearMap.keys()].sort((a, b) => a - b);
  if (!years.length) return [];

  const realYear    = new Date().getFullYear();
  const mesHastaYoy = computeMesHastaYoy(yearMap, realYear);

  function yoySamePeriod(cur: YAcc, prev: YAcc | undefined, mesMap: (a: YAcc) => Map<number, number>): number | null {
    if (!prev) return null;
    let curSum = 0, prevSum = 0;
    for (let m = 1; m <= mesHastaYoy; m++) {
      curSum  += mesMap(cur).get(m) ?? 0;
      prevSum += mesMap(prev).get(m) ?? 0;
    }
    return computeYoy(curSum, prevSum);
  }

  function yoyFullYear(cur: YAcc, prev: YAcc | undefined, field: 'total' | 'onco' | 'hemato'): number | null {
    if (!prev) return null;
    return computeYoy(cur[field], prev[field]);
  }

  return years.map(anio => {
    const acc     = yearMap.get(anio)!;
    const esCurso = anio === realYear;
    const prevAcc = yearMap.get(anio - 1);

    let variacionYoy: number | null;
    let variacionYoyOnco: number | null;
    let variacionYoyHemato: number | null;

    if (esCurso) {
      variacionYoy      = yoySamePeriod(acc, prevAcc, a => a.porMes);
      variacionYoyOnco  = yoySamePeriod(acc, prevAcc, a => a.oncoPorMes);
      variacionYoyHemato = yoySamePeriod(acc, prevAcc, a => a.hematoPorMes);
    } else {
      variacionYoy       = yoyFullYear(acc, prevAcc, 'total');
      variacionYoyOnco   = yoyFullYear(acc, prevAcc, 'onco');
      variacionYoyHemato = yoyFullYear(acc, prevAcc, 'hemato');
    }

    return {
      anio,
      gastoTotal:  acc.total,
      gastoOnco:   acc.onco,
      gastoHemato: acc.hemato,
      variacionYoy,
      variacionYoyOnco,
      variacionYoyHemato,
      parcial: esCurso,
      mesHasta: esCurso ? mesHastaYoy : null,
    };
  });
}

// ---------------------------------------------------------------------------
// YoY año en curso: mismos meses (cr.anio / cr.mes) vs mismo periodo año anterior.
// Coherente con el gráfico anual histórico.
// ---------------------------------------------------------------------------
export type YoyYtd = {
  porGrupo: Map<DiagnosticoGrupo, { cur: number; prev: number }>;
  porCn: Map<string, { cur: number; prev: number }>;
  mesHasta: number;
  anio: number;
};

async function getYoyYtd(area: string, mesHasta: number, anio: number): Promise<YoyYtd> {
  const sql = getDb();
  const rows = (await sql`
    SELECT
      cr.cn,
      cr.anio::int                                                            AS anio,
      cr.mes::int                                                             AS mes,
      cr.semana_iso::int                                                      AS semana_iso,
      COALESCE(cr.diagnostico, '')                                            AS diagnostico,
      SUM(cr.viales_dispensados * COALESCE(m.precio_unidad, 0))::float        AS gasto
    FROM consumo_registros cr
    JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
    JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area}
    WHERE ic.area = ${area}
      AND cr.anio IN (${anio}, ${anio - 1})
      AND cr.mes <= ${mesHasta}
      AND lower(COALESCE(cr.tipo_componente, '')) NOT IN ('fungible', 'fluido')
    GROUP BY cr.cn, cr.anio, cr.mes, cr.semana_iso, cr.diagnostico
  `) as Array<{ cn: string; anio: number; mes: number; semana_iso: number | null; diagnostico: string; gasto: number }>;

  type Celda = { mensual: number; semanal: number; cn: string; anio: number; mes: number; diagnostico: string };
  const celdas = new Map<string, Celda>();

  for (const r of rows) {
    const key = `${r.cn}|${r.anio}|${r.mes}|${r.diagnostico}`;
    const isMensual = r.semana_iso == null || r.semana_iso === 0;
    let c = celdas.get(key);
    if (!c) {
      c = { mensual: 0, semanal: 0, cn: r.cn, anio: num(r.anio), mes: num(r.mes), diagnostico: r.diagnostico };
      celdas.set(key, c);
    }
    const g = Number(r.gasto);
    if (isMensual) c.mensual += g; else c.semanal += g;
  }

  const porGrupo = new Map<DiagnosticoGrupo, { cur: number; prev: number }>();
  const porCn    = new Map<string, { cur: number; prev: number }>();

  for (const c of celdas.values()) {
    const g = gastoCeldaFiable(c.mensual, c.semanal, c.anio, c.mes);
    const grupo = classifyDiagnostico(c.diagnostico);
    const isCur = c.anio === anio;

    const ga = porGrupo.get(grupo) ?? { cur: 0, prev: 0 };
    if (isCur) ga.cur += g; else ga.prev += g;
    porGrupo.set(grupo, ga);

    const ca = porCn.get(c.cn) ?? { cur: 0, prev: 0 };
    if (isCur) ca.cur += g; else ca.prev += g;
    porCn.set(c.cn, ca);
  }
  return { porGrupo, porCn, mesHasta, anio };
}

function yoyDeGrupos(yoy: YoyYtd, grupos: DiagnosticoGrupo[]): number | null {
  let cur = 0, prev = 0;
  for (const g of grupos) { const v = yoy.porGrupo.get(g); if (v) { cur += v.cur; prev += v.prev; } }
  return computeYoy(cur, prev);
}

function yoyMapByCn(yoy: YoyYtd): Map<string, number | null> {
  const m = new Map<string, number | null>();
  for (const [cn, v] of yoy.porCn) m.set(cn, computeYoy(v.cur, v.prev));
  return m;
}

type ComparativaMaps = {
  porGrupo: Map<DiagnosticoGrupo, { cur: number; prev: number }>;
  porCn: Map<string, { cur: number; prev: number }>;
};

function buildComparativaFromRows(cur: ClassifiedRow[], base: ClassifiedRow[]): ComparativaMaps {
  const porGrupo = new Map<DiagnosticoGrupo, { cur: number; prev: number }>();
  const porCn = new Map<string, { cur: number; prev: number }>();

  for (const r of cur) {
    const ga = porGrupo.get(r.grupo) ?? { cur: 0, prev: 0 };
    ga.cur += r.gasto;
    porGrupo.set(r.grupo, ga);
    const ca = porCn.get(r.cn) ?? { cur: 0, prev: 0 };
    ca.cur += r.gasto;
    porCn.set(r.cn, ca);
  }
  for (const r of base) {
    const ga = porGrupo.get(r.grupo) ?? { cur: 0, prev: 0 };
    ga.prev += r.gasto;
    porGrupo.set(r.grupo, ga);
    const ca = porCn.get(r.cn) ?? { cur: 0, prev: 0 };
    ca.prev += r.gasto;
    porCn.set(r.cn, ca);
  }
  return { porGrupo, porCn };
}

function variacionDeGrupos(comp: ComparativaMaps, grupos: DiagnosticoGrupo[]): number | null {
  let cur = 0;
  let prev = 0;
  for (const g of grupos) {
    const v = comp.porGrupo.get(g);
    if (v) { cur += v.cur; prev += v.prev; }
  }
  return computeYoy(cur, prev);
}

function variacionFromRows(cur: ClassifiedRow[], base: ClassifiedRow[]): number | null {
  const curSum = cur.reduce((s, r) => s + r.gasto, 0);
  const prevSum = base.reduce((s, r) => s + r.gasto, 0);
  return computeYoy(curSum, prevSum);
}

function comparativaMapByCn(comp: ComparativaMaps): Map<string, number | null> {
  const m = new Map<string, number | null>();
  for (const [cn, v] of comp.porCn) m.set(cn, computeYoy(v.cur, v.prev));
  return m;
}

function filterScopeRows(
  rows: ClassifiedRow[],
  grupoFiltro: string | null | undefined,
  servicioFiltro: string | null | undefined,
): ClassifiedRow[] {
  return rows.filter((r) => {
    if (grupoFiltro && r.grupo !== grupoFiltro) return false;
    if (servicioFiltro && r.servicioKey !== servicioKey(servicioFiltro)) return false;
    return true;
  });
}

function yoyFromGastoAnual(
  items: GastoAnualServicio[],
  servicioFiltro?: string | null,
): number | null {
  const realYear = new Date().getFullYear();
  const cur = items.find(i => i.anio === realYear);
  if (!cur) return null;
  if (servicioFiltro === 'hematologia') return cur.variacionYoyHemato;
  if (servicioFiltro === 'oncologia-solida') return cur.variacionYoyOnco;
  return cur.variacionYoy;
}

function yoyEtiquetaFromAnual(items: GastoAnualServicio[]): string {
  const realYear = new Date().getFullYear();
  const cur = items.find(i => i.anio === realYear);
  if (!cur?.mesHasta) return `${realYear} vs ${realYear - 1} (dato mensual)`;
  const m = MESES_SHORT[cur.mesHasta - 1] ?? '?';
  return `Ene–${m} ${realYear} vs Ene–${m} ${realYear - 1} · mensual fiable`;
}

// ---------------------------------------------------------------------------
// Semanas reales recientes (independiente del filtro de período largo)
// ---------------------------------------------------------------------------
async function getTemporalSemanalReciente(
  area: string,
  servicioFiltro?: string | null,
  maxWeeks = 6,
): Promise<TemporalPoint[]> {
  const sql = getDb();
  const rows = (await sql`
    SELECT
      cr.anio::int                                                            AS anio,
      cr.mes::int                                                             AS mes,
      cr.semana_iso::int                                                      AS semana_iso,
      SUM(cr.viales_dispensados)::float                                       AS viales,
      SUM(cr.num_pacientes)::int                                              AS pacientes,
      COUNT(*)::int                                                           AS preparaciones,
      SUM(cr.viales_dispensados * COALESCE(m.precio_unidad, 0))::float        AS gasto
    FROM consumo_registros cr
    JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
    JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area}
    WHERE ic.area = ${area}
      AND cr.semana_iso IS NOT NULL AND cr.semana_iso > 0
      AND (cr.anio * 100 + cr.mes) >= ${CUT_YM}
      AND lower(COALESCE(cr.tipo_componente, '')) NOT IN ('fungible', 'fluido')
    GROUP BY cr.anio, cr.mes, cr.semana_iso
    ORDER BY cr.anio DESC, cr.semana_iso DESC
    LIMIT ${maxWeeks}
  `) as Array<{
    anio: number; mes: number; semana_iso: number;
    viales: number; pacientes: number; preparaciones: number; gasto: number;
  }>;

  const points = rows.map(r => ({
    anio: num(r.anio), mes: num(r.mes), semana: num(r.semana_iso),
    label: weekLabel(num(r.anio), num(r.semana_iso), num(r.mes)),
    viales: Number(r.viales), unidades: Number(r.viales), gasto: Number(r.gasto),
    preparaciones: num(r.preparaciones), pacientes: num(r.pacientes), lunesRef: null,
  }));

  // Filtrar por servicio si aplica — requiere datos por diagnóstico; re-query si servicio
  if (servicioFiltro === 'oncologia-solida' || servicioFiltro === 'hematologia') {
    const grupos = gruposParaServicio(servicioFiltro as Servicio);
    const detailRows = (await sql`
      SELECT
        cr.anio::int AS anio, cr.mes::int AS mes, cr.semana_iso::int AS semana_iso,
        COALESCE(cr.diagnostico, '') AS diagnostico,
        SUM(cr.viales_dispensados * COALESCE(m.precio_unidad, 0))::float AS gasto,
        SUM(cr.viales_dispensados)::float AS viales,
        SUM(cr.num_pacientes)::int AS pacientes,
        COUNT(*)::int AS preparaciones
      FROM consumo_registros cr
      JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
      JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area}
      WHERE ic.area = ${area}
        AND cr.semana_iso IS NOT NULL AND cr.semana_iso > 0
        AND (cr.anio * 100 + cr.mes) >= ${CUT_YM}
        AND lower(COALESCE(cr.tipo_componente, '')) NOT IN ('fungible', 'fluido')
      GROUP BY cr.anio, cr.mes, cr.semana_iso, cr.diagnostico
    `) as Array<{
      anio: number; mes: number; semana_iso: number; diagnostico: string;
      gasto: number; viales: number; pacientes: number; preparaciones: number;
    }>;

    const weekMap = new Map<string, TemporalPoint>();
    for (const r of detailRows) {
      if (!grupos.includes(classifyDiagnostico(r.diagnostico))) continue;
      const key = `${r.anio}-W${r.semana_iso}`;
      const ex = weekMap.get(key);
      if (ex) {
        ex.gasto += Number(r.gasto); ex.viales += Number(r.viales); ex.unidades += Number(r.viales);
        ex.preparaciones += num(r.preparaciones); ex.pacientes += num(r.pacientes);
      } else {
        weekMap.set(key, {
          anio: num(r.anio), mes: num(r.mes), semana: num(r.semana_iso),
          label: weekLabel(num(r.anio), num(r.semana_iso), num(r.mes)),
          viales: Number(r.viales), unidades: Number(r.viales), gasto: Number(r.gasto),
          preparaciones: num(r.preparaciones), pacientes: num(r.pacientes), lunesRef: null,
        });
      }
    }
    return [...weekMap.values()]
      .sort((a, b) => a.anio !== b.anio ? b.anio - a.anio : (b.semana ?? 0) - (a.semana ?? 0))
      .slice(0, maxWeeks)
      .reverse();
  }

  return points.reverse();
}

// ---------------------------------------------------------------------------
// Helpers de agrupación temporal
// ---------------------------------------------------------------------------
function splitRows(rows: ClassifiedRow[]): { historic: ClassifiedRow[]; recent: ClassifiedRow[] } {
  const historic: ClassifiedRow[] = [];
  const recent: ClassifiedRow[] = [];
  for (const r of rows) {
    const ym = ymKey(r.anio, r.mes);
    const hasSemana = r.semana_iso != null && r.semana_iso > 0;
    if (hasSemana && ym >= CUT_YM) recent.push(r);
    else if (!hasSemana) historic.push(r);
  }
  return { historic, recent };
}

type MonthAcc = {
  anio: number; mes: number;
  mGasto: number; sGasto: number;
  mViales: number; sViales: number;
  mUnits: number; sUnits: number;
  mPrep: number; sPrep: number;
  mPac: number; sPac: number;
};

function pickFiable(mensual: number, semanal: number, anio: number, mes: number): number {
  return gastoCeldaFiable(mensual, semanal, anio, mes);
}

function monthAccToPoint(a: MonthAcc): TemporalPoint {
  return {
    anio: a.anio, mes: a.mes, semana: null,
    label: `${MESES_SHORT[a.mes - 1]} ${a.anio}`,
    gasto: pickFiable(a.mGasto, a.sGasto, a.anio, a.mes),
    viales: pickFiable(a.mViales, a.sViales, a.anio, a.mes),
    unidades: pickFiable(a.mUnits, a.sUnits, a.anio, a.mes),
    preparaciones: pickFiable(a.mPrep, a.sPrep, a.anio, a.mes),
    pacientes: pickFiable(a.mPac, a.sPac, a.anio, a.mes),
    lunesRef: null,
  };
}

/** Agrega por mes preferiendo filas mensuales (evita subtotales semanales parciales). */
function buildMonthlyTemporalFiable(rows: ClassifiedRow[]): TemporalPoint[] {
  const map = new Map<string, MonthAcc>();
  for (const r of rows) {
    const key = `${r.anio}-${String(r.mes).padStart(2, '0')}`;
    let a = map.get(key);
    if (!a) {
      a = {
        anio: r.anio, mes: r.mes,
        mGasto: 0, sGasto: 0,
        mViales: 0, sViales: 0,
        mUnits: 0, sUnits: 0,
        mPrep: 0, sPrep: 0,
        mPac: 0, sPac: 0,
      };
      map.set(key, a);
    }
    const isMensual = r.semana_iso == null || r.semana_iso <= 0;
    if (isMensual) {
      a.mGasto += r.gasto; a.mViales += r.viales;
      a.mUnits += r.unidades;
      a.mPrep += r.preparaciones; a.mPac += r.pacientes;
    } else {
      a.sGasto += r.gasto; a.sViales += r.viales;
      a.sUnits += r.unidades;
      a.sPrep += r.preparaciones; a.sPac += r.pacientes;
    }
  }
  return [...map.values()]
    .map(monthAccToPoint)
    .sort((a, b) => a.anio !== b.anio ? a.anio - b.anio : a.mes - b.mes);
}

function monthsInRange(desde: string, hasta: string): { anio: number; mes: number; label: string }[] {
  const start = isoToYM(desde);
  const end = isoToYM(hasta);
  const out: { anio: number; mes: number; label: string }[] = [];
  let y = start.y;
  let m = start.m;
  while (ymKey(y, m) <= ymKey(end.y, end.m)) {
    out.push({ anio: y, mes: m, label: `${MESES_SHORT[m - 1]} ${y}` });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

function fillTemporalGaps(points: TemporalPoint[], desde: string, hasta: string): TemporalPoint[] {
  const map = new Map(points.map(p => [`${p.anio}-${String(p.mes).padStart(2, '0')}`, p]));
  return monthsInRange(desde, hasta).map(({ anio, mes, label }) => {
    const key = `${anio}-${String(mes).padStart(2, '0')}`;
    return map.get(key) ?? {
      anio, mes, semana: null, label,
      viales: 0, unidades: 0, gasto: 0, preparaciones: 0, pacientes: 0, lunesRef: null,
    };
  });
}

/** Serie mensual continua con dato fiable + huecos a cero en el periodo. */
function buildCompleteMonthlyTemporal(
  rows: ClassifiedRow[],
  desde: string,
  hasta: string,
): TemporalPoint[] {
  return fillTemporalGaps(buildMonthlyTemporalFiable(rows), desde, hasta);
}

function buildWeeklyTemporal(rows: ClassifiedRow[], maxWeeks?: number): TemporalPoint[] {
  const map = new Map<string, TemporalPoint>();
  for (const r of rows) {
    const sem = r.semana_iso;
    if (sem == null || sem <= 0) continue;
    const key = `${r.anio}-W${sem}`;
    const ex = map.get(key);
    if (ex) {
      ex.viales += r.viales; ex.unidades += r.unidades; ex.gasto += r.gasto;
      ex.preparaciones += r.preparaciones; ex.pacientes += r.pacientes;
    } else {
      const ref = weekRefFromIsoDate(r.fecha_min);
      map.set(key, {
        anio: r.anio, mes: r.mes, semana: sem,
        label: ref.label || weekLabel(r.anio, sem, r.mes),
        lunesRef: ref.lunesRef || null,
        viales: r.viales,
        unidades: r.unidades,
        gasto: r.gasto,
        preparaciones: r.preparaciones,
        pacientes: r.pacientes,
      });
    }
  }
  const sorted = [...map.values()].sort((a, b) => {
    if (a.anio !== b.anio) return a.anio - b.anio;
    return (a.semana ?? 0) - (b.semana ?? 0);
  });
  return maxWeeks ? sorted.slice(-maxWeeks) : sorted;
}

function countSemanas(rows: ClassifiedRow[]): number {
  const keys = new Set(rows.map(r =>
    r.semana_iso != null ? `${r.anio}-W${r.semana_iso}` : `${r.anio}-M${r.mes}`
  ));
  return keys.size;
}

// ---------------------------------------------------------------------------
// Top 10 protocolos
// ---------------------------------------------------------------------------
function buildTopProtocols(rows: ClassifiedRow[], limit = 10): TopProtocolo[] {
  const map = new Map<string, { gasto: number; prep: number; viales: number; unidades: number; cns: Set<string> }>();
  for (const r of rows) {
    const prot = r.protocolo || '—';
    let p = map.get(prot);
    if (!p) { p = { gasto: 0, prep: 0, viales: 0, unidades: 0, cns: new Set() }; map.set(prot, p); }
    p.gasto  += r.gasto;
    p.prep   += r.preparaciones;
    p.viales += r.viales;
    p.unidades += r.unidades;
    p.cns.add(r.cn);
  }
  return [...map.entries()]
    .sort(([, a], [, b]) => b.gasto - a.gasto)
    .slice(0, limit)
    .map(([prot, p]) => ({
      protocolo: prot,
      totalGasto:          p.gasto,
      totalPreparaciones:  p.prep,
      totalViales:         p.viales,
      totalUnidades:       p.unidades,
      medicamentosDistintos: p.cns.size,
      costePorPreparacion: p.prep > 0 ? p.gasto / p.prep : 0,
    }));
}

// ---------------------------------------------------------------------------
// Top 10 medicamentos
// ---------------------------------------------------------------------------

function buildTemporalStacked(
  monthSegMap: Map<string, Map<string, { label: string; gasto: number }>>,
  monthsSorted: TemporalPoint[],
  limitSegments = 6,
): TemporalMesStacked[] {
  const segTotals = new Map<string, { label: string; total: number }>();
  for (const segs of monthSegMap.values()) {
    for (const [id, { label, gasto }] of segs) {
      const t = segTotals.get(id) ?? { label, total: 0 };
      t.total += gasto;
      segTotals.set(id, t);
    }
  }
  const topIds = new Set(
    [...segTotals.entries()]
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, limitSegments)
      .map(([id]) => id),
  );

  return monthsSorted.map(month => {
    const mk = `${month.anio}-${String(month.mes).padStart(2, '0')}`;
    const segs = monthSegMap.get(mk);
    let gastoTotal = 0;
    let otrosGasto = 0;
    const byTop = new Map<string, { label: string; gasto: number }>();

    if (segs) {
      for (const [id, { label, gasto }] of segs) {
        gastoTotal += gasto;
        if (topIds.has(id)) {
          const ex = byTop.get(id) ?? { label, gasto: 0 };
          ex.gasto += gasto;
          byTop.set(id, ex);
        } else {
          otrosGasto += gasto;
        }
      }
    }

    const segmentos: TemporalStackSegment[] = [...byTop.entries()]
      .map(([id, { label, gasto }]) => ({ id, label, gasto, pctOfMes: 0 }));
    if (otrosGasto > 0) {
      segmentos.push({ id: '__otros__', label: 'Otros', gasto: otrosGasto, pctOfMes: 0 });
    }
    for (const s of segmentos) {
      s.pctOfMes = gastoTotal > 0 ? Math.round((s.gasto / gastoTotal) * 1000) / 10 : 0;
    }
    segmentos.sort((a, b) => b.gasto - a.gasto);

    return { anio: month.anio, mes: month.mes, label: month.label, gastoTotal, segmentos };
  });
}

function buildTopMeds(
  rows: ClassifiedRow[],
  limit = 10,
  yoyByCn?: Map<string, number | null>,
  periodo?: { desde: string; hasta: string },
): TopMed[] {
  type MedAcc = {
    pa: string; nom: string; gasto: number; viales: number; unidades: number; prep: number;
    grupo: DiagnosticoGrupo;
    servicios: Set<string>;
    months: Map<string, MonthAcc>;
    monthGrupo: Map<string, Map<string, { label: string; gasto: number }>>;
    monthDx: Map<string, Map<string, { label: string; gasto: number }>>;
    dxMap: Map<string, DxBreakdown>;
  };
  const medMap = new Map<string, MedAcc>();

  for (const r of rows) {
    let m = medMap.get(r.cn);
    if (!m) {
      m = {
        pa: r.principio_activo,
        nom: r.nombre,
        gasto: 0,
        viales: 0,
        unidades: 0,
        prep: 0,
        grupo: r.grupo,
        servicios: new Set(),
        months: new Map(),
        monthGrupo: new Map(),
        monthDx: new Map(),
        dxMap: new Map(),
      };
      medMap.set(r.cn, m);
    }
    m.gasto += r.gasto; m.viales += r.viales; m.unidades += r.unidades; m.prep += r.preparaciones;
    m.servicios.add(r.servicio);

    const mk = `${r.anio}-${String(r.mes).padStart(2, '0')}`;
    let ma = m.months.get(mk);
    if (!ma) {
      ma = {
        anio: r.anio,
        mes: r.mes,
        mGasto: 0,
        sGasto: 0,
        mViales: 0,
        sViales: 0,
        mUnits: 0,
        sUnits: 0,
        mPrep: 0,
        sPrep: 0,
        mPac: 0,
        sPac: 0,
      };
      m.months.set(mk, ma);
    }
    const isMensual = r.semana_iso == null || r.semana_iso <= 0;
    if (isMensual) {
      ma.mGasto += r.gasto; ma.mViales += r.viales;
      ma.mUnits += r.unidades;
      ma.mPrep += r.preparaciones; ma.mPac += r.pacientes;
    } else {
      ma.sGasto += r.gasto; ma.sViales += r.viales;
      ma.sUnits += r.unidades;
      ma.sPrep += r.preparaciones; ma.sPac += r.pacientes;
    }

    // Apilado por tipo tumoral (vista total)
    let mg = m.monthGrupo.get(mk);
    if (!mg) { mg = new Map(); m.monthGrupo.set(mk, mg); }
    const gId = r.grupo;
    const gEx = mg.get(gId) ?? { label: GRUPO_LABELS[r.grupo], gasto: 0 };
    gEx.gasto += r.gasto;
    mg.set(gId, gEx);

    // Apilado por diagnóstico / indicación (vista grupo)
    const dxKey = `${r.diagnostico}||${r.indicacion}`;
    const dxLabel = `${r.diagnostico || '—'} / ${r.indicacion || '—'}`;
    let md = m.monthDx.get(mk);
    if (!md) { md = new Map(); m.monthDx.set(mk, md); }
    const dEx = md.get(dxKey) ?? { label: dxLabel, gasto: 0 };
    dEx.gasto += r.gasto;
    md.set(dxKey, dEx);

    const dx = m.dxMap.get(dxKey);
    if (dx) {
      dx.viales += r.viales;
      dx.unidades += r.unidades;
      dx.gasto += r.gasto;
      dx.preparaciones += r.preparaciones;
    } else {
      m.dxMap.set(dxKey, {
        diagnostico: r.diagnostico || '—',
        indicacion: r.indicacion || '—',
        grupo: r.grupo,
        servicio: r.servicio,
        viales: r.viales,
        unidades: r.unidades,
        gasto: r.gasto,
        preparaciones: r.preparaciones,
      });
    }
  }

  return [...medMap.entries()]
    .sort(([, a], [, b]) => b.gasto - a.gasto)
    .slice(0, limit)
    .map(([cn, m]) => {
      const temporalMensualRaw = [...m.months.values()]
        .map(monthAccToPoint)
        .sort((a, b) => a.anio !== b.anio ? a.anio - b.anio : a.mes - b.mes);
      const temporalMensual = periodo
        ? fillTemporalGaps(temporalMensualRaw, periodo.desde, periodo.hasta)
        : temporalMensualRaw;
      return {
        cn, principioActivo: m.pa, nombre: m.nom,
        totalViales: m.viales,
        totalUnidades: m.unidades,
        totalGasto: m.gasto,
        totalPreparaciones: m.prep,
        costePorPreparacion: m.prep > 0 ? m.gasto / m.prep : 0,
        variacionYoy: yoyByCn ? (yoyByCn.get(cn) ?? null) : null,
        grupo: m.grupo,
        servicios: [...m.servicios].sort((a, b) => a.localeCompare(b, 'es')),
        temporalMensual,
        temporalPorGrupo: buildTemporalStacked(m.monthGrupo, temporalMensual, 8),
        temporalPorDx: buildTemporalStacked(m.monthDx, temporalMensual, 6),
        desgloseByDx: [...m.dxMap.values()].sort((a, b) => b.gasto - a.gasto),
      };
    });
}

// ---------------------------------------------------------------------------
// Pareto / ABC, coste paciente-ciclo, detección de outliers
// ---------------------------------------------------------------------------
function buildPareto(rows: ClassifiedRow[], limit = 20): AbcItem[] {
  const map = new Map<string, { pa: string; nom: string; gasto: number }>();
  for (const r of rows) {
    const ex = map.get(r.cn);
    if (ex) ex.gasto += r.gasto;
    else map.set(r.cn, { pa: r.principio_activo, nom: r.nombre, gasto: r.gasto });
  }
  const total = [...map.values()].reduce((s, m) => s + m.gasto, 0);
  if (total <= 0) return [];

  const sorted = [...map.entries()]
    .sort(([, a], [, b]) => b.gasto - a.gasto)
    .slice(0, limit);

  let acum = 0;
  return sorted.map(([cn, m]) => {
    acum += m.gasto;
    const pctAcumulado = (acum / total) * 100;
    const clase: 'A' | 'B' | 'C' = pctAcumulado <= 80 ? 'A' : pctAcumulado <= 95 ? 'B' : 'C';
    return {
      cn, principioActivo: m.pa, nombre: m.nom,
      gasto: m.gasto,
      pctTotal: (m.gasto / total) * 100,
      pctAcumulado,
      clase,
    };
  });
}

function buildCostePacienteCiclo(rows: ClassifiedRow[], limit = 10): CostePacienteCiclo[] {
  void rows;
  void limit;
  return [];
}

function buildCostePacienteCicloLegacy(rows: ClassifiedRow[], limit = 10): CostePacienteCiclo[] {
  const map = new Map<string, CostePacienteCiclo>();
  for (const r of rows) {
    const key = `${r.protocolo}||${r.indicacion}`;
    const ex = map.get(key);
    if (ex) {
      ex.gasto += r.gasto; ex.pacientes += r.pacientes; ex.preparaciones += r.preparaciones;
    } else {
      map.set(key, {
        protocolo: r.protocolo || '—',
        indicacion: r.indicacion || '—',
        grupo: r.grupo,
        gasto: r.gasto,
        pacientes: r.pacientes,
        preparaciones: r.preparaciones,
        costeMedio: 0,
      });
    }
  }
  return [...map.values()]
    .filter(p => p.pacientes > 0)
    .map(p => ({ ...p, costeMedio: p.gasto / p.pacientes }))
    .sort((a, b) => b.gasto - a.gasto)
    .slice(0, limit);
}

function buildOutliers(rows: ClassifiedRow[], temporalSemanal: TemporalPoint[]): OutlierItem[] {
  if (temporalSemanal.length < 4) return [];

  // Gasto semanal por medicamento (solo semanas reales)
  type WAcc = { gasto: number; pa: string; prot: string; label: string };
  const weekMed = new Map<string, WAcc>();
  for (const r of rows) {
    if (r.semana_iso == null || r.semana_iso <= 0) continue;
    if (ymKey(r.anio, r.mes) < CUT_YM) continue;
    const wk = `${r.cn}||${r.anio}-W${r.semana_iso}`;
    const ex = weekMed.get(wk);
    if (ex) ex.gasto += r.gasto;
    else weekMed.set(wk, {
      gasto: r.gasto, pa: r.principio_activo,
      prot: r.protocolo || '—',
      label: weekLabel(r.anio, r.semana_iso, r.mes),
    });
  }

  // Media y desviación por CN
  const byCn = new Map<string, number[]>();
  for (const [wk, d] of weekMed) {
    const cn = wk.split('||')[0]!;
    const arr = byCn.get(cn) ?? [];
    arr.push(d.gasto);
    byCn.set(cn, arr);
  }

  const outliers: OutlierItem[] = [];
  for (const [wk, d] of weekMed) {
    const cn = wk.split('||')[0]!;
    const vals = byCn.get(cn)!;
    if (vals.length < 4) continue;
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
    const std = Math.sqrt(variance);
    if (std <= 0) continue;
    if (d.gasto > mean + 2 * std) {
      outliers.push({
        cn, principioActivo: d.pa, protocolo: d.prot,
        semanaLabel: d.label, gastoSemana: d.gasto,
        mediaSemanal: mean, desviacion: std,
        ratio: d.gasto / mean,
      });
    }
  }
  return outliers.sort((a, b) => b.ratio - a.ratio).slice(0, 8);
}

function buildGrupoCards(
  currentRows: ClassifiedRow[],
  baseRows: ClassifiedRow[],
  totalGastoGlobal: number,
): GrupoCard[] {
  type GAcc = { gasto: number; prep: number; viales: number; unidades: number; cns: Set<string>; prots: Set<string>; yearMap: Map<number, number> };
  const curAgg = new Map<DiagnosticoGrupo, GAcc>();
  const baseAgg = new Map<DiagnosticoGrupo, number>();

  for (const r of currentRows) {
    let g = curAgg.get(r.grupo);
    if (!g) {
      g = { gasto: 0, prep: 0, viales: 0, unidades: 0, cns: new Set(), prots: new Set(), yearMap: new Map() };
      curAgg.set(r.grupo, g);
    }
    g.gasto += r.gasto;
    g.prep += r.preparaciones;
    g.viales += r.viales;
    g.unidades += r.unidades;
    g.cns.add(r.cn);
    if (r.protocolo) g.prots.add(r.protocolo);
    g.yearMap.set(r.anio, (g.yearMap.get(r.anio) ?? 0) + r.gasto);
  }

  for (const r of baseRows) {
    baseAgg.set(r.grupo, (baseAgg.get(r.grupo) ?? 0) + r.gasto);
  }

  return GRUPO_ORDER
    .filter((g) => curAgg.has(g))
    .map((g) => {
      const d = curAgg.get(g)!;
      const prev = baseAgg.get(g) ?? 0;
      return {
        grupo: g,
        label: GRUPO_LABELS[g],
        totalGasto: d.gasto,
        totalPreparaciones: d.prep,
        totalViales: d.viales,
        totalUnidades: d.unidades,
        medicamentosDistintos: d.cns.size,
        protocolosActivos: d.prots.size,
        pctGasto: totalGastoGlobal > 0 ? (d.gasto / totalGastoGlobal) * 100 : 0,
        variacionYoy: computeYoy(d.gasto, prev),
        gastoPorAnio: [...d.yearMap.entries()]
          .sort(([a], [b]) => a - b)
          .map(([anio, gasto]) => ({ anio, gasto })),
      };
    });
}

function buildServiceCards(
  currentRows: ClassifiedRow[],
  baseRows: ClassifiedRow[],
  totalGastoGlobal: number,
): ServicioCard[] {
  type SAcc = {
    label: string;
    key: string;
    gasto: number;
    prep: number;
    viales: number;
    unidades: number;
    grupos: Map<DiagnosticoGrupo, number>;
    porAnio: Map<number, { gasto: number; viales: number }>;
  };
  const cur = new Map<string, SAcc>();
  const prev = new Map<string, number>();

  for (const r of currentRows) {
    let acc = cur.get(r.servicioKey);
    if (!acc) {
      acc = {
        label: r.servicio,
        key: r.servicioKey,
        gasto: 0,
        prep: 0,
        viales: 0,
        unidades: 0,
        grupos: new Map(),
        porAnio: new Map(),
      };
      cur.set(r.servicioKey, acc);
    }
    acc.gasto += r.gasto;
    acc.prep += r.preparaciones;
    acc.viales += r.viales;
    acc.unidades += r.unidades;
    acc.grupos.set(r.grupo, (acc.grupos.get(r.grupo) ?? 0) + r.gasto);
    const ya = acc.porAnio.get(r.anio) ?? { gasto: 0, viales: 0 };
    ya.gasto += r.gasto; ya.viales += r.viales;
    acc.porAnio.set(r.anio, ya);
  }

  for (const r of baseRows) {
    prev.set(r.servicioKey, (prev.get(r.servicioKey) ?? 0) + r.gasto);
  }

  return [...cur.values()]
    .sort((a, b) => b.gasto - a.gasto)
    .map((acc) => {
      const gruposDominantes = [...acc.grupos.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([grupo, gasto]) => ({
          grupo,
          label: GRUPO_LABELS[grupo],
          pctServicio: acc.gasto > 0 ? (gasto / acc.gasto) * 100 : 0,
        }));

      const gastoPorAnio = [...acc.porAnio.entries()]
        .sort(([a], [b]) => a - b)
        .map(([anio, v]) => ({ anio, gasto: v.gasto, viales: v.viales }));

      return {
        servicio: acc.label,
        servicioKey: acc.key,
        totalGasto: acc.gasto,
        totalPreparaciones: acc.prep,
        totalViales: acc.viales,
        totalUnidades: acc.unidades,
        pctGasto: totalGastoGlobal > 0 ? (acc.gasto / totalGastoGlobal) * 100 : 0,
        variacionYoy: computeYoy(acc.gasto, prev.get(acc.key) ?? 0),
        gruposDominantes,
        gastoPorAnio,
      };
    });
}

function buildMedicamentoList(
  rows: ClassifiedRow[],
  yoyByCn: Map<string, number | null>,
): MedicamentoListItem[] {
  const map = new Map<string, MedicamentoListItem>();
  for (const r of rows) {
    const ex = map.get(r.cn);
    if (ex) {
      ex.totalGasto += r.gasto;
      ex.totalViales += r.viales;
      ex.totalUnidades += r.unidades;
      ex.totalPreparaciones += r.preparaciones;
    } else {
      map.set(r.cn, {
        cn: r.cn,
        principioActivo: r.principio_activo,
        nombre: r.nombre,
        grupo: r.grupo,
        totalGasto: r.gasto,
        totalViales: r.viales,
        totalUnidades: r.unidades,
        totalPreparaciones: r.preparaciones,
        variacionYoy: yoyByCn.get(r.cn) ?? null,
      });
    }
  }

  return [...map.values()].sort((a, b) => b.totalGasto - a.totalGasto);
}

function buildDxBreakdownRows(rows: ClassifiedRow[]): DxBreakdown[] {
  const map = new Map<string, DxBreakdown>();
  for (const r of rows) {
    const key = `${r.diagnostico}||${r.indicacion}||${r.servicioKey}`;
    const ex = map.get(key);
    if (ex) {
      ex.viales += r.viales;
      ex.unidades += r.unidades;
      ex.gasto += r.gasto;
      ex.preparaciones += r.preparaciones;
    } else {
      map.set(key, {
        diagnostico: r.diagnostico || '—',
        indicacion: r.indicacion || '—',
        grupo: r.grupo,
        servicio: r.servicio,
        viales: r.viales,
        unidades: r.unidades,
        gasto: r.gasto,
        preparaciones: r.preparaciones,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.gasto - a.gasto);
}

type PedidoRecibidoRaw = {
  recibido_at: string;
  fecha_documento: string;
  por_entregar_cantidad: string | null;
  cantidad_recibida: string | null;
  cantidad_pedido: string | null;
};

async function loadPedidosRecibidosByCn(
  cn: string,
  desde: string,
  hasta: string,
): Promise<Array<{ fecha: string; unidades: number }>> {
  const cn6 = cnClavePedidos(cn);
  if (!cn6) return [];

  const sql = getPedidosReadonlyClient();
  const rows = (await sql`
    SELECT
      recibido_at::text AS recibido_at,
      fecha_documento::text AS fecha_documento,
      por_entregar_cantidad::text AS por_entregar_cantidad,
      cantidad_recibida::text AS cantidad_recibida,
      cantidad_pedido::text AS cantidad_pedido
    FROM public.orders
    WHERE anulado = FALSE
      AND recibido_at IS NOT NULL
      AND recibido_at::date >= ${desde}::date
      AND recibido_at::date <= ${hasta}::date
      AND n_mate_prov IS NOT NULL
      AND lpad(right(regexp_replace(n_mate_prov::text, '[^0-9]', '', 'g'), 6), 6, '0') = ${cn6}
    ORDER BY recibido_at ASC;
  `) as PedidoRecibidoRaw[];

  return rows.map((row) => ({
    fecha: (row.recibido_at || row.fecha_documento).slice(0, 10),
    unidades: cantidadUdsDesdePedido({
      recibido: true,
      por_entregar_cantidad: row.por_entregar_cantidad,
      cantidad_recibida: row.cantidad_recibida,
      cantidad_pedido: row.cantidad_pedido,
    }),
  }));
}

function buildComprasMensuales(
  compras: Array<{ fecha: string; unidades: number }>,
  unidadesPorCaja: number,
  precioUnidad: number,
): Map<string, { unidades: number; cajas: number; gasto: number }> {
  const map = new Map<string, { unidades: number; cajas: number; gasto: number }>();
  for (const compra of compras) {
    const d = parseDateOnly(compra.fecha);
    if (!d) continue;
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const ex = map.get(key) ?? { unidades: 0, cajas: 0, gasto: 0 };
    ex.unidades += compra.unidades;
    ex.cajas += compra.unidades / (unidadesPorCaja > 0 ? unidadesPorCaja : 1);
    ex.gasto += compra.unidades * precioUnidad;
    map.set(key, ex);
  }
  return map;
}

function buildComprasSemanales(
  compras: Array<{ fecha: string; unidades: number }>,
  unidadesPorCaja: number,
  precioUnidad: number,
): Map<string, { label: string; lunesRef: string; unidades: number; cajas: number; gasto: number }> {
  const map = new Map<string, { label: string; lunesRef: string; unidades: number; cajas: number; gasto: number }>();
  for (const compra of compras) {
    const ref = weekRefFromIsoDate(compra.fecha);
    if (!ref.lunesRef) continue;
    const key = ref.lunesRef;
    const ex = map.get(key) ?? { label: ref.label, lunesRef: ref.lunesRef, unidades: 0, cajas: 0, gasto: 0 };
    ex.unidades += compra.unidades;
    ex.cajas += compra.unidades / (unidadesPorCaja > 0 ? unidadesPorCaja : 1);
    ex.gasto += compra.unidades * precioUnidad;
    map.set(key, ex);
  }
  return map;
}

function mergeMedicamentoTemporalMensual(
  consumo: TemporalPoint[],
  compras: Map<string, { unidades: number; cajas: number; gasto: number }>,
): MedicamentoTemporalPoint[] {
  return consumo.map((point) => {
    const key = `${point.anio}-${String(point.mes).padStart(2, '0')}`;
    const compra = compras.get(key);
    return {
      anio: point.anio,
      mes: point.mes,
      semana: null,
      label: point.label,
      lunesRef: null,
      consumoCajas: point.viales,
      consumoUnidades: point.unidades,
      consumoGasto: point.gasto,
      comprasCajas: compra?.cajas ?? 0,
      comprasUnidades: compra?.unidades ?? 0,
      comprasGasto: compra?.gasto ?? 0,
      preparaciones: point.preparaciones,
    };
  });
}

function mergeMedicamentoTemporalSemanal(
  consumo: TemporalPoint[],
  compras: Map<string, { label: string; lunesRef: string; unidades: number; cajas: number; gasto: number }>,
): MedicamentoTemporalPoint[] {
  const keys = new Set<string>();
  for (const point of consumo) if (point.lunesRef) keys.add(point.lunesRef);
  for (const key of compras.keys()) keys.add(key);

  return [...keys]
    .sort((a, b) => a.localeCompare(b))
    .map((lunesRef) => {
      const point = consumo.find((item) => item.lunesRef === lunesRef);
      const compra = compras.get(lunesRef);
      return {
        anio: point?.anio ?? Number(lunesRef.slice(0, 4)),
        mes: point?.mes ?? Number(lunesRef.slice(5, 7)),
        semana: point?.semana ?? null,
        label: point?.label ?? compra?.label ?? lunesRef,
        lunesRef,
        consumoCajas: point?.viales ?? 0,
        consumoUnidades: point?.unidades ?? 0,
        consumoGasto: point?.gasto ?? 0,
        comprasCajas: compra?.cajas ?? 0,
        comprasUnidades: compra?.unidades ?? 0,
        comprasGasto: compra?.gasto ?? 0,
        preparaciones: point?.preparaciones ?? 0,
      };
    });
}

async function buildMedicamentoDetalle(
  area: string,
  cn: string,
  currentRows: ClassifiedRow[],
  baseRows: ClassifiedRow[],
  desde: string,
  hasta: string,
  comparativaEtiqueta: string,
): Promise<MedicamentoDetalle | null> {
  void area;
  const medRows = currentRows.filter((r) => r.cn === cn);
  if (!medRows.length) return null;

  const baseMedRows = baseRows.filter((r) => r.cn === cn);
  const sample = medRows[0]!;
  const totalGasto = medRows.reduce((s, r) => s + r.gasto, 0);
  const totalViales = medRows.reduce((s, r) => s + r.viales, 0);
  const totalUnidades = medRows.reduce((s, r) => s + r.unidades, 0);
  const totalPreparaciones = medRows.reduce((s, r) => s + r.preparaciones, 0);
  const baseGasto = baseMedRows.reduce((s, r) => s + r.gasto, 0);

  const compras = await loadPedidosRecibidosByCn(cn, desde, hasta);
  const comprasMensual = buildComprasMensuales(compras, sample.unidadesPorCaja, sample.precioUnidad);

  const weeklyDesde = maxIsoDate(desde, addDays(hasta, -183));
  const consumoSemanal = buildWeeklyTemporal(
    medRows.filter((r) => r.fecha_min >= weeklyDesde && r.fecha_min <= hasta),
  );
  const comprasSemanal = buildComprasSemanales(
    await loadPedidosRecibidosByCn(cn, weeklyDesde, hasta),
    sample.unidadesPorCaja,
    sample.precioUnidad,
  );

  const comprasTotalUnidades = compras.reduce((s, row) => s + row.unidades, 0);
  const comprasTotalViales = comprasTotalUnidades / (sample.unidadesPorCaja > 0 ? sample.unidadesPorCaja : 1);
  const comprasTotalGasto = comprasTotalUnidades * sample.precioUnidad;

  return {
    cn,
    principioActivo: sample.principio_activo,
    nombre: sample.nombre,
    grupo: sample.grupo,
    unidadesPorCaja: sample.unidadesPorCaja,
    precioUnidad: sample.precioUnidad,
    contextoCompras: 'area',
    comparativaEtiqueta,
    consumo: {
      totalGasto,
      totalViales,
      totalUnidades,
      totalPreparaciones,
      variacionYoy: computeYoy(totalGasto, baseGasto),
    },
    compras: {
      totalGasto: comprasTotalGasto,
      totalViales: comprasTotalViales,
      totalUnidades: comprasTotalUnidades,
      nPedidosRecibidos: compras.length,
    },
    porServicio: buildServiceCards(medRows, baseMedRows, totalGasto),
    porGrupo: buildGrupoCards(medRows, baseMedRows, totalGasto),
    topProtocolos: buildTopProtocols(medRows, 12),
    topDiagnosticos: buildDxBreakdownRows(medRows),
    temporalMensual: mergeMedicamentoTemporalMensual(
      buildCompleteMonthlyTemporal(medRows, desde, hasta),
      comprasMensual,
    ),
    temporalSemanal: mergeMedicamentoTemporalSemanal(consumoSemanal, comprasSemanal),
  };
}

// ---------------------------------------------------------------------------
// Detalle de grupo: dx → indicación → protocolo → medicamentos
// ---------------------------------------------------------------------------
function computeGrupoDetalle(
  grupo: DiagnosticoGrupo,
  current: ClassifiedRow[],
  grupoYoy: number | null,
  yoyByCn: Map<string, number | null>,
  desde: string,
  hasta: string,
): GrupoDetalle {
  const totalGasto    = current.reduce((s, r) => s + r.gasto, 0);
  const totalPrep     = current.reduce((s, r) => s + r.preparaciones, 0);
  const totalViales   = current.reduce((s, r) => s + r.viales, 0);
  const totalUnidades = current.reduce((s, r) => s + r.unidades, 0);
  const semanas       = countSemanas(current);

  // Gasto por año del grupo (desde las filas actuales)
  const yearMap = new Map<number, { gasto: number; prep: number }>();
  for (const r of current) {
    const y = yearMap.get(r.anio) ?? { gasto: 0, prep: 0 };
    y.gasto += r.gasto; y.prep += r.preparaciones;
    yearMap.set(r.anio, y);
  }
  const gastoPorAnio = [...yearMap.entries()].sort(([a], [b]) => a - b).map(([anio, d]) => ({
    anio, gasto: d.gasto,
    costePorPrep: d.prep > 0 ? d.gasto / d.prep : 0,
  }));

  // Temporal dual (histórico mensual + reciente semanal real)
  const { historic, recent } = splitRows(current);

  // Diagnóstico → Indicación → Protocolo → Medicamento
  type ProtInfo = {
    gasto: number; prep: number; viales: number; unidades: number; pacientes: number;
    semanas: Set<string>; meds: Map<string, MedicamentoEnProtocolo>;
  };
  type IndicInfo = { gasto: number; prep: number; prots: Map<string, ProtInfo> };
  type DxInfo   = { gasto: number; prep: number; viales: number; unidades: number; indics: Map<string, IndicInfo> };

  const dxMap = new Map<string, DxInfo>();

  for (const r of current) {
    const dx   = r.diagnostico || '—';
    const ind  = r.indicacion  || '—';
    const prot = r.protocolo   || '—';

    if (!dxMap.has(dx)) dxMap.set(dx, { gasto: 0, prep: 0, viales: 0, unidades: 0, indics: new Map() });
    const dxE = dxMap.get(dx)!;
    dxE.gasto += r.gasto; dxE.prep += r.preparaciones; dxE.viales += r.viales; dxE.unidades += r.unidades;

    if (!dxE.indics.has(ind)) dxE.indics.set(ind, { gasto: 0, prep: 0, prots: new Map() });
    const indE = dxE.indics.get(ind)!;
    indE.gasto += r.gasto; indE.prep += r.preparaciones;

    if (!indE.prots.has(prot)) indE.prots.set(prot, {
      gasto: 0,
      prep: 0,
      viales: 0,
      unidades: 0,
      pacientes: 0,
      semanas: new Set(),
      meds: new Map(),
    });
    const pE = indE.prots.get(prot)!;
    pE.gasto += r.gasto; pE.prep += r.preparaciones;
    pE.viales += r.viales; pE.unidades += r.unidades; pE.pacientes += r.pacientes;
    const sem = r.semana_iso;
    pE.semanas.add(sem != null && sem > 0 ? `${r.anio}-W${sem}` : `${r.anio}-M${r.mes}`);

    if (!pE.meds.has(r.cn)) {
      pE.meds.set(r.cn, {
        cn: r.cn,
        principioActivo: r.principio_activo,
        nombre: r.nombre,
        totalViales: 0,
        totalUnidades: 0,
        totalGasto: 0,
        totalPreparaciones: 0,
      });
    }
    const mE = pE.meds.get(r.cn)!;
    mE.totalViales += r.viales;
    mE.totalUnidades += r.unidades;
    mE.totalGasto += r.gasto;
    mE.totalPreparaciones += r.preparaciones;
  }

  const diagnosticos: DiagnosticoDetalle[] = [...dxMap.entries()]
    .sort(([, a], [, b]) => b.gasto - a.gasto)
    .map(([dx, d]) => ({
      diagnostico: dx, grupo,
      totalGasto: d.gasto, totalPreparaciones: d.prep,
      indicaciones: [...d.indics.entries()]
        .sort(([, a], [, b]) => b.gasto - a.gasto)
        .map(([ind, i]) => ({
          indicacion: ind,
          totalGasto: i.gasto, totalPreparaciones: i.prep,
          protocolos: [...i.prots.entries()]
            .sort(([, a], [, b]) => b.gasto - a.gasto || b.prep - a.prep)
            .map(([prot, p]) => ({
              protocolo: prot,
              totalGasto: p.gasto, totalPreparaciones: p.prep,
              totalViales: p.viales,
              totalUnidades: p.unidades,
              mediaPackientesSemana: p.semanas.size > 0 ? Math.round((p.pacientes / p.semanas.size) * 10) / 10 : 0,
              costePorPreparacion: p.prep > 0 ? p.gasto / p.prep : 0,
              medicamentos: [...p.meds.values()].sort((a, b) => b.totalGasto - a.totalGasto),
            })),
        })),
    }));

  return {
    grupo,
    label: GRUPO_LABELS[grupo],
    kpis: {
      totalGasto, totalPreparaciones: totalPrep, totalViales,
      totalUnidades,
      mediaPackientesSemana: 0,
      costePorPreparacion: totalPrep > 0 ? totalGasto / totalPrep : 0,
      variacionYoy: grupoYoy,
      medicamentosDistintos: new Set(current.map(r => r.cn)).size,
      protocolosActivos: new Set(current.map(r => r.protocolo).filter(Boolean)).size,
    },
    gastoPorAnio,
    temporalHistorico: buildCompleteMonthlyTemporal(current, desde, hasta),
    temporalReciente:  buildWeeklyTemporal(recent),
    topProtocolos:    buildTopProtocols(current),
    topMedicamentos:  buildTopMeds(current, 10, yoyByCn, { desde, hasta }),
    diagnosticos,
  };
}

// ---------------------------------------------------------------------------
// Función pública principal
// ---------------------------------------------------------------------------
export async function getAnalisisDatos(
  area: string,
  desde: string,
  hasta: string,
  grupoFiltro?: string | null,
  servicioFiltro?: string | null,
  modoComparativa: ModoComparativa = 'yoy',
  cnFiltro?: string | null,
): Promise<AnalisisDatos> {
  void modoComparativa;
  const modo: ModoComparativa = 'periodo-anterior';
  const { baseDesde, baseHasta } = resolvePeriodoBase(desde, hasta, modo);
  const comparativaEtiqueta = etiquetaComparativa(desde, hasta, baseDesde, baseHasta);

  const [classified, classifiedBase, gastoPorAnio, gastoAnualServicio, gastoAnualServicioReal] = await Promise.all([
    getAnalisisRaw(area, desde, hasta),
    getAnalisisRaw(area, baseDesde, baseHasta),
    getGastoByYear(area),
    getGastoAnualPorServicio(area),
    getGastoAnualPorServicioReal(area),
  ]);

  const areaTotalGasto = classified.reduce((s, r) => s + r.gasto, 0);
  const servicios = buildServiceCards(classified, classifiedBase, areaTotalGasto);

  const rowsForGroupCards = filterScopeRows(classified, null, servicioFiltro);
  const rowsForGroupCardsBase = filterScopeRows(classifiedBase, null, servicioFiltro);
  const totalGastoGrupos = rowsForGroupCards.reduce((s, r) => s + r.gasto, 0);
  const grupos = buildGrupoCards(rowsForGroupCards, rowsForGroupCardsBase, totalGastoGrupos);

  const scopeRows = filterScopeRows(classified, grupoFiltro, servicioFiltro);
  const scopeRowsBase = filterScopeRows(classifiedBase, grupoFiltro, servicioFiltro);
  const comparativaScope = buildComparativaFromRows(scopeRows, scopeRowsBase);
  const yoyByCn = comparativaMapByCn(comparativaScope);

  const scopeGasto     = scopeRows.reduce((s, r) => s + r.gasto, 0);
  const totalPrep      = scopeRows.reduce((s, r) => s + r.preparaciones, 0);
  const totalViales    = scopeRows.reduce((s, r) => s + r.viales, 0);
  const totalUnidades  = scopeRows.reduce((s, r) => s + r.unidades, 0);
  const allCns         = new Set(scopeRows.map(r => r.cn));
  const allProts       = new Set(scopeRows.map(r => r.protocolo).filter(Boolean));
  const allServicios   = new Set(scopeRows.map(r => r.servicioKey));
  const temporalHistorico = buildCompleteMonthlyTemporal(scopeRows, desde, hasta);
  const temporalReciente = buildWeeklyTemporal(scopeRows);

  const kpis: KpisAnalisis = {
    totalGasto: scopeGasto,
    totalPreparaciones: totalPrep,
    totalViales,
    totalUnidades,
    mediaPackientesSemana: 0,
    protocolosActivos: allProts.size,
    medicamentosDistintos: allCns.size,
    serviciosActivos: allServicios.size,
    costePorPreparacion: totalPrep > 0 ? scopeGasto / totalPrep : 0,
    variacionYoy: variacionFromRows(scopeRows, scopeRowsBase),
  };

  const rowsForTops: ClassifiedRow[] = scopeRows;
  const medicamentos = buildMedicamentoList(scopeRows, yoyByCn);

  let grupoDetalle: GrupoDetalle | null = null;
  if (grupoFiltro) {
    grupoDetalle = computeGrupoDetalle(
      grupoFiltro as DiagnosticoGrupo,
      scopeRows,
      variacionFromRows(scopeRows, scopeRowsBase),
      yoyByCn,
      desde, hasta,
    );
  }

  const medicamentoDetalle = cnFiltro
    ? await buildMedicamentoDetalle(area, cnFiltro, scopeRows, scopeRowsBase, desde, hasta, comparativaEtiqueta)
    : null;

  return {
    periodo: { desde, hasta },
    scope: {
      servicio: servicioFiltro ? servicioLabel(servicioFiltro) : null,
      grupo: grupoFiltro ?? null,
      cn: cnFiltro ?? null,
    },
    comparativa: {
      modo,
      etiqueta: comparativaEtiqueta,
      base: { desde: baseDesde, hasta: baseHasta },
    },
    yoyEtiqueta: comparativaEtiqueta,
    kpis,
    gastoPorAnio,
    gastoAnualServicio,
    gastoAnualServicioReal,
    servicios,
    grupos,
    medicamentos,
    topProtocolos:     buildTopProtocols(rowsForTops),
    topMedicamentos:   buildTopMeds(rowsForTops, 10, yoyByCn, { desde, hasta }),
    temporalHistorico,
    temporalReciente,
    pareto:            buildPareto(scopeRows),
    costePacienteCiclo: buildCostePacienteCiclo(scopeRows),
    outliers:          buildOutliers(rowsForTops, temporalReciente),
    grupoDetalle,
    medicamentoDetalle,
  };
}
