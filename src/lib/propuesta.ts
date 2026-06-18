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
  stockMaximo: number
): number {
  if (stockActual > puntoPedido) return 0;
  return Math.max(Math.ceil(stockMaximo - stockActual), 0);
}

export function toSapCode(cn: string): string {
  return `14${cn}`;
}
