import { NextRequest, NextResponse } from 'next/server';
import { isValidArea } from '@/lib/areas';
import { getPedidoConLineas, ensureTablesReposicion } from '@/lib/reposicion-neon';
import { buildReposicionPdf, buildReposicionPdfFilename } from '@/lib/reposicion-pdf';

export const runtime = 'nodejs';

/* ── Endpoint ── */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureTablesReposicion();
    const area = req.cookies.get('area_session')?.value;
    if (!isValidArea(area)) {
      return NextResponse.json({ error: 'Area no seleccionada o no valida.' }, { status: 400 });
    }
    const { id } = await params;
    const pedidoId = Number(id);
    if (!Number.isFinite(pedidoId)) {
      return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });
    }

    const result = await getPedidoConLineas(pedidoId);
    if (!result) return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 });
    if (result.cabecera.area !== area) {
      return NextResponse.json({ error: 'No autorizado para este pedido.' }, { status: 403 });
    }
    if (result.lineas.length === 0) return NextResponse.json({ error: 'El pedido no tiene líneas.' }, { status: 400 });

    const bytes = await buildReposicionPdf(
      result.cabecera.id,
      result.cabecera.fechaCreacion,
      result.cabecera.fechaFinalizado,
      result.lineas
    );

    const filename = buildReposicionPdfFilename(pedidoId, result.cabecera.fechaCreacion);

    // Copiar a ArrayBuffer puro para compatibilidad con BodyInit / BlobPart
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    const blob = new Blob([ab], { type: 'application/pdf' });

    return new Response(blob, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(bytes.byteLength),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
