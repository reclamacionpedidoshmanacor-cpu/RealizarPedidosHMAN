import { neon } from '@neondatabase/serverless';
import type { ConsumoRow } from './consumo-parser';

function getDb() {
  const url = process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Falta REALIZAR_PEDIDOS_DATABASE_URL');
  return neon(url);
}

function num(v: unknown): number { return Number(v ?? 0); }

// ---------------------------------------------------------------------------
// Auto-creación de tablas (se llama desde el endpoint de importación)
// ---------------------------------------------------------------------------
export async function ensureConsumoTables(): Promise<void> {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS importaciones_consumo (
      id              SERIAL PRIMARY KEY,
      area            TEXT NOT NULL,
      periodo_inicio  DATE NOT NULL,
      periodo_fin     DATE NOT NULL,
      importado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
      fichero_nombre  TEXT,
      total_lineas    INTEGER NOT NULL DEFAULT 0
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS consumo_registros (
      id                 SERIAL PRIMARY KEY,
      importacion_id     INTEGER NOT NULL REFERENCES importaciones_consumo(id) ON DELETE CASCADE,
      anio               SMALLINT NOT NULL,
      mes                SMALLINT NOT NULL,
      dia                SMALLINT,
      fecha              DATE NOT NULL,
      servicio           TEXT,
      uh                 TEXT,
      indicacion         TEXT,
      diagnostico        TEXT,
      protocolo          TEXT,
      tipo_terapia       TEXT,
      tipo_componente    TEXT,
      componente         TEXT,
      cn                 TEXT NOT NULL,
      medicamento        TEXT,
      viales_dispensados REAL NOT NULL DEFAULT 0,
      num_pacientes      INTEGER NOT NULL DEFAULT 0
    );
  `;
  // Columna semana_iso añadida en v2 — es seguro ejecutarla aunque ya exista
  await sql`ALTER TABLE consumo_registros ADD COLUMN IF NOT EXISTS semana_iso SMALLINT;`;
  await sql`CREATE INDEX IF NOT EXISTS idx_consumo_importacion ON consumo_registros(importacion_id);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_consumo_cn         ON consumo_registros(cn);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_consumo_anio_mes   ON consumo_registros(anio, mes);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_consumo_semana     ON consumo_registros(semana_iso) WHERE semana_iso IS NOT NULL;`;
  await sql`CREATE INDEX IF NOT EXISTS idx_consumo_area       ON importaciones_consumo(area);`;
}

// ---------------------------------------------------------------------------
// Tipos de retorno
// ---------------------------------------------------------------------------
export type ImportacionConsumo = {
  id: number;
  area: string;
  periodoInicio: string;
  periodoFin: string;
  importadoEn: string;
  ficheroNombre: string | null;
  totalLineas: number;
};

export type ResumenMedicamento = {
  cn: string;
  componente: string;       // principio activo
  tipoComponente: string;
  medicamento: string;
  totalViales: number;
  totalPacientes: number;
  desglose: DesgloseItem[];
  temporal: TemporalItem[];
};

export type DesgloseItem = {
  diagnostico: string;
  indicacion: string;
  protocolo: string;
  viales: number;
  pacientes: number;
};

export type TemporalItem = {
  anio: number;
  mes: number;
  label: string;          // "Ene 2025"
  viales: number;
  pacientes: number;
};

// ---------------------------------------------------------------------------
// Listar importaciones del área
// ---------------------------------------------------------------------------
export async function listImportacionesConsumo(area: string): Promise<ImportacionConsumo[]> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, area, periodo_inicio::text, periodo_fin::text,
           importado_en::text, fichero_nombre, total_lineas
    FROM importaciones_consumo
    WHERE area = ${area}
    ORDER BY id DESC
    LIMIT 50;
  `) as Array<{
    id: number; area: string; periodo_inicio: string; periodo_fin: string;
    importado_en: string; fichero_nombre: string | null; total_lineas: number;
  }>;
  return rows.map(r => ({
    id: num(r.id), area: r.area,
    periodoInicio: r.periodo_inicio, periodoFin: r.periodo_fin,
    importadoEn: r.importado_en, ficheroNombre: r.fichero_nombre,
    totalLineas: num(r.total_lineas),
  }));
}

