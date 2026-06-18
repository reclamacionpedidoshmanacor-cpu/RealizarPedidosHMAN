import * as XLSX from 'xlsx';
import { cnFromSapMaterial } from './utils';

export interface SapStockRow {
  cn: string;
  material: string;
  stockUnidades: number;
  valorTotal: number | null;
}

export interface SapParseResult {
  rows: SapStockRow[];
  errors: string[];
  fechaArchivo: string | null;
}

// Columnas esperadas en el Excel de SAP (case-insensitive, trim)
const COL_MATERIAL = ['material'];
const COL_STOCK    = ['stock de cierre', 'stock cierre', 'stockcierre'];
const COL_VALOR    = ['valor final', 'valor', 'valorstock'];

function normalize(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function findCol(headers: string[], candidates: string[]): number {
  return headers.findIndex(h => candidates.includes(normalize(h)));
}

export function parseSapExcel(buffer: Buffer): SapParseResult {
  const errors: string[] = [];
  const rows: SapStockRow[] = [];

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch {
    return { rows, errors: ['No se pudo leer el archivo Excel.'], fechaArchivo: null };
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][];

  if (raw.length < 2) {
    return { rows, errors: ['El archivo no contiene datos.'], fechaArchivo: null };
  }

  const headers = (raw[0] as string[]).map(String);
  const idxMaterial = findCol(headers, COL_MATERIAL);
  const idxStock    = findCol(headers, COL_STOCK);
  const idxValor    = findCol(headers, COL_VALOR);

  if (idxMaterial === -1) errors.push('No se encontró la columna "Material".');
  if (idxStock === -1)    errors.push('No se encontró la columna "Stock de cierre".');
  if (errors.length) return { rows, errors, fechaArchivo: null };

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] as string[];
    const material = String(row[idxMaterial] ?? '').trim();
    if (!material) continue;

    const stockRaw = parseFloat(String(row[idxStock] ?? '0').replace(',', '.'));
    if (isNaN(stockRaw)) {
      errors.push(`Fila ${i + 1}: stock no numérico ("${row[idxStock]}")`);
      continue;
    }

    const valorRaw = idxValor !== -1
      ? parseFloat(String(row[idxValor] ?? '').replace(',', '.'))
      : NaN;

    const cn = cnFromSapMaterial(material);

    rows.push({
      cn,
      material,
      stockUnidades: stockRaw,
      valorTotal: isNaN(valorRaw) ? null : valorRaw,
    });
  }

  return { rows, errors, fechaArchivo: null };
}
