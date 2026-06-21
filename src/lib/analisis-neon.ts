import { neon } from '@neondatabase/serverless';
import {
  classifyDiagnostico,
  type DiagnosticoGrupo,
  GRUPO_LABELS,
  GRUPO_ORDER,
} from './diagnostico-grupos';

function getDb() {
  const url = process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Falta REALIZAR_PEDIDOS_DATABASE_URL');
  return neon(url);
}

function num(v: unknown): number { return Number(v ?? 0); }

const MESES_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function weekLabel(anio: number, semana: number | null, mes: number): string {
  const m = MESES_SHORT[(mes - 1) % 12] ?? '?';
  return semana != null ? `S${semana}·${m}` : `${m} ${anio}`;
}

function shiftYear(isoDate: string, delta: number): string {
  const [y, m, d] = isoDate.split('-');
  return `${parseInt(y!, 10) + delta}-${m}-${d}`;
}

export function computeYoy(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current / previous) - 1) * 1000) / 10;
}

// Punto de corte: 3 meses antes de hoy → datos más antiguos van al histórico (mensual)
// y los más recientes al semanal de detalle.
function getSplitYM(): number {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.getFullYear() * 100 + (d.getMonth() + 1);
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
  temporalSemanal: TemporalPoint[];
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
      SUM(cr.viales_dispensados * COALESCE(m.precio_unidad, 0))::float       AS gasto
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
  }>;

  return rows.map(r => ({
    anio: num(r.anio), mes: num(r.mes),
    semana_iso: r.semana_iso != null ? num(r.semana_iso) : null,
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
// Helpers de agrupación temporal
// ---------------------------------------------------------------------------
function splitRows(rows: ClassifiedRow[]): { historic: ClassifiedRow[]; recent: ClassifiedRow[] } {
  const splitYM = getSplitYM();
  const historic: ClassifiedRow[] = [];
  const recent: ClassifiedRow[] = [];
  for (const r of rows) {
    if (r.anio * 100 + r.mes < splitYM) historic.push(r);
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
  prevGastoMap?: Map<string, number>,
): TopMed[] {
  type MedAcc = {
    pa: string; nom: string; gasto: number; viales: number; prep: number;
    grupo: DiagnosticoGrupo; weeks: Map<string, TemporalPoint>;
  };
  const medMap = new Map<string, MedAcc>();

  for (const r of rows) {
    let m = medMap.get(r.cn);
    if (!m) {
      m = { pa: r.principio_activo, nom: r.nombre, gasto: 0, viales: 0, prep: 0, grupo: r.grupo, weeks: new Map() };
      medMap.set(r.cn, m);
    }
    m.gasto += r.gasto; m.viales += r.viales; m.prep += r.preparaciones;

    const sem = r.semana_iso;
    const wk  = sem != null && sem > 0 ? `${r.anio}-W${sem}` : `${r.anio}-M${r.mes}`;
    const wp  = m.weeks.get(wk);
    if (wp) {
      wp.viales += r.viales; wp.gasto += r.gasto;
      wp.preparaciones += r.preparaciones; wp.pacientes += r.pacientes;
    } else {
      m.weeks.set(wk, { anio: r.anio, mes: r.mes, semana: sem, label: weekLabel(r.anio, sem, r.mes), viales: r.viales, gasto: r.gasto, preparaciones: r.preparaciones, pacientes: r.pacientes });
    }
  }

  return [...medMap.entries()]
    .sort(([, a], [, b]) => b.gasto - a.gasto)
    .slice(0, limit)
    .map(([cn, m]) => ({
      cn, principioActivo: m.pa, nombre: m.nom,
      totalViales: m.viales, totalGasto: m.gasto, totalPreparaciones: m.prep,
      costePorPreparacion: m.prep > 0 ? m.gasto / m.prep : 0,
      variacionYoy: prevGastoMap ? computeYoy(m.gasto, prevGastoMap.get(cn) ?? 0) : null,
      grupo: m.grupo,
      temporalSemanal: [...m.weeks.values()].sort((a, b) =>
        a.anio !== b.anio ? a.anio - b.anio : (a.semana ?? a.mes) - (b.semana ?? b.mes)
      ),
    }));
}

// ---------------------------------------------------------------------------
// Detalle de grupo: dx → indicación → protocolo → medicamentos
// ---------------------------------------------------------------------------
function computeGrupoDetalle(
  grupo: DiagnosticoGrupo,
  current: ClassifiedRow[],
  previous: ClassifiedRow[],
): GrupoDetalle {
  const totalGasto    = current.reduce((s, r) => s + r.gasto, 0);
  const prevGasto     = previous.reduce((s, r) => s + r.gasto, 0);
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

  // Temporal dual
  const { historic, recent } = splitRows(current);

  // Top protocols/meds del grupo
  const prevMedGastoGrupo = new Map<string, number>();
  for (const r of previous) prevMedGastoGrupo.set(r.cn, (prevMedGastoGrupo.get(r.cn) ?? 0) + r.gasto);

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
      variacionYoy: computeYoy(totalGasto, prevGasto),
    },
    gastoPorAnio,
    temporalHistorico: buildMonthlyTemporal(historic),
    temporalReciente:  buildWeeklyTemporal(recent),
    topProtocolos:    buildTopProtocols(current),
    topMedicamentos:  buildTopMeds(current, 10, prevMedGastoGrupo),
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
): Promise<AnalisisDatos> {
  // Tres queries en paralelo: período actual, mismo período año anterior, gasto por año global
  const [classified, prevRows, gastoPorAnio] = await Promise.all([
    getAnalisisRaw(area, desde, hasta),
    getAnalisisRaw(area, shiftYear(desde, -1), shiftYear(hasta, -1)),
    getGastoByYear(area),
  ]);

  // YoY por medicamento y por grupo
  const prevMedGasto = new Map<string, number>();
  for (const r of prevRows) prevMedGasto.set(r.cn, (prevMedGasto.get(r.cn) ?? 0) + r.gasto);

  const prevGrupoGasto = new Map<DiagnosticoGrupo, number>();
  for (const r of prevRows) prevGrupoGasto.set(r.grupo, (prevGrupoGasto.get(r.grupo) ?? 0) + r.gasto);

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
  const prevTotalGasto   = prevRows.reduce((s, r) => s + r.gasto, 0);

  const grupos: GrupoCard[] = GRUPO_ORDER
    .filter(g => grupoAgg.has(g))
    .map(g => {
      const d = grupoAgg.get(g)!;
      return {
        grupo: g, label: GRUPO_LABELS[g],
        totalGasto: d.gasto, totalPreparaciones: d.prep, totalViales: d.viales,
        medicamentosDistintos: d.cns.size, protocolosActivos: d.prots.size,
        pctGasto: totalGastoGlobal > 0 ? (d.gasto / totalGastoGlobal) * 100 : 0,
        variacionYoy: computeYoy(d.gasto, prevGrupoGasto.get(g) ?? 0),
        gastoPorAnio: [...d.yearMap.entries()].sort(([a], [b]) => a - b).map(([anio, gasto]) => ({ anio, gasto })),
      };
    });

  // KPIs globales
  const totalPrep      = classified.reduce((s, r) => s + r.preparaciones, 0);
  const totalViales    = classified.reduce((s, r) => s + r.viales, 0);
  const totalPacientes = classified.reduce((s, r) => s + r.pacientes, 0);
  const semanas        = countSemanas(classified);
  const allCns         = new Set(classified.map(r => r.cn));
  const allProts       = new Set(classified.map(r => r.protocolo).filter(Boolean));

  const kpis: KpisAnalisis = {
    totalGasto: totalGastoGlobal, totalPreparaciones: totalPrep, totalViales,
    mediaPackientesSemana: semanas > 0 ? Math.round((totalPacientes / semanas) * 10) / 10 : 0,
    protocolosActivos: allProts.size, medicamentosDistintos: allCns.size,
    costePorPreparacion: totalPrep > 0 ? totalGastoGlobal / totalPrep : 0,
    variacionYoy: computeYoy(totalGastoGlobal, prevTotalGasto),
  };

  // Temporal dual global
  const { historic, recent } = splitRows(classified);

  // Detalle de grupo
  let grupoDetalle: GrupoDetalle | null = null;
  if (grupoFiltro) {
    const grupoRows     = classified.filter(r => r.grupo === grupoFiltro);
    const prevGrupoRows = prevRows.filter(r => r.grupo === grupoFiltro);
    grupoDetalle = computeGrupoDetalle(grupoFiltro as DiagnosticoGrupo, grupoRows, prevGrupoRows);
  }

  return {
    periodo: { desde, hasta },
    kpis,
    gastoPorAnio,
    grupos,
    topProtocolos:    buildTopProtocols(classified),
    topMedicamentos:  buildTopMeds(classified, 10, prevMedGasto),
    temporalHistorico: buildMonthlyTemporal(historic),
    temporalReciente:  buildWeeklyTemporal(recent),
    grupoDetalle,
  };
}
