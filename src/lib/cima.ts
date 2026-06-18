const CIMA_REST = 'https://cima.aemps.es/cima/rest';

export interface CimaMedicamento {
  cn: string;
  nregistro: string;
  nombre: string;
  principioActivo: string;
  presentacion: string;
  formaFarmaceutica: string;
  labTitular: string;
  autorizado: boolean;
}

interface CimaApiResponse {
  nregistro?: string | number;
  nombre?: string;
  labtitular?: string;
  formaFarmaceutica?: { nombre?: string };
  pactivos?: { nombre?: string; cant?: string; unidad?: string }[];
  presentaciones?: { cn?: string; nombre?: string }[];
  estado?: { aut?: number };
}

export async function buscarMedicamentoPorCN(cn: string): Promise<CimaMedicamento | null> {
  const trimmed = cn.trim();
  if (!trimmed) return null;
  try {
    const res = await fetch(
      `${CIMA_REST}/medicamento?cn=${encodeURIComponent(trimmed)}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) }
    );
    if (!res.ok) return null;
    const data: CimaApiResponse = await res.json();
    if (!data.nregistro) return null;

    const principioActivo = data.pactivos
      ?.map(p => [p.nombre, p.cant, p.unidad].filter(Boolean).join(' '))
      .join(' / ') ?? '';

    const presentacion = data.presentaciones?.find(p => p.cn === trimmed)?.nombre
      ?? data.presentaciones?.[0]?.nombre
      ?? '';

    return {
      cn: trimmed,
      nregistro: String(data.nregistro),
      nombre: String(data.nombre ?? '').trim(),
      principioActivo: principioActivo.trim(),
      presentacion: presentacion.trim(),
      formaFarmaceutica: data.formaFarmaceutica?.nombre ?? '',
      labTitular: data.labtitular ?? '',
      autorizado: data.estado?.aut === 1,
    };
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

export async function checkDesabastecimiento(cn: string): Promise<CimaProblemaSupministro | null> {
  const trimmed = cn.trim();
  if (!trimmed) return null;
  try {
    const res = await fetch(
      `${CIMA_REST}/medicamento?cn=${encodeURIComponent(trimmed)}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) }
    );
    if (!res.ok) return null;
    const data: CimaApiResponse = await res.json();
    if (!data.nregistro) return null;
    const nregistro = String(data.nregistro).trim();

    // Consultar problema de suministro
    let descripcion: string | null = null;
    try {
      const psRes = await fetch(
        `${CIMA_REST}/problemaSuministro?nregistro=${encodeURIComponent(nregistro)}`,
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) }
      );
      if (psRes.ok) {
        const ps = await psRes.json();
        const item = Array.isArray(ps) ? ps[0] : ps;
        if (item) {
          descripcion = item.descripcion ?? item.motivo ?? item.detalle ?? null;
        }
      }
    } catch { /* sin descripcion */ }

    return {
      nregistro,
      cn: trimmed,
      nombre: String(data.nombre ?? '').trim(),
      descripcion,
    };
  } catch {
    return null;
  }
}
