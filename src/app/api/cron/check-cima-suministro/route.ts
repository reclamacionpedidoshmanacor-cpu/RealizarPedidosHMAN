import { NextRequest, NextResponse } from 'next/server';
import { runChequeoCimaSuministroCatalogo } from '@/lib/cima-suministro-neon';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runChequeoCimaSuministroCatalogo();
    return NextResponse.json({
      message: `CIMA catálogo: ${result.problemasActivos} problemas activos de ${result.comprobados} CNs comprobados`,
      ...result,
    });
  } catch (error) {
    console.error('Cron check-cima-suministro error:', error);
    return NextResponse.json({ error: 'Error ejecutando chequeo CIMA de suministro' }, { status: 500 });
  }
}
