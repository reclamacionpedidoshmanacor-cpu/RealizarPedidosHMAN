import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
export interface ConsumoRow {
  anio: number;
  mes: number;
  dia: number | null;
  semanaIso: number | null;
  fecha: string;            // ISO yyyy-MM-dd (lunes de semana ISO)
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
}

// ---------------------------------------------------------------------------
// Aliases de columnas (normalizados)
// ---------------------------------------------------------------------------
const COL_MES        = ['mes', 'month'];
const COL_ANIO       = ['año', 'anio', 'ano', 'year'];
const COL_SEMANA     = ['semana', 'semana del año', 'semana del ano', 'week', 'num semana', 'n semana'];
const COL_SERVICIO   = ['servicio'];
const COL_UH         = ['uh', 'unidad hospitalaria', 'unidad'];
const COL_INDICACION = ['indicacion', 'indicación'];
const COL_DIAGNOSTICO = ['diagnostico', 'diagnóstico', 'diagnostico'];
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
const COL_COMPONENTE = ['componente'];  // principio activo
const COL_CN         = ['cn', 'codigo nacional', 'código nacional', 'cod.nacional'];
const COL_MEDICAMENTO = ['medicamento'];
const COL_VIALES     = [
  'viales dispensados',
  'viales dispensados (ud)',
  'viales dispensados (uds)',
  'viales dispensados ud',
  'viales dispensados uds',
  'viales',
  'viales_dispensados',
  'viales_consumidos',
  'cantidad',
];
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

  // 1) Match exacto (prioritario)
  const exactIdx = headers.findIndex((h) => normalizedCandidates.includes(normalize(h)));
  if (exactIdx !== -1) return exactIdx;

  // 2) Match por prefijo (ej: "viales dispensados (ud)")
  const prefixedIdx = headers.findIndex((h) => {
    const nh = normalize(h);
    return normalizedCandidates.some((c) =>
      nh.startsWith(`${c} `) || nh.startsWith(`${c}(`) || nh.startsWith(`${c}-`)
    );
  });
  if (prefixedIdx !== -1) return prefixedIdx;

  // 3) Match parcial como último recurso
  return headers.findIndex((h) => {
    const nh = normalize(h);
    return normalizedCandidates.some((c) => nh.includes(c));
  });
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

/** Lunes de la semana ISO indicada. */
function isoWeekStartDate(anio: number, semana: number): Date {
  const base = new Date(Date.UTC(anio, 0, 1 + (semana - 1) * 7));
  const day = base.getUTCDay(); // 0 domingo ... 6 sábado
  const diff = day <= 4 ? 1 - day : 8 - day; // mover al lunes ISO
  base.setUTCDate(base.getUTCDate() + diff);
  return base;
}

