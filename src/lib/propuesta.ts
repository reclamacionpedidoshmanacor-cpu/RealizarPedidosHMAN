export const MOTIVOS_AJUSTE = [
  'Prevision aumento de consumo',
  'Rotura proveedor',
  'Caducidad < 6 meses',
  'Exceso de stock',
  'Sustitucion',
  'Otro',
] as const;

export type MotivoAjuste = (typeof MOTIVOS_AJUSTE)[number];

export function calcularCajasPropuestas(
  stockActual: number,
  puntoPedido: number,
  stockMaximo: number,
  stockTransito = 0,
  multiploPedido = 1
): number {
  const stockDisponible = stockActual + stockTransito;
  if (stockDisponible > puntoPedido) return 0;
  const faltante = Math.max(Math.ceil(stockMaximo - stockDisponible), 0);
  const multiplo = Number.isFinite(multiploPedido) && multiploPedido > 1
    ? Math.trunc(multiploPedido)
    : 1;
  if (multiplo <= 1 || faltante === 0) return faltante;
  return Math.ceil(faltante / multiplo) * multiplo;
}

export function toSapCode(cn: string): string {
  return `14${cn}`;
}
