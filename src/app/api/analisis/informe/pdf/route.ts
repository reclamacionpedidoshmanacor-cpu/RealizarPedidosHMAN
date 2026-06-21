import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getAnalisisDatos } from '@/lib/analisis-neon';
import {
  buildInformeAnalisisPdf,
  buildInformePdfFilename,
} from '@/lib/informe-analisis-pdf';
import {
  periodoInforme12Meses,
  type InformeTipo,
} from '@/lib/informes-config';
import {
  GRUPO_LABELS,
  type DiagnosticoGrupo,
  type Servicio,
} from '@/lib/diagnostico-grupos';

export const runtime = 'nodejs';

const SERVICIO_LABELS: Record<Servicio, string> = {
  'oncologia-solida': 'Oncologia solida',
  'hematologia': 'Hematologia',
};

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;
  if (session.area !== 'oncologia') {
    return NextResponse.json({ error: 'Solo disponible para Oncologia.' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const tipo = searchParams.get('tipo') as InformeTipo | null;
  const servicio = searchParams.get('servicio') as Servicio | null;
  const grupo = searchParams.get('grupo') as DiagnosticoGrupo | null;

  if (tipo !== 'servicio' && tipo !== 'grupo') {
    return NextResponse.json({ error: 'Parametro tipo requerido: servicio | grupo' }, { status: 400 });
  }

  if (tipo === 'servicio') {
    if (servicio !== 'oncologia-solida' && servicio !== 'hematologia') {
      return NextResponse.json({ error: 'Parametro servicio requerido: oncologia-solida | hematologia' }, { status: 400 });
    }
  } else if (!grupo || !GRUPO_LABELS[grupo]) {
    return NextResponse.json({ error: 'Parametro grupo requerido y valido' }, { status: 400 });
  }

  const { desde, hasta } = periodoInforme12Meses();

  const datos = await getAnalisisDatos(
    session.area,
    desde,
    hasta,
    tipo === 'grupo' ? grupo : null,
    tipo === 'servicio' ? servicio : null,
  );

  const titulo = tipo === 'servicio'
    ? `Informe por servicio — ${SERVICIO_LABELS[servicio!]}`
    : `Informe por grupo tumoral — ${GRUPO_LABELS[grupo!]}`;

  const subtitulo = tipo === 'servicio'
    ? 'Resumen farmaeconomico del servicio (12 meses). Destinado a responsables clinicos del area.'
    : `Detalle del grupo ${GRUPO_LABELS[grupo!]} (12 meses).`;

  const pdfBytes = await buildInformeAnalisisPdf(tipo, datos, {
    titulo,
    subtitulo,
    servicio: tipo === 'servicio' ? servicio! : undefined,
    grupo: tipo === 'grupo' ? grupo! : undefined,
  });

  const slug = tipo === 'servicio' ? servicio! : grupo!;
  const filename = buildInformePdfFilename(tipo, slug, desde, hasta);

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
