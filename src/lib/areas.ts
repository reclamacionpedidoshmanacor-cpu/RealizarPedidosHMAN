export const AREA_IDS = ['oncologia', 'upe', 'iv', 'nutricion', 'almacen'] as const;

export type AreaId = (typeof AREA_IDS)[number];

export function isValidArea(value: string | null | undefined): value is AreaId {
  if (!value) return false;
  return AREA_IDS.includes(value as AreaId);
}
