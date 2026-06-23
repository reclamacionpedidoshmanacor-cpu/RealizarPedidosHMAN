/**
 * Intenta inferir unidades por caja desde el texto de presentación CIMA.
 * Ej.: "TRINOMIA … , 28 cápsulas" → 28
 */
export function inferirUnidadesPorCaja(presentacion: string): number | null {
  const text = presentacion.trim();
  if (!text) return null;

  const patterns = [
    /,\s*(\d+)\s*(?:cápsulas?|capsulas?)/i,
    /,\s*(\d+)\s*(?:comprimidos?)/i,
    /,\s*(\d+)\s*(?:viales?|ampollas?|jeringas?)/i,
    /,\s*(\d+)\s*(?:frascos?)/i,
    /,\s*(\d+)\s*(?:uds?\.?|unidades?)/i,
    /(\d+)\s*(?:cápsulas?|capsulas?|comprimidos?|viales?|ampollas?)/i,
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
