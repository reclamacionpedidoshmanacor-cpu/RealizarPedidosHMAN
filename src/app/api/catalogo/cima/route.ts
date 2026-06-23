import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { buscarMedicamentoPorCN } from '@/lib/cima';
import { inferirUnidadesPorCaja } from '@/lib/cima-presentacion';
import { normalizarCnParaCima } from '@/lib/utils';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  const rawCn = req.nextUrl.searchParams.get('cn')?.trim() ?? '';
  if (!rawCn) {
    return NextResponse.json({ error: 'CN requerido.' }, { status: 400 });
  }

  const cnNormalizado = normalizarCnParaCima(rawCn);
  if (!cnNormalizado) {
    return NextResponse.json({ error: 'CN no válido.' }, { status: 400 });
  }

  const datos = await buscarMedicamentoPorCN(rawCn);
  if (!datos) {
    return NextResponse.json(
      {
        error: `No encontrado en CIMA. Se consultó como CN ${cnNormalizado}${rawCn !== cnNormalizado ? ` (entrada: ${rawCn})` : ''}.`,
      },
      { status: 404 }
    );
  }

  const unidadesInferidas = inferirUnidadesPorCaja(datos.presentacion);

  return NextResponse.json({
    cn: datos.cn,
    cnConsultado: cnNormalizado,
    nombre: datos.nombre,
    principioActivo: datos.principioActivo,
    presentacion: datos.presentacion,
    formaFarmaceutica: datos.formaFarmaceutica,
    labTitular: datos.labTitular,
    autorizado: datos.autorizado,
    unidadesPorCajaInferidas: unidadesInferidas,
  });
}