// ---------------------------------------------------------------------------
// Insertar importación + registros
// ---------------------------------------------------------------------------
export async function insertarImportacionConsumo(
  area: string,
  periodoInicio: string,
  periodoFin: string,
  ficheroNombre: string,
  rows: ConsumoRow[],
): Promise<number> {
  const sql = getDb();

  const inserted = (await sql`
    INSERT INTO importaciones_consumo (area, periodo_inicio, periodo_fin, fichero_nombre, total_lineas)
    VALUES (${area}, ${periodoInicio}, ${periodoFin}, ${ficheroNombre}, ${rows.length})
    RETURNING id;
  `) as Array<{ id: number }>;

  const importacionId = num(inserted[0]!.id);

  // Bulk insert usando unnest — una sola llamada HTTP a Neon para todas las filas
  if (rows.length > 0) {
    await sql`
      INSERT INTO consumo_registros (
        importacion_id, anio, mes, dia, semana_iso, fecha,
        servicio, uh,
        indicacion, diagnostico, protocolo,
        tipo_terapia, tipo_componente, componente,
        cn, medicamento, viales_dispensados, num_pacientes
      )
      SELECT * FROM unnest(
        ${rows.map(() => importacionId)}::integer[],
        ${rows.map(r => r.anio)}::smallint[],
        ${rows.map(r => r.mes)}::smallint[],
        ${rows.map(r => r.dia ?? null)}::smallint[],
        ${rows.map(r => r.semanaIso ?? null)}::smallint[],
        ${rows.map(r => r.fecha)}::date[],
        ${rows.map(r => r.servicio || null)}::text[],
        ${rows.map(r => r.uh || null)}::text[],
        ${rows.map(r => r.indicacion || null)}::text[],
        ${rows.map(r => r.diagnostico || null)}::text[],
        ${rows.map(r => r.protocolo || null)}::text[],
        ${rows.map(r => r.tipoTerapia || null)}::text[],
        ${rows.map(r => r.tipoComponente || null)}::text[],
        ${rows.map(r => r.componente || null)}::text[],
        ${rows.map(r => r.cn)}::text[],
        ${rows.map(r => r.medicamento || null)}::text[],
        ${rows.map(r => r.vialesDispensados)}::real[],
        ${rows.map(r => r.numPacientes)}::integer[]
      );
    `;
  }

  return importacionId;
}

