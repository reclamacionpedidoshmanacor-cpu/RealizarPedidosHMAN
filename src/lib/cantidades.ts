/**
 * Política única de cantidades:
 * - unidades de stock: enteros exactos, fuente de verdad;
 * - cajas equivalentes, tránsito y niveles: decimales;
 * - pedidos: cajas enteras no negativas.
 *
 * Las cajas equivalentes son siempre un dato derivado de las unidades. Nunca
 * deben utilizarse para reconstruir un recuento de unidades.
 */
export const STOCK_DECIMALS = 4;

function roundDecimal(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function isStockUnidadesEnteras(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function normalizeStockUnidades(value: number): number {
  const unidades = Number(value);
  if (!isStockUnidadesEnteras(unidades)) {
    throw new Error('Las unidades totales de stock deben ser un número entero no negativo.');
  }
  return unidades;
}

export function normalizeStockCajas(value: number): number {
  return roundDecimal(Math.max(Number(value) || 0, 0), STOCK_DECIMALS);
}

export function normalizeNivelStock(value: number): number {
  return normalizeStockCajas(value);
}

export function stockCajasDesdeUnidades(
  stockUnidades: number,
  unidadesPorCaja: number,
): number {
  const upc = Number.isFinite(unidadesPorCaja) && unidadesPorCaja > 0
    ? Math.trunc(unidadesPorCaja)
    : 1;
  return normalizeStockCajas(normalizeStockUnidades(stockUnidades) / upc);
}

export function calcularStockUnidadesContadas(params: {
  cajasEnteras: number;
  unidadesSueltas: number;
  unidadesPorCaja: number;
}): number {
  const cajas = Number(params.cajasEnteras);
  const sueltas = Number(params.unidadesSueltas);
  const upc = Number(params.unidadesPorCaja);
  if (!isStockUnidadesEnteras(cajas) || !isStockUnidadesEnteras(sueltas)) {
    throw new Error('Las cajas contadas y las unidades sueltas deben ser enteros no negativos.');
  }
  if (!Number.isSafeInteger(upc) || upc <= 0) {
    throw new Error('Las unidades por caja deben ser un entero positivo.');
  }
  return normalizeStockUnidades(cajas * upc + sueltas);
}

/** Conversión exclusiva de cajas enteras de pedido; no usar para recuentos. */
export function stockUnidadesDesdeCajas(
  stockCajas: number,
  unidadesPorCaja: number,
): number {
  const cajas = Number(stockCajas);
  const upc = Number(unidadesPorCaja);
  if (!Number.isSafeInteger(cajas) || cajas < 0) {
    throw new Error('Solo se pueden convertir cajas enteras a unidades.');
  }
  if (!Number.isSafeInteger(upc) || upc <= 0) {
    throw new Error('Las unidades por caja deben ser un entero positivo.');
  }
  return normalizeStockUnidades(cajas * upc);
}

export function isPedidoCajasEnteras(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

/** Redondeo comercial del faltante: menos de 0,5 baja; 0,5 o más sube. */
export function roundPedidoCajas(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value + 1e-9);
}

/** Para valores ya validados como enteros en los límites de entrada. */
export function normalizePedidoCajas(value: number): number {
  if (!isPedidoCajasEnteras(value)) {
    throw new Error('La cantidad a pedir debe ser un numero entero de cajas.');
  }
  return value;
}

export function calcularPedidoCajas(params: {
  stockActual: number;
  stockTransito?: number;
  puntoPedido: number;
  stockMaximo: number;
}): number {
  const stockDisponible =
    normalizeStockCajas(params.stockActual) +
    normalizeStockCajas(params.stockTransito ?? 0);
  const puntoPedido = normalizeNivelStock(params.puntoPedido);
  const stockMaximo = normalizeNivelStock(params.stockMaximo);

  if (stockDisponible > puntoPedido) return 0;
  return roundPedidoCajas(Math.max(stockMaximo - stockDisponible, 0));
}
