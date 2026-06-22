const MESES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export type ModoComparativa = 'yoy' | 'periodo-anterior';

export const MODO_COMPARATIVA_LABELS: Record<ModoComparativa, string> = {
  yoy: 'Mismo periodo año anterior',
  'periodo-anterior': 'Periodo anterior (mismo nº de meses)',
};

export function parseModoComparativa(v: string | null | undefined): ModoComparativa {
  return v === 'periodo-anterior' ? 'periodo-anterior' : 'yoy';
}

function isoToYM(iso: string): { y: number; m: number } {
  const [y, m] = iso.split('-').map(Number);
  return { y: y!, m: m! };
}

function firstDayOfMonth(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

function lastDayOfMonth(y: number, m: number): string {
  return new Date(y, m, 0).toISOString().slice(0, 10);
}

function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const total = y * 12 + (m - 1) + delta;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

function monthsInclusive(desde: string, hasta: string): number {
  const { y: yD, m: mD } = isoToYM(desde);
  const { y: yH, m: mH } = isoToYM(hasta);
  return (yH - yD) * 12 + (mH - mD) + 1;
}

export function resolvePeriodoBase(
  desde: string,
  hasta: string,
  modo: ModoComparativa,
): { baseDesde: string; baseHasta: string } {
  const { y: yD, m: mD } = isoToYM(desde);
  const { y: yH, m: mH } = isoToYM(hasta);

  if (modo === 'yoy') {
    return {
      baseDesde: firstDayOfMonth(yD - 1, mD),
      baseHasta: lastDayOfMonth(yH - 1, mH),
    };
  }

  const n = monthsInclusive(desde, hasta);
  const baseEnd = addMonths(yD, mD, -1);
  const baseStart = addMonths(baseEnd.y, baseEnd.m, -(n - 1));
  return {
    baseDesde: firstDayOfMonth(baseStart.y, baseStart.m),
    baseHasta: lastDayOfMonth(baseEnd.y, baseEnd.m),
  };
}

function formatPeriodoCorto(desde: string, hasta: string): string {
  const { y: yD, m: mD } = isoToYM(desde);
  const { y: yH, m: mH } = isoToYM(hasta);
  const md = MESES_SHORT[mD - 1] ?? '?';
  const mh = MESES_SHORT[mH - 1] ?? '?';
  if (yD === yH && mD === mH) return `${md} ${yD}`;
  if (yD === yH) return `${md}–${mh} ${yD}`;
  return `${md} ${yD} – ${mh} ${yH}`;
}

export function etiquetaComparativa(
  desde: string,
  hasta: string,
  baseDesde: string,
  baseHasta: string,
): string {
  const actual = formatPeriodoCorto(desde, hasta);
  const base = formatPeriodoCorto(baseDesde, baseHasta);
  return `${actual} vs ${base}`;
}
