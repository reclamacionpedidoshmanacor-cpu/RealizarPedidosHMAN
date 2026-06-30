import * as XLSX from 'xlsx';
import { cnFromSapMaterial } from './utils';

export type ConsumoMedioImportRow = {
  cn: string;
  material: string;
  consumoTotal: number;
};

export type ConsumoMedioImportParseResult = {
  rows: ConsumoMedioImportRow[];
  errors: string[];
};

const COL_MATERIAL = ['material', 'cod material', 'codigo material'];
const COL_CONSUMO_TOTAL = ['consumo total', 'consumo_total', 'consumototal'];

function normalize(s: string): string {
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
  const normHeaders = headers.map(normalize);
  for (const candidate of candidates) {
    const norm = normalize(candidate);
    const exact = normHeaders.findIndex((h) => h === norm);
    if (exact !== -1) return exact;
  }
  for (const candidate of candidates) {
    const norm = normalize(candidate);
    const partial = normHeaders.findIndex((h) => h.includes(norm) || norm.includes(h));
    if (partial !== -1) return partial;
  }
  return -1;
}

/** Excel SAP: columna Material + Consumo TOTAL (unidades). Agrupa por CN sumando consumos. */
export function parseConsumoMedioSapExcel(buffer: Buffer): ConsumoMedioImportParseResult {
  const errors: string[] = [];

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch {
    return { rows: [], errors: ['No se pudo leer el archivo Excel.'] };
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];

  if (raw.length < 2) {
    return { rows: [], errors: ['El archivo no contiene datos.'] };
  }

  const headers = (raw[0] as unknown[]).map((v) => String(v ?? ''));
  const idxMaterial = findCol(headers, COL_MATERIAL);
  const idxConsumoTotal = findCol(headers, COL_CONSUMO_TOTAL);

  if (idxMaterial === -1) errors.push('No se encontró la columna "Material".');
  if (idxConsumoTotal === -1) errors.push('No se encontró la columna "Consumo TOTAL".');
  if (errors.length > 0) return { rows: [], errors };

  const totalsByCn = new Map<string, { material: string; consumoTotal: number }>();

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    const material = String(row[idxMaterial] ?? '').trim();
    if (!material) continue;

    const consumoRaw = parseExcelNumber(row[idxConsumoTotal]);
    if (consumoRaw == null) {
      errors.push(`Fila ${i + 1}: consumo total no numérico ("${row[idxConsumoTotal]}").`);
      continue;
    }

    const cn = cnFromSapMaterial(material);
    if (!cn) {
      errors.push(`Fila ${i + 1}: material sin CN válido ("${material}").`);
      continue;
    }

    const prev = totalsByCn.get(cn);
    if (prev) {
      prev.consumoTotal += consumoRaw;
    } else {
      totalsByCn.set(cn, { material, consumoTotal: consumoRaw });
    }
  }

  const rows = [...totalsByCn.entries()]
    .map(([cn, data]) => ({
      cn,
      material: data.material,
      consumoTotal: data.consumoTotal,
    }))
    .sort((a, b) => a.cn.localeCompare(b.cn, 'es', { numeric: true }));

  return { rows, errors };
}
