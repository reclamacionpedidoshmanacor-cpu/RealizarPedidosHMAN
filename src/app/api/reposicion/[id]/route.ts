import { NextRequest, NextResponse } from 'next/server';
import { isValidArea } from '@/lib/areas';
import { requireApiSession } from '@/lib/api-auth';
import {
  actualizarPedidoFinalizado,
  eliminarPedidoReposicion,
  getPedidoConLineas,
  ensureTablesReposicion,
} from '@/lib/reposicion-neon';
import { sendReposicionEmail } from '@/lib/reposicion-email';
import {
  esConsultaValida,
  normalizarConsulta,
} from '@/lib/reposicion-consultas';

export const runtime = 'nodejs';
export const maxDuration = 30;

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
    if (!result) {
      return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 });
    }
    if (result.cabecera.area !== area) {
      return NextResponse.json({ error: 'No autorizado para este pedido.' }, { status: 403 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireApiSession(req);
    if (!session.ok) return session.response;
    await ensureTablesReposicion();

    const { id } = await params;
    const pedidoId = Number(id);
    if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
      return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });
    }

    const pedido = await getPedidoConLineas(pedidoId);
    if (!pedido || pedido.cabecera.area !== session.area) {
      return NextResponse.json({ error: 'Pedido no encontrado en el área activa.' }, { status: 404 });
    }
    if (pedido.cabecera.estado !== 'finalizado' && pedido.cabecera.estado !== 'enviado') {
      return NextResponse.json({ error: 'Solo se pueden corregir pedidos finalizados o enviados.' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({})) as {
      consultaDestino?: unknown;
      lineas?: unknown;
    };
    const consultaDestino = normalizarConsulta(body.consultaDestino);
    if (!esConsultaValida(session.area, consultaDestino)) {
      return NextResponse.json({ error: 'Consulta destino no válida.' }, { status: 400 });
    }
    if (!Array.isArray(body.lineas) || body.lineas.length === 0) {
      return NextResponse.json({ error: 'El pedido debe conservar al menos una línea.' }, { status: 400 });
    }

    const lineas = body.lineas.map((linea) => {
      const raw = linea as { id?: unknown; cantidadCajas?: unknown };
      return {
        id: Number(raw.id),
        cantidadCajas: Number(raw.cantidadCajas),
      };
    });
    if (lineas.some((linea) =>
      !Number.isInteger(linea.id) ||
      linea.id <= 0 ||
      !Number.isInteger(linea.cantidadCajas) ||
      linea.cantidadCajas < 0
    )) {
      return NextResponse.json({ error: 'Hay cantidades o líneas no válidas.' }, { status: 400 });
    }
    if (!lineas.some((linea) => linea.cantidadCajas > 0)) {
      return NextResponse.json({ error: 'El pedido debe conservar al menos una línea.' }, { status: 400 });
    }

    let cabecera = await actualizarPedidoFinalizado(
      pedidoId,
      session.area,
      consultaDestino,
      lineas,
    );
    const email = await sendReposicionEmail(pedidoId);
    const actualizado = await getPedidoConLineas(pedidoId);
    if (actualizado) cabecera = actualizado.cabecera;

    return NextResponse.json({
      ok: true,
      cabecera,
      emailEnviado: email.success,
      emailError: email.success ? undefined : email.error,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireApiSession(req);
    if (!session.ok) return session.response;
    await ensureTablesReposicion();

    const { id } = await params;
    const pedidoId = Number(id);
    if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
      return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });
    }

    const eliminado = await eliminarPedidoReposicion(pedidoId, session.area);
    if (!eliminado) {
      return NextResponse.json({ error: 'Pedido no encontrado en el área activa.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, eliminado });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
