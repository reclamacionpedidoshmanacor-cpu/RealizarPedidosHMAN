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
  parcial: boolean;            // true para el año en curso (incompleto)
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
  temporalMensual: TemporalPoint[];   // serie mensual (dato fiable en todo el histórico)
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

export type AnalisisDatos = {
  periodo: { desde: string; hasta: string };
  kpis: KpisAnalisis;
  gastoPorAnio: GastoAnual[];
  gastoAnualServicio: GastoAnualServicio[];
  grupos: GrupoCard[];
  topProtocolos: TopProtocolo[];
  topMedicamentos: TopMed[];
  temporalHistorico: TemporalPoint[];
  temporalReciente: TemporalPoint[];
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
      AND cr.fecha >= ${desde}::date
      AND cr.fecha <= ${hasta}::date
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
// Para el año en curso, el YoY se compara contra el MISMO período (mismos meses)
// del año anterior, evitando la distorsión de comparar año parcial vs completo.
// ---------------------------------------------------------------------------
async function getGastoAnualPorServicio(area: string): Promise<GastoAnualServicio[]> {
  const sql = getDb();
  const rows = (await sql`
    SELECT
      EXTRACT(YEAR  FROM cr.fecha)::int                                     AS anio,
      EXTRACT(MONTH FROM cr.fecha)::int                                     AS mes,
      COALESCE(cr.diagnostico, '')                                          AS diagnostico,
      SUM(cr.viales_dispensados * COALESCE(m.precio_unidad, 0))::float      AS gasto
    FROM consumo_registros cr
    JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
    LEFT JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area}
    WHERE ic.area = ${area}
      AND lower(COALESCE(cr.tipo_componente, '')) NOT IN ('fungible', 'fluido')
    GROUP BY EXTRACT(YEAR FROM cr.fecha), EXTRACT(MONTH FROM cr.fecha), cr.diagnostico
  `) as Array<{ anio: number; mes: number; diagnostico: string; gasto: number }>;

  type YAcc = { total: number; onco: number; hemato: number; porMes: Map<number, number> };
  const yearMap = new Map<number, YAcc>();

  for (const r of rows) {
    const anio = num(r.anio);
    const mes  = num(r.mes);
    const g    = Number(r.gasto);
    const servicio = getServicioFromGrupo(classifyDiagnostico(r.diagnostico));

    let y = yearMap.get(anio);
    if (!y) { y = { total: 0, onco: 0, hemato: 0, porMes: new Map() }; yearMap.set(anio, y); }
    y.total += g;
    if (servicio === 'hematologia') y.hemato += g; else y.onco += g;
    y.porMes.set(mes, (y.porMes.get(mes) ?? 0) + g);
  }

  const years = [...yearMap.keys()].sort((a, b) => a - b);
  if (!years.length) return [];

  // El año en curso es el año natural real (no simplemente el último con datos),
  // para no marcar como "parcial" un año pasado que sí está completo.
  const realYear  = new Date().getFullYear();
  const curAcc    = yearMap.get(realYear);
  const lastMonth = curAcc ? Math.max(...curAcc.porMes.keys()) : 12;

  return years.map(anio => {
    const acc     = yearMap.get(anio)!;
    const esCurso = anio === realYear;

    let prevComparable = 0;
    const prevAcc = yearMap.get(anio - 1);
    if (prevAcc) {
      if (esCurso) {
        // Mismo período: sumar sólo meses <= último mes con datos del año en curso
        for (const [mes, g] of prevAcc.porMes) if (mes <= lastMonth) prevComparable += g;
      } else {
        prevComparable = prevAcc.total;
      }
    }

    return {
      anio,
      gastoTotal:  acc.total,
      gastoOnco:   acc.onco,
      gastoHemato: acc.hemato,
      variacionYoy: computeYoy(acc.total, prevComparable),
      parcial: esCurso,
    };
  });
}

// ---------------------------------------------------------------------------
// YoY robusto: últimos 12 meses vs los 12 meses anteriores (ventanas móviles
// que NO se solapan), por grupo tumoral y por medicamento. Esto evita las
// variaciones infladas que producía comparar períodos largos solapados.
// ---------------------------------------------------------------------------
export type YoyRolling = {
  porGrupo: Map<DiagnosticoGrupo, { cur: number; prev: number }>;
  porCn: Map<string, { cur: number; prev: number }>;
};

async function getYoyRolling(area: string): Promise<YoyRolling> {
  const sql = getDb();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const hoy = new Date();
  const cur2 = iso(hoy);
  const c1 = new Date(hoy); c1.setFullYear(c1.getFullYear() - 1); const cur1 = iso(c1);
  const p1 = new Date(hoy); p1.setFullYear(p1.getFullYear() - 2); const prev1 = iso(p1);

  const rows = (await sql`
    SELECT
      cr.cn,
      COALESCE(cr.diagnostico, '')                                                              AS diagnostico,
      SUM(CASE WHEN cr.fecha >  ${cur1}::date AND cr.fecha <= ${cur2}::date
               THEN cr.viales_dispensados * COALESCE(m.precio_unidad, 0) ELSE 0 END)::float     AS cur,
      SUM(CASE WHEN cr.fecha >  ${prev1}::date AND cr.fecha <= ${cur1}::date
               THEN cr.viales_dispensados * COALESCE(m.precio_unidad, 0) ELSE 0 END)::float     AS prev
    FROM consumo_registros cr
    JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
    LEFT JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area}
    WHERE ic.area = ${area}
      AND cr.fecha > ${prev1}::date AND cr.fecha <= ${cur2}::date
      AND lower(COALESCE(cr.tipo_componente, '')) NOT IN ('fungible', 'fluido')
    GROUP BY cr.cn, cr.diagnostico
  `) as Array<{ cn: string; diagnostico: string; cur: number; prev: number }>;

  const porGrupo = new Map<DiagnosticoGrupo, { cur: number; prev: number }>();
  const porCn    = new Map<string, { cur: number; prev: number }>();

  for (const r of rows) {
    const cur = Number(r.cur); const prev = Number(r.prev);
    const grupo = classifyDiagnostico(r.diagnostico);
    const g = porGrupo.get(grupo) ?? { cur: 0, prev: 0 }; g.cur += cur; g.prev += prev; porGrupo.set(grupo, g);
    const c = porCn.get(r.cn)     ?? { cur: 0, prev: 0 }; c.cur += cur; c.prev += prev; porCn.set(r.cn, c);
  }
  return { porGrupo, porCn };
}

// YoY agregado para un conjunto de grupos (un servicio o el total del área)
function yoyDeGrupos(yoy: YoyRolling, grupos: DiagnosticoGrupo[]): number | null {
  let cur = 0, prev = 0;
  for (const g of grupos) { const v = yoy.porGrupo.get(g); if (v) { cur += v.cur; prev += v.prev; } }
  return computeYoy(cur, prev);
}

// Mapa cn → variación YoY (para asignar a cada medicamento del top)
function yoyMapByCn(yoy: YoyRolling): Map<string, number | null> {
  const m = new Map<string, number | null>();
  for (const [cn, v] of yoy.porCn) m.set(cn, computeYoy(v.cur, v.prev));
  return m;
}

// ---------------------------------------------------------------------------
// Helpers de agrupación temporal
// ---------------------------------------------------------------------------
function splitRows(rows: ClassifiedRow[]): { historic: ClassifiedRow[]; recent: ClassifiedRow[] } {
  const historic: ClassifiedRow[] = [];
  const recent: ClassifiedRow[] = [];
  for (const r of rows) {
    // Antes del corte: histórico (mensual, fiable). A partir del corte: semanal real.
    if (r.fecha_min < SEMANA_REAL_DESDE) historic.push(r);
    else recent.push(r);
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

function buildWeeklyTemporal(rows: ClassifiedRow[]): TemporalPoint[] {
  const map = new Map<string, TemporalPoint>();
  for (const r of rows) {
    const sem = r.semana_iso;
    const key = sem != null && sem > 0 ? `${r.anio}-W${sem}` : `${r.anio}-M${r.mes}`;
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
  return [...map.values()].sort((a, b) => {
    if (a.anio !== b.anio) return a.anio - b.anio;
    if (a.semana != null && b.semana != null) return a.semana - b.semana;
    return a.mes - b.mes;
  });
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
function buildTopMeds(
  rows: ClassifiedRow[],
  limit = 10,
  yoyByCn?: Map<string, number | null>,
): TopMed[] {
  type MedAcc = {
    pa: string; nom: string; gasto: number; viales: number; prep: number;
    grupo: DiagnosticoGrupo;
    months: Map<string, TemporalPoint>;
    dxMap: Map<string, DxBreakdown>;
  };
  const medMap = new Map<string, MedAcc>();

  for (const r of rows) {
    let m = medMap.get(r.cn);
    if (!m) {
      m = { pa: r.principio_activo, nom: r.nombre, gasto: 0, viales: 0, prep: 0, grupo: r.grupo, months: new Map(), dxMap: new Map() };
      medMap.set(r.cn, m);
    }
    m.gasto += r.gasto; m.viales += r.viales; m.prep += r.preparaciones;

    // Temporal MENSUAL (dato fiable en todo el histórico)
    const mk = `${r.anio}-${String(r.mes).padStart(2, '0')}`;
    const mp = m.months.get(mk);
    if (mp) {
      mp.viales += r.viales; mp.gasto += r.gasto;
      mp.preparaciones += r.preparaciones; mp.pacientes += r.pacientes;
    } else {
      m.months.set(mk, { anio: r.anio, mes: r.mes, semana: null, label: `${MESES_SHORT[r.mes - 1]} ${r.anio}`, viales: r.viales, gasto: r.gasto, preparaciones: r.preparaciones, pacientes: r.pacientes });
    }

    // Desglose por diagnóstico + indicación
    const dxKey = `${r.diagnostico}||${r.indicacion}`;
    const dx = m.dxMap.get(dxKey);
    if (dx) {
      dx.viales += r.viales; dx.gasto += r.gasto; dx.preparaciones += r.preparaciones;
    } else {
      m.dxMap.set(dxKey, { diagnostico: r.diagnostico || '—', indicacion: r.indicacion || '—', grupo: r.grupo, viales: r.viales, gasto: r.gasto, preparaciones: r.preparaciones });
    }
  }

  return [...medMap.entries()]
    .sort(([, a], [, b]) => b.gasto - a.gasto)
    .slice(0, limit)
    .map(([cn, m]) => ({
      cn, principioActivo: m.pa, nombre: m.nom,
      totalViales: m.viales, totalGasto: m.gasto, totalPreparaciones: m.prep,
      costePorPreparacion: m.prep > 0 ? m.gasto / m.prep : 0,
      variacionYoy: yoyByCn ? (yoyByCn.get(cn) ?? null) : null,
      grupo: m.grupo,
      temporalMensual: [...m.months.values()].sort((a, b) =>
        a.anio !== b.anio ? a.anio - b.anio : a.mes - b.mes
      ),
      desgloseByDx: [...m.dxMap.values()].sort((a, b) => b.gasto - a.gasto),
    }));
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
  // Queries en paralelo: período actual, gasto por año global,
  // gasto anual por servicio (histórico) y YoY móvil (últimos 12m vs 12m previos)
  const [classified, gastoPorAnio, gastoAnualServicio, yoy] = await Promise.all([
    getAnalisisRaw(area, desde, hasta),
    getGastoByYear(area),
    getGastoAnualPorServicio(area),
    getYoyRolling(area),
  ]);

  // Mapa cn → YoY (últimos 12 meses vs 12 meses anteriores)
  const yoyByCn = yoyMapByCn(yoy);

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

  // KPIs: se ajustan al alcance seleccionado.
  //  · Si hay servicio (Onco/Hemato) → KPIs del servicio (más intuitivo para la farmacéutica).
  //  · Si es "total" (sin servicio) → KPIs de toda el área.
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

  // YoY del alcance: agregado de los grupos correspondientes (12m vs 12m previos)
  const scopeGrupos = isService ? gruposParaServicio(servicioFiltro as Servicio) : GRUPO_ORDER;

  const kpis: KpisAnalisis = {
    totalGasto: scopeGasto, totalPreparaciones: totalPrep, totalViales,
    mediaPackientesSemana: semanas > 0 ? Math.round((totalPacientes / semanas) * 10) / 10 : 0,
    protocolosActivos: allProts.size, medicamentosDistintos: allCns.size,
    costePorPreparacion: totalPrep > 0 ? scopeGasto / totalPrep : 0,
    variacionYoy: yoyDeGrupos(yoy, scopeGrupos),
  };

  // Filas filtradas por servicio para tops y temporal global (si no hay grupo específico)
  // → cuando el usuario está en Hematología, los Top 10 son de hematología, no de toda el área
  const rowsForTops: ClassifiedRow[] = (servicioFiltro && !grupoFiltro)
    ? classified.filter(r => gruposParaServicio(servicioFiltro as Servicio).includes(r.grupo))
    : classified;

  // Temporal dual: histórico mensual + reciente semanal real
  const { historic, recent } = splitRows(rowsForTops);

  // Detalle de grupo
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
    kpis,
    gastoPorAnio,
    gastoAnualServicio,
    grupos,
    topProtocolos:     buildTopProtocols(rowsForTops),
    topMedicamentos:   buildTopMeds(rowsForTops, 10, yoyByCn),
    temporalHistorico: buildMonthlyTemporal(historic),
    temporalReciente:  buildWeeklyTemporal(recent),
    grupoDetalle,
  };
}
