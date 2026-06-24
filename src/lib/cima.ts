import { normalizarCnParaCima } from './utils';
import { procesarPresentacionCima } from './cima-presentacion';

const CIMA_REST = 'https://cima.aemps.es/cima/rest';

const CIMA_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; FarmaciaHMAN/1.0)',
} as const;

export interface CimaMedicamento {
  cn: string;
  nregistro: string;
  nombre: string;
  principioActivo: string;
  presentacion: string;
  unidadesPorCaja: number | null;
  formaFarmaceutica: string;
  labTitular: string;
  autorizado: boolean;
}

interface CimaApiResponse {
  nregistro?: string | number;
  nombre?: string;
  labtitular?: string;
  formaFarmaceutica?: { nombre?: string };
  pactivos?: string | { nombre?: string; cant?: string; unidad?: string }[];
  presentaciones?: { cn?: string | number; nombre?: string }[];
  estado?: { aut?: number };
  psum?: boolean;
}

const CIMA_PUBLIC = 'https://cima.aemps.es/cima/publico/detalle.html';

function cimaUrl(nregistro: string): string {
  return `${CIMA_PUBLIC}?nregistro=${encodeURIComponent(nregistro)}`;
}

function formatPrincipioActivo(
  pactivos: CimaApiResponse['pactivos']
): string {
  if (!pactivos) return '';
  if (typeof pactivos === 'string') return pactivos.trim();
  if (Array.isArray(pactivos)) {
    return pactivos
      .map((p) => [p.nombre, p.cant, p.unidad].filter(Boolean).join(' '))
      .join(' / ')
      .trim();
  }
  return '';
}

function cnCimaKey(value: string | number | undefined): string {
  return normalizarCnParaCima(String(value ?? ''));
}

async function fetchCimaMedicamentoPorCn(cn: string): Promise<CimaApiResponse | null> {
  const res = await fetch(
    `${CIMA_REST}/medicamento?cn=${encodeURIComponent(cn)}`,
    { headers: CIMA_HEADERS, signal: AbortSignal.timeout(8_000) }
  );
  if (!res.ok || res.status === 204) return null;

  const text = await res.text();
  if (!text.trim()) return null;

  try {
    const data = JSON.parse(text) as CimaApiResponse;
    if (!data.nregistro) return null;
    return data;
  } catch {
    return null;
  }
}

function mapCimaResponse(cn: string, data: CimaApiResponse): CimaMedicamento {
  const cnKey = cnCimaKey(cn);

  const principioActivo = formatPrincipioActivo(data.pactivos);

  const presentacionRaw = data.presentaciones?.find(p => cnCimaKey(p.cn) === cnKey)?.nombre
    ?? data.presentaciones?.[0]?.nombre
    ?? '';

  const nombre = String(data.nombre ?? '').trim();
  const { presentacion, unidadesPorCaja } = procesarPresentacionCima(presentacionRaw, nombre);

  return {
    cn,
    nregistro: String(data.nregistro),
    nombre,
    principioActivo: principioActivo,
    presentacion,
    unidadesPorCaja,
    formaFarmaceutica: data.formaFarmaceutica?.nombre ?? '',
    labTitular: data.labtitular ?? '',
    autorizado: data.estado?.aut === 1,
  };
}

export async function buscarMedicamentoPorCN(rawCn: string): Promise<CimaMedicamento | null> {
  const trimmed = String(rawCn ?? '').trim();
  if (!trimmed) return null;

  const candidatos = new Set<string>();
  const normalizado = normalizarCnParaCima(trimmed);
  if (normalizado) candidatos.add(normalizado);
  candidatos.add(trimmed.replace(/\D/g, '') || trimmed);

  try {
    for (const cn of candidatos) {
      if (!cn) continue;
      const data = await fetchCimaMedicamentoPorCn(cn);
      if (data) return mapCimaResponse(cn, data);
    }
    return null;
  } catch {
    return null;
  }
}

export interface CimaProblemaSupministro {
  nregistro: string;
  cn: string;
  nombre: string;
  descripcion: string | null;
  cimaUrl: string;
}

async function fetchDescripcionProblema(nregistro: string): Promise<string | null> {
  try {
    const psRes = await fetch(
      `${CIMA_REST}/problemaSuministro?nregistro=${encodeURIComponent(nregistro)}`,
      { headers: CIMA_HEADERS, signal: AbortSignal.timeout(6_000) }
    );
    if (!psRes.ok || psRes.status === 204) return null;
    const text = await psRes.text();
    if (!text.trim()) return null;
    const ps = JSON.parse(text);
    const item = Array.isArray(ps) ? ps[0] : ps;
    if (!item) return null;
    return item.descripcion ?? item.motivo ?? item.detalle ?? item.texto ?? item.informacion ?? null;
  } catch {
    return null;
  }
}

/** Problema de suministro activo en CIMA (psum=true) para un CN. */
export async function checkCNenCIMA(rawCn: string): Promise<CimaProblemaSupministro | null> {
  const trimmed = String(rawCn ?? '').trim();
  if (!trimmed) return null;

  const candidatos = new Set<string>();
  const normalizado = normalizarCnParaCima(trimmed);
  if (normalizado) candidatos.add(normalizado);
  candidatos.add(trimmed.replace(/\D/g, '') || trimmed);

  try {
    for (const cn of candidatos) {
      if (!cn) continue;
      const data = await fetchCimaMedicamentoPorCn(cn);
      if (!data?.psum || !data.nregistro) continue;

      const nregistro = String(data.nregistro).trim();
      const descripcion = await fetchDescripcionProblema(nregistro);

      return {
        nregistro,
        cn: trimmed,
        nombre: String(data.nombre ?? '').trim(),
        descripcion,
        cimaUrl: cimaUrl(nregistro),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function checkCNsConProblemas(cns: string[]): Promise<CimaProblemaSupministro[]> {
  const unique = [...new Set(cns.map((c) => c.trim()).filter(Boolean))];
  const all: CimaProblemaSupministro[] = [];

  for (const cn of unique) {
    const result = await checkCNenCIMA(cn);
    if (result && !all.some((a) => a.nregistro === result.nregistro)) {
      all.push(result);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  return all;
}

export async function checkDesabastecimiento(rawCn: string): Promise<CimaProblemaSupministro | null> {
  return checkCNenCIMA(rawCn);
}
