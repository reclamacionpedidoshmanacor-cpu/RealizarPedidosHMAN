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
  await sql`ALTER TABLE consumo_registros ADD COLUMN IF NOT EXISTS periodicidad SMALLINT;`;
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
  periodicidad: number | null;
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
        indicacion, diagnostico, protocolo, periodicidad,
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
        ${rows.map(r => r.periodicidad ?? null)}::smallint[],
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
      MAX(periodicidad)::int     AS periodicidad,
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
    periodicidad: number | null; viales: number; pacientes: number;
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
        periodicidad: d.periodicidad != null ? num(d.periodicidad) : null,
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
// Movimientos de consumo para el panel Inicio
// Ventana: últimas 8 semanas vs 8 semanas anteriores (112 días).
// Clasificación: sube | baja | parado | nuevo (umbrales alineados con alertas).
// ---------------------------------------------------------------------------
export type DireccionMovimiento = 'sube' | 'baja' | 'parado' | 'nuevo';

export type MovimientoConsumo = {
  cn: string;
  componente: string;
  medicamento: string;
  ppioActivoCima: string | null;
  unidadesPorCaja: number;
  direccion: DireccionMovimiento;
  periodoReciente: number;
  periodoAnterior: number;
  promedioSemanalReciente: number;
  promedioSemanalAnterior: number;
  variacionPct: number | null;
  deltaVialesPeriodo: number;
  semanasSeries: { semana: number; anio: number; label: string; viales: number; recepciones: number }[];
};

export type MovimientoGrupoPrincipioActivo = {
  claveGrupo: string;
  principioActivo: string;
  agrupacionAproximada: boolean;
  presentaciones: MovimientoConsumo[];
};

export type MovimientosConsumoResult = {
  suben: MovimientoGrupoPrincipioActivo[];
  bajan: MovimientoGrupoPrincipioActivo[];
  resumen: {
    totalSuben: number;
    totalBajan: number;
  };
};

function claveGrupoMovimiento(m: Pick<MovimientoConsumo, 'ppioActivoCima' | 'componente' | 'cn' | 'medicamento'>): {
  clave: string;
  nombre: string;
  aproximada: boolean;
} {
  const cima = m.ppioActivoCima?.trim();
  if (cima) return { clave: cima.toLowerCase(), nombre: cima, aproximada: false };
  const pa = m.componente?.trim();
  if (pa) return { clave: `pa:${pa.toLowerCase()}`, nombre: pa, aproximada: true };
  return { clave: `cn:${m.cn}`, nombre: m.medicamento || m.cn, aproximada: true };
}

function clasificarMovimiento(rec: number, ant: number, upx: number): DireccionMovimiento | null {
  if (rec === 0 && ant === 0) return null;

  const cambioAbsVialesSem = Math.abs((rec - ant) / 8);
  const cambioAbsCajasSem = cambioAbsVialesSem / Math.max(1, upx);

  if (ant === 0 && rec > 0) {
    return rec >= 2 ? 'nuevo' : null;
  }

  if (rec === 0 && ant > 0) {
    return ant >= 2 ? 'parado' : null;
  }

  const variacionPct = ((rec - ant) / ant) * 100;

  if (rec > ant && variacionPct > 25 && (cambioAbsVialesSem >= 2 || cambioAbsCajasSem >= 1)) {
    return 'sube';
  }

  if (rec < ant && variacionPct < -25 && (cambioAbsVialesSem >= 2 || cambioAbsCajasSem >= 1)) {
    return 'baja';
  }

  return null;
}

function buildSemanasSeries8(
  series: Array<{ semana: number; anio: number; viales: number }>,
): MovimientoConsumo['semanasSeries'] {
  const semanasFilled: MovimientoConsumo['semanasSeries'] = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i * 7);
    const thursday = new Date(d);
    thursday.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
    const jan4 = new Date(thursday.getFullYear(), 0, 4);
    const diffDays = (thursday.getTime() - jan4.getTime()) / 86400000;
    const sw = Math.round(diffDays / 7) + 1;
    const sy = thursday.getFullYear();
    const found = series.find(s => s.semana === sw && s.anio === sy);
    semanasFilled.push({
      semana: sw,
      anio: sy,
      label: `S${String(sw).padStart(2, '0')}/${String(sy).slice(-2)}`,
      viales: found ? found.viales : 0,
      recepciones: 0,
    });
  }
  return semanasFilled;
}