// ---------------------------------------------------------------------------
// Parser principal
// ---------------------------------------------------------------------------
export function parseConsumoExcel(buffer: Buffer): ConsumoParseResult {
  const errors: string[] = [];
  const rows: ConsumoRow[] = [];

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch {
    return { rows, errors: ['No se pudo leer el archivo.'], periodoInicio: null, periodoFin: null };
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];

  if (raw.length < 2) {
    return { rows, errors: ['El archivo no contiene datos.'], periodoInicio: null, periodoFin: null };
  }

  const headers = (raw[0] as string[]).map(String);
  const idxAnio           = findCol(headers, COL_ANIO);
  const idxSemana         = findCol(headers, COL_SEMANA);
  const idxServicio       = findCol(headers, COL_SERVICIO);
  const idxUH             = findCol(headers, COL_UH);
  const idxIndicacion     = findCol(headers, COL_INDICACION);
  const idxDiagnostico    = findCol(headers, COL_DIAGNOSTICO);
  const idxProtocolo      = findCol(headers, COL_PROTOCOLO);
  const idxPeriodicidad   = findCol(headers, COL_PERIODICIDAD);
  const idxTipoTerapia    = findCol(headers, COL_TIPO_TERAPIA);
  const idxTipoComponente = findCol(headers, COL_TIPO_COMPONENTE);
  const idxComponente     = findCol(headers, COL_COMPONENTE);
  const idxCN             = findCol(headers, COL_CN);
  const idxMedicamento    = findCol(headers, COL_MEDICAMENTO);
  const idxViales         = findCol(headers, COL_VIALES);
  const idxPacientes      = findCol(headers, COL_PACIENTES);

  // Columnas obligatorias
  const missing: string[] = [];
  if (idxCN === -1)       missing.push('"CN"');
  if (idxViales === -1)   missing.push('"VIALES DISPENSADOS"');
  if (missing.length) {
    return {
      rows, errors: [`Columnas obligatorias no encontradas: ${missing.join(', ')}.`],
      periodoInicio: null, periodoFin: null,
    };
  }

  const fechas: string[] = [];

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];

    const cn = toStr(row[idxCN]);
    if (!cn) continue; // fila vacía

    // La semana final la fija /api/consumo/importar con valores manuales.
    // Si el Excel trae AÑO/SEMANA se usan solo como base informativa.
    const nowYear = new Date().getFullYear();
    const anio = idxAnio !== -1 ? (Math.round(toNum(row[idxAnio])) || nowYear) : nowYear;
    const semanaRaw = idxSemana !== -1 ? Math.round(toNum(row[idxSemana])) : 1;
    const semanaIso = Number.isFinite(semanaRaw) && semanaRaw >= 1 && semanaRaw <= 53 ? semanaRaw : 1;
    const monday = isoWeekStartDate(anio, semanaIso);
    const mes = monday.getUTCMonth() + 1;
    const dia: number | null = null;
    const fecha = toIsoDateUTC(monday);

    fechas.push(fecha);

    rows.push({
      anio, mes, dia, semanaIso, fecha,
      servicio:       idxServicio       !== -1 ? toStr(row[idxServicio])       : '',
      uh:             idxUH             !== -1 ? toStr(row[idxUH])             : '',
      indicacion:     idxIndicacion     !== -1 ? toStr(row[idxIndicacion])     : '',
      diagnostico:    idxDiagnostico    !== -1 ? toStr(row[idxDiagnostico])    : '',
      protocolo:      idxProtocolo      !== -1 ? toStr(row[idxProtocolo])      : '',
      periodicidad:   idxPeriodicidad   !== -1 ? parsePeriodicidad(row[idxPeriodicidad]) : null,
      tipoTerapia:    idxTipoTerapia    !== -1 ? toStr(row[idxTipoTerapia])    : '',
      tipoComponente: idxTipoComponente !== -1 ? toStr(row[idxTipoComponente]) : '',
      componente:     idxComponente     !== -1 ? toStr(row[idxComponente])     : '',
      cn,
      medicamento:    idxMedicamento    !== -1 ? toStr(row[idxMedicamento])    : '',
      vialesDispensados: toNum(row[idxViales]),
      numPacientes:   idxPacientes      !== -1 ? Math.round(toNum(row[idxPacientes])) : 0,
    });
  }

  fechas.sort();
  return {
    rows,
    errors,
    periodoInicio: fechas[0] ?? null,
    periodoFin: fechas[fechas.length - 1] ?? null,
  };
}

