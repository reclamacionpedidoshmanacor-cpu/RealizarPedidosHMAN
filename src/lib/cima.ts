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
}

export async function checkDesabastecimiento(rawCn: string): Promise<CimaProblemaSupministro | null> {
  const datos = await buscarMedicamentoPorCN(rawCn);
  if (!datos) return null;

  const nregistro = datos.nregistro.trim();

  let descripcion: string | null = null;
  try {
    const psRes = await fetch(
      `${CIMA_REST}/problemaSuministro?nregistro=${encodeURIComponent(nregistro)}`,
      { headers: CIMA_HEADERS, signal: AbortSignal.timeout(6_000) }
    );
    if (psRes.ok && psRes.status !== 204) {
      const text = await psRes.text();
      if (text.trim()) {
        const ps = JSON.parse(text);
        const item = Array.isArray(ps) ? ps[0] : ps;
        if (item) {
          descripcion = item.descripcion ?? item.motivo ?? item.detalle ?? null;
        }
      }
    }
  } catch { /* sin descripcion */ }

  return {
    nregistro,
    cn: datos.cn,
    nombre: datos.nombre,
    descripcion,
  };
}