// ---------------------------------------------------------------------------
// Resumen agrupado por medicamento para una importación
// ---------------------------------------------------------------------------
export async function getResumenConsumo(
  importacionId: number,
  fechaDesde?: string | null,
  fechaHasta?: string | null,
): Promise<ResumenMedicamento[]> {
  const sql = getDb();
  const desde = fechaDesde ?? null;
  const hasta = fechaHasta ?? null;

  // Totales por CN
  const totales = (await sql`
    SELECT
      cn,
      COALESCE(MAX(componente), '') AS componente,
      COALESCE(MAX(tipo_componente), '') AS tipo_componente,
      COALESCE(MAX(medicamento), '') AS medicamento,
      SUM(viales_dispensados)::float AS total_viales,
      SUM(num_pacientes)::int        AS total_pacientes
    FROM consumo_registros
    WHERE importacion_id = ${importacionId}
      AND (${desde}::date IS NULL OR fecha >= ${desde}::date)
      AND (${hasta}::date IS NULL OR fecha <= ${hasta}::date)
    GROUP BY cn
    ORDER BY SUM(viales_dispensados) DESC;
  `) as Array<{
    cn: string; componente: string; tipo_componente: string; medicamento: string;
    total_viales: number; total_pacientes: number;
  }>;

  // Desglose diagnóstico/indicación/protocolo por CN
  const desgloses = (await sql`
    SELECT
      cn,
      COALESCE(diagnostico, '—') AS diagnostico,
      COALESCE(indicacion, '—')  AS indicacion,
      COALESCE(protocolo, '—')   AS protocolo,
      SUM(viales_dispensados)::float AS viales,
      SUM(num_pacientes)::int        AS pacientes
    FROM consumo_registros
    WHERE importacion_id = ${importacionId}
      AND (${desde}::date IS NULL OR fecha >= ${desde}::date)
      AND (${hasta}::date IS NULL OR fecha <= ${hasta}::date)
    GROUP BY cn, diagnostico, indicacion, protocolo
    ORDER BY cn, SUM(viales_dispensados) DESC;
  `) as Array<{
    cn: string; diagnostico: string; indicacion: string; protocolo: string;
    viales: number; pacientes: number;
  }>;

  // Evolución temporal por CN
  const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const temporal = (await sql`
    SELECT
      cn, anio, mes,
      SUM(viales_dispensados)::float AS viales,
      SUM(num_pacientes)::int        AS pacientes
    FROM consumo_registros
    WHERE importacion_id = ${importacionId}
      AND (${desde}::date IS NULL OR fecha >= ${desde}::date)
      AND (${hasta}::date IS NULL OR fecha <= ${hasta}::date)
    GROUP BY cn, anio, mes
    ORDER BY cn, anio, mes;
  `) as Array<{
    cn: string; anio: number; mes: number; viales: number; pacientes: number;
  }>;

  return totales.map(t => ({
    cn: t.cn,
    componente: t.componente,
    tipoComponente: t.tipo_componente,
    medicamento: t.medicamento,
    totalViales: Number(t.total_viales),
    totalPacientes: num(t.total_pacientes),
    desglose: desgloses
      .filter(d => d.cn === t.cn)
      .map(d => ({
        diagnostico: d.diagnostico,
        indicacion: d.indicacion,
        protocolo: d.protocolo,
        viales: Number(d.viales),
        pacientes: num(d.pacientes),
      })),
    temporal: temporal
      .filter(p => p.cn === t.cn)
      .map(p => ({
        anio: num(p.anio),
        mes: num(p.mes),
        label: `${MESES[num(p.mes) - 1]} ${p.anio}`,
        viales: Number(p.viales),
        pacientes: num(p.pacientes),
      })),
  }));
}

// ---------------------------------------------------------------------------
// Evolución temporal global (todos los medicamentos)
// ---------------------------------------------------------------------------
export type TemporalGlobal = {
  anio: number;
  mes: number;
  label: string;
  viales: number;
  pacientes: number;
  preparaciones?: number;
  medicamentosDistintos?: number;
};

// ---------------------------------------------------------------------------
// Tendencias de consumo para el panel Inicio
// Compara los últimos 3 meses naturales vs los 3 meses anteriores (relativo a hoy).
// Devuelve sólo los medicamentos con variación > +10 %.
// ---------------------------------------------------------------------------
export type TendenciaMedicamento = {
  cn: string;
  componente: string;
  medicamento: string;
  periodoActual: number;
  periodoAnterior: number;
  variacionPct: number;       // porcentaje de variación, ej: 25.3
  temporalActual: { mes: number; anio: number; label: string; viales: number }[];
};