function agruparMovimientos(
  movimientos: MovimientoConsumo[],
  sortPresentaciones: (a: MovimientoConsumo, b: MovimientoConsumo) => number,
): MovimientoGrupoPrincipioActivo[] {
  const map = new Map<string, MovimientoConsumo[]>();
  const meta = new Map<string, { nombre: string; aproximada: boolean }>();

  for (const m of movimientos) {
    const { clave, nombre, aproximada } = claveGrupoMovimiento(m);
    if (!map.has(clave)) {
      map.set(clave, []);
      meta.set(clave, { nombre, aproximada });
    }
    map.get(clave)!.push(m);
  }

  const grupos: MovimientoGrupoPrincipioActivo[] = [];

  for (const [claveGrupo, presentaciones] of map.entries()) {
    const sorted = [...presentaciones].sort(sortPresentaciones);
    const m = meta.get(claveGrupo)!;
    grupos.push({
      claveGrupo,
      principioActivo: m.nombre,
      agrupacionAproximada: m.aproximada,
      presentaciones: sorted,
    });
  }

  return grupos.sort((a, b) => {
    const maxA = Math.max(...a.presentaciones.map(p => Math.abs(p.deltaVialesPeriodo)));
    const maxB = Math.max(...b.presentaciones.map(p => Math.abs(p.deltaVialesPeriodo)));
    if (maxB !== maxA) return maxB - maxA;
    return a.principioActivo.localeCompare(b.principioActivo, 'es');
  });
}

