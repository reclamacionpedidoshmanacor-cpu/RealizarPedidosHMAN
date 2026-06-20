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

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type KpisAnalisis = {
  totalGasto: number;
  totalPreparaciones: number;
  totalViales: number;
  mediaPackientesSemana: number;
  protocolosActivos: number;
  medicamentosDistintos: number;
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
  medicamentos: MedicamentoEnProtocolo[];
};

export type DiagnosticoDetalle = {
  diagnostico: string;
  grupo: DiagnosticoGrupo;
  totalGasto: number;
  totalPreparaciones: number;
  totalViales: number;
  protocolos: ProtocoloDetalle[];
};

export type TopMed = {
  cn: string;
  principioActivo: string;
  nombre: string;
  totalViales: number;
  totalGasto: number;
  totalPreparaciones: number;
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
  };
  temporal: TemporalPoint[];
  diagnosticos: DiagnosticoDetalle[];
  topMedicamentos: TopMed[];
};

export type AnalisisDatos = {
  periodo: { desde: string; hasta: string };
  kpis: KpisAnalisis;
  grupos: GrupoCard[];
  topMedicamentos: TopMed[];
  temporal: TemporalPoint[];
  grupoDetalle: GrupoDetalle | null;
};

// ---------------------------------------------------------------------------
// Fila interna con grupo clasificado
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
// Query principal: devuelve filas agregadas por semana+cn+diagnostico+protocolo
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
    anio:          num(r.anio),
    mes:           num(r.mes),
    semana_iso:    r.semana_iso != null ? num(r.semana_iso) : null,
    diagnostico:   r.diagnostico,
    indicacion:    r.indicacion,
    protocolo:     r.protocolo,
    cn:            r.cn,
    principio_activo: r.principio_activo,
    nombre:        r.nombre,
    viales:        Number(r.viales),
    pacientes:     num(r.pacientes),
    preparaciones: num(r.preparaciones),
    gasto:         Number(r.gasto),
    grupo:         classifyDiagnostico(r.diagnostico),
  }));
}

// ---------------------------------------------------------------------------
// Helpers de agrupación temporal
// ---------------------------------------------------------------------------
function weekKey(r: ClassifiedRow): string {
  return `${r.anio}-W${r.semana_iso ?? `M${r.mes}`}`;
}