/** Límite inclusive del histórico mensual (abril 2026). Desde mayo → importación semanal. */
export const HISTORICO_MENSUAL_HASTA_YM = 202604;

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
      throw new Error(`Mes no válido en fila (CN ${r.cn || '?'}). El Excel debe incluir columnas AÑO y MES.`);
    }
    const ym = ymFromAnioMes(r.anio, r.mes);
    if (ym > HISTORICO_MENSUAL_HASTA_YM) {
      throw new Error(
        `El histórico mensual solo admite hasta abril 2026. Hay filas de ${r.mes}/${r.anio}.`,
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

/** Parser histórico: lee AÑO y MES del Excel (varios meses en un archivo). */
export function parseConsumoExcelHistorico(buffer: Buffer): ConsumoParseResult & { tieneColumnasPeriodo: boolean } {
  const errors: string[] = [];
  const rows: ConsumoRow[] = [];

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch {
    return { rows, errors: ['No se pudo leer el archivo.'], periodoInicio: null, periodoFin: null, tieneColumnasPeriodo: false };
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
  if (raw.length < 2) {
    return { rows, errors: ['El archivo no contiene datos.'], periodoInicio: null, periodoFin: null, tieneColumnasPeriodo: false };
  }

  const headers = (raw[0] as string[]).map(String);
  const idxAnio = findCol(headers, COL_ANIO);
  const idxMes = findCol(headers, COL_MES);
  const idxServicio = findCol(headers, COL_SERVICIO);
  const idxUH = findCol(headers, COL_UH);
  const idxIndicacion = findCol(headers, COL_INDICACION);
  const idxDiagnostico = findCol(headers, COL_DIAGNOSTICO);
  const idxProtocolo = findCol(headers, COL_PROTOCOLO);
  const idxPeriodicidad = findCol(headers, COL_PERIODICIDAD);
  const idxTipoTerapia = findCol(headers, COL_TIPO_TERAPIA);
  const idxTipoComponente = findCol(headers, COL_TIPO_COMPONENTE);
  const idxComponente = findCol(headers, COL_COMPONENTE);
  const idxCN = findCol(headers, COL_CN);
  const idxMedicamento = findCol(headers, COL_MEDICAMENTO);
  const idxViales = findCol(headers, COL_VIALES);
  const idxPacientes = findCol(headers, COL_PACIENTES);

  const missing: string[] = [];
  if (idxCN === -1) missing.push('"CN"');
  if (idxViales === -1) missing.push('"VIALES DISPENSADOS"');
  if (missing.length) {
    return {
      rows,
      errors: [`Columnas obligatorias no encontradas: ${missing.join(', ')}.`],
      periodoInicio: null,
      periodoFin: null,
      tieneColumnasPeriodo: idxAnio !== -1 && idxMes !== -1,
    };
  }

  const tieneColumnasPeriodo = idxAnio !== -1 && idxMes !== -1;
  if (!tieneColumnasPeriodo) {
    return {
      rows,
      errors: ['El histórico requiere columnas AÑO y MES en el Excel (o indícalos en el formulario si el archivo es de un solo mes).'],
      periodoInicio: null,
      periodoFin: null,
      tieneColumnasPeriodo: false,
    };
  }

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    const cn = toStr(row[idxCN]);
    if (!cn) continue;

    const anio = Math.round(toNum(row[idxAnio]));
    const mes = Math.round(toNum(row[idxMes]));
    if (anio < 2000 || anio > 2100 || mes < 1 || mes > 12) {
      errors.push(`Fila ${i + 1}: AÑO/MES no válidos (${anio}/${mes}).`);
      continue;
    }

    rows.push({
      anio,
      mes,
      dia: null,
      semanaIso: null,
      fecha: firstDayOfMonthUTC(anio, mes),
      servicio: idxServicio !== -1 ? toStr(row[idxServicio]) : '',
      uh: idxUH !== -1 ? toStr(row[idxUH]) : '',
      indicacion: idxIndicacion !== -1 ? toStr(row[idxIndicacion]) : '',
      diagnostico: idxDiagnostico !== -1 ? toStr(row[idxDiagnostico]) : '',
      protocolo: idxProtocolo !== -1 ? toStr(row[idxProtocolo]) : '',
      periodicidad: idxPeriodicidad !== -1 ? parsePeriodicidad(row[idxPeriodicidad]) : null,
      tipoTerapia: idxTipoTerapia !== -1 ? toStr(row[idxTipoTerapia]) : '',
      tipoComponente: idxTipoComponente !== -1 ? toStr(row[idxTipoComponente]) : '',
      componente: idxComponente !== -1 ? toStr(row[idxComponente]) : '',
      cn,
      medicamento: idxMedicamento !== -1 ? toStr(row[idxMedicamento]) : '',
      vialesDispensados: toNum(row[idxViales]),
      numPacientes: idxPacientes !== -1 ? Math.round(toNum(row[idxPacientes])) : 0,
    });
  }

  return { rows, errors, periodoInicio: null, periodoFin: null, tieneColumnasPeriodo: true };
}
