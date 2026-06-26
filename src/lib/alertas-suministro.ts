import {
  type AlertaSuministroCn,
  loadAlertasPedidosPorCns,
  loadAlertasPedidosPorCnsSafe,
} from '@/lib/pedidos-pendientes';

export type { AlertaSuministroCn, TipoAlertaSuministro } from '@/lib/pedidos-pendientes';
export { alertaSuministroParaCn, cnClavePedidos } from '@/lib/pedidos-pendientes';

/** CIMA + en falta + proveedor desde Pedidos Pendientes (solo lectura). */
export async function loadAlertasSuministroPorCns(
  cns: string[],
): Promise<Record<string, AlertaSuministroCn | null>> {
  return loadAlertasPedidosPorCns(cns);
}

export async function loadAlertasSuministroPorCnsSafe(
  cns: string[],
): Promise<Record<string, AlertaSuministroCn | null>> {
  return loadAlertasPedidosPorCnsSafe(cns);
}