function buildTemporal(rows: ClassifiedRow[]): TemporalPoint[] {
  const map = new Map<string, TemporalPoint>();
  for (const r of rows) {
    const key = weekKey(r);
    const ex = map.get(key);
    if (ex) {
      ex.viales       += r.viales;
      ex.gasto        += r.gasto;
      ex.preparaciones += r.preparaciones;
      ex.pacientes    += r.pacientes;
    } else {
      map.set(key, {
        anio: r.anio, mes: r.mes, semana: r.semana_iso,
        label: weekLabel(r.anio, r.semana_iso, r.mes),
        viales: r.viales, gasto: r.gasto,
        preparaciones: r.preparaciones, pacientes: r.pacientes,
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.anio !== b.anio ? a.anio - b.anio : (a.semana ?? a.mes) - (b.semana ?? b.mes)
  );
}

function countSemanas(rows: ClassifiedRow[]): number {
  return new Set(rows.map(r => weekKey(r))).size;
}

// ---------------------------------------------------------------------------
// Cálculo de Top 10 medicamentos
// ---------------------------------------------------------------------------
function buildTopMeds(rows: ClassifiedRow[], limit = 10): TopMed[] {
  const medMap = new Map<string, {
    pa: string; nom: string; gasto: number; viales: number; prep: number; grupo: DiagnosticoGrupo;
    weeks: Map<string, TemporalPoint>;
  }>();

  for (const r of rows) {
    let m = medMap.get(r.cn);
    if (!m) {
      m = { pa: r.principio_activo, nom: r.nombre, gasto: 0, viales: 0, prep: 0, grupo: r.grupo, weeks: new Map() };
      medMap.set(r.cn, m);
    }
    m.gasto += r.gasto;
    m.viales += r.viales;
    m.prep  += r.preparaciones;

    const wk = weekKey(r);
    const wp = m.weeks.get(wk);
    if (wp) {
      wp.viales += r.viales; wp.gasto += r.gasto;
      wp.preparaciones += r.preparaciones; wp.pacientes += r.pacientes;
    } else {
      m.weeks.set(wk, {
        anio: r.anio, mes: r.mes, semana: r.semana_iso,
        label: weekLabel(r.anio, r.semana_iso, r.mes),
        viales: r.viales, gasto: r.gasto, preparaciones: r.preparaciones, pacientes: r.pacientes,
      });
    }
  }

  return [...medMap.entries()]
    .sort(([, a], [, b]) => b.gasto - a.gasto)
    .slice(0, limit)
    .map(([cn, m]) => ({
      cn,
      principioActivo: m.pa,
      nombre: m.nom,
      totalViales: m.viales,
      totalGasto: m.gasto,
      totalPreparaciones: m.prep,
      grupo: m.grupo,
      temporalSemanal: [...m.weeks.values()].sort((a, b) =>
        a.anio !== b.anio ? a.anio - b.anio : (a.semana ?? a.mes) - (b.semana ?? b.mes)
      ),
    }));
}

// ---------------------------------------------------------------------------
// Detalle de un grupo tumoral
// ---------------------------------------------------------------------------
function computeGrupoDetalle(grupo: DiagnosticoGrupo, rows: ClassifiedRow[]): GrupoDetalle {
  const totalGasto  = rows.reduce((s, r) => s + r.gasto, 0);
  const totalPrep   = rows.reduce((s, r) => s + r.preparaciones, 0);
  const totalViales = rows.reduce((s, r) => s + r.viales, 0);
  const totalPacientes = rows.reduce((s, r) => s + r.pacientes, 0);
  const semanas = countSemanas(rows);

  // Diagnoses → Protocols → Meds
  type ProtMap = Map<string, { gasto: number; prep: number; viales: number; pacientes: number; semanas: Set<string>; meds: Map<string, MedicamentoEnProtocolo> }>;
  const dxMap = new Map<string, { gasto: number; prep: number; viales: number; prots: ProtMap }>();

  for (const r of rows) {
    const dx   = r.diagnostico || '—';
    const prot = r.protocolo   || '—';

    if (!dxMap.has(dx)) dxMap.set(dx, { gasto: 0, prep: 0, viales: 0, prots: new Map() });
    const dxE = dxMap.get(dx)!;
    dxE.gasto  += r.gasto;
    dxE.prep   += r.preparaciones;
    dxE.viales += r.viales;

    if (!dxE.prots.has(prot)) dxE.prots.set(prot, { gasto: 0, prep: 0, viales: 0, pacientes: 0, semanas: new Set(), meds: new Map() });
    const pE = dxE.prots.get(prot)!;
    pE.gasto    += r.gasto;
    pE.prep     += r.preparaciones;
    pE.viales   += r.viales;
    pE.pacientes += r.pacientes;
    pE.semanas.add(weekKey(r));

    if (!pE.meds.has(r.cn)) pE.meds.set(r.cn, { cn: r.cn, principioActivo: r.principio_activo, nombre: r.nombre, totalViales: 0, totalGasto: 0, totalPreparaciones: 0 });
    const mE = pE.meds.get(r.cn)!;
    mE.totalViales       += r.viales;
    mE.totalGasto        += r.gasto;
    mE.totalPreparaciones += r.preparaciones;
  }

  const diagnosticos: DiagnosticoDetalle[] = [...dxMap.entries()]
    .sort(([, a], [, b]) => b.gasto - a.gasto)
    .map(([dx, d]) => ({
      diagnostico: dx,
      grupo,
      totalGasto:        d.gasto,
      totalPreparaciones: d.prep,
      totalViales:       d.viales,
      protocolos: [...d.prots.entries()]
        .sort(([, a], [, b]) => b.gasto - a.gasto)
        .map(([prot, p]) => ({
          protocolo:          prot,
          totalGasto:         p.gasto,
          totalPreparaciones: p.prep,
          totalViales:        p.viales,
          mediaPackientesSemana: p.semanas.size > 0 ? Math.round((p.pacientes / p.semanas.size) * 10) / 10 : 0,
          medicamentos: [...p.meds.values()].sort((a, b) => b.totalGasto - a.totalGasto),
        })),
    }));

  return {
    grupo,
    label: GRUPO_LABELS[grupo],
    kpis: {
      totalGasto,
      totalPreparaciones: totalPrep,
      totalViales,
      mediaPackientesSemana: semanas > 0 ? Math.round((totalPacientes / semanas) * 10) / 10 : 0,
    },
    temporal: buildTemporal(rows),
    diagnosticos,
    topMedicamentos: buildTopMeds(rows),
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
  const classified = await getAnalisisRaw(area, desde, hasta);

  // ── Grupo cards ─────────────────────────────────────────────────────────
  const grupoAgg = new Map<DiagnosticoGrupo, { gasto: number; prep: number; viales: number; cns: Set<string>; prots: Set<string> }>();
  for (const r of classified) {
    let g = grupoAgg.get(r.grupo);
    if (!g) { g = { gasto: 0, prep: 0, viales: 0, cns: new Set(), prots: new Set() }; grupoAgg.set(r.grupo, g); }
    g.gasto  += r.gasto;
    g.prep   += r.preparaciones;
    g.viales += r.viales;
    g.cns.add(r.cn);
    if (r.protocolo) g.prots.add(r.protocolo);
  }

  const totalGastoGlobal = [...grupoAgg.values()].reduce((s, g) => s + g.gasto, 0);
  const grupos: GrupoCard[] = GRUPO_ORDER
    .filter(g => grupoAgg.has(g))
    .map(g => {
      const d = grupoAgg.get(g)!;
      return {
        grupo: g,
        label: GRUPO_LABELS[g],
        totalGasto:          d.gasto,
        totalPreparaciones:  d.prep,
        totalViales:         d.viales,
        medicamentosDistintos: d.cns.size,
        protocolosActivos:   d.prots.size,
        pctGasto:            totalGastoGlobal > 0 ? (d.gasto / totalGastoGlobal) * 100 : 0,
      };
    });

  // ── KPIs globales ────────────────────────────────────────────────────────
  const allCns   = new Set(classified.map(r => r.cn));
  const allProts = new Set(classified.map(r => r.protocolo).filter(Boolean));
  const semanas  = countSemanas(classified);
  const totalPacientes = classified.reduce((s, r) => s + r.pacientes, 0);

  const kpis: KpisAnalisis = {
    totalGasto:          totalGastoGlobal,
    totalPreparaciones:  classified.reduce((s, r) => s + r.preparaciones, 0),
    totalViales:         classified.reduce((s, r) => s + r.viales, 0),
    mediaPackientesSemana: semanas > 0 ? Math.round((totalPacientes / semanas) * 10) / 10 : 0,
    protocolosActivos:   allProts.size,
    medicamentosDistintos: allCns.size,
  };

  // ── Detalle de grupo (si se pide) ────────────────────────────────────────
  let grupoDetalle: GrupoDetalle | null = null;
  if (grupoFiltro) {
    const grupoRows = classified.filter(r => r.grupo === grupoFiltro);
    grupoDetalle = computeGrupoDetalle(grupoFiltro as DiagnosticoGrupo, grupoRows);
  }

  return {
    periodo: { desde, hasta },
    kpis,
    grupos,
    topMedicamentos: buildTopMeds(classified),
    temporal: buildTemporal(classified),
    grupoDetalle,
  };
}