export async function getTendenciasConsumo(area: string): Promise<TendenciaMedicamento[]> {
  const sql = getDb();
  const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  // Ventana temporal relativa a hoy (no al último dato cargado).
  // Excluye Fungible y Fluido, y solo incluye CNs presentes en el catálogo del área.
  const agrupado = (await sql`
    WITH periods AS (
      SELECT
        (CURRENT_DATE - INTERVAL '3 months')::date AS split_date,
        (CURRENT_DATE - INTERVAL '6 months')::date AS start_date
    ),
    agrupado AS (
      SELECT
        cr.cn,
        -- Principio activo y nombre comercial tomados del catálogo (más fiables que el Excel de consumo)
        COALESCE(MAX(m.principio_activo), MAX(cr.componente), '') AS componente,
        COALESCE(MAX(m.nombre),           MAX(cr.medicamento), '') AS medicamento,
        SUM(CASE WHEN cr.fecha >  p.split_date                            THEN cr.viales_dispensados ELSE 0 END)::float AS periodo_actual,
        SUM(CASE WHEN cr.fecha <= p.split_date AND cr.fecha > p.start_date THEN cr.viales_dispensados ELSE 0 END)::float AS periodo_anterior
      FROM consumo_registros cr
      JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
      -- Solo CNs del catálogo de esta área
      JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area} AND m.activo = TRUE
      CROSS JOIN periods p
      WHERE ic.area = ${area}
        AND cr.fecha > p.start_date
        -- Excluir Fungible y Fluido (insensible a mayúsculas)
        AND lower(COALESCE(cr.tipo_componente, '')) NOT IN ('fungible', 'fluido')
      GROUP BY cr.cn
    )
    SELECT
      cn, componente, medicamento,
      periodo_actual, periodo_anterior,
      ROUND((((periodo_actual / NULLIF(periodo_anterior, 0)) - 1) * 100)::numeric, 1) AS variacion_pct
    FROM agrupado
    WHERE periodo_anterior > 0
      AND periodo_actual > periodo_anterior * 1.10
    ORDER BY variacion_pct DESC;
  `) as Array<{
    cn: string; componente: string; medicamento: string;
    periodo_actual: number; periodo_anterior: number; variacion_pct: number;
  }>;

  if (agrupado.length === 0) return [];

  // Evolución mensual del período actual (últimos 3 meses naturales) para cada CN encontrado
  const cns = agrupado.map(r => r.cn);
  const temporal = (await sql`
    SELECT
           cr.cn,
           EXTRACT(YEAR FROM cr.fecha)::int AS anio,
           EXTRACT(MONTH FROM cr.fecha)::int AS mes,
           SUM(cr.viales_dispensados)::float AS viales
    FROM consumo_registros cr
    JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
    WHERE ic.area = ${area}
      AND cr.cn = ANY(${cns})
      AND cr.fecha > (CURRENT_DATE - INTERVAL '3 months')::date
    GROUP BY cr.cn, EXTRACT(YEAR FROM cr.fecha), EXTRACT(MONTH FROM cr.fecha)
    ORDER BY cr.cn, EXTRACT(YEAR FROM cr.fecha), EXTRACT(MONTH FROM cr.fecha);
  `) as Array<{ cn: string; anio: number; mes: number; viales: number }>;

  return agrupado.map(r => ({
    cn: r.cn,
    componente: r.componente,
    medicamento: r.medicamento,
    periodoActual: Number(r.periodo_actual),
    periodoAnterior: Number(r.periodo_anterior),
    variacionPct: Number(r.variacion_pct),
    temporalActual: temporal
      .filter(t => t.cn === r.cn)
      .map(t => ({
        anio: num(t.anio), mes: num(t.mes),
        label: `${MESES[num(t.mes) - 1]} ${t.anio}`,
        viales: Number(t.viales),
      })),
  }));
}

// ---------------------------------------------------------------------------
// Curva completa de un medicamento (todos los meses disponibles para el área)
// ---------------------------------------------------------------------------
export type CurvaMes = {
  anio: number; mes: number; label: string; viales: number; pacientes: number;
};

