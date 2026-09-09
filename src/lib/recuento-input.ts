export function limpiarEntradaCantidad(value: string): string {
  return /^\d*$/.test(value) ? value : '';
}

export function cantidadDesdeEntrada(
  value: string,
  min = 0,
): number | null {
  if (!/^\d+$/.test(value)) return null;
  const limpia = limpiarEntradaCantidad(value);
  if (!limpia) return null;
  const numero = Number(limpia);
  if (!Number.isSafeInteger(numero)) return null;
  return Math.max(min, numero);
}
