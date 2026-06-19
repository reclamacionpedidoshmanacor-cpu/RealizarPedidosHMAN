import { NextRequest, NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';
import { getPedidoConLineas, ensureTablesReposicion, type ReposicionLinea } from '@/lib/reposicion-neon';

export const runtime = 'nodejs';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function buildPdf(
  pedidoId: number,
  fechaCreacion: string,
  fechaFinalizado: string | null,
  lineas: ReposicionLinea[]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width - 100; // ancho útil

    /* ── Cabecera del albarán ── */
    doc.fontSize(18).font('Helvetica-Bold').text('ALBARÁN DE REPOSICIÓN', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica').text('Farmacia Hospitalaria — Pacientes Externos', { align: 'center' });
    doc.moveDown(0.5);

    doc.moveTo(50, doc.y).lineTo(50 + pageW, doc.y).stroke();
    doc.moveDown(0.5);

    doc.fontSize(10).font('Helvetica');
    doc.text(`Nº Pedido: ${pedidoId}`, { continued: true });
    doc.text(`   Fecha: ${fmtDate(fechaCreacion)}`, { continued: true });
    if (fechaFinalizado) doc.text(`   Finalizado: ${fmtDate(fechaFinalizado)}`);
    else doc.text('');
    doc.moveDown(1);

    /* ── Agrupar por ubicación ── */
    const porUbicacion = new Map<string, ReposicionLinea[]>();
    for (const l of lineas) {
      if (!porUbicacion.has(l.ubicacion)) porUbicacion.set(l.ubicacion, []);
      porUbicacion.get(l.ubicacion)!.push(l);
    }

    for (const [ubicacion, items] of porUbicacion) {
      /* Título ubicación */
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#1e3a5f')
        .text(`📍 ${ubicacion}`, { underline: false });
      doc.moveDown(0.3);

      /* Cabecera tabla */
      const col = { cn: 50, pa: 120, med: 310, qty: 500 };
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#444444');
      doc.text('CN', col.cn, doc.y, { width: 65 });
      const yRow = doc.y;
      doc.text('Principio activo', col.pa, yRow, { width: 185 });
      doc.text('Medicamento', col.med, yRow, { width: 185 });
      doc.text('Cajas', col.qty, yRow, { width: 45, align: 'right' });
      doc.moveDown(0.2);
      doc.moveTo(50, doc.y).lineTo(50 + pageW, doc.y).lineWidth(0.5).stroke();
      doc.moveDown(0.2);

      /* Filas */
      doc.fontSize(9).font('Helvetica').fillColor('#000000');
      for (const l of items) {
        const y = doc.y;
        doc.text(l.cn, col.cn, y, { width: 65 });
        doc.text(l.principioActivo ?? '—', col.pa, y, { width: 185 });
        doc.text(l.nombre, col.med, y, { width: 185 });
        doc.text(String(l.cantidadCajas), col.qty, y, { width: 45, align: 'right' });
        doc.moveDown(0.5);

        // Salto de página automático
        if (doc.y > doc.page.height - 100) {
          doc.addPage();
        }
      }

      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(50 + pageW, doc.y).lineWidth(0.3).stroke();
      doc.moveDown(1);
    }

    /* ── Pie ── */
    const totalCajas = lineas.reduce((s, l) => s + l.cantidadCajas, 0);
    doc.fontSize(10).font('Helvetica-Bold')
      .text(`Total líneas: ${lineas.length}   |   Total cajas: ${totalCajas}`, { align: 'right' });
    doc.moveDown(2);
    doc.fontSize(9).font('Helvetica').fillColor('#888888')
      .text('Documento generado automáticamente — Farmacia Oncológica', { align: 'center' });

    doc.end();
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureTablesReposicion();
    const { id } = await params;
    const pedidoId = Number(id);
    if (!Number.isFinite(pedidoId)) {
      return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });
    }

    const result = await getPedidoConLineas(pedidoId);
    if (!result) {
      return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 });
    }
    if (result.lineas.length === 0) {
      return NextResponse.json({ error: 'El pedido no tiene líneas.' }, { status: 400 });
    }

    const buffer = await buildPdf(
      result.cabecera.id,
      result.cabecera.fechaCreacion,
      result.cabecera.fechaFinalizado,
      result.lineas
    );

    const fecha = fmtDate(result.cabecera.fechaCreacion).replace(/\//g, '-');
    const filename = `albaran-reposicion-${pedidoId}-${fecha}.pdf`;

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
