import { isReposicionArea, type ReposicionArea } from '@/lib/reposicion-catalogo-neon';

/** Consultas destino a las que se entrega cada pedido de reposición. */
export const CONSULTAS_REPOSICION: Record<ReposicionArea, readonly string[]> = {
  upe: ['C138', 'C139', 'C140'],
  oncologia: ['C305'],
};

export function consultasDeArea(area: string | null | undefined): readonly string[] {
  return isReposicionArea(area) ? CONSULTAS_REPOSICION[area] : [];
}

/** Consulta implícita cuando el área solo tiene un destino posible (Oncología). */
export function consultaUnicaDeArea(area: string | null | undefined): string | null {
  const consultas = consultasDeArea(area);
  return consultas.length === 1 ? consultas[0] : null;
}

export function normalizarConsulta(valor: unknown): string {
  return String(valor ?? '').trim().toUpperCase();
}

export function esConsultaValida(
  area: string | null | undefined,
  consulta: unknown,
): boolean {
  return consultasDeArea(area).includes(normalizarConsulta(consulta));
}
