import * as XLSX from 'xlsx';
import { cnFromSapMaterial } from './utils';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
export type ConsumoFormato = 'iv' | 'oral';

export interface ConsumoRow {
  anio: number;
  mes: number;
  dia: number | null;
  semanaIso: number | null;
  fecha: string;            // ISO yyyy-MM-dd (lunes de semana ISO o día 1 mensual)
  servicio: string;
  uh: string;              // Unidad Hospitalaria
  indicacion: string;
  diagnostico: string;
  protocolo: string;
  periodicidad: number | null;  // días que dura el protocolo
  tipoTerapia: string;
  tipoComponente: string;
  componente: string;      // Principio activo
  cn: string;
  medicamento: string;     // Nombre comercial
  vialesDispensados: number;
  numPacientes: number;
}

export interface ConsumoParseResult {
  rows: ConsumoRow[];
  errors: string[];
  periodoInicio: string | null;
  periodoFin: string | null;
  formato: ConsumoFormato;
  /** Cabecera detectada para la columna de cantidad (viales o unidades). */
  cantidadColumna: string | null;
}

// ---------------------------------------------------------------------------
// Aliases de columnas (normalizados)
// ---------------------------------------------------------------------------
const COL_MES        = ['mes', 'month'];
const COL_ANIO       = ['año', 'anio', 'ano', 'year'];
const COL_DIA        = ['dia', 'día', 'day'];
const COL_FECHA      = ['fecha de dispensacion', 'fecha de dispensación', 'fecha dispensacion', 'fecha', 'date'];
const COL_SEMANA     = ['semana', 'semana del año', 'semana del ano', 'week', 'num semana', 'n semana'];
const COL_SERVICIO   = ['servicio', 'servicio clinico', 'servicio clínico'];
const COL_UH         = ['uh', 'unidad hospitalaria', 'unidad'];
const COL_INDICACION = ['indicacion', 'indicación'];
const COL_DIAGNOSTICO = ['diagnostico', 'diagnóstico'];
const COL_PROTOCOLO  = ['protocolo'];
const COL_PERIODICIDAD = [
  'periodicidad',
  'periodicidad dias',
  'periodicidad días',
  'periodicidad (dias)',
  'periodicidad (días)',
  'dias periodicidad',
  'días periodicidad',
  'dias del protocolo',
  'días del protocolo',
];
const COL_TIPO_TERAPIA    = ['tipo de terapia', 'tipo terapia', 'terapia'];
const COL_TIPO_COMPONENTE = ['tipo de componente', 'tipo componente'];
const COL_COMPONENTE = ['componente', 'componente principal', 'principio activo', 'ppio activo'];
const COL_CN         = ['cn', 'codigo nacional', 'código nacional', 'cod.nacional', 'cod nacional'];
const COL_SAP        = ['codigo sap', 'código sap', 'material', 'cod material', 'codigo material'];
const COL_MEDICAMENTO = ['medicamento', 'marca', 'nombre comercial'];
const COL_CANTIDAD_IV = [
  'viales dispensados',
  'viales dispensados (ud)',
  'viales dispensados (uds)',
  'viales dispensados ud',
  'viales dispensados uds',
  'viales',
  'viales_dispensados',
  'viales_consumidos',
];
const COL_CANTIDAD_ORAL = [
  'unidades dispensadas',
  'uds dispensadas',
  'unid dispensadas',
  'unidades',
  'uds',
  'ud',
  'comprimidos',
  'comprimidos dispensados',
  'pastillas',
  'unidades consumidas',
  'uds consumidas',
];
const COL_CANTIDAD_COMUN = ['cantidad', 'cantidad dispensada', 'cantidad consumida'];
const COL_PACIENTES  = ['nº de pacientes', 'n de pacientes', 'num pacientes', 'numero de pacientes', 'número de pacientes', 'pacientes'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function findCol(headers: string[], candidates: string[]): number {
  const normalizedCandidates = candidates.map(normalize);

  const exactIdx = headers.findIndex((h) => normalizedCandidates.includes(normalize(h)));
  if (exactIdx !== -1) return exactIdx;

  const prefixedIdx = headers.findIndex((h) => {
    const nh = normalize(h);
    return normalizedCandidates.some((c) =>
      nh.startsWith(`${c} `) || nh.startsWith(`${c}(`) || nh.startsWith(`${c}-`)
    );
  });
  if (prefixedIdx !== -1) return prefixedIdx;

  return headers.findIndex((h) => {
    const nh = normalize(h);
    return normalizedCandidates.some((c) => nh.includes(c));
  });
}

function findCantidadCol(headers: string[]): { idx: number; formato: ConsumoFormato; label: string } {
  const idxIv = findCol(headers, COL_CANTIDAD_IV);
  if (idxIv !== -1) return { idx: idxIv, formato: 'iv', label: headers[idxIv] ?? 'viales' };

  const idxOral = findCol(headers, COL_CANTIDAD_ORAL);
  if (idxOral !== -1) return { idx: idxOral, formato: 'oral', label: headers[idxOral] ?? 'unidades' };

  const idxComun = findCol(headers, COL_CANTIDAD_COMUN);
  if (idxComun !== -1) {
    const nh = normalize(headers[idxComun] ?? '');
    const formato: ConsumoFormato = nh.includes('vial') ? 'iv' : 'oral';
    return { idx: idxComun, formato, label: headers[idxComun] ?? 'cantidad' };
  }

  return { idx: -1, formato: 'iv', label: '' };
}

type ColumnMap = {
  anio: number;
  mes: number;
  dia: number;
  fecha: number;
  semana: number;
  servicio: number;
  uh: number;
  indicacion: number;
  diagnostico: number;
  protocolo: number;
  periodicidad: number;
  tipoTerapia: number;
  tipoComponente: number;
  componente: number;
  cn: number;
  sap: number;
  medicamento: number;
  cantidad: number;
  pacientes: number;
};

function buildColumnMap(headers: string[]): { cols: ColumnMap; formato: ConsumoFormato; cantidadLabel: string } {
  const cantidad = findCantidadCol(headers);
  const cols: ColumnMap = {
    anio: findCol(headers, COL_ANIO),
    mes: findCol(headers, COL_MES),
    dia: findCol(headers, COL_DIA),
    fecha: findCol(headers, COL_FECHA),
    semana: findCol(headers, COL_SEMANA),
    servicio: findCol(headers, COL_SERVICIO),
    uh: findCol(headers, COL_UH),
    indicacion: findCol(headers, COL_INDICACION),
    diagnostico: findCol(headers, COL_DIAGNOSTICO),
    protocolo: findCol(headers, COL_PROTOCOLO),
    periodicidad: findCol(headers, COL_PERIODICIDAD),
    tipoTerapia: findCol(headers, COL_TIPO_TERAPIA),
    tipoComponente: findCol(headers, COL_TIPO_COMPONENTE),
    componente: findCol(headers, COL_COMPONENTE),
    cn: findCol(headers, COL_CN),
    sap: findCol(headers, COL_SAP),
    medicamento: findCol(headers, COL_MEDICAMENTO),
    cantidad: cantidad.idx,
    pacientes: findCol(headers, COL_PACIENTES),
  };

  let formato = cantidad.formato;
  if (cols.cn === -1 && cols.sap !== -1) formato = 'oral';
  else if (cols.cn !== -1 && cols.sap === -1) formato = 'iv';
  else if (cols.cn !== -1 && cols.sap !== -1) formato = cantidad.formato;

  const firstHeader = normalize(headers[0] ?? '');
  if (firstHeader === 'codigo sap' && cols.sap !== -1) formato = 'oral';

  return { cols, formato, cantidadLabel: cantidad.label };
}

function toNum(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function toStr(v: unknown): string {
  return String(v ?? '').trim();
}

function parsePeriodicidad(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Math.round(toNum(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toIsoDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseExcelDate(v: unknown): { anio: number; mes: number; dia: number } | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return { anio: v.getUTCFullYear(), mes: v.getUTCMonth() + 1, dia: v.getUTCDate() };
  }

  if (typeof v === 'number' && Number.isFinite(v) && v > 30000 && v < 60000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(v));
    return { anio: epoch.getUTCFullYear(), mes: epoch.getUTCMonth() + 1, dia: epoch.getUTCDate() };
  }

  let s = toStr(v);
  if (!s) return null;

  // Ignorar hora: "02/01/2024 10:21" o "2024-01-02T10:21:00"
  s = s.split(/[T\s]/)[0] ?? s;

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const anio = Number(iso[1]);
    const mes = Number(iso[2]);
    const dia = Number(iso[3]);
    if (anio >= 2000 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) return { anio, mes, dia };
  }

  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (dmy) {
    const dia = Number(dmy[1]);
    const mes = Number(dmy[2]);
    let anio = Number(dmy[3]);
    if (anio < 100) anio += 2000;
    if (anio >= 2000 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) return { anio, mes, dia };
  }

  const n = Number(s);
  if (Number.isFinite(n) && n > 30000 && n < 60000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(n));
    return { anio: epoch.getUTCFullYear(), mes: epoch.getUTCMonth() + 1, dia: epoch.getUTCDate() };
  }

  return null;
}

