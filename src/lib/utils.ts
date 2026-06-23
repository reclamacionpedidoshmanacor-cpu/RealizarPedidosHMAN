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

/** Cajas con un decimal (p. ej. 2,5) — catálogo Nutrición. */
export function formatCajas(value: number | null | undefined, decimals = 1): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function roundCajas(value: number, decimals = 1): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function parseCajasInput(value: string): number | null {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return roundCajas(n);
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

/** CN listo para consultar la API REST de CIMA (AEMPS). */
export function normalizarCnParaCima(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';

  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed;

  if (digits.startsWith('14') && digits.length > 6) {
    digits = digits.slice(2);
  }

  // MSE: el CN puede tener más de 6 dígitos y empieza por 02.
  if (digits.startsWith('02')) {
    return digits;
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
