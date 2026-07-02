import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getAnalisisDatos, parseModoComparativa } from '@/lib/analisis-neon';
import {
  buildInformeAnalisisPdf,
  buildInformePdfFilename,
} from '@/lib/informe-analisis-pdf';
import {
  GRUPO_LABELS,
  type DiagnosticoGrupo,
} from '@/lib/diagnostico-grupos';

export const runtime = 'nodejs';

function defaultDesde() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  d.setMonth(d.getMonth() + 1, 1);
  return d.toISOString().slice(0, 10);
}

function defaultHasta() {
  return new Date().toISOString().slice(0, 10);
}

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;
  if (session.area !== 'oncologia') {
    return NextResponse.json({ error: 'Solo disponible para Oncologia.' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const desde = searchParams.get('desde') || defaultDesde();
  const hasta = searchParams.get('hasta') || defaultHasta();
  const servicio = searchParams.get('servicio')?.trim() || null;
  const grupoRaw = searchParams.get('grupo')?.trim() || null;
  const cn = searchParams.get('cn')?.trim() || null;
  const grupo = grupoRaw && grupoRaw in GRUPO_LABELS ? (grupoRaw as DiagnosticoGrupo) : null;
  const comparativa = parseModoComparativa(searchParams.get('comparativa'));

  const datos = await getAnalisisDatos(
    session.area,
    desde,
    hasta,
    grupo,
    servicio,
    comparativa,
    cn,
  );

  const subtitulo = [
    servicio ? `Servicio: ${servicio}` : null,
    grupo ? `Grupo tumoral: ${GRUPO_LABELS[grupo]}` : null,
    cn ? `CN: ${cn}` : null,
  ].filter(Boolean).join(' · ') || 'Vista global del area';

  const pdfBytes = await buildInformeAnalisisPdf(datos, {
    lineaInforme: cn ? 'Ficha de analisis de medicamento' : 'Informe de analisis de Oncologia',
    subtitulo,
  });

  const filename = buildInformePdfFilename(
    [
      session.area,
      servicio ? slugify(servicio) : 'global',
      grupo ? slugify(GRUPO_LABELS[grupo]) : null,
      cn ? `cn-${slugify(cn)}` : null,
    ].filter(Boolean).join('-'),
    desde,
    hasta,
  );

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