export async function getCurvaMedicamento(cn: string, area: string): Promise<CurvaMes[]> {
  const sql = getDb();
  const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  // Ventana visible de los últimos 6 meses naturales (relativo a hoy).
  const rows = (await sql`
    SELECT
           EXTRACT(YEAR FROM cr.fecha)::int AS anio,
           EXTRACT(MONTH FROM cr.fecha)::int AS mes,
           SUM(cr.viales_dispensados)::float AS viales,
           SUM(cr.num_pacientes)::int        AS pacientes
    FROM consumo_registros cr
    JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
    WHERE ic.area = ${area}
      AND cr.cn = ${cn}
      AND cr.fecha > (CURRENT_DATE - INTERVAL '6 months')::date
    GROUP BY EXTRACT(YEAR FROM cr.fecha), EXTRACT(MONTH FROM cr.fecha)
    ORDER BY EXTRACT(YEAR FROM cr.fecha), EXTRACT(MONTH FROM cr.fecha);
  `) as Array<{ anio: number; mes: number; viales: number; pacientes: number }>;
  return rows.map(r => ({
    anio: num(r.anio), mes: num(r.mes),
    label: `${MESES[num(r.mes) - 1]} ${r.anio}`,
    viales: Number(r.viales),
    pacientes: num(r.pacientes),
  }));
}

export async function getTemporalGlobal(
  importacionId: number,
  fechaDesde?: string | null,
  fechaHasta?: string | null,
): Promise<TemporalGlobal[]> {
  const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const sql = getDb();
  const desde = fechaDesde ?? null;
  const hasta = fechaHasta ?? null;
  const rows = (await sql`
    SELECT anio, mes,
           SUM(viales_dispensados)::float AS viales,
           SUM(num_pacientes)::int        AS pacientes
    FROM consumo_registros
    WHERE importacion_id = ${importacionId}
      AND (${desde}::date IS NULL OR fecha >= ${desde}::date)
      AND (${hasta}::date IS NULL OR fecha <= ${hasta}::date)
    GROUP BY anio, mes
    ORDER BY anio, mes;
  `) as Array<{ anio: number; mes: number; viales: number; pacientes: number }>;
  return rows.map(r => ({
    anio: num(r.anio), mes: num(r.mes),
    label: `${MESES[num(r.mes) - 1]} ${r.anio}`,
    viales: Number(r.viales),
    pacientes: num(r.pacientes),
  }));
}

