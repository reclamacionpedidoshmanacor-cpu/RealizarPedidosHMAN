import { neon } from '@neondatabase/serverless';
import {
  classifyDiagnostico,
  type DiagnosticoGrupo,
  type Servicio,
  GRUPO_LABELS,
  GRUPO_ORDER,
  gruposParaServicio,
  getServicioFromGrupo,
} from './diagnostico-grupos';

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

export function computeYoy(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current / previous) - 1) * 1000) / 10;
}

// Fecha a partir de la cual el dato SEMANAL es real. Antes de esta fecha la semana
// era una estimación (el dato fiable es el MENSUAL). Por eso:
//  · Histórico (antes de esta fecha)  → se agrega y muestra por MESES (correcto).
//  · Reciente (a partir de esta fecha) → se muestra por SEMANAS reales.
// Cuando se disponga de más histórico semanal real, basta con adelantar esta fecha.
export const SEMANA_REAL_DESDE = '2026-06-01';
const CUT_YM = 2026 * 100 + 6; // jun 2026 — antes: mensual fiable; después: semanal real
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
  mediaPackientesSemana: number;
  protocolosActivos: number;
  medicamentosDistintos: number;
  costePorPreparacion: number;
  variacionYoy: number | null;
};

export type GrupoCard = {
  grupo: DiagnosticoGrupo;
  label: string;
  totalGasto: number;
  totalPreparaciones: number;
  totalViales: number;
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
  gasto: number;
  preparaciones: number;
  pacientes: number;
};

export type MedicamentoEnProtocolo = {
  cn: string;
  principioActivo: string;
  nombre: string;
  totalViales: number;
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
  medicamentosDistintos: number;
  costePorPreparacion: number;
};

