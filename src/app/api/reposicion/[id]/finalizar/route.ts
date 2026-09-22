import { NextRequest, NextResponse } from 'next/server';
import { requireApiSessionOrArea } from '@/lib/api-auth';
import { finalizarPedido, getPedidoConLineas, ensureTablesReposicion } from '@/lib/reposicion-neon';
import { sendReposicionEmail } from '@/lib/reposicion-email';
import {
  consultaUnicaDeArea,
  consultasDeArea,
  esConsultaValida,
  normalizarConsulta,
} from '@/lib/reposicion-consultas';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = requireApiSessionOrArea(req);
    if (!session.ok) return session.response;
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
    if (result.cabecera.area !== session.area) {
      return NextResponse.json({ error: 'No autorizado para este pedido.' }, { status: 403 });
    }
    if (result.cabecera.estado !== 'borrador') {
      return NextResponse.json({ error: 'El pedido ya está finalizado.' }, { status: 400 });
    }
    if (result.cabecera.totalLineas === 0) {
      return NextResponse.json({ error: 'No se puede finalizar un pedido sin líneas.' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const consultaSolicitada = normalizarConsulta(
      (body as { consultaDestino?: unknown }).consultaDestino,
    );
    const consultaDestino =
      result.cabecera.consultaDestino ||
      consultaSolicitada ||
      consultaUnicaDeArea(result.cabecera.area) ||
      '';

    if (!esConsultaValida(result.cabecera.area, consultaDestino)) {
      return NextResponse.json(
        {
          error: `Indica la consulta destino del pedido (${consultasDeArea(result.cabecera.area).join(', ')}).`,
          consultasDisponibles: consultasDeArea(result.cabecera.area),
        },
        { status: 400 },
      );
    }
    if (consultaSolicitada && consultaSolicitada !== consultaDestino) {
      return NextResponse.json(
        { error: `Este pedido pertenece a la consulta ${consultaDestino}.` },
        { status: 409 },
      );
    }

    let cabecera = await finalizarPedido(pedidoId, consultaDestino);
    const email = await sendReposicionEmail(pedidoId);
    const actualizado = await getPedidoConLineas(pedidoId);
    if (actualizado) cabecera = actualizado.cabecera;

    return NextResponse.json({
      cabecera,
      emailEnviado: email.success,
      emailError: email.success ? undefined : email.error,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
