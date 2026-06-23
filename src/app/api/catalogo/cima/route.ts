import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { buscarMedicamentoPorCN } from '@/lib/cima';
import { inferirUnidadesPorCaja } from '@/lib/cima-presentacion';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  const cn = req.nextUrl.searchParams.get('cn')?.trim() ?? '';
  if (!cn) {
    return NextResponse.json({ error: 'CN requerido.' }, { status: 400 });
  }

  const datos = await buscarMedicamentoPorCN(cn);
  if (!datos) {
    return NextResponse.json({ error: `CN ${cn} no encontrado en CIMA (AEMPS).` }, { status: 404 });
  }

  const unidadesInferidas = inferirUnidadesPorCaja(datos.presentacion);

  return NextResponse.json({
    cn: datos.cn,
    nombre: datos.nombre,
    principioActivo: datos.principioActivo,
    presentacion: datos.presentacion,
    formaFarmaceutica: datos.formaFarmaceutica,
    labTitular: datos.labTitular,
    autorizado: datos.autorizado,
    unidadesPorCajaInferidas: unidadesInferidas,
  });
}