export type DxBreakdown = {
  diagnostico: string;
  indicacion: string;
  grupo: DiagnosticoGrupo;
  viales: number;
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
  totalGasto: number;
  totalPreparaciones: number;
  costePorPreparacion: number;
  variacionYoy: number | null;
  grupo: DiagnosticoGrupo;
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
    mediaPackientesSemana: number;
    costePorPreparacion: number;
    variacionYoy: number | null;
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

export type AnalisisDatos = {
  periodo: { desde: string; hasta: string };
  yoyEtiqueta: string;
  kpis: KpisAnalisis;
  gastoPorAnio: GastoAnual[];
  gastoAnualServicio: GastoAnualServicio[];
  grupos: GrupoCard[];
  topProtocolos: TopProtocolo[];
  topMedicamentos: TopMed[];
  temporalHistorico: TemporalPoint[];
  temporalReciente: TemporalPoint[];
  pareto: AbcItem[];
  costePacienteCiclo: CostePacienteCiclo[];
  outliers: OutlierItem[];
  grupoDetalle: GrupoDetalle | null;
};

// ---------------------------------------------------------------------------
// Fila interna clasificada
// ---------------------------------------------------------------------------
type ClassifiedRow = {
  anio: number;
  mes: number;
  semana_iso: number | null;
  fecha_min: string;      // fecha real ISO yyyy-MM-dd para el corte histórico/reciente
  diagnostico: string;
  indicacion: string;
  protocolo: string;
  cn: string;
  principio_activo: string;
  nombre: string;
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
      COALESCE(cr.diagnostico, '')                                            AS diagnostico,
      COALESCE(cr.indicacion,  '')                                            AS indicacion,
      COALESCE(cr.protocolo,   '')                                            AS protocolo,
      cr.cn,
      MAX(COALESCE(m.principio_activo, cr.componente, ''))                    AS principio_activo,
      MAX(COALESCE(m.nombre,           cr.medicamento, ''))                   AS nombre,
      SUM(cr.viales_dispensados)::float                                       AS viales,
      SUM(cr.num_pacientes)::int                                              AS pacientes,
      COUNT(*)::int                                                           AS preparaciones,
      SUM(cr.viales_dispensados * COALESCE(m.precio_unidad, 0))::float       AS gasto,
      MIN(cr.fecha)::text                                                     AS fecha_min
    FROM consumo_registros cr
    JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
    LEFT JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area}
    WHERE ic.area = ${area}
      AND (cr.anio * 100 + cr.mes) >= ${ymDesde}
      AND (cr.anio * 100 + cr.mes) <= ${ymHasta}
      AND lower(COALESCE(cr.tipo_componente, '')) NOT IN ('fungible', 'fluido')
    GROUP BY cr.anio, cr.mes, cr.semana_iso, cr.diagnostico, cr.indicacion, cr.protocolo, cr.cn
    ORDER BY cr.anio, cr.mes, cr.semana_iso, cr.cn
  `) as Array<{
    anio: number; mes: number; semana_iso: number | null;
    diagnostico: string; indicacion: string; protocolo: string;
    cn: string; principio_activo: string; nombre: string;
    viales: number; pacientes: number; preparaciones: number; gasto: number;
    fecha_min: string;
  }>;

  return rows.map(r => ({
    anio: num(r.anio), mes: num(r.mes),
    semana_iso: r.semana_iso != null ? num(r.semana_iso) : null,
    fecha_min: r.fecha_min,
    diagnostico: r.diagnostico, indicacion: r.indicacion, protocolo: r.protocolo,
    cn: r.cn, principio_activo: r.principio_activo, nombre: r.nombre,
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
    LEFT JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area}
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
    LEFT JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area}
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
    LEFT JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area}
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
    LEFT JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area}
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
    viales: Number(r.viales), gasto: Number(r.gasto),
    preparaciones: num(r.preparaciones), pacientes: num(r.pacientes),
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
      LEFT JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area}
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
        ex.gasto += Number(r.gasto); ex.viales += Number(r.viales);
        ex.preparaciones += num(r.preparaciones); ex.pacientes += num(r.pacientes);
      } else {
        weekMap.set(key, {
          anio: num(r.anio), mes: num(r.mes), semana: num(r.semana_iso),
          label: weekLabel(num(r.anio), num(r.semana_iso), num(r.mes)),
          viales: Number(r.viales), gasto: Number(r.gasto),
          preparaciones: num(r.preparaciones), pacientes: num(r.pacientes),
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
    // Corte por columnas anio/mes (dato fiable), no por fecha
    if (ymKey(r.anio, r.mes) < CUT_YM) historic.push(r);
    else if (r.semana_iso != null && r.semana_iso > 0) recent.push(r);
  }
  return { historic, recent };
}

function buildMonthlyTemporal(rows: ClassifiedRow[]): TemporalPoint[] {
  const map = new Map<string, TemporalPoint>();
  for (const r of rows) {
    const key = `${r.anio}-${String(r.mes).padStart(2, '0')}`;
    const ex = map.get(key);
    if (ex) {
      ex.viales += r.viales; ex.gasto += r.gasto;
      ex.preparaciones += r.preparaciones; ex.pacientes += r.pacientes;
    } else {
      map.set(key, {
        anio: r.anio, mes: r.mes, semana: null,
        label: `${MESES_SHORT[r.mes - 1]} ${r.anio}`,
        viales: r.viales, gasto: r.gasto, preparaciones: r.preparaciones, pacientes: r.pacientes,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.anio !== b.anio ? a.anio - b.anio : a.mes - b.mes);
}

function buildWeeklyTemporal(rows: ClassifiedRow[], maxWeeks?: number): TemporalPoint[] {
  const map = new Map<string, TemporalPoint>();
  for (const r of rows) {
    const sem = r.semana_iso;
    if (sem == null || sem <= 0) continue;
    const key = `${r.anio}-W${sem}`;
    const ex = map.get(key);
    if (ex) {
      ex.viales += r.viales; ex.gasto += r.gasto;
      ex.preparaciones += r.preparaciones; ex.pacientes += r.pacientes;
    } else {
      map.set(key, {
        anio: r.anio, mes: r.mes, semana: sem,
        label: weekLabel(r.anio, sem, r.mes),
        viales: r.viales, gasto: r.gasto, preparaciones: r.preparaciones, pacientes: r.pacientes,
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
  const map = new Map<string, { gasto: number; prep: number; viales: number; cns: Set<string> }>();
  for (const r of rows) {
    const prot = r.protocolo || '—';
    let p = map.get(prot);
    if (!p) { p = { gasto: 0, prep: 0, viales: 0, cns: new Set() }; map.set(prot, p); }
    p.gasto  += r.gasto;
    p.prep   += r.preparaciones;
    p.viales += r.viales;
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
): TopMed[] {
  type MedAcc = {
    pa: string; nom: string; gasto: number; viales: number; prep: number;
    grupo: DiagnosticoGrupo;
    months: Map<string, TemporalPoint>;
    monthGrupo: Map<string, Map<string, { label: string; gasto: number }>>;
    monthDx: Map<string, Map<string, { label: string; gasto: number }>>;
    dxMap: Map<string, DxBreakdown>;
  };
  const medMap = new Map<string, MedAcc>();

  for (const r of rows) {
    let m = medMap.get(r.cn);
    if (!m) {
      m = {
        pa: r.principio_activo, nom: r.nombre, gasto: 0, viales: 0, prep: 0, grupo: r.grupo,
        months: new Map(),
        monthGrupo: new Map(),
        monthDx: new Map(),
        dxMap: new Map(),
      };
      medMap.set(r.cn, m);
    }
    m.gasto += r.gasto; m.viales += r.viales; m.prep += r.preparaciones;

    const mk = `${r.anio}-${String(r.mes).padStart(2, '0')}`;
    const mp = m.months.get(mk);
    if (mp) {
      mp.viales += r.viales; mp.gasto += r.gasto;
      mp.preparaciones += r.preparaciones; mp.pacientes += r.pacientes;
    } else {
      m.months.set(mk, {
        anio: r.anio, mes: r.mes, semana: null,
        label: `${MESES_SHORT[r.mes - 1]} ${r.anio}`,
        viales: r.viales, gasto: r.gasto, preparaciones: r.preparaciones, pacientes: r.pacientes,
      });
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
      dx.viales += r.viales; dx.gasto += r.gasto; dx.preparaciones += r.preparaciones;
    } else {
      m.dxMap.set(dxKey, {
        diagnostico: r.diagnostico || '—', indicacion: r.indicacion || '—', grupo: r.grupo,
        viales: r.viales, gasto: r.gasto, preparaciones: r.preparaciones,
      });
    }
  }

  return [...medMap.entries()]
    .sort(([, a], [, b]) => b.gasto - a.gasto)
    .slice(0, limit)
    .map(([cn, m]) => {
      const temporalMensual = [...m.months.values()].sort((a, b) =>
        a.anio !== b.anio ? a.anio - b.anio : a.mes - b.mes,
      );
      return {
        cn, principioActivo: m.pa, nombre: m.nom,
        totalViales: m.viales, totalGasto: m.gasto, totalPreparaciones: m.prep,
        costePorPreparacion: m.prep > 0 ? m.gasto / m.prep : 0,
        variacionYoy: yoyByCn ? (yoyByCn.get(cn) ?? null) : null,
        grupo: m.grupo,
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

// ---------------------------------------------------------------------------
// Detalle de grupo: dx → indicación → protocolo → medicamentos
// ---------------------------------------------------------------------------
function computeGrupoDetalle(
  grupo: DiagnosticoGrupo,
  current: ClassifiedRow[],
  grupoYoy: number | null,
  yoyByCn: Map<string, number | null>,
): GrupoDetalle {
  const totalGasto    = current.reduce((s, r) => s + r.gasto, 0);
  const totalPrep     = current.reduce((s, r) => s + r.preparaciones, 0);
  const totalViales   = current.reduce((s, r) => s + r.viales, 0);
  const totalPacientes = current.reduce((s, r) => s + r.pacientes, 0);
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
    gasto: number; prep: number; viales: number; pacientes: number;
    semanas: Set<string>; meds: Map<string, MedicamentoEnProtocolo>;
  };
  type IndicInfo = { gasto: number; prep: number; prots: Map<string, ProtInfo> };
  type DxInfo   = { gasto: number; prep: number; viales: number; indics: Map<string, IndicInfo> };

  const dxMap = new Map<string, DxInfo>();

  for (const r of current) {
    const dx   = r.diagnostico || '—';
    const ind  = r.indicacion  || '—';
    const prot = r.protocolo   || '—';

    if (!dxMap.has(dx)) dxMap.set(dx, { gasto: 0, prep: 0, viales: 0, indics: new Map() });
    const dxE = dxMap.get(dx)!;
    dxE.gasto += r.gasto; dxE.prep += r.preparaciones; dxE.viales += r.viales;

    if (!dxE.indics.has(ind)) dxE.indics.set(ind, { gasto: 0, prep: 0, prots: new Map() });
    const indE = dxE.indics.get(ind)!;
    indE.gasto += r.gasto; indE.prep += r.preparaciones;

    if (!indE.prots.has(prot)) indE.prots.set(prot, { gasto: 0, prep: 0, viales: 0, pacientes: 0, semanas: new Set(), meds: new Map() });
    const pE = indE.prots.get(prot)!;
    pE.gasto += r.gasto; pE.prep += r.preparaciones;
    pE.viales += r.viales; pE.pacientes += r.pacientes;
    const sem = r.semana_iso;
    pE.semanas.add(sem != null && sem > 0 ? `${r.anio}-W${sem}` : `${r.anio}-M${r.mes}`);

    if (!pE.meds.has(r.cn)) pE.meds.set(r.cn, { cn: r.cn, principioActivo: r.principio_activo, nombre: r.nombre, totalViales: 0, totalGasto: 0, totalPreparaciones: 0 });
    const mE = pE.meds.get(r.cn)!;
    mE.totalViales += r.viales; mE.totalGasto += r.gasto; mE.totalPreparaciones += r.preparaciones;
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
      mediaPackientesSemana: semanas > 0 ? Math.round((totalPacientes / semanas) * 10) / 10 : 0,
      costePorPreparacion: totalPrep > 0 ? totalGasto / totalPrep : 0,
      variacionYoy: grupoYoy,
    },
    gastoPorAnio,
    temporalHistorico: buildMonthlyTemporal(historic),
    temporalReciente:  buildWeeklyTemporal(recent),
    topProtocolos:    buildTopProtocols(current),
    topMedicamentos:  buildTopMeds(current, 10, yoyByCn),
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
): Promise<AnalisisDatos> {
  const realYear = new Date().getFullYear();

  const [classified, gastoPorAnio, gastoAnualServicio, temporalReciente] = await Promise.all([
    getAnalisisRaw(area, desde, hasta),
    getGastoByYear(area),
    getGastoAnualPorServicio(area),
    getTemporalSemanalReciente(area, servicioFiltro, 6),
  ]);

  const curAnual = gastoAnualServicio.find(g => g.anio === realYear);
  const mesHasta = curAnual?.mesHasta ?? new Date().getMonth() + 1;
  const yoy = await getYoyYtd(area, mesHasta, realYear);
  const yoyByCn = yoyMapByCn(yoy);
  const yoyEtiqueta = yoyEtiquetaFromAnual(gastoAnualServicio);

  // Group aggregation
  type GAcc = { gasto: number; prep: number; viales: number; cns: Set<string>; prots: Set<string>; yearMap: Map<number, number> };
  const grupoAgg = new Map<DiagnosticoGrupo, GAcc>();
  for (const r of classified) {
    let g = grupoAgg.get(r.grupo);
    if (!g) { g = { gasto: 0, prep: 0, viales: 0, cns: new Set(), prots: new Set(), yearMap: new Map() }; grupoAgg.set(r.grupo, g); }
    g.gasto += r.gasto; g.prep += r.preparaciones; g.viales += r.viales;
    g.cns.add(r.cn);
    if (r.protocolo) g.prots.add(r.protocolo);
    g.yearMap.set(r.anio, (g.yearMap.get(r.anio) ?? 0) + r.gasto);
  }

  const totalGastoGlobal = [...grupoAgg.values()].reduce((s, g) => s + g.gasto, 0);

  const grupos: GrupoCard[] = GRUPO_ORDER
    .filter(g => grupoAgg.has(g))
    .map(g => {
      const d = grupoAgg.get(g)!;
      return {
        grupo: g, label: GRUPO_LABELS[g],
        totalGasto: d.gasto, totalPreparaciones: d.prep, totalViales: d.viales,
        medicamentosDistintos: d.cns.size, protocolosActivos: d.prots.size,
        pctGasto: totalGastoGlobal > 0 ? (d.gasto / totalGastoGlobal) * 100 : 0,
        variacionYoy: yoyDeGrupos(yoy, [g]),
        gastoPorAnio: [...d.yearMap.entries()].sort(([a], [b]) => a - b).map(([anio, gasto]) => ({ anio, gasto })),
      };
    });

  const isService = servicioFiltro === 'oncologia-solida' || servicioFiltro === 'hematologia';
  const scopeRows = isService
    ? classified.filter(r => gruposParaServicio(servicioFiltro as Servicio).includes(r.grupo))
    : classified;

  const scopeGasto     = scopeRows.reduce((s, r) => s + r.gasto, 0);
  const totalPrep      = scopeRows.reduce((s, r) => s + r.preparaciones, 0);
  const totalViales    = scopeRows.reduce((s, r) => s + r.viales, 0);
  const totalPacientes = scopeRows.reduce((s, r) => s + r.pacientes, 0);
  const semanas        = countSemanas(scopeRows);
  const allCns         = new Set(scopeRows.map(r => r.cn));
  const allProts       = new Set(scopeRows.map(r => r.protocolo).filter(Boolean));

  const kpis: KpisAnalisis = {
    totalGasto: scopeGasto, totalPreparaciones: totalPrep, totalViales,
    mediaPackientesSemana: semanas > 0 ? Math.round((totalPacientes / semanas) * 10) / 10 : 0,
    protocolosActivos: allProts.size, medicamentosDistintos: allCns.size,
    costePorPreparacion: totalPrep > 0 ? scopeGasto / totalPrep : 0,
    // Coherente con el gráfico anual: mismo periodo del año en curso vs año anterior
    variacionYoy: yoyFromGastoAnual(gastoAnualServicio, servicioFiltro),
  };

  const rowsForTops: ClassifiedRow[] = (servicioFiltro && !grupoFiltro)
    ? classified.filter(r => gruposParaServicio(servicioFiltro as Servicio).includes(r.grupo))
    : classified;

  const { historic } = splitRows(rowsForTops);

  let grupoDetalle: GrupoDetalle | null = null;
  if (grupoFiltro) {
    const grupoRows = classified.filter(r => r.grupo === grupoFiltro);
    grupoDetalle = computeGrupoDetalle(
      grupoFiltro as DiagnosticoGrupo, grupoRows,
      yoyDeGrupos(yoy, [grupoFiltro as DiagnosticoGrupo]), yoyByCn,
    );
  }

  return {
    periodo: { desde, hasta },
    yoyEtiqueta,
    kpis,
    gastoPorAnio,
    gastoAnualServicio,
    grupos,
    topProtocolos:     buildTopProtocols(rowsForTops),
    topMedicamentos:   buildTopMeds(rowsForTops, 10, yoyByCn),
    temporalHistorico: buildMonthlyTemporal(historic),
    temporalReciente,
    pareto:            buildPareto(scopeRows),
    costePacienteCiclo: buildCostePacienteCiclo(scopeRows),
    outliers:          buildOutliers(rowsForTops, temporalReciente),
    grupoDetalle,
  };
}