// ---------------------------------------------------------------------------
// Resumen global por área (acumulado de todas las importaciones)
// ---------------------------------------------------------------------------
export async function getResumenConsumoArea(
  area: string,
  fechaDesde?: string | null,
  fechaHasta?: string | null,
): Promise<ResumenMedicamento[]> {
  const sql = getDb();
  const desde = fechaDesde ?? null;
  const hasta = fechaHasta ?? null;

  const totales = (await sql`
    SELECT
      cr.cn,
      COALESCE(MAX(m.principio_activo), MAX(cr.componente), '') AS componente,
      COALESCE(MAX(cr.tipo_componente), '') AS tipo_componente,
      COALESCE(MAX(m.nombre), MAX(cr.medicamento), '') AS medicamento,
      SUM(cr.viales_dispensados)::float AS total_viales,
      SUM(cr.num_pacientes)::int        AS total_pacientes
    FROM consumo_registros cr
    INNER JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
    INNER JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area}
    WHERE ic.area = ${area}
      AND (${desde}::date IS NULL OR cr.fecha >= ${desde}::date)
      AND (${hasta}::date IS NULL OR cr.fecha <= ${hasta}::date)
    GROUP BY cr.cn
    ORDER BY COALESCE(MAX(m.principio_activo), MAX(cr.componente), '') ASC,
             COALESCE(MAX(m.nombre), MAX(cr.medicamento), '') ASC;
  `) as Array<{
    cn: string; componente: string; tipo_componente: string; medicamento: string;
    total_viales: number; total_pacientes: number;
  }>;

  const desgloses = (await sql`
    SELECT
      cr.cn,
      COALESCE(cr.diagnostico, '—') AS diagnostico,
      COALESCE(cr.indicacion, '—')  AS indicacion,
      COALESCE(cr.protocolo, '—')   AS protocolo,
      SUM(cr.viales_dispensados)::float AS viales
    FROM consumo_registros cr
    INNER JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
    INNER JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area}
    WHERE ic.area = ${area}
      AND (${desde}::date IS NULL OR cr.fecha >= ${desde}::date)
      AND (${hasta}::date IS NULL OR cr.fecha <= ${hasta}::date)
    GROUP BY cr.cn, cr.diagnostico, cr.indicacion, cr.protocolo
    ORDER BY cr.cn, diagnostico ASC, indicacion ASC, protocolo ASC;
  `) as Array<{
    cn: string; diagnostico: string; indicacion: string; protocolo: string; viales: number;
  }>;

  const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const temporal = (await sql`
    SELECT
      cr.cn, cr.anio, cr.mes,
      SUM(cr.viales_dispensados)::float AS viales,
      SUM(cr.num_pacientes)::int        AS pacientes
    FROM consumo_registros cr
    INNER JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
    INNER JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area}
    WHERE ic.area = ${area}
      AND (${desde}::date IS NULL OR cr.fecha >= ${desde}::date)
      AND (${hasta}::date IS NULL OR cr.fecha <= ${hasta}::date)
    GROUP BY cr.cn, cr.anio, cr.mes
    ORDER BY cr.cn, cr.anio, cr.mes;
  `) as Array<{
    cn: string; anio: number; mes: number; viales: number; pacientes: number;
  }>;

  return totales.map(t => ({
    cn: t.cn,
    componente: t.componente,
    tipoComponente: t.tipo_componente,
    medicamento: t.medicamento,
    totalViales: Number(t.total_viales),
    totalPacientes: num(t.total_pacientes),
    desglose: desgloses
      .filter(d => d.cn === t.cn)
      .map(d => ({
        diagnostico: d.diagnostico,
        indicacion: d.indicacion,
        protocolo: d.protocolo,
        viales: Number(d.viales),
        pacientes: 0,
      })),
    temporal: temporal
      .filter(p => p.cn === t.cn)
      .map(p => ({
        anio: num(p.anio),
        mes: num(p.mes),
        label: `${MESES[num(p.mes) - 1]} ${p.anio}`,
        viales: Number(p.viales),
        pacientes: num(p.pacientes),
      })),
  }));
}

export async function getTemporalGlobalArea(
  area: string,
  fechaDesde?: string | null,
  fechaHasta?: string | null,
): Promise<TemporalGlobal[]> {
  const sql = getDb();
  const desde = fechaDesde ?? null;
  const hasta = fechaHasta ?? null;
  const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const rows = (await sql`
    SELECT
      cr.anio, cr.mes,
      SUM(cr.viales_dispensados)::float AS viales,
      SUM(cr.num_pacientes)::int        AS pacientes,
      COUNT(*)::int                     AS preparaciones,
      COUNT(DISTINCT cr.cn)::int        AS medicamentos_distintos
    FROM consumo_registros cr
    INNER JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
    WHERE ic.area = ${area}
      AND (${desde}::date IS NULL OR cr.fecha >= ${desde}::date)
      AND (${hasta}::date IS NULL OR cr.fecha <= ${hasta}::date)
    GROUP BY cr.anio, cr.mes
    ORDER BY cr.anio, cr.mes;
  `) as Array<{
    anio: number; mes: number; viales: number; pacientes: number;
    preparaciones: number; medicamentos_distintos: number;
  }>;

  return rows.map(r => ({
    anio: num(r.anio),
    mes: num(r.mes),
    label: `${MESES[num(r.mes) - 1]} ${r.anio}`,
    viales: Number(r.viales),
    pacientes: num(r.pacientes),
    preparaciones: num(r.preparaciones),
    medicamentosDistintos: num(r.medicamentos_distintos),
  }));
}
