import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatEuro(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);
}

export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: decimals }).format(value);
}

export function cnFromSapMaterial(material: string): string {
  const trimmed = material.trim();
  if (trimmed.startsWith('14')) return trimmed.slice(2);
  return trimmed;
}

export function isMSE(cn: string): boolean {
  return cn.trim().startsWith('02');
}
