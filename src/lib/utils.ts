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
  const trimmed = String(material ?? '').trim();
  if (!trimmed) return '';

  // SAP suele enviar el material con prefijo 14, separadores o formato numérico.
  // Normalizamos a CN de 6 dígitos para poder cruzar con catálogo.
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed;

  if (digits.startsWith('14') && digits.length > 6) {
    digits = digits.slice(2);
  }

  if (digits.length > 6) digits = digits.slice(-6);
  if (digits.length < 6) digits = digits.padStart(6, '0');
  return digits;
}

export function isMSE(cn: string): boolean {
  return cn.trim().startsWith('02');
}

export function formatMseLabel(tipoMse: string | null | undefined): string {
  const trimmed = tipoMse?.trim();
  return trimmed || 'MSE';
}