/** Lunes de la semana ISO indicada. */
function isoWeekStartDate(anio: number, semana: number): Date {
  const base = new Date(Date.UTC(anio, 0, 1 + (semana - 1) * 7));
  const day = base.getUTCDay();
  const diff = day <= 4 ? 1 - day : 8 - day;
  base.setUTCDate(base.getUTCDate() + diff);
  return base;
}

function resolveCn(row: unknown[], cols: ColumnMap): string {
  const cnDirect = cols.cn !== -1 ? toStr(row[cols.cn]) : '';
  if (cnDirect) return cnDirect;
  if (cols.sap !== -1) return cnFromSapMaterial(toStr(row[cols.sap]));
  return '';
}

function readWorkbook(buffer: Buffer): { raw: unknown[][]; headers: string[] } | { error: string } {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch {
    return { error: 'No se pudo leer el archivo.' };
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
  if (raw.length < 2) return { error: 'El archivo no contiene datos.' };

  const headers = (raw[0] as string[]).map(String);
  return { raw, headers };
}

function validateMandatoryColumns(cols: ColumnMap): string | null {
  const hasId = cols.cn !== -1 || cols.sap !== -1;
  if (!hasId) return 'Columnas obligatorias no encontradas: identificador del medicamento (CN o Código SAP).';
  if (cols.cantidad === -1) {
    return 'Columnas obligatorias no encontradas: cantidad (viales dispensados, unidades dispensadas o cantidad).';
  }
  return null;
}

function buildRowBase(
  row: unknown[],
  cols: ColumnMap,
  formato: ConsumoFormato,
): Omit<ConsumoRow, 'anio' | 'mes' | 'dia' | 'semanaIso' | 'fecha'> | null {
  const cn = resolveCn(row, cols);
  if (!cn) return null;

  let tipoTerapia = cols.tipoTerapia !== -1 ? toStr(row[cols.tipoTerapia]) : '';
  if (!tipoTerapia) tipoTerapia = formato === 'oral' ? 'Oral' : '';

  return {
    servicio: cols.servicio !== -1 ? toStr(row[cols.servicio]) : '',
    uh: cols.uh !== -1 ? toStr(row[cols.uh]) : '',
    indicacion: cols.indicacion !== -1 ? toStr(row[cols.indicacion]) : '',
    diagnostico: cols.diagnostico !== -1 ? toStr(row[cols.diagnostico]) : '',
    protocolo: cols.protocolo !== -1 ? toStr(row[cols.protocolo]) : '',
    periodicidad: cols.periodicidad !== -1 ? parsePeriodicidad(row[cols.periodicidad]) : null,
    tipoTerapia,
    tipoComponente: cols.tipoComponente !== -1 ? toStr(row[cols.tipoComponente]) : '',
    componente: cols.componente !== -1 ? toStr(row[cols.componente]) : '',
    cn,
    medicamento: cols.medicamento !== -1 ? toStr(row[cols.medicamento]) : '',
    vialesDispensados: toNum(row[cols.cantidad]),
    numPacientes: cols.pacientes !== -1 ? Math.round(toNum(row[cols.pacientes])) : 0,
  };
}

// ---------------------------------------------------------------------------
// Parser principal (semanal)
// ---------------------------------------------------------------------------
export function parseConsumoExcel(buffer: Buffer): ConsumoParseResult {
  const errors: string[] = [];
  const rows: ConsumoRow[] = [];

  const wb = readWorkbook(buffer);
  if ('error' in wb) {
    return { rows, errors: [wb.error], periodoInicio: null, periodoFin: null, formato: 'iv', cantidadColumna: null };
  }

  const { raw, headers } = wb;
  const { cols, formato, cantidadLabel } = buildColumnMap(headers);
  const missing = validateMandatoryColumns(cols);
  if (missing) {
    return { rows, errors: [missing], periodoInicio: null, periodoFin: null, formato, cantidadColumna: cantidadLabel || null };
  }

  const fechas: string[] = [];

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    const base = buildRowBase(row, cols, formato);
    if (!base) continue;

    const nowYear = new Date().getFullYear();
    const anio = cols.anio !== -1 ? (Math.round(toNum(row[cols.anio])) || nowYear) : nowYear;
    const semanaRaw = cols.semana !== -1 ? Math.round(toNum(row[cols.semana])) : 1;
    const semanaIso = Number.isFinite(semanaRaw) && semanaRaw >= 1 && semanaRaw <= 53 ? semanaRaw : 1;
    const monday = isoWeekStartDate(anio, semanaIso);
    const mes = monday.getUTCMonth() + 1;
    const fecha = toIsoDateUTC(monday);

    fechas.push(fecha);

    rows.push({
      anio, mes, dia: null, semanaIso, fecha,
      ...base,
    });
  }

  fechas.sort();
  return {
    rows,
    errors,
    periodoInicio: fechas[0] ?? null,
    periodoFin: fechas[fechas.length - 1] ?? null,
    formato,
    cantidadColumna: cantidadLabel || null,
  };
}

