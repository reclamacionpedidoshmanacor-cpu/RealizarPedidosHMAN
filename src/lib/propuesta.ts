import { cnClavePedidos } from '@/lib/pedidos-pendientes';

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

function roundThreeDecimals(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Convierte unidades pendientes de pedidos SAP a cajas por CN. */
export function buildStockTransitoCajasByCn(
  transitoUnidadesByCn: Record<string, number>,
  rows: Array<{ cn: string; unidadesPorCaja: number }>
): Record<string, number> {
  const byCn: Record<string, number> = {};
  for (const row of rows) {
    const cnKey = cnClavePedidos(row.cn);
    const unidadesTransito = Number(
      (cnKey ? transitoUnidadesByCn[cnKey] : undefined) ?? transitoUnidadesByCn[row.cn] ?? 0
    );
    if (!Number.isFinite(unidadesTransito) || unidadesTransito <= 0) {
      byCn[row.cn] = 0;
      continue;
    }
    const cajasTransito =
      row.unidadesPorCaja > 0 ? unidadesTransito / row.unidadesPorCaja : unidadesTransito;
    byCn[row.cn] = cajasTransito > 0 ? roundThreeDecimals(cajasTransito) : 0;
  }
  return byCn;
}

export function toSapCode(cn: string): string {
  return `14${cn}`;
}