export async function getMovimientosConsumo(area: string): Promise<MovimientosConsumoResult> {
  const sql = getDb();

  const agrupado = (await sql`
    WITH periods AS (
      SELECT
        (CURRENT_DATE - INTERVAL '56 days')::date AS split_date,
        (CURRENT_DATE - INTERVAL '112 days')::date AS start_date
    ),
    agrupado AS (
      SELECT
        cr.cn,
        COALESCE(MAX(m.principio_activo), MAX(cr.componente), '') AS componente,
        COALESCE(MAX(m.nombre), MAX(cr.medicamento), '') AS medicamento,
        NULLIF(TRIM(MAX(m.ppio_activo_cima)), '') AS ppio_activo_cima,
        MAX(m.unidades_por_caja) AS unidades_por_caja,
        SUM(CASE WHEN cr.fecha >  p.split_date                            THEN cr.viales_dispensados ELSE 0 END)::float AS periodo_reciente,
        SUM(CASE WHEN cr.fecha <= p.split_date AND cr.fecha > p.start_date THEN cr.viales_dispensados ELSE 0 END)::float AS periodo_anterior
      FROM consumo_registros cr
      JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
      JOIN medicamentos m ON m.cn = cr.cn AND m.area = ${area} AND m.activo = TRUE
      CROSS JOIN periods p
      WHERE ic.area = ${area}
        AND cr.fecha > p.start_date
        AND lower(COALESCE(cr.tipo_componente, '')) NOT IN ('fungible', 'fluido')
      GROUP BY cr.cn
    )
    SELECT
      cn, componente, medicamento, ppio_activo_cima, unidades_por_caja,
      periodo_reciente, periodo_anterior
    FROM agrupado
    WHERE periodo_reciente > 0 OR periodo_anterior > 0
    ORDER BY componente, medicamento;
  `) as Array<{
    cn: string; componente: string; medicamento: string; ppio_activo_cima: string | null;
    unidades_por_caja: number; periodo_reciente: number; periodo_anterior: number;
  }>;

  if (agrupado.length === 0) {
    return {
      suben: [],
      bajan: [],
      resumen: { totalSuben: 0, totalBajan: 0 },
    };
  }

  const movimientos: MovimientoConsumo[] = [];

  for (const r of agrupado) {
    const rec = num(r.periodo_reciente);
    const ant = num(r.periodo_anterior);
    const upx = Math.max(1, num(r.unidades_por_caja));
    const direccion = clasificarMovimiento(rec, ant, upx);
    if (!direccion) continue;

    movimientos.push({
      cn: r.cn,
      componente: r.componente,
      medicamento: r.medicamento,
      ppioActivoCima: r.ppio_activo_cima,
      unidadesPorCaja: upx,
      direccion,
      periodoReciente: rec,
      periodoAnterior: ant,
      promedioSemanalReciente: rec / 8,
      promedioSemanalAnterior: ant / 8,
      variacionPct: ant > 0 ? ((rec - ant) / ant) * 100 : null,
      deltaVialesPeriodo: rec - ant,
      semanasSeries: [],
    });
  }

  const cns = movimientos.map(m => m.cn);
  const seriesRows = cns.length > 0 ? (await sql`
    SELECT
      cr.cn,
      EXTRACT(ISOYEAR FROM cr.fecha)::int AS iso_year,
      EXTRACT(WEEK     FROM cr.fecha)::int AS iso_week,
      SUM(cr.viales_dispensados)::float   AS viales
    FROM consumo_registros cr
    JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
    WHERE ic.area = ${area}
      AND cr.cn = ANY(${cns})
      AND cr.fecha > (CURRENT_DATE - INTERVAL '56 days')
      AND lower(COALESCE(cr.tipo_componente, '')) NOT IN ('fungible', 'fluido')
    GROUP BY cr.cn, EXTRACT(ISOYEAR FROM cr.fecha), EXTRACT(WEEK FROM cr.fecha)
    ORDER BY cr.cn, iso_year, iso_week;
  `) as Array<{ cn: string; iso_year: number; iso_week: number; viales: number }> : [];

  for (const m of movimientos) {
    const series = seriesRows
      .filter(s => s.cn === m.cn)
      .map(s => ({
        semana: num(s.iso_week),
        anio: num(s.iso_year),
        viales: Number(s.viales),
      }));
    m.semanasSeries = buildSemanasSeries8(series);
  }

  const subenList = movimientos
    .filter(m => m.direccion === 'sube' || m.direccion === 'nuevo')
    .sort((a, b) => b.deltaVialesPeriodo - a.deltaVialesPeriodo);

  const bajanList = movimientos
    .filter(m => m.direccion === 'baja' || m.direccion === 'parado')
    .sort((a, b) => a.deltaVialesPeriodo - b.deltaVialesPeriodo);

  return {
    suben: agruparMovimientos(subenList, (a, b) => b.deltaVialesPeriodo - a.deltaVialesPeriodo),
    bajan: agruparMovimientos(bajanList, (a, b) => a.deltaVialesPeriodo - b.deltaVialesPeriodo),
    resumen: {
      totalSuben: subenList.length,
      totalBajan: bajanList.length,
    },
  };
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
      MAX(cr.periodicidad)::int     AS periodicidad,
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
    cn: string; diagnostico: string; indicacion: string; protocolo: string;
    periodicidad: number | null; viales: number;
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
        periodicidad: d.periodicidad != null ? num(d.periodicidad) : null,
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

// ---------------------------------------------------------------------------
// Panel "Alertas de compra" para Inicio
// Calcula cobertura de stock, tendencia de consumo y semáforo por medicamento.
//
// Rango operativo real: almacén para 2-4 semanas, pedidos semanales.
//   - consumo_reciente  = viales en las últimas 8 semanas
//   - consumo_anterior  = viales en las 8 semanas anteriores
//   - promedio_semanal  = consumo_reciente / 8
//   - cobertura         = stock_actual_unidades / promedio_semanal  (en semanas)
//   - tendencia         = variacion_pct > 25 % Y cambio_abs >= 2 viales/sem O >= 1 caja/sem
//   - semáforo (thresholds ajustados al rango operativo 2-4 sem):
//       rojo    < 1.5 semanas  → urgente
//       naranja 1.5–2.5 sem   O tendencia creciente relevante
//       verde   2.5–4 sem     → rango óptimo
//       azul    > 4 semanas   → sobrestock
//   - sugerenciaAjuste: stock mínimo sugerido = prom × 2, máximo = prom × 4
// ---------------------------------------------------------------------------
export type SugerenciaAjuste = {
  tipo: 'aumentar' | 'reducir' | 'ok';
  stockMinimoSugerido: number;   // promedio × 2 sem (redondeado a múltiplo de caja)
  stockMaximoSugerido: number;   // promedio × 4 sem (redondeado a múltiplo de caja)
  stockMinimoActual: number;
  stockMaximoActual: number;
};

export type AlertaCompra = {
  cn: string;
  componente: string;
  medicamento: string;
  ppioActivoCima: string | null;
  unidadesPorCaja: number;
  stockActualUnidades: number;
  stockActualCajas: number;
  stockMinimo: number;
  stockMaximo: number;
  consumoReciente: number;
  consumoAnterior: number;
  promedioSemanal: number;
  variacionPct: number | null;
  tendenciaCreciente: boolean;
  tendenciaRelevante: boolean;
  coberturaSemanas: number | null;
  semaforo: 'rojo' | 'naranja' | 'verde' | 'azul' | 'gris';
  sugerenciaAjuste: SugerenciaAjuste | null;
  semanasSeries: { semana: number; anio: number; label: string; viales: number; recepciones: number }[];
};

export type ResumenSemaforoGrupo = {
  rojo: number;
  naranja: number;
  verde: number;
  azul: number;
  gris: number;
  peor: AlertaCompra['semaforo'];
};

export type AlertaGrupoPrincipioActivo = {
  claveGrupo: string;
  principioActivo: string;
  agrupacionAproximada: boolean;
  presentaciones: AlertaCompra[];
  resumenSemaforo: ResumenSemaforoGrupo;
};

const SEMAFORO_PRIORIDAD: Record<AlertaCompra['semaforo'], number> = {
  rojo: 0, naranja: 1, verde: 2, azul: 3, gris: 4,
};

function claveGrupoFrom(alerta: Pick<AlertaCompra, 'ppioActivoCima' | 'componente' | 'cn' | 'medicamento'>): {
  clave: string;
  nombre: string;
  aproximada: boolean;
} {
  const cima = alerta.ppioActivoCima?.trim();
  if (cima) return { clave: cima.toLowerCase(), nombre: cima, aproximada: false };
  const pa = alerta.componente?.trim();
  if (pa) return { clave: `pa:${pa.toLowerCase()}`, nombre: pa, aproximada: true };
  return { clave: `cn:${alerta.cn}`, nombre: alerta.medicamento || alerta.cn, aproximada: true };
}

export function agruparAlertasPorPrincipioActivo(alertas: AlertaCompra[]): AlertaGrupoPrincipioActivo[] {
  const map = new Map<string, AlertaCompra[]>();
  const meta = new Map<string, { nombre: string; aproximada: boolean }>();

  for (const a of alertas) {
    const { clave, nombre, aproximada } = claveGrupoFrom(a);
    if (!map.has(clave)) {
      map.set(clave, []);
      meta.set(clave, { nombre, aproximada });
    }
    map.get(clave)!.push(a);
  }

  const grupos: AlertaGrupoPrincipioActivo[] = [];

  for (const [claveGrupo, presentaciones] of map.entries()) {
    const sorted = [...presentaciones].sort((a, b) => {
      const sp = SEMAFORO_PRIORIDAD[a.semaforo] - SEMAFORO_PRIORIDAD[b.semaforo];
      if (sp !== 0) return sp;
      return b.consumoReciente - a.consumoReciente;
    });

    const resumen: ResumenSemaforoGrupo = {
      rojo: 0, naranja: 0, verde: 0, azul: 0, gris: 0, peor: 'gris',
    };
    for (const p of sorted) {
      resumen[p.semaforo]++;
      if (SEMAFORO_PRIORIDAD[p.semaforo] < SEMAFORO_PRIORIDAD[resumen.peor]) {
        resumen.peor = p.semaforo;
      }
    }

    const m = meta.get(claveGrupo)!;
    grupos.push({
      claveGrupo,
      principioActivo: m.nombre,
      agrupacionAproximada: m.aproximada,
      presentaciones: sorted,
      resumenSemaforo: resumen,
    });
  }

  return grupos.sort((a, b) => {
    const gp = SEMAFORO_PRIORIDAD[a.resumenSemaforo.peor] - SEMAFORO_PRIORIDAD[b.resumenSemaforo.peor];
    if (gp !== 0) return gp;
    const critA = a.resumenSemaforo.rojo + a.resumenSemaforo.naranja;
    const critB = b.resumenSemaforo.rojo + b.resumenSemaforo.naranja;
    if (critB !== critA) return critB - critA;
    return a.principioActivo.localeCompare(b.principioActivo, 'es');
  });
}

export async function getAlertasCompra(area: string): Promise<AlertaCompra[]> {
  const sql = getDb();

  // 16 sem = 112 días atrás; últimas 8 = 56 días atrás.
  const agrupado = (await sql`
    WITH
    meds AS (
      SELECT m.cn, m.principio_activo, m.nombre, m.unidades_por_caja,
             NULLIF(TRIM(m.ppio_activo_cima), '') AS ppio_activo_cima,
             COALESCE(so.stock_minimo,  0) AS stock_minimo,
             COALESCE(so.stock_maximo,  0) AS stock_maximo
      FROM medicamentos m
      LEFT JOIN stock_objetivo so ON so.cn = m.cn
      WHERE m.area = ${area} AND m.activo = TRUE
    ),
    stock_actual AS (
      -- Último recuento disponible para el área
      SELECT DISTINCT ON (sr.cn)
             sr.cn,
             sr.stock_unidades
      FROM stock_registros sr
      JOIN importaciones_stock si ON si.id = sr.importacion_id
      WHERE si.area = ${area}
      ORDER BY sr.cn, si.importado_en DESC, sr.id DESC
    ),
    consumo_periodos AS (
      SELECT
        cr.cn,
        SUM(CASE WHEN cr.fecha > (CURRENT_DATE - INTERVAL '56 days')  THEN cr.viales_dispensados ELSE 0 END)::float  AS reciente,
        SUM(CASE WHEN cr.fecha <= (CURRENT_DATE - INTERVAL '56 days')
                  AND cr.fecha >  (CURRENT_DATE - INTERVAL '112 days') THEN cr.viales_dispensados ELSE 0 END)::float AS anterior
      FROM consumo_registros cr
      JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
      WHERE ic.area = ${area}
        AND cr.fecha > (CURRENT_DATE - INTERVAL '112 days')
        AND lower(COALESCE(cr.tipo_componente, '')) NOT IN ('fungible', 'fluido')
      GROUP BY cr.cn
    )
    SELECT
      m.cn,
      COALESCE(m.principio_activo, '') AS componente,
      COALESCE(m.nombre, '')           AS medicamento,
      m.ppio_activo_cima,
      m.unidades_por_caja,
      m.stock_minimo,
      m.stock_maximo,
      COALESCE(sa.stock_unidades, 0)::float  AS stock_unidades,
      COALESCE(cp.reciente,  0)::float AS consumo_reciente,
      COALESCE(cp.anterior,  0)::float AS consumo_anterior
    FROM meds m
    LEFT JOIN stock_actual sa    ON sa.cn = m.cn
    LEFT JOIN consumo_periodos cp ON cp.cn = m.cn
    WHERE COALESCE(cp.reciente, 0) > 0
       OR COALESCE(sa.stock_unidades, 0) > 0
    ORDER BY m.principio_activo, m.nombre;
  `) as Array<{
    cn: string; componente: string; medicamento: string; ppio_activo_cima: string | null;
    unidades_por_caja: number; stock_minimo: number; stock_maximo: number;
    stock_unidades: number; consumo_reciente: number; consumo_anterior: number;
  }>;

  if (agrupado.length === 0) return [];

  // Series semanales (últimas 16 semanas) para los CNs encontrados
  const cns = agrupado.map(r => r.cn);
  const seriesRows = (await sql`
    SELECT
      cr.cn,
      EXTRACT(ISOYEAR FROM cr.fecha)::int AS iso_year,
      EXTRACT(WEEK     FROM cr.fecha)::int AS iso_week,
      SUM(cr.viales_dispensados)::float   AS viales
    FROM consumo_registros cr
    JOIN importaciones_consumo ic ON ic.id = cr.importacion_id
    WHERE ic.area = ${area}
      AND cr.cn = ANY(${cns})
      AND cr.fecha > (CURRENT_DATE - INTERVAL '56 days')
      AND lower(COALESCE(cr.tipo_componente, '')) NOT IN ('fungible', 'fluido')
    GROUP BY cr.cn, EXTRACT(ISOYEAR FROM cr.fecha), EXTRACT(WEEK FROM cr.fecha)
    ORDER BY cr.cn, iso_year, iso_week;
  `) as Array<{ cn: string; iso_year: number; iso_week: number; viales: number }>;

  // Construimos el resultado con semáforo
  return agrupado.map(r => {
    const upx   = Math.max(1, num(r.unidades_por_caja));
    const stockU = num(r.stock_unidades);
    const stockC = stockU / upx;
    const rec    = num(r.consumo_reciente);
    const ant    = num(r.consumo_anterior);
    const promSem = rec / 8;
    const cobertura = promSem > 0 ? stockU / promSem : null;

    let variacionPct: number | null = null;
    let tendenciaCreciente = false;
    let tendenciaRelevante = false;

    if (ant > 0) {
      variacionPct = ((rec - ant) / ant) * 100;
      tendenciaCreciente = variacionPct > 0;
      // Cambio absoluto en viales/semana
      const cambioAbsViales = Math.abs((rec - ant) / 8);
      const cambioAbsCajas  = cambioAbsViales / upx;
      tendenciaRelevante =
        Math.abs(variacionPct) > 25 &&
        (cambioAbsViales >= 2 || cambioAbsCajas >= 1);
    }

    // Semáforo — thresholds ajustados al rango operativo real (2-4 semanas)
    let semaforo: AlertaCompra['semaforo'] = 'gris';
    if (rec === 0 && stockU === 0) {
      semaforo = 'gris';
    } else if (cobertura !== null && cobertura < 1.5) {
      semaforo = 'rojo';
    } else if (
      (cobertura !== null && cobertura >= 1.5 && cobertura < 2.5) ||
      (tendenciaRelevante && tendenciaCreciente && (cobertura === null || cobertura < 4))
    ) {
      semaforo = 'naranja';
    } else if (cobertura !== null && cobertura >= 2.5 && cobertura <= 4) {
      semaforo = 'verde';
    } else if (cobertura !== null && cobertura > 4) {
      semaforo = 'azul'; // sobrestock
    }

    // Sugerencia de ajuste de stock objetivo (min = 2 sem, max = 4 sem)
    let sugerenciaAjuste: SugerenciaAjuste | null = null;
    if (promSem > 0) {
      const stockMinimoSugerido = Math.ceil(promSem * 2 / upx) * upx;
      const stockMaximoSugerido = Math.ceil(promSem * 4 / upx) * upx;
      const stockMinimoActual = num(r.stock_minimo);
      const stockMaximoActual = num(r.stock_maximo);
      let tipo: SugerenciaAjuste['tipo'] = 'ok';
      if (stockU < promSem * 1.5) {
        tipo = 'aumentar';
      } else if (stockU > promSem * 4) {
        tipo = 'reducir';
      }
      sugerenciaAjuste = { tipo, stockMinimoSugerido, stockMaximoSugerido, stockMinimoActual, stockMaximoActual };
    }

    // Series semanales para la mini-gráfica (últimas 8 semanas)
    const series = seriesRows
      .filter(s => s.cn === r.cn)
      .map(s => ({
        semana: num(s.iso_week),
        anio: num(s.iso_year),
        label: `S${String(num(s.iso_week)).padStart(2, '0')}/${String(num(s.iso_year)).slice(-2)}`,
        viales: Number(s.viales),
      }));

    // Llenar 8 semanas con viales = 0 cuando no hay dato
    const semanasFilled: AlertaCompra['semanasSeries'] = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i * 7);
      // Calcular semana ISO y año ISO
      const thursday = new Date(d);
      thursday.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
      const jan4 = new Date(thursday.getFullYear(), 0, 4);
      const diffDays = (thursday.getTime() - jan4.getTime()) / 86400000;
      const sw = Math.round(diffDays / 7) + 1;
      const sy = thursday.getFullYear();
      const found = series.find(s => s.semana === sw && s.anio === sy);
      semanasFilled.push({
        semana: sw,
        anio: sy,
        label: `S${String(sw).padStart(2, '0')}/${String(sy).slice(-2)}`,
        viales: found ? found.viales : 0,
        recepciones: 0,
      });
    }

    return {
      cn: r.cn,
      componente: r.componente,
      medicamento: r.medicamento,
      ppioActivoCima: r.ppio_activo_cima,
      unidadesPorCaja: upx,
      stockActualUnidades: stockU,
      stockActualCajas: stockC,
      stockMinimo: num(r.stock_minimo),
      stockMaximo: num(r.stock_maximo),
      consumoReciente: rec,
      consumoAnterior: ant,
      promedioSemanal: promSem,
      variacionPct,
      tendenciaCreciente,
      tendenciaRelevante,
      coberturaSemanas: cobertura,
      semaforo,
      sugerenciaAjuste,
      semanasSeries: semanasFilled,
    } satisfies AlertaCompra;
  });
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
