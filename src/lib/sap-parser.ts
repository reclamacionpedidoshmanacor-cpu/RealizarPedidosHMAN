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
const COL_MATERIAL = ['material', 'cod material', 'codigo material'];
const COL_STOCK = ['stock de cierre', 'stock cierre', 'stockcierre', 'stock final', 'stock'];
const COL_VALOR = ['valor final', 'valor', 'valorstock', 'valor total'];

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\n\r\t]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseExcelNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const compact = raw.replace(/\s/g, '');
  let normalized = compact;

  if (compact.includes('.') && compact.includes(',')) {
    const lastDot = compact.lastIndexOf('.');
    const lastComma = compact.lastIndexOf(',');
    normalized =
      lastComma > lastDot
        ? compact.replace(/\./g, '').replace(',', '.')
        : compact.replace(/,/g, '');
  } else if (compact.includes(',')) {
    normalized = compact.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(compact)) {
    normalized = compact.replace(/\./g, '');
  }

  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
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
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];

  if (raw.length < 2) {
    return { rows, errors: ['El archivo no contiene datos.'], fechaArchivo: null };
  }

  const headers = (raw[0] as unknown[]).map((v) => String(v ?? ''));
  const idxMaterial = findCol(headers, COL_MATERIAL);
  const idxStock    = findCol(headers, COL_STOCK);
  const idxValor    = findCol(headers, COL_VALOR);

  if (idxMaterial === -1) errors.push('No se encontró la columna "Material".');
  if (idxStock === -1)    errors.push('No se encontró la columna "Stock de cierre".');
  if (errors.length) return { rows, errors, fechaArchivo: null };

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    const material = String(row[idxMaterial] ?? '').trim();
    if (!material) continue;

    const stockRaw = parseExcelNumber(row[idxStock]);
    if (stockRaw == null) {
      errors.push(`Fila ${i + 1}: stock no numérico ("${row[idxStock]}")`);
      continue;
    }

    const valorRaw = idxValor !== -1 ? parseExcelNumber(row[idxValor]) : null;

    const cn = cnFromSapMaterial(material);
    if (!cn) {
      errors.push(`Fila ${i + 1}: material sin CN válido ("${material}")`);
      continue;
    }

    rows.push({
      cn,
      material,
      stockUnidades: stockRaw,
      valorTotal: valorRaw,
    });
  }

  return { rows, errors, fechaArchivo: null };
}