/** Último año/mes inclusive del histórico mensual (mayo 2026, hasta el 3 incl.). */
export const HISTORICO_MENSUAL_HASTA_YM = 202605;

/** Primer lunes con importación semanal (4 mayo 2026). */
export const SEMANAL_DESDE_FECHA = '2026-05-04';

export function ymFromAnioMes(anio: number, mes: number): number {
  return anio * 100 + mes;
}

function lastDayOfMonthUTC(anio: number, mes: number): string {
  return toIsoDateUTC(new Date(Date.UTC(anio, mes, 0)));
}

function firstDayOfMonthUTC(anio: number, mes: number): string {
  return toIsoDateUTC(new Date(Date.UTC(anio, mes - 1, 1)));
}

/** Aplica modo mensual por fila (año/mes del Excel o fallback único). semana_iso queda nula. */
export function assignHistoricoMensual(
  rows: ConsumoRow[],
  fallback?: { anio: number; mes: number },
): { periodoInicio: string; periodoFin: string; meses: { anio: number; mes: number; filas: number }[] } {
  const byYm = new Map<number, number>();
  let minYm = Infinity;
  let maxYm = -Infinity;

  for (const r of rows) {
    if (fallback) {
      r.anio = fallback.anio;
      r.mes = fallback.mes;
    }
    const anio = r.anio;
    const mes = r.mes;
    if (!Number.isFinite(anio) || anio < 2000 || anio > 2100) {
      throw new Error(`Año no válido en fila (CN ${r.cn || '?'}).`);
    }
    if (!Number.isFinite(mes) || mes < 1 || mes > 12) {
      throw new Error(`Mes no válido en fila (CN ${r.cn || '?'}). El Excel debe incluir columnas AÑO y MES, o FECHA.`);
    }
    const ym = ymFromAnioMes(r.anio, r.mes);
    if (ym > HISTORICO_MENSUAL_HASTA_YM) {
      throw new Error(
        `El histórico mensual solo admite hasta mayo 2026 (corte 3 may). Hay filas de ${r.mes}/${r.anio}.`,
      );
    }
    r.dia = null;
    r.semanaIso = null;
    r.fecha = firstDayOfMonthUTC(r.anio, r.mes);
    byYm.set(ym, (byYm.get(ym) ?? 0) + 1);
    minYm = Math.min(minYm, ym);
    maxYm = Math.max(maxYm, ym);
  }

  const [minAnio, minMes] = [Math.floor(minYm / 100), minYm % 100];
  const [maxAnio, maxMes] = [Math.floor(maxYm / 100), maxYm % 100];

  const meses = [...byYm.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ym, filas]) => ({ anio: Math.floor(ym / 100), mes: ym % 100, filas }));

  return {
    periodoInicio: firstDayOfMonthUTC(minAnio, minMes),
    periodoFin: lastDayOfMonthUTC(maxAnio, maxMes),
    meses,
  };
}

