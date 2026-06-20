import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
export interface ConsumoRow {
  anio: number;
  mes: number;
  dia: number | null;
  semanaIso: number | null;
  fecha: string;            // ISO yyyy-MM-dd (lunes de semana ISO, o fecha derivada de mes/día)
  servicio: string;
  uh: string;              // Unidad Hospitalaria
  indicacion: string;
  diagnostico: string;
  protocolo: string;
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
const COL_ANIO       = ['año', 'anio', 'ano', 'year'];
const COL_SEMANA     = ['semana', 'semana del año', 'semana del ano', 'week', 'num semana', 'n semana'];
const COL_MES        = ['mes', 'month'];
const COL_DIA        = ['dia', 'día', 'day'];
const COL_SERVICIO   = ['servicio'];
const COL_UH         = ['uh', 'unidad hospitalaria', 'unidad'];
const COL_INDICACION = ['indicacion', 'indicación'];
const COL_DIAGNOSTICO = ['diagnostico', 'diagnóstico', 'diagnostico'];
const COL_PROTOCOLO  = ['protocolo'];
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

function buildFecha(anio: number, mes: number, dia: number | null): string {
  const d = dia && dia > 0 ? dia : 1;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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

/** Calcula semana ISO desde una fecha concreta. */
function calcIsoWeek(anio: number, mes: number, dia: number): number {
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  const dow = d.getUTCDay() || 7; // lunes=1, domingo=7
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
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
  const idxMes            = findCol(headers, COL_MES);
  const idxDia            = findCol(headers, COL_DIA);
  const idxServicio       = findCol(headers, COL_SERVICIO);
  const idxUH             = findCol(headers, COL_UH);
  const idxIndicacion     = findCol(headers, COL_INDICACION);
  const idxDiagnostico    = findCol(headers, COL_DIAGNOSTICO);
  const idxProtocolo      = findCol(headers, COL_PROTOCOLO);
  const idxTipoTerapia    = findCol(headers, COL_TIPO_TERAPIA);
  const idxTipoComponente = findCol(headers, COL_TIPO_COMPONENTE);
  const idxComponente     = findCol(headers, COL_COMPONENTE);
  const idxCN             = findCol(headers, COL_CN);
  const idxMedicamento    = findCol(headers, COL_MEDICAMENTO);
  const idxViales         = findCol(headers, COL_VIALES);
  const idxPacientes      = findCol(headers, COL_PACIENTES);

  // Columnas obligatorias
  const missing: string[] = [];
  if (idxAnio === -1) missing.push('"AÑO"');
  if (idxSemana === -1 && idxMes === -1) missing.push('"SEMANA" o "MES"');
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

    const anio = Math.round(toNum(row[idxAnio]));
    if (!anio) {
      errors.push(`Fila ${i + 1}: año no válido (AÑO=${row[idxAnio]})`);
      continue;
    }

    // Modo preferente: AÑO + SEMANA
    const semanaRaw = idxSemana !== -1 ? Math.round(toNum(row[idxSemana])) : 0;
    const hasSemana = Number.isFinite(semanaRaw) && semanaRaw >= 1 && semanaRaw <= 53;

    let mes = 0;
    let dia: number | null = null;
    let semanaIso: number | null = null;
    let fecha = '';

    if (hasSemana) {
      semanaIso = semanaRaw;
      const monday = isoWeekStartDate(anio, semanaIso);
      mes = monday.getUTCMonth() + 1;
      fecha = toIsoDateUTC(monday);
    } else {
      // Compatibilidad: AÑO + MES (+ DIA opcional)
      const mesRaw = idxMes !== -1 ? Math.round(toNum(row[idxMes])) : 0;
      if (!mesRaw || mesRaw < 1 || mesRaw > 12) {
        errors.push(`Fila ${i + 1}: semana o mes no válido (SEMANA=${idxSemana !== -1 ? row[idxSemana] : 'N/A'}, MES=${idxMes !== -1 ? row[idxMes] : 'N/A'})`);
        continue;
      }
      mes = mesRaw;
      dia = idxDia !== -1 ? Math.round(toNum(row[idxDia])) || null : null;
      const diaForWeek = dia && dia > 0 ? dia : 1;
      semanaIso = calcIsoWeek(anio, mes, diaForWeek);
      fecha = buildFecha(anio, mes, dia);
    }

    fechas.push(fecha);

    rows.push({
      anio, mes, dia, semanaIso, fecha,
      servicio:       idxServicio       !== -1 ? toStr(row[idxServicio])       : '',
      uh:             idxUH             !== -1 ? toStr(row[idxUH])             : '',
      indicacion:     idxIndicacion     !== -1 ? toStr(row[idxIndicacion])     : '',
      diagnostico:    idxDiagnostico    !== -1 ? toStr(row[idxDiagnostico])    : '',
      protocolo:      idxProtocolo      !== -1 ? toStr(row[idxProtocolo])      : '',
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
