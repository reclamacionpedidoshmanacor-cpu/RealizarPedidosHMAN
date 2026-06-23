/**
 * CIMA suele devolver presentaciones como:
 * "NOMBRE COMERCIAL EFG , 50 bolsas de 100 ml"
 * Solo nos interesa la parte del envase tras la coma.
 */
export function extraerDescripcionEnvase(
  presentacionCompleta: string,
  nombreMedicamento?: string | null
): string {
  const text = presentacionCompleta.trim();
  if (!text) return '';

  const commaIdx = text.search(/\s*,\s*(?=\d)/);
  if (commaIdx >= 0) {
    return text.slice(commaIdx).replace(/^\s*,\s*/, '').trim();
  }

  const nombre = nombreMedicamento?.trim();
  if (nombre && text.length > nombre.length) {
    const prefix = text.slice(0, nombre.length);
    if (prefix.localeCompare(nombre, 'es', { sensitivity: 'base' }) === 0) {
      const rest = text.slice(nombre.length).replace(/^\s*,\s*/, '').trim();
      if (rest) return rest;
    }
  }

  return text;
}

const UNIDAD_ENVASE = '(?:bolsas?|cápsulas?|capsulas?|comprimidos?|viales?|ampollas?|jeringas?|frascos?|sobres?|uds?\\.?|unidades?)';

/**
 * Inferir uds/caja = número de unidades del envase (bolsas, cápsulas, frascos…).
 * Ej.: "50 bolsas de 100 ml" → 50 · "28 cápsulas" → 28
 */
export function inferirUnidadesPorCaja(presentacion: string): number | null {
  const text = presentacion.trim();
  if (!text) return null;

  const patterns = [
    new RegExp(`^\\s*(\\d+)\\s*${UNIDAD_ENVASE}`, 'i'),
    new RegExp(`,\\s*(\\d+)\\s*${UNIDAD_ENVASE}`, 'i'),
    new RegExp(`(\\d+)\\s*${UNIDAD_ENVASE}`, 'i'),
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) return Math.trunc(n);
    }
  }
  return null;
}

export function procesarPresentacionCima(
  presentacionCompleta: string,
  nombreMedicamento?: string | null
): { presentacion: string; unidadesPorCaja: number | null } {
  const presentacion = extraerDescripcionEnvase(presentacionCompleta, nombreMedicamento);
  const unidadesPorCaja = inferirUnidadesPorCaja(presentacion || presentacionCompleta);
  return { presentacion, unidadesPorCaja };
}
