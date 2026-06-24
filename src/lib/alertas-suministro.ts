import { loadAlertasCimaPorCnsSafe } from '@/lib/cima-suministro-neon';
import {
  type AlertaSuministroCn,
  cnClavePedidos,
  loadAlertasPedidosPorCnsSafe,
} from '@/lib/pedidos-pendientes';

export type { AlertaSuministroCn, TipoAlertaSuministro } from '@/lib/pedidos-pendientes';
export { alertaSuministroParaCn, cnClavePedidos } from '@/lib/pedidos-pendientes';

type Candidato = AlertaSuministroCn & { ms: number };

function parseTs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function elegirMasReciente(candidatos: Candidato[]): AlertaSuministroCn | null {
  if (candidatos.length === 0) return null;
  const mejor = candidatos.reduce((a, b) => (b.ms > a.ms ? b : a));
  return {
    tipo: mejor.tipo,
    etiqueta: mejor.etiqueta,
    detalle: mejor.detalle,
    fecha: mejor.fecha,
  };
}

function mergeAlertas(
  pedidos: Record<string, AlertaSuministroCn | null>,
  cima: Record<string, AlertaSuministroCn | null>,
  cns: string[],
): Record<string, AlertaSuministroCn | null> {
  const keys = new Set<string>();
  for (const cn of cns) {
    const key = cnClavePedidos(cn);
    if (key) keys.add(key);
  }

  const out: Record<string, AlertaSuministroCn | null> = {};
  for (const key of keys) {
    const candidatos: Candidato[] = [];
    for (const alerta of [pedidos[key], cima[key]]) {
      if (!alerta) continue;
      const ms = parseTs(alerta.fecha);
      if (ms == null) continue;
      candidatos.push({ ...alerta, ms });
    }
    out[key] = elegirMasReciente(candidatos);
  }
  return out;
}

/** CIMA (catálogo local) + en falta + proveedor (Pedidos Pendientes, solo lectura). */
export async function loadAlertasSuministroPorCns(
  cns: string[],
): Promise<Record<string, AlertaSuministroCn | null>> {
  const [pedidos, cima] = await Promise.all([
    loadAlertasPedidosPorCnsSafe(cns),
    loadAlertasCimaPorCnsSafe(cns),
  ]);
  return mergeAlertas(pedidos, cima, cns);
}

export async function loadAlertasSuministroPorCnsSafe(
  cns: string[],
): Promise<Record<string, AlertaSuministroCn | null>> {
  try {
    return await loadAlertasSuministroPorCns(cns);
  } catch {
    const fallback: Record<string, AlertaSuministroCn | null> = {};
    for (const cn of cns) {
      const key = cnClavePedidos(cn);
      if (key) fallback[key] = null;
    }
    return fallback;
  }
}