/** Parser histórico: lee AÑO y MES del Excel (varios meses en un archivo), o FECHA por fila. */
export function parseConsumoExcelHistorico(buffer: Buffer): ConsumoParseResult & { tieneColumnasPeriodo: boolean } {
  const errors: string[] = [];
  const rows: ConsumoRow[] = [];

  const wb = readWorkbook(buffer);
  if ('error' in wb) {
    return {
      rows, errors: [wb.error], periodoInicio: null, periodoFin: null,
      tieneColumnasPeriodo: false, formato: 'iv', cantidadColumna: null,
    };
  }

  const { raw, headers } = wb;
  const { cols, formato, cantidadLabel } = buildColumnMap(headers);
  const missing = validateMandatoryColumns(cols);
  if (missing) {
    return {
      rows, errors: [missing], periodoInicio: null, periodoFin: null,
      tieneColumnasPeriodo: false, formato, cantidadColumna: cantidadLabel || null,
    };
  }

  const tieneColumnasPeriodo = (cols.anio !== -1 && cols.mes !== -1) || cols.fecha !== -1;
  if (!tieneColumnasPeriodo) {
    return {
      rows,
      errors: ['El histórico requiere columnas AÑO y MES, columna FECHA, o indícalos en el formulario si el archivo es de un solo mes.'],
      periodoInicio: null,
      periodoFin: null,
      tieneColumnasPeriodo: false,
      formato,
      cantidadColumna: cantidadLabel || null,
    };
  }

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    const base = buildRowBase(row, cols, formato);
    if (!base) continue;

    let anio: number;
    let mes: number;
    let dia: number | null = cols.dia !== -1 ? Math.round(toNum(row[cols.dia])) || null : null;

    if (cols.anio !== -1 && cols.mes !== -1) {
      anio = Math.round(toNum(row[cols.anio]));
      mes = Math.round(toNum(row[cols.mes]));
    } else if (cols.fecha !== -1) {
      const parsed = parseExcelDate(row[cols.fecha]);
      if (!parsed) {
        errors.push(`Fila ${i + 1}: FECHA no válida.`);
        continue;
      }
      anio = parsed.anio;
      mes = parsed.mes;
      dia = parsed.dia;
    } else {
      errors.push(`Fila ${i + 1}: falta periodo (AÑO/MES o FECHA).`);
      continue;
    }

    if (anio < 2000 || anio > 2100 || mes < 1 || mes > 12) {
      errors.push(`Fila ${i + 1}: AÑO/MES no válidos (${anio}/${mes}).`);
      continue;
    }

    rows.push({
      anio,
      mes,
      dia,
      semanaIso: null,
      fecha: firstDayOfMonthUTC(anio, mes),
      ...base,
    });
  }

  return {
    rows, errors, periodoInicio: null, periodoFin: null,
    tieneColumnasPeriodo: true, formato, cantidadColumna: cantidadLabel || null,
  };
}

