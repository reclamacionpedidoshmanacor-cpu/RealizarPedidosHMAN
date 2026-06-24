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
  /** Valor para columna BD ppio_activo_cima (import almacén). */
  ppioActivoCima?: string | null;
  cimaConsultado?: boolean;
  /** Si el Excel trae columnas CIMA importadas (no consultar API). */
  incluyeCimaImportado?: boolean;
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

/** Activo en catálogo: vacío = activo; solo NO/FALSE/0 marcan inactivo. */
function parseActivoCatalogo(val: unknown): boolean {
  const s = String(val ?? '').trim().toUpperCase();
  if (!s) return true;
  if (s === 'NO' || s === 'N' || s === 'FALSE' || s === '0') return false;
  return parseBool(val);
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

/** Número Excel con coma decimal o miles (p. ej. 2,5 · 1.500). */
function parseDecimalExcel(val: unknown): number | null {
  if (val == null || val === '') return null;
  if (typeof val === 'number' && Number.isFinite(val)) return val;

  let raw = String(val).trim().replace(/\s/g, '');
  if (!raw) return null;

  if (raw.includes('.') && raw.includes(',')) {
    raw = raw.replace(/\./g, '').replace(',', '.');
  } else if (raw.includes(',') && !raw.includes('.')) {
    raw = raw.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    raw = raw.replace(/\./g, '');
  }

  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(val: unknown): number | null {
  const n = parseDecimalExcel(val);
  if (n == null) return null;
  return Math.max(0, Math.round(n));
}

function toCajasOrNull(val: unknown): number | null {
  const n = parseDecimalExcel(val);
  if (n == null) return null;
  return roundCajas(Math.max(0, n));
}

function cajasDesdeUdes(udes: number, unidadesPorCaja: number): number {
  if (unidadesPorCaja <= 0) return 0;
  return roundCajas(udes / unidadesPorCaja);
}

type NutricionStockKind = 'min' | 'max';
type NutricionStockUnit = 'cajas' | 'udes';

function headerIsNutricionStockKind(header: string, kind: NutricionStockKind): boolean {
  if (kind === 'min') {
    return /\bminimo\b/.test(header) || /\bmin\b/.test(header);
  }
  return /\bmaximo\b/.test(header) || /\bmax\b/.test(header);
}

function headerIsNutricionStockUnit(header: string, unit: NutricionStockUnit): boolean {
  if (unit === 'cajas') {
    return /\bcajas?\b/.test(header);
  }
  return /\budes?\b/.test(header) || /\bunidades?\b/.test(header) || /\buds?\b/.test(header);
}

/** Columnas cortas del Excel de Nutrición: «min» / «max» en cajas (sin sufijo en cabecera). */
function findNutricionStockColSimple(
  headerNorm: string[],
  kind: NutricionStockKind,
  used: Set<number>
): number {
  const candidates =
    kind === 'min'
      ? ['min', 'minimo', 'stock minimo', 'stock min']
      : ['max', 'maximo', 'stock maximo', 'stock max'];

  for (const candidate of candidates) {
    const i = headerNorm.findIndex((h, colIdx) => {
      if (used.has(colIdx)) return false;
      const hClean = h.replace(/[.:]+$/g, '').trim();
      if (hClean !== candidate) return false;
      // No usar columnas claramente en udes si existen ambas nomenclaturas
      if (headerIsNutricionStockUnit(h, 'udes') && !headerIsNutricionStockUnit(h, 'cajas')) {
        return false;
      }
      return true;
    });
    if (i !== -1) {
      used.add(i);
      return i;
    }
  }
  return -1;
}

function mapNutricionStockColumns(headerNorm: string[]): {
  minCajas: number;
  maxCajas: number;
  minUdes: number;
  maxUdes: number;
} {
  const used = new Set<number>();
  let minCajas = findNutricionStockCol(headerNorm, 'min', 'cajas', used);
  let maxCajas = findNutricionStockCol(headerNorm, 'max', 'cajas', used);
  const minUdes = findNutricionStockCol(headerNorm, 'min', 'udes', used);
  const maxUdes = findNutricionStockCol(headerNorm, 'max', 'udes', used);

  if (minCajas === -1) minCajas = findNutricionStockColSimple(headerNorm, 'min', used);
  if (maxCajas === -1) maxCajas = findNutricionStockColSimple(headerNorm, 'max', used);

  return { minCajas, maxCajas, minUdes, maxUdes };
}

/** Evita asignar la misma columna a cajas y udes; exige unidad explícita en la cabecera. */
function findNutricionStockCol(
  headerNorm: string[],
  kind: NutricionStockKind,
  unit: NutricionStockUnit,
  used: Set<number>
): number {
  let bestIdx = -1;
  let bestScore = 0;

  for (let i = 0; i < headerNorm.length; i++) {
    if (used.has(i)) continue;
    const h = headerNorm[i];
    if (!headerIsNutricionStockKind(h, kind)) continue;
    if (!headerIsNutricionStockUnit(h, unit)) continue;

    let score = 1;
    if (h.includes('stock')) score += 2;
    if (unit === 'cajas' && h.includes('cajas')) score += 2;
    if (unit === 'udes' && (h.includes('udes') || h.includes('unidades') || h.includes('uds'))) score += 2;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx !== -1) used.add(bestIdx);
  return bestIdx;
}

/** Prioriza cajas; si la celda de cajas está vacía, convierte desde udes. */
function resolveStockCajasNutricion(
  row: unknown[],
  idxCajas: number,
  idxUdes: number,
  unidadesPorCaja: number
): number | null {
  const cajas = idxCajas !== -1 ? toCajasOrNull(row[idxCajas]) : null;
  const udes = idxUdes !== -1 ? toIntOrNull(row[idxUdes]) : null;

  if (cajas != null && (cajas > 0 || udes == null)) return cajas;
  if (udes != null) return cajasDesdeUdes(udes, unidadesPorCaja);
  return cajas;
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

/** Formato Nutrición: Código SAP, Producto, uds/caja, min/max/punto pedido en cajas, activo, ubicación y vía. */
export function parseCatalogoExcelNutricion(buffer: Buffer): CatalogoParseResult {
  const errors: string[] = [];
  const rows: CatalogoRow[] = [];

  const { raw, errors: readErrors } = readWorkbookRows(buffer);
  if (readErrors.length) return { rows, errors: readErrors, via: 'OTRO' };

  const headers = (raw[0] as string[]).map((h) => String(h));
  const headerNorm = headers.map(normalize);

  const stockCols = mapNutricionStockColumns(headerNorm);
  const idx = {
    sap: findCol(headerNorm, ['codigo sap', 'codigo material', 'material', 'title', 'sap']),
    producto: findCol(headerNorm, ['producto', 'medicamento', 'marca', 'nombre', 'descripcion']),
    udesCaja: findCol(headerNorm, [
      'udes(caja)', 'udes (caja)', 'udes/caja', 'uds/caja', 'ud/caja',
      'unidades/caja', 'unidades por caja', 'unidades x caja',
    ]),
    minCajas: stockCols.minCajas,
    maxCajas: stockCols.maxCajas,
    minUdes: stockCols.minUdes,
    maxUdes: stockCols.maxUdes,
    activo: findCol(headerNorm, ['activo', 'active']),
    puntoPedido: findCol(headerNorm, [
      'punto pedido', 'puntopedido', 'pto pedido', 'punto de pedido', 'pto. pedido',
    ]),
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
        'Esperado: Código SAP, Producto, Uds/caja, min, max (cajas), punto pedido (opc.), activo/active (opc.), Ubicación y Vía (opc.).',
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
        'No se encontraron columnas min / max (stock objetivo en cajas).',
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

    const stockMinimo =
      resolveStockCajasNutricion(row, idx.minCajas, idx.minUdes, unidadesPorCaja) ?? 0;
    const stockMaximo = resolveStockCajasNutricion(row, idx.maxCajas, idx.maxUdes, unidadesPorCaja);

    if (stockMaximo != null && stockMaximo < stockMinimo) {
      errors.push(
        `Fila ${i + 1} (${producto}): stock máximo (${stockMaximo}) menor que mínimo (${stockMinimo}). Revisa columnas cajas/udes.`
      );
    }

    const ubicRaw = idx.ubic !== -1 ? String(row[idx.ubic] ?? '').trim() : '';
    const viaRaw = idx.via !== -1 ? String(row[idx.via] ?? '').trim() : '';
    const activo = idx.activo !== -1 ? parseActivoCatalogo(row[idx.activo]) : true;
    const puntoPedidoExcel =
      idx.puntoPedido !== -1 ? toCajasOrNull(row[idx.puntoPedido]) : null;
    const puntoPedido = puntoPedidoExcel ?? stockMinimo;
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
      puntoPedido,
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
    activo: findCol(headerNorm, ['active', 'activo']),
    cimaConsultado: findCol(headerNorm, ['cima_consultado', 'cima consultado']),
    ppioActivoCima: findCol(headerNorm, [
      'ppio_activo_cima',
      'ppio activo cima',
      'ppio_active_cima',
      'ppio active cima',
    ]),
  };

  const requiredMissing: string[] = [];
  if (idx.sap === -1 && idx.cnCima === -1) {
    requiredMissing.push('Código SAP o CN_CIMA');
  }
  if (idx.ubic === -1) requiredMissing.push('ubicacion');
  if (requiredMissing.length) {
    return {
      rows,
      errors: [
        `Columnas obligatorias no encontradas: ${requiredMissing.join(', ')}.`,
        'Esperado: Código SAP, Pr. Activo, Denominación, ubicacion, CN_CIMA, Principio Activo_CIMA, Marca Comercial_CIMA, Presentacion, udes/caja, Active, cima_consultado, ppio_activo_cima (opc.).',
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

    let unidadesPorCaja = 0;
    if (idx.udesCaja !== -1) {
      const udesRaw = String(row[idx.udesCaja] ?? '').trim();
      if (udesRaw) {
        const parsed = toIntOrNull(row[idx.udesCaja]);
        if (parsed == null || parsed <= 0) {
          errors.push(`Fila ${i + 1}: udes/caja inválidas ("${udesRaw}") para CN ${cn}.`);
          continue;
        }
        unidadesPorCaja = parsed;
      }
    }

    const principioActivo = firstNonEmpty(
      idx.ppioActivoCima !== -1 ? String(row[idx.ppioActivoCima] ?? '').trim() : '',
      ppioCima,
      prActivo,
      denominacion,
    );
    const nombre = firstNonEmpty(marcaCima, denominacion, prActivo, principioActivo, cn);
    if (!principioActivo) {
      errors.push(`Fila ${i + 1}: falta principio activo (CN ${cn}).`);
      continue;
    }

    const activo = idx.activo !== -1 ? parseActivoCatalogo(row[idx.activo]) : true;

    const incluyeCimaImportado =
      idx.ppioActivoCima !== -1 || idx.cimaConsultado !== -1;
    let ppioActivoCima: string | null | undefined;
    let cimaConsultado: boolean | undefined;
    if (incluyeCimaImportado) {
      ppioActivoCima =
        idx.ppioActivoCima !== -1
          ? String(row[idx.ppioActivoCima] ?? '').trim() || null
          : null;
      if (idx.cimaConsultado !== -1) {
        cimaConsultado = parseBool(row[idx.cimaConsultado]);
      } else if (ppioActivoCima) {
        cimaConsultado = true;
      } else {
        cimaConsultado = false;
      }
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
      activo,
      mse: isMSE(cn),
      stockMinimo: 0,
      puntoPedido: 0,
      stockMaximo: null,
      ppioActivoCima,
      cimaConsultado,
      incluyeCimaImportado,
    });
  }

  return { rows, errors, via: 'OTRO' };
}

export function parseCatalogoByArea(buffer: Buffer, area: AreaId): CatalogoParseResult {
  if (area === 'nutricion') return parseCatalogoExcelNutricion(buffer);
  if (area === 'almacen') return parseCatalogoExcelAlmacen(buffer);
  return parseCatalogoExcel(buffer);
}
