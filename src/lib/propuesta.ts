import { cnClavePedidos } from '@/lib/pedidos-pendientes';
import {
  calcularPedidoCajas,
  normalizeStockCajas,
  stockUnidadesDesdeCajas,
} from '@/lib/cantidades';

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
  _unidadesPorCaja = 1,
): number {
  return calcularPedidoCajas({
    stockActual,
    stockTransito,
    puntoPedido,
    stockMaximo,
  });
}

export function cajasAUnidades(cajas: number, unidadesPorCaja: number): number {
  return Math.round(stockUnidadesDesdeCajas(cajas, unidadesPorCaja));
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
    byCn[row.cn] = cajasTransito > 0 ? normalizeStockCajas(cajasTransito) : 0;
  }
  return byCn;
}

export function toSapCode(cn: string): string {
  return `14${cn}`;
}
