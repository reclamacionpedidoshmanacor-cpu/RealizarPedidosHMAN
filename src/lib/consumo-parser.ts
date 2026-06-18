import * as XLSX from 'xlsx';

export interface ConsumoRow {
  fecha: string;         // ISO yyyy-MM-dd
  pacienteId: string;
  indicacion: string;
  protocolo: string;
  cn: string;
  vialesConsumidos: number;
}

export interface ConsumoParseResult {
  rows: ConsumoRow[];
  errors: string[];
  periodoInicio: string | null;
  periodoFin: string | null;
}

// Columnas obligatorias y sus aliases
const COL_FECHA     = ['fecha'];
const COL_PACIENTE  = ['hc', 'paciente', 'hc_paciente', 'historia', 'nhc'];
const COL_INDICACION = ['indicacion', 'indicación', 'diagnostico', 'diagnóstico'];
const COL_PROTOCOLO = ['protocolo'];
const COL_CN        = ['cn', 'codigo nacional', 'código nacional', 'cod.nacional'];
const COL_VIALES    = ['viales', 'viales_consumidos', 'cantidad', 'unidades'];

function normalize(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function findCol(headers: string[], candidates: string[]): number {
  return headers.findIndex(h => candidates.includes(normalize(h)));
}

function parseDate(raw: unknown): string | null {
  if (!raw) return null;
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  const s = String(raw).trim();
  // dd/mm/yyyy
  const match = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

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
  const idxFecha     = findCol(headers, COL_FECHA);
  const idxPaciente  = findCol(headers, COL_PACIENTE);
  const idxIndicacion = findCol(headers, COL_INDICACION);
  const idxProtocolo = findCol(headers, COL_PROTOCOLO);
  const idxCN        = findCol(headers, COL_CN);
  const idxViales    = findCol(headers, COL_VIALES);

  const missing = [];
  if (idxFecha === -1)   missing.push('"Fecha"');
  if (idxCN === -1)      missing.push('"CN"');
  if (idxViales === -1)  missing.push('"Viales"');
  if (missing.length) {
    return { rows, errors: [`Columnas obligatorias no encontradas: ${missing.join(', ')}`], periodoInicio: null, periodoFin: null };
  }

  const fechas: string[] = [];

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    const cn = String(row[idxCN] ?? '').trim();
    if (!cn) continue;

    const fecha = parseDate(row[idxFecha]);
    if (!fecha) {
      errors.push(`Fila ${i + 1}: fecha no reconocida ("${row[idxFecha]}")`);
      continue;
    }

    const viales = parseFloat(String(row[idxViales] ?? '0').replace(',', '.'));
    if (isNaN(viales)) {
      errors.push(`Fila ${i + 1}: viales no numérico`);
      continue;
    }

    fechas.push(fecha);
    rows.push({
      fecha,
      pacienteId: idxPaciente !== -1 ? String(row[idxPaciente] ?? '').trim() : '',
      indicacion: idxIndicacion !== -1 ? String(row[idxIndicacion] ?? '').trim() : '',
      protocolo:  idxProtocolo !== -1 ? String(row[idxProtocolo] ?? '').trim() : '',
      cn,
      vialesConsumidos: viales,
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