// ---------------------------------------------------------------------------
// Parser oral (dispensaciones mensuales — columnas fijas del informe)
// ---------------------------------------------------------------------------
type OralColumnMap = {
  anio: number;
  mes: number;
  fechaDisp: number;
  servicio: number;
  uh: number;
  diagnostico: number;
  cn: number;
  medicamento: number;
  componente: number;
  cantidad: number;
  pacientes: number;
};

function buildOralColumnMap(headers: string[]): OralColumnMap {
  return {
    anio: findCol(headers, COL_ANIO),
    mes: findCol(headers, COL_MES),
    fechaDisp: findCol(headers, COL_FECHA),
    servicio: findCol(headers, COL_SERVICIO),
    uh: findCol(headers, COL_UH),
    diagnostico: findCol(headers, COL_DIAGNOSTICO),
    cn: findCol(headers, COL_CN),
    medicamento: findCol(headers, COL_MEDICAMENTO),
    componente: findCol(headers, COL_COMPONENTE),
    cantidad: findCol(headers, [...COL_CANTIDAD_COMUN, ...COL_CANTIDAD_ORAL]),
    pacientes: findCol(headers, COL_PACIENTES),
  };
}

function validateOralColumns(cols: OralColumnMap, allowMissingYm = false): string | null {
  const missing: string[] = [];
  if (cols.cn === -1) missing.push('CN');
  if (cols.cantidad === -1) missing.push('cantidad');
  if (!allowMissingYm) {
    if (cols.anio === -1) missing.push('AÑO');
    if (cols.mes === -1) missing.push('mes');
  }
  if (missing.length) {
    return `Columnas obligatorias no encontradas: ${missing.join(', ')}. Esperado: AÑO, mes, fecha de dispensación, servicio clínico, UH, diagnóstico, CN, Medicamento, Componente principal, cantidad, nº de pacientes.`;
  }
  return null;
}

