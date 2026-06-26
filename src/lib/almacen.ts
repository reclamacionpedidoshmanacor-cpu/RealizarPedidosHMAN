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

/** Ubicación del almacén que se recorre por letras del abecedario. */
export const ALMACEN_UBICACION_CON_LETRAS = 'ALMACEN FAR';

/** Grupos de letras para propuestas de ALMACEN FAR (orden de recorrido). */
export const ALMACEN_FAR_GRUPOS_LETRAS = ['A', 'B-C', 'D-H', 'I-N', 'O-S', 'T-Z'] as const;

export type AlmacenFarGrupoLetras = (typeof ALMACEN_FAR_GRUPOS_LETRAS)[number];

const GRUPO_LETRAS_FAR: Record<AlmacenFarGrupoLetras, readonly string[]> = {
  A: ['A'],
  'B-C': ['B', 'C'],
  'D-H': ['D', 'E', 'F', 'G', 'H'],
  'I-N': ['I', 'J', 'K', 'L', 'M', 'N', 'Ñ'],
  'O-S': ['O', 'P', 'Q', 'R', 'S'],
  'T-Z': ['T', 'U', 'V', 'W', 'X', 'Y', 'Z'],
};

export function ubicacionAlmacenUsaLetras(ubicacion: string | null | undefined): boolean {
  return normalizeAlmacenText(ubicacion) === normalizeAlmacenText(ALMACEN_UBICACION_CON_LETRAS);
}

export function grupoLetrasAlmacenFarFromLetter(letra: string | null | undefined): AlmacenFarGrupoLetras {
  const L = String(letra ?? '')
    .trim()
    .toLocaleUpperCase('es');
  if (!L || L === '#') return 'T-Z';
  for (const grupo of ALMACEN_FAR_GRUPOS_LETRAS) {
    if (GRUPO_LETRAS_FAR[grupo].includes(L)) return grupo;
  }
  return 'T-Z';
}

export function grupoLetrasAlmacenFar(
  principioActivo: string | null | undefined,
  nombre: string | null | undefined
): AlmacenFarGrupoLetras {
  return grupoLetrasAlmacenFarFromLetter(letraCatalogoAlmacen(principioActivo, nombre));
}

/** Etiqueta visible de la propuesta (p. ej. «Propuesta ALMACEN FAR B-C»). */
export function nombrePropuestaAlmacen(
  ubicacion: string,
  grupoLetras?: AlmacenFarGrupoLetras | null
): string {
  const ub = ubicacion.trim();
  if (grupoLetras && ubicacionAlmacenUsaLetras(ubicacion)) {
    return `Propuesta ${ub} ${grupoLetras}`;
  }
  return `Propuesta ${ub}`;
}

/** Etiqueta de propuesta por ubicación (áreas con recuento por pasillo). */
export function nombrePropuestaUbicacion(ubicacion: string): string {
  return nombrePropuestaAlmacen(ubicacion);
}

/** Ubicación legible a partir de la etiqueta «Propuesta …». */
export function ubicacionDesdeEtiquetaPropuesta(observaciones: string | null | undefined): string | null {
  const text = observaciones?.trim();
  if (!text || !text.toLowerCase().startsWith('propuesta ')) return null;
  return text.slice('Propuesta '.length).trim() || null;
}

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
  for (const raw of desdeCatalogo) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) continue;
    const key = normalizeAlmacenText(trimmed);
    if (!map.has(key)) map.set(key, trimmed);
  }
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
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
