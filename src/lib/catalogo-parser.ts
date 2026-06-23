import * as XLSX from 'xlsx';
import { cnFromSapMaterial, isMSE, normalizarCnParaCima, roundCajas } from './utils';
import type { AreaId } from './areas';

export interface CatalogoRow {
  cn: string;
  sapCode: string;
  principioActivo: string;
  nombre: string;
  presentacion?: string | null;
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

const NUTRICION_UBIC_DEFAULT = 'Nutrición';

function mapUbicacion(raw: string): string {
  const upper = raw.trim().toUpperCase();
  return UBIC_MAP[upper] ?? raw.trim();
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function parseBool(val: unknown): boolean {
  const s = String(val ?? '').toUpperCase().trim();
  return s === 'SI' || s === 'S' || s === 'TRUE' || s === '1';
}

function findCol(headerNorm: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const norm = normalize(candidate);
    const exact = headerNorm.findIndex((h) => h === norm);
    if (exact !== -1) return exact;
  }
  for (const candidate of candidates) {
    const norm = normalize(candidate);
    const partial = headerNorm.findIndex((h) => h.includes(norm) || norm.includes(h));
    if (partial !== -1) return partial;
  }
  return -1;
}

function toIntOrNull(val: unknown): number | null {
  const raw = String(val ?? '').trim();
  if (!raw) return null;
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n));
}

function toCajasOrNull(val: unknown): number | null {
  const raw = String(val ?? '').trim();
  if (!raw) return null;
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return roundCajas(Math.max(0, n));
}

function cajasDesdeUdes(udes: number, unidadesPorCaja: number): number {
  if (unidadesPorCaja <= 0) return 0;
  return roundCajas(udes / unidadesPorCaja);
}

function readWorkbookRows(buffer: Buffer): { raw: unknown[][]; errors: string[] } {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
    if (raw.length < 2) {
      return { raw: [], errors: ['El archivo no contiene datos.'] };
    }
    return { raw, errors: [] };
  } catch {
    return { raw: [], errors: ['No se pudo leer el archivo Excel.'] };
  }
}