/** Finaliza filas orales: conserva la fecha de dispensación y no exige semana ISO. */
export function finalizeOralImport(
  rows: ConsumoRow[],
  fallback?: { anio: number; mes: number },
): { periodoInicio: string; periodoFin: string; meses: { anio: number; mes: number; filas: number }[] } {
  const byYm = new Map<number, number>();
  const fechas: string[] = [];

  for (const r of rows) {
    if (fallback) {
      r.anio = fallback.anio;
      r.mes = fallback.mes;
    }
    if (!Number.isFinite(r.anio) || r.anio < 2000 || r.anio > 2100) {
      throw new Error(`Año no válido en fila (CN ${r.cn || '?'}).`);
    }
    if (!Number.isFinite(r.mes) || r.mes < 1 || r.mes > 12) {
      throw new Error(`Mes no válido en fila (CN ${r.cn || '?'}).`);
    }

    r.semanaIso = null;
    r.tipoTerapia = 'Oral';
    r.indicacion = r.indicacion || '';
    r.protocolo = r.protocolo || '';
    r.tipoComponente = r.tipoComponente || '';

    if (!r.fecha) {
      r.fecha = firstDayOfMonthUTC(r.anio, r.mes);
      r.dia = null;
    }

    fechas.push(r.fecha);
    const ym = ymFromAnioMes(r.anio, r.mes);
    byYm.set(ym, (byYm.get(ym) ?? 0) + 1);
  }

  fechas.sort();
  const meses = [...byYm.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ym, filas]) => ({ anio: Math.floor(ym / 100), mes: ym % 100, filas }));

  return {
    periodoInicio: fechas[0] ?? firstDayOfMonthUTC(meses[0]?.anio ?? 2000, meses[0]?.mes ?? 1),
    periodoFin: fechas[fechas.length - 1] ?? lastDayOfMonthUTC(
      meses[meses.length - 1]?.anio ?? 2000,
      meses[meses.length - 1]?.mes ?? 1,
    ),
    meses,
  };
}

/**
 * Parser dedicado a informes de dispensación oral.
 * Mapeo: servicio clínico→servicio, Componente principal→componente, cantidad→viales_dispensados.
 * protocolo / indicación / periodicidad quedan vacíos (no afectan al análisis agregado).
 */
