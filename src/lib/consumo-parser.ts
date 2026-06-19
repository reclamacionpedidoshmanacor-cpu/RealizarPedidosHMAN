import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
export interface ConsumoRow {
  anio: number;
  mes: number;
  dia: number | null;
  semanaIso: number | null; // semana ISO 8601 calculada desde DIA si disponible
  fecha: string;            // ISO yyyy-MM-dd construida desde AÑO+MES+DIA
  servicio: string;
  uh: string;              // Unidad Hospitalaria
  edadPaciente: string;
  indicacion: string;
  diagnostico: string;
  protocolo: string;
  numCiclo: string;
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
const COL_MES        = ['mes', 'month'];
const COL_DIA        = ['dia', 'día', 'day'];
const COL_SERVICIO   = ['servicio'];
const COL_UH         = ['uh', 'unidad hospitalaria', 'unidad'];
const COL_EDAD       = ['edad del paciente', 'edad paciente', 'edad'];
const COL_INDICACION = ['indicacion', 'indicación'];
const COL_DIAGNOSTICO = ['diagnostico', 'diagnóstico', 'diagnostico'];
const COL_PROTOCOLO  = ['protocolo'];
const COL_CICLO      = ['nº ciclo', 'n ciclo', 'num ciclo', 'numero ciclo', 'número ciclo', 'ciclo'];
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

/** Calcula el número de semana ISO 8601 a partir de una fecha. */
function calcIsoWeek(anio: number, mes: number, dia: number): number {
  const d = new Date(anio, mes - 1, dia);
  const dayOfWeek = d.getDay() || 7; // lunes=1, domingo=7
  d.setDate(d.getDate() + 4 - dayOfWeek);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
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
  const idxMes            = findCol(headers, COL_MES);
  const idxDia            = findCol(headers, COL_DIA);
  const idxServicio       = findCol(headers, COL_SERVICIO);
  const idxUH             = findCol(headers, COL_UH);
  const idxEdad           = findCol(headers, COL_EDAD);
  const idxIndicacion     = findCol(headers, COL_INDICACION);
  const idxDiagnostico    = findCol(headers, COL_DIAGNOSTICO);
  const idxProtocolo      = findCol(headers, COL_PROTOCOLO);
  const idxCiclo          = findCol(headers, COL_CICLO);
  const idxTipoTerapia    = findCol(headers, COL_TIPO_TERAPIA);
  const idxTipoComponente = findCol(headers, COL_TIPO_COMPONENTE);
  const idxComponente     = findCol(headers, COL_COMPONENTE);
  const idxCN             = findCol(headers, COL_CN);
  const idxMedicamento    = findCol(headers, COL_MEDICAMENTO);
  const idxViales         = findCol(headers, COL_VIALES);
  const idxPacientes      = findCol(headers, COL_PACIENTES);

  // Columnas obligatorias
  const missing: string[] = [];
  if (idxAnio === -1 || idxMes === -1)  missing.push('"AÑO" y "MES"');
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
    const mes  = Math.round(toNum(row[idxMes]));
    if (!anio || !mes) {
      errors.push(`Fila ${i + 1}: año o mes no válido (AÑO=${row[idxAnio]}, MES=${row[idxMes]})`);
      continue;
    }

    const dia = idxDia !== -1 ? Math.round(toNum(row[idxDia])) || null : null;
    const semanaIso = dia && dia > 0 ? calcIsoWeek(anio, mes, dia) : null;
    const fecha = buildFecha(anio, mes, dia);
    fechas.push(fecha);

    rows.push({
      anio, mes, dia, semanaIso, fecha,
      servicio:       idxServicio       !== -1 ? toStr(row[idxServicio])       : '',
      uh:             idxUH             !== -1 ? toStr(row[idxUH])             : '',
      edadPaciente:   idxEdad           !== -1 ? toStr(row[idxEdad])           : '',
      indicacion:     idxIndicacion     !== -1 ? toStr(row[idxIndicacion])     : '',
      diagnostico:    idxDiagnostico    !== -1 ? toStr(row[idxDiagnostico])    : '',
      protocolo:      idxProtocolo      !== -1 ? toStr(row[idxProtocolo])      : '',
      numCiclo:       idxCiclo          !== -1 ? toStr(row[idxCiclo])          : '',
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