export function parseCatalogoExcel(buffer: Buffer): CatalogoParseResult {
  const errors: string[] = [];
  const rows: CatalogoRow[] = [];

  const { raw, errors: readErrors } = readWorkbookRows(buffer);
  if (readErrors.length) return { rows, errors: readErrors, via: 'OTRO' };

  const headers = (raw[0] as string[]).map((h) => String(h));
  const headerNorm = headers.map(normalize);

  const firstColNorm = headerNorm[0];
  const via: 'IV' | 'ORAL' =
    firstColNorm === 'title' ? 'IV' :
    firstColNorm === 'codigo sap' ? 'ORAL' : 'IV';

  const idx = {
    sap:       headerNorm.findIndex(h => h === 'title' || h === 'codigo sap'),
    ppio:      headerNorm.findIndex(h => h === 'ppio activo'),
    marca:     headerNorm.findIndex(h => h === 'marca'),
    activo:    headerNorm.findIndex(h => h === 'activo'),
    ubic:      headerNorm.findIndex(h => h === 'ubic' || h === 'ubicacion'),
    multiplo:  headerNorm.findIndex(h => h === 'multiplopedido' || h === 'multiplo pedido'),
    minimo:    headerNorm.findIndex(h => h === 'stock minimo'),
    pedido:    headerNorm.findIndex(h => h === 'puntopedido' || h === 'punto pedido'),
    maximo:    headerNorm.findIndex(h => h === 'stock maximo'),
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

function parseViaCatalogo(raw: string): 'IV' | 'ORAL' | 'OTRO' {
  const v = normalize(raw);
  if (!v) return 'OTRO';
  if (v === 'iv' || v.includes('parenteral') || v === 'npt' || v === 'np') return 'IV';
  if (v === 'oral' || v.includes('enteral') || v === 'ne' || v === 'vo') return 'ORAL';
  if (v === 'otro' || v === 'otros') return 'OTRO';
  const upper = raw.trim().toUpperCase();
  if (upper === 'IV' || upper === 'ORAL' || upper === 'OTRO') return upper;
  return 'OTRO';
}

/** Formato Nutrición: Código SAP, Producto, uds/caja y stocks en cajas y/o udes. */
export function parseCatalogoExcelNutricion(buffer: Buffer): CatalogoParseResult {
  const errors: string[] = [];
  const rows: CatalogoRow[] = [];

  const { raw, errors: readErrors } = readWorkbookRows(buffer);
  if (readErrors.length) return { rows, errors: readErrors, via: 'OTRO' };

  const headers = (raw[0] as string[]).map((h) => String(h));
  const headerNorm = headers.map(normalize);

  const idx = {
    sap: findCol(headerNorm, ['codigo sap', 'codigo material', 'material', 'title', 'sap']),
    producto: findCol(headerNorm, ['producto', 'medicamento', 'marca', 'nombre', 'descripcion']),
    udesCaja: findCol(headerNorm, [
      'udes/caja', 'uds/caja', 'ud/caja', 'unidades/caja', 'unidades por caja', 'unidades x caja',
    ]),
    minCajas: findCol(headerNorm, [
      'stock minimo cajas', 'stock min cajas', 'minimo cajas', 'min cajas',
      'stock minimo (cajas)', 'stock minimo en cajas', 'stock minimo nº cajas', 'stock minimo no cajas',
    ]),
    maxCajas: findCol(headerNorm, [
      'stock maximo cajas', 'stock max cajas', 'maximo cajas', 'max cajas',
      'stock maximo (cajas)', 'stock maximo en cajas', 'stock maximo nº cajas', 'stock maximo no cajas',
    ]),
    minUdes: findCol(headerNorm, [
      'stock minimo udes', 'stock minimo unidades', 'stock min udes', 'minimo udes', 'min udes',
      'stock minimo (udes)', 'stock minimo (unidades)', 'stock minimo en udes', 'stock minimo en unidades',
    ]),
    maxUdes: findCol(headerNorm, [
      'stock maximo udes', 'stock maximo unidades', 'stock max udes', 'maximo udes', 'max udes',
      'stock maximo (udes)', 'stock maximo (unidades)', 'stock maximo en udes', 'stock maximo en unidades',
    ]),
    activo: findCol(headerNorm, ['activo']),
    ubic: findCol(headerNorm, ['ubic', 'ubicacion']),
    via: findCol(headerNorm, ['via', 'administracion', 'ruta', 'ruta de administracion']),
  };

  const requiredMissing: string[] = [];
  if (idx.sap === -1) requiredMissing.push('Código SAP');
  if (idx.producto === -1) requiredMissing.push('Producto');
  if (idx.udesCaja === -1) requiredMissing.push('Uds/caja');
  if (requiredMissing.length) {
    return {
      rows,
      errors: [
        `Columnas obligatorias no encontradas: ${requiredMissing.join(', ')}.`,
        'Esperado: Código SAP, Producto, Vía (opc.), Uds/caja y stock mín/máx en cajas y/o udes.',
      ],
      via: 'OTRO',
    };
  }

  const hasStockCols =
    idx.minCajas !== -1 || idx.maxCajas !== -1 || idx.minUdes !== -1 || idx.maxUdes !== -1;
  if (!hasStockCols) {
    return {
      rows,
      errors: [
        'No se encontraron columnas de stock objetivo (mín/máx en cajas o en udes).',
      ],
      via: 'OTRO',
    };
  }

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    const sapRaw = String(row[idx.sap] ?? '').trim();
    if (!sapRaw) continue;

    const producto = String(row[idx.producto] ?? '').trim();
    if (!producto) {
      errors.push(`Fila ${i + 1}: Producto vacío (SAP ${sapRaw}).`);
      continue;
    }

    const unidadesPorCaja = toIntOrNull(row[idx.udesCaja]);
    if (unidadesPorCaja == null || unidadesPorCaja <= 0) {
      errors.push(`Fila ${i + 1}: Uds/caja inválidas ("${row[idx.udesCaja]}").`);
      continue;
    }

    const minCajas = idx.minCajas !== -1 ? toCajasOrNull(row[idx.minCajas]) : null;
    const maxCajas = idx.maxCajas !== -1 ? toCajasOrNull(row[idx.maxCajas]) : null;
    const minUdes = idx.minUdes !== -1 ? toIntOrNull(row[idx.minUdes]) : null;
    const maxUdes = idx.maxUdes !== -1 ? toIntOrNull(row[idx.maxUdes]) : null;

    const stockMinimo =
      minCajas ??
      (minUdes != null ? cajasDesdeUdes(minUdes, unidadesPorCaja) : 0);
    const stockMaximo =
      maxCajas ??
      (maxUdes != null ? cajasDesdeUdes(maxUdes, unidadesPorCaja) : null);

    const ubicRaw = idx.ubic !== -1 ? String(row[idx.ubic] ?? '').trim() : '';
    const viaRaw = idx.via !== -1 ? String(row[idx.via] ?? '').trim() : '';
    const activo = idx.activo !== -1 ? parseBool(row[idx.activo]) : true;
    const cn = cnFromSapMaterial(sapRaw);

    rows.push({
      cn,
      sapCode: sapRaw,
      principioActivo: producto,
      nombre: producto,
      via: parseViaCatalogo(viaRaw),
      ubicacion: ubicRaw ? mapUbicacion(ubicRaw) : NUTRICION_UBIC_DEFAULT,
      unidadesPorCaja,
      activo,
      mse: isMSE(cn),
      stockMinimo,
      puntoPedido: stockMinimo,
      stockMaximo,
    });
  }

  return { rows, errors, via: 'OTRO' };
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function resolveCnAlmacen(cnCimaRaw: string, sapRaw: string): string {
  if (cnCimaRaw) return normalizarCnParaCima(cnCimaRaw);
  if (sapRaw) return cnFromSapMaterial(sapRaw);
  return '';
}

/** Formato Almacén: Excel revisado con CIMA (sin consulta API en importación). */
export function parseCatalogoExcelAlmacen(buffer: Buffer): CatalogoParseResult {
  const errors: string[] = [];
  const rows: CatalogoRow[] = [];

  const { raw, errors: readErrors } = readWorkbookRows(buffer);
  if (readErrors.length) return { rows, errors: readErrors, via: 'OTRO' };

  const headers = (raw[0] as string[]).map((h) => String(h));
  const headerNorm = headers.map(normalize);

  const idx = {
    sap: findCol(headerNorm, ['codigo sap', 'codigo material', 'material', 'sap']),
    prActivo: findCol(headerNorm, ['pr. activo', 'pr activo', 'ppio activo', 'principio activo']),
    denominacion: findCol(headerNorm, ['denominacion', 'denominación', 'descripcion', 'descripción']),
    ubic: findCol(headerNorm, ['ubicacion', 'ubic']),
    cnCima: findCol(headerNorm, ['cn_cima', 'cn cima']),
    ppioCima: findCol(headerNorm, ['principio activo_cima', 'principio activo cima']),
    marcaCima: findCol(headerNorm, ['marca comercial_cima', 'marca comercial cima']),
    presentacion: findCol(headerNorm, ['presentacion', 'presentación']),
    udesCaja: findCol(headerNorm, [
      'udes/caja', 'uds/caja', 'ud/caja', 'unidades/caja', 'unidades por caja', 'unidades x caja',
    ]),
  };

  const requiredMissing: string[] = [];
  if (idx.sap === -1 && idx.cnCima === -1) {
    requiredMissing.push('Código SAP o CN_CIMA');
  }
  if (idx.ubic === -1) requiredMissing.push('ubicacion');
  if (idx.udesCaja === -1) requiredMissing.push('udes/caja');
  if (requiredMissing.length) {
    return {
      rows,
      errors: [
        `Columnas obligatorias no encontradas: ${requiredMissing.join(', ')}.`,
        'Esperado: Código SAP, Pr. Activo, Denominación, ubicacion, CN_CIMA, Principio Activo_CIMA, Marca Comercial_CIMA, Presentacion, udes/caja.',
      ],
      via: 'OTRO',
    };
  }

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    const sapRaw = idx.sap !== -1 ? String(row[idx.sap] ?? '').trim() : '';
    const cnCimaRaw = idx.cnCima !== -1 ? String(row[idx.cnCima] ?? '').trim() : '';
    if (!sapRaw && !cnCimaRaw) continue;

    const cn = resolveCnAlmacen(cnCimaRaw, sapRaw);
    if (!cn) {
      errors.push(`Fila ${i + 1}: no se pudo obtener CN (SAP "${sapRaw}", CN_CIMA "${cnCimaRaw}").`);
      continue;
    }

    const prActivo = idx.prActivo !== -1 ? String(row[idx.prActivo] ?? '').trim() : '';
    const denominacion = idx.denominacion !== -1 ? String(row[idx.denominacion] ?? '').trim() : '';
    const ppioCima = idx.ppioCima !== -1 ? String(row[idx.ppioCima] ?? '').trim() : '';
    const marcaCima = idx.marcaCima !== -1 ? String(row[idx.marcaCima] ?? '').trim() : '';
    const presentacion = idx.presentacion !== -1 ? String(row[idx.presentacion] ?? '').trim() : '';
    const ubicacion = String(row[idx.ubic] ?? '').trim();

    if (!ubicacion) {
      errors.push(`Fila ${i + 1}: ubicación vacía (CN ${cn}).`);
      continue;
    }

    const unidadesPorCaja = toIntOrNull(row[idx.udesCaja]);
    if (unidadesPorCaja == null || unidadesPorCaja <= 0) {
      errors.push(`Fila ${i + 1}: udes/caja inválidas ("${row[idx.udesCaja]}") para CN ${cn}.`);
      continue;
    }

    const principioActivo = firstNonEmpty(ppioCima, prActivo, denominacion);
    const nombre = firstNonEmpty(marcaCima, denominacion, prActivo, principioActivo, cn);
    if (!principioActivo) {
      errors.push(`Fila ${i + 1}: falta principio activo (CN ${cn}).`);
      continue;
    }

    rows.push({
      cn,
      sapCode: sapRaw || cn,
      principioActivo,
      nombre,
      presentacion: presentacion || null,
      via: 'OTRO',
      ubicacion,
      unidadesPorCaja,
      activo: true,
      mse: isMSE(cn),
      stockMinimo: 0,
      puntoPedido: 0,
      stockMaximo: null,
    });
  }

  return { rows, errors, via: 'OTRO' };
}

export function parseCatalogoByArea(buffer: Buffer, area: AreaId): CatalogoParseResult {
  if (area === 'nutricion') return parseCatalogoExcelNutricion(buffer);
  if (area === 'almacen') return parseCatalogoExcelAlmacen(buffer);
  return parseCatalogoExcel(buffer);
}