export function parseConsumoExcelOral(
  buffer: Buffer,
  opts?: { allowMissingYm?: boolean },
): ConsumoParseResult & { tieneColumnasPeriodo: boolean } {
  const errors: string[] = [];
  const rows: ConsumoRow[] = [];
  const allowMissingYm = opts?.allowMissingYm ?? false;

  const wb = readWorkbook(buffer);
  if ('error' in wb) {
    return {
      rows, errors: [wb.error], periodoInicio: null, periodoFin: null,
      tieneColumnasPeriodo: false, formato: 'oral', cantidadColumna: null,
    };
  }

  const { raw, headers } = wb;
  const cols = buildOralColumnMap(headers);
  const missing = validateOralColumns(cols, allowMissingYm);
  if (missing) {
    return {
      rows, errors: [missing], periodoInicio: null, periodoFin: null,
      tieneColumnasPeriodo: false, formato: 'oral', cantidadColumna: null,
    };
  }

  const cantidadLabel = headers[cols.cantidad] ?? 'cantidad';
  const tieneColumnasPeriodo = (cols.anio !== -1 && cols.mes !== -1) || allowMissingYm;

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    const cn = toStr(row[cols.cn]);
    if (!cn) continue;

    let anio = cols.anio !== -1 ? Math.round(toNum(row[cols.anio])) : 0;
    let mes = cols.mes !== -1 ? Math.round(toNum(row[cols.mes])) : 0;

    if (!allowMissingYm && (anio < 2000 || anio > 2100 || mes < 1 || mes > 12)) {
      errors.push(`Fila ${i + 1}: AÑO/mes no válidos (${anio}/${mes}).`);
      continue;
    }

    let fecha = anio >= 2000 && mes >= 1 && mes <= 12
      ? firstDayOfMonthUTC(anio, mes)
      : '';
    // Guardamos el mes del Excel antes de sobreescribir, lo usaremos para
    // detectar fechas en formato AAAA-DD-MM (día y mes invertidos).
    const mesDelExcel = mes;
    let dia: number | null = null;
    if (cols.fechaDisp !== -1) {
      const parsed = parseExcelDate(row[cols.fechaDisp]);
      if (parsed) {
        let { anio: pA, mes: pM, dia: pD } = parsed;

        // Detección de formato AAAA-DD-MM: ocurre cuando el día (≤12) y el mes del
        // Excel de referencia coinciden en posición invertida.
        // Condición: mesDelExcel válido, el mes parseado ≠ mesDelExcel, pero el día
        // parseado = mesDelExcel → el archivo usa AAAA-DD-MM.
        if (
          mesDelExcel >= 1 && mesDelExcel <= 12 &&
          pM !== mesDelExcel &&
          pD === mesDelExcel &&
          pM >= 1 && pM <= 31
        ) {
          const tmp = pM;
          pM = pD;
          pD = tmp;
        }

        fecha = toIsoDateUTC(new Date(Date.UTC(pA, pM - 1, pD)));
        dia = pD;
        // La fecha real de dispensación siempre tiene prioridad
        anio = pA;
        mes = pM;
      } else if (toStr(row[cols.fechaDisp])) {
        errors.push(`Fila ${i + 1}: fecha de dispensación no válida.`);
        continue;
      }
    }

    if (!fecha && allowMissingYm) {
      fecha = '2000-01-01'; // placeholder; finalizeOralImport con fallback lo corrige
    }

    rows.push({
      anio,
      mes,
      dia,
      semanaIso: null,
      fecha,
      servicio: cols.servicio !== -1 ? toStr(row[cols.servicio]) : '',
      uh: cols.uh !== -1 ? toStr(row[cols.uh]) : '',
      indicacion: '',
      diagnostico: cols.diagnostico !== -1 ? toStr(row[cols.diagnostico]) : '',
      protocolo: '',
      periodicidad: null,
      tipoTerapia: 'Oral',
      tipoComponente: '',
      componente: cols.componente !== -1 ? toStr(row[cols.componente]) : '',
      cn,
      medicamento: cols.medicamento !== -1 ? toStr(row[cols.medicamento]) : '',
      vialesDispensados: toNum(row[cols.cantidad]),
      numPacientes: cols.pacientes !== -1 ? Math.round(toNum(row[cols.pacientes])) : 0,
    });
  }

  return {
    rows,
    errors,
    periodoInicio: null,
    periodoFin: null,
    tieneColumnasPeriodo,
    formato: 'oral',
    cantidadColumna: cantidadLabel,
  };
}
