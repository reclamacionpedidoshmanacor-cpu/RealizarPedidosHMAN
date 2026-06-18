import * as XLSX from 'xlsx';
import { cnFromSapMaterial, isMSE } from './utils';

export interface CatalogoRow {
  cn: string;
  sapCode: string;
  principioActivo: string;
  nombre: string;
  via: 'IV' | 'ORAL' | 'OTRO';
  ubicacion: string;
  unidadesPorCaja: number;
  activo: boolean;
  mse: boolean;
  stockMinimo: number;
  puntoPedido: number;
  stockMaximo: number | null;
}

export interface CatalogoParseResult {
  rows: CatalogoRow[];
  errors: string[];
  via: 'IV' | 'ORAL' | 'OTRO';
}

const UBIC_MAP: Record<string, string> = {
  'ARMARIO': 'Armario NEA',
  'NEVERA':  'Nevera NEA',
};

function mapUbicacion(raw: string): string {
  const upper = raw.trim().toUpperCase();
  return UBIC_MAP[upper] ?? raw.trim();
}

function normalize(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function parseBool(val: unknown): boolean {
  const s = String(val ?? '').toUpperCase().trim();
  return s === 'SI' || s === 'S' || s === 'TRUE' || s === '1';
}

export function parseCatalogoExcel(buffer: Buffer): CatalogoParseResult {
  const errors: string[] = [];
  const rows: CatalogoRow[] = [];

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    return { rows, errors: ['No se pudo leer el archivo Excel.'], via: 'OTRO' };
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];

  if (raw.length < 2) {
    return { rows, errors: ['El archivo no contiene datos.'], via: 'OTRO' };
  }

  const headers = (raw[0] as string[]).map(h => String(h));
  const headerNorm = headers.map(normalize);

  // Detectar vía por la primera columna (Title = IV, CODIGO SAP = ORAL)
  const firstColNorm = headerNorm[0];
  const via: 'IV' | 'ORAL' =
    firstColNorm === 'title' ? 'IV' :
    firstColNorm === 'codigo sap' ? 'ORAL' : 'IV';

  // Índices de columnas
  const idx = {
    sap:       headerNorm.findIndex(h => h === 'title' || h === 'codigo sap'),
    ppio:      headerNorm.findIndex(h => h === 'ppio activo'),
    marca:     headerNorm.findIndex(h => h === 'marca'),
    activo:    headerNorm.findIndex(h => h === 'activo'),
    ubic:      headerNorm.findIndex(h => h === 'ubic' || h === 'ubicacion'),
    multiplo:  headerNorm.findIndex(h => h === 'multiplopedido' || h === 'multiplo pedido'),
    minimo:    headerNorm.findIndex(h => h === 'stock minimo' || h === 'stock mínimo'),
    pedido:    headerNorm.findIndex(h => h === 'puntopedido' || h === 'punto pedido' || h === 'puntopedido'),
    maximo:    headerNorm.findIndex(h => h === 'stock maximo' || h === 'stock máximo'),
  };

  const missing = (Object.entries(idx) as [string, number][])
    .filter(([, i]) => i === -1)
    .map(([k]) => k);
  if (missing.length) {
    return { rows, errors: [`Columnas no encontradas: ${missing.join(', ')}`], via };
  }

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    const sapRaw = String(row[idx.sap] ?? '').trim();
    if (!sapRaw) continue;

    const cn = cnFromSapMaterial(sapRaw);
    const multiplo = parseInt(String(row[idx.multiplo] ?? '1'), 10);
    const minimo   = parseInt(String(row[idx.minimo] ?? '0'), 10);
    const pedido   = parseInt(String(row[idx.pedido] ?? '0'), 10);
    const maximoRaw = String(row[idx.maximo] ?? '').trim();
    const maximo   = maximoRaw !== '' ? parseInt(maximoRaw, 10) : null;

    if (isNaN(multiplo) || multiplo <= 0) {
      errors.push(`Fila ${i + 1}: MultiploPedido inválido ("${row[idx.multiplo]}")`);
      continue;
    }

    rows.push({
      cn,
      sapCode: sapRaw,
      principioActivo: String(row[idx.ppio] ?? '').trim(),
      nombre:          String(row[idx.marca] ?? '').trim(),
      via,
      ubicacion:       mapUbicacion(String(row[idx.ubic] ?? '')),
      unidadesPorCaja: multiplo,
      activo:          parseBool(row[idx.activo]),
      mse:             isMSE(cn),
      stockMinimo:     isNaN(minimo) ? 0 : minimo,
      puntoPedido:     isNaN(pedido) ? 0 : pedido,
      stockMaximo:     maximo !== null && isNaN(maximo) ? null : maximo,
    });
  }

  return { rows, errors, via };
}
