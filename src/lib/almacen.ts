import type { AreaId } from '@/lib/areas';

export const ALMACEN_AREA: AreaId = 'almacen';

/** Ubicaciones fijas del almacén (orden de recorrido). */
export const ALMACEN_UBICACIONES = [
  'Almacen general',
  'Fuera de Guía',
  'Pomadas/Cremas',
  'Nutricion',
  'Sueros',
  'Nevera',
] as const;

export type AlmacenUbicacion = (typeof ALMACEN_UBICACIONES)[number];

export const ORIGEN_PEDIDO_ALMACEN = 'Pedido-Almacen';

export function isAlmacenArea(area: string | null | undefined): boolean {
  return area === ALMACEN_AREA;
}

export function normalizeAlmacenText(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/** Primera letra alfabética del criterio de orden (principio activo → nombre). */
export function letraCatalogoAlmacen(
  principioActivo: string | null | undefined,
  nombre: string | null | undefined
): string {
  const source = (principioActivo?.trim() || nombre?.trim() || '').toLocaleUpperCase('es');
  const match = source.match(/[A-ZÁÉÍÓÚÜÑ]/i);
  return match ? match[0].toLocaleUpperCase('es') : '#';
}

export function mergeUbicacionesAlmacen(desdeCatalogo: string[]): string[] {
  const map = new Map<string, string>();
  for (const ub of ALMACEN_UBICACIONES) {
    map.set(normalizeAlmacenText(ub), ub);
  }
  for (const raw of desdeCatalogo) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) continue;
    const key = normalizeAlmacenText(trimmed);
    if (!map.has(key)) map.set(key, trimmed);
  }
  const fijas = ALMACEN_UBICACIONES.filter((ub) => map.has(normalizeAlmacenText(ub)));
  const extras = [...map.entries()]
    .filter(([key]) => !ALMACEN_UBICACIONES.some((ub) => normalizeAlmacenText(ub) === key))
    .map(([, v]) => v)
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  return [...fijas, ...extras];
}

export function filtrarPorLetra<T extends { principioActivo: string | null; nombre: string }>(
  items: T[],
  letra: string | null | undefined
): T[] {
  if (!letra || letra === '*') return items;
  const target = letra.trim().toLocaleUpperCase('es');
  if (!target) return items;
  return items.filter((item) => letraCatalogoAlmacen(item.principioActivo, item.nombre) === target);
}

export function letrasDisponibles<T extends { principioActivo: string | null; nombre: string }>(
  items: T[]
): string[] {
  const set = new Set<string>();
  for (const item of items) {
    set.add(letraCatalogoAlmacen(item.principioActivo, item.nombre));
  }
  return [...set]
    .filter((l) => l !== '#')
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}
