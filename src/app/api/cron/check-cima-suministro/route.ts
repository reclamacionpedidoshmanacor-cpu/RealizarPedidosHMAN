import { NextRequest, NextResponse } from 'next/server';
import {
  getCimaLoteConfig,
  runChequeoCimaSuministroCatalogoLote,
} from '@/lib/cima-suministro-neon';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const reiniciar = request.nextUrl.searchParams.get('reset') === '1';
    const result = await runChequeoCimaSuministroCatalogoLote({ reiniciar });
    const avance = result.totalUniverso > 0
      ? result.totalUniverso - result.pendientesTrasLote
      : 0;

    return NextResponse.json({
      modo: 'lote',
      config: getCimaLoteConfig(),
      message: result.cicloCompleto
        ? `CIMA catálogo: ciclo completado (${result.comprobados} CNs en este lote, ${result.problemasActivos} problemas)`
        : `CIMA catálogo: lote ${result.comprobados} CNs (${avance}/${result.totalUniverso}), quedan ${result.pendientesTrasLote}`,
      ...result,
    });
  } catch (error) {
    console.error('Cron check-cima-suministro error:', error);
    return NextResponse.json({ error: 'Error ejecutando chequeo CIMA de suministro' }, { status: 500 });
  }
}
