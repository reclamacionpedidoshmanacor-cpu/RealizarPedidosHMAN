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
      edad_paciente      TEXT,
      indicacion         TEXT,
      diagnostico        TEXT,
      protocolo          TEXT,
      num_ciclo          TEXT,
      tipo_terapia       TEXT,
      tipo_componente    TEXT,
      componente         TEXT,
      cn                 TEXT NOT NULL,
      medicamento        TEXT,
      viales_dispensados REAL NOT NULL DEFAULT 0,
      num_pacientes      INTEGER NOT NULL DEFAULT 0
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_consumo_importacion ON consumo_registros(importacion_id);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_consumo_cn         ON consumo_registros(cn);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_consumo_anio_mes   ON consumo_registros(anio, mes);`;
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
        importacion_id, anio, mes, dia, fecha,
        servicio, uh, edad_paciente,
        indicacion, diagnostico, protocolo, num_ciclo,
        tipo_terapia, tipo_componente, componente,
        cn, medicamento, viales_dispensados, num_pacientes
      )
      SELECT * FROM unnest(
        ${rows.map(() => importacionId)}::integer[],
        ${rows.map(r => r.anio)}::smallint[],
        ${rows.map(r => r.mes)}::smallint[],
        ${rows.map(r => r.dia ?? null)}::smallint[],
        ${rows.map(r => r.fecha)}::date[],
        ${rows.map(r => r.servicio || null)}::text[],
        ${rows.map(r => r.uh || null)}::text[],
        ${rows.map(r => r.edadPaciente || null)}::text[],
        ${rows.map(r => r.indicacion || null)}::text[],
        ${rows.map(r => r.diagnostico || null)}::text[],
        ${rows.map(r => r.protocolo || null)}::text[],
        ${rows.map(r => r.numCiclo || null)}::text[],
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
export async function getResumenConsumo(importacionId: number): Promise<ResumenMedicamento[]> {
  const sql = getDb();

  // Totales por CN
  const totales = (await sql`
    SELECT
      cn,
      COALESCE(MAX(componente), '') AS componente,
      COALESCE(MAX(medicamento), '') AS medicamento,
      SUM(viales_dispensados)::float AS total_viales,
      SUM(num_pacientes)::int        AS total_pacientes
    FROM consumo_registros
    WHERE importacion_id = ${importacionId}
    GROUP BY cn
    ORDER BY SUM(viales_dispensados) DESC;
  `) as Array<{
    cn: string; componente: string; medicamento: string;
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
    GROUP BY cn, anio, mes
    ORDER BY cn, anio, mes;
  `) as Array<{
    cn: string; anio: number; mes: number; viales: number; pacientes: number;
  }>;

  return totales.map(t => ({
    cn: t.cn,
    componente: t.componente,
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
};

export async function getTemporalGlobal(importacionId: number): Promise<TemporalGlobal[]> {
  const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const sql = getDb();
  const rows = (await sql`
    SELECT anio, mes,
           SUM(viales_dispensados)::float AS viales,
           SUM(num_pacientes)::int        AS pacientes
    FROM consumo_registros
    WHERE importacion_id = ${importacionId}
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
