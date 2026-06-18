import * as XLSX from 'xlsx';

export interface ManualStockRow {
  cn: string;
  stockCajas: number;
}

export interface ManualStockParseResult {
  rows: ManualStockRow[];
  errors: string[];
}

const CN_HEADERS = ['cn', 'codigo nacional', 'codigo_nacional'];
const CAJAS_HEADERS = ['stock cajas', 'cajas', 'stock_cajas', 'stock'];

function normalize(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

function findHeader(headers: string[], candidates: readonly string[]): number {
  return headers.findIndex((header) => candidates.includes(normalize(header)));
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

  if (cnIdx === -1) errors.push('No se encontró columna CN.');
  if (cajasIdx === -1) errors.push('No se encontró columna de stock en cajas.');
  if (errors.length) return { rows, errors };

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] ?? [];
    const cn = String(row[cnIdx] ?? '').trim();
    if (!cn) continue;

    const cajasRaw = parseFloat(String(row[cajasIdx] ?? '0').replace(',', '.'));
    if (!Number.isFinite(cajasRaw)) {
      errors.push(`Fila ${i + 1}: stock en cajas no numérico.`);
      continue;
    }

    rows.push({
      cn,
      stockCajas: Math.max(cajasRaw, 0),
    });
  }

  return { rows, errors };
}
