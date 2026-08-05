import * as XLSX from 'xlsx';

export interface ManualStockRow {
  cn: string;
  stockUnidades: number | null;
  cajasEnteras: number | null;
  unidadesSueltas: number | null;
}

export interface ManualStockParseResult {
  rows: ManualStockRow[];
  errors: string[];
}

const CN_HEADERS = ['cn', 'codigo nacional', 'codigo_nacional'];
const CAJAS_HEADERS = ['stock cajas', 'cajas', 'stock_cajas', 'stock'];
const UNIDADES_HEADERS = ['unidades totales', 'stock unidades', 'stock_unidades', 'unidades'];
const SUELTAS_HEADERS = ['unidades sueltas', 'comprimidos sueltos', 'unidades_sueltas', 'sueltas'];

function normalize(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

function findHeader(headers: string[], candidates: readonly string[]): number {
  return headers.findIndex((header) => candidates.includes(normalize(header)));
}

function parseInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  const raw = String(value ?? '').trim().replace(/\s/g, '');
  if (!raw) return 0;
  const normalized = /^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw;
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseManualStockExcel(buffer: Buffer): ManualStockParseResult {
  const errors: string[] = [];
  const rows: ManualStockRow[] = [];

  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][];

  if (raw.length < 2) {
    return { rows, errors: ['El archivo manual no contiene datos.'] };
  }

  const headers = (raw[0] ?? []).map(String);
  const cnIdx = findHeader(headers, CN_HEADERS);
  const cajasIdx = findHeader(headers, CAJAS_HEADERS);
  const unidadesIdx = findHeader(headers, UNIDADES_HEADERS);
  const sueltasIdx = findHeader(headers, SUELTAS_HEADERS);

  if (cnIdx === -1) errors.push('No se encontró columna CN.');
  if (unidadesIdx === -1 && cajasIdx === -1) {
    errors.push('No se encontró "Unidades totales" ni "Cajas".');
  }
  if (errors.length) return { rows, errors };

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] ?? [];
    const cn = String(row[cnIdx] ?? '').trim();
    if (!cn) continue;

    if (unidadesIdx !== -1) {
      const stockUnidades = parseInteger(row[unidadesIdx]);
      if (stockUnidades == null) {
        errors.push(`Fila ${i + 1}: las unidades totales deben ser un entero no negativo.`);
        continue;
      }
      rows.push({ cn, stockUnidades, cajasEnteras: null, unidadesSueltas: null });
      continue;
    }

    const cajasEnteras = parseInteger(row[cajasIdx]);
    const unidadesSueltas = sueltasIdx === -1 ? 0 : parseInteger(row[sueltasIdx]);
    if (cajasEnteras == null || unidadesSueltas == null) {
      errors.push(
        `Fila ${i + 1}: las cajas y las unidades sueltas deben ser enteros no negativos.`
      );
      continue;
    }
    rows.push({ cn, stockUnidades: null, cajasEnteras, unidadesSueltas });
  }

  return { rows, errors };
}
