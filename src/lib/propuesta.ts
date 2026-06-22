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
  unidadesPorCaja = 1,
): number {
  const stockDisponible = stockActual + stockTransito;
  if (stockDisponible > puntoPedido) return 0;

  const faltanteCajas = Math.max(stockMaximo - stockDisponible, 0);
  if (faltanteCajas <= 0) return 0;

  const upc = Number.isFinite(unidadesPorCaja) && unidadesPorCaja > 0
    ? Math.trunc(unidadesPorCaja)
    : 1;

  // Múltiplo de pedido = unidades/caja → pedir siempre cajas completas
  const faltanteUnidades = Math.ceil(faltanteCajas * upc);
  const unidadesPedido = Math.ceil(faltanteUnidades / upc) * upc;
  return unidadesPedido / upc;
}

export function cajasAUnidades(cajas: number, unidadesPorCaja: number): number {
  const upc = Number.isFinite(unidadesPorCaja) && unidadesPorCaja > 0
    ? Math.trunc(unidadesPorCaja)
    : 1;
  return Math.round(cajas * upc);
}

export function toSapCode(cn: string): string {
  return `14${cn}`;
}
