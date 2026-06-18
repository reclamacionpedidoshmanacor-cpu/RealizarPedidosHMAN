import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import {
  loadPedidosConRespuestas,
  type PedidoPendienteRow,
  type PedidoEstadoFiltro,
} from '@/lib/pedidos-pendientes';
import { listMedicamentosByArea } from '@/lib/catalogo-neon';

export const runtime = 'nodejs';

function parseEstado(value: string | null): PedidoEstadoFiltro {
  if (value === 'pendientes' || value === 'recibidos' || value === 'anulados' || value === 'todos') {
    return value;
  }
  return 'todos';
}

function parseLimit(value: string | null): number {
  if (!value) return 300;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 300;
  return Math.min(Math.trunc(num), 1000);
}

function normalizeCn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  const withoutSapPrefix = digits.startsWith('14') && digits.length > 7 ? digits.slice(2) : digits;
  return withoutSapPrefix.replace(/^0+/, '') || withoutSapPrefix;
}

function extractCnCandidates(pedido: PedidoPendienteRow): string[] {
  const values = [pedido.cnRaw, pedido.textoBreve].filter(Boolean) as string[];
  const set = new Set<string>();

  for (const value of values) {
    const direct = normalizeCn(value);
    if (direct) set.add(direct);

    const chunks = value.match(/\d{6,10}/g) ?? [];
    for (const chunk of chunks) {
      const cn = normalizeCn(chunk);
      if (cn) set.add(cn);
    }
  }

  return [...set];
}

function parseSearch(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const estado = parseEstado(req.nextUrl.searchParams.get('estado'));
    const soloReclamados = req.nextUrl.searchParams.get('reclamados') === 'true';
    const limit = parseLimit(req.nextUrl.searchParams.get('limit'));
    const search = parseSearch(req.nextUrl.searchParams.get('search'));

    const [catalogo, pedidos] = await Promise.all([
      listMedicamentosByArea(session.area),
      loadPedidosConRespuestas({ estado, soloReclamados, limit }),
    ]);

    const medsByCn = new Map(
      catalogo.map((med) => [
        normalizeCn(med.cn),
        {
          cn: normalizeCn(med.cn) ?? med.cn,
          nombre: med.nombre,
          principioActivo: med.principioActivo ?? '',
        },
      ])
    );

    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    const groupsMap = new Map<
      string,
      {
        cn: string;
        nombre: string;
        principioActivo: string;
        pendientes: number;
        recibidos: number;
        anulados: number;
        reclamados: number;
        detallePendientes: PedidoPendienteRow[];
        detalleRecibidos: PedidoPendienteRow[];
      }
    >();

    for (const pedido of pedidos) {
      const cnMatch = extractCnCandidates(pedido).find((cn) => medsByCn.has(cn));
      if (!cnMatch) continue;

      const med = medsByCn.get(cnMatch);
      if (!med) continue;

      if (search) {
        const hayMatch =
          med.cn.toLowerCase().includes(search) || med.principioActivo.toLowerCase().includes(search);
        if (!hayMatch) continue;
      }

      let group = groupsMap.get(cnMatch);
      if (!group) {
        group = {
          cn: med.cn,
          nombre: med.nombre,
          principioActivo: med.principioActivo,
          pendientes: 0,
          recibidos: 0,
          anulados: 0,
          reclamados: 0,
          detallePendientes: [],
          detalleRecibidos: [],
        };
        groupsMap.set(cnMatch, group);
      }

      if (pedido.anulado) group.anulados += 1;
      else if (pedido.recibido) group.recibidos += 1;
      else group.pendientes += 1;
      if (pedido.reclamado) group.reclamados += 1;

      const fecha = new Date(pedido.fechaDocumento);
      const enVentana = !Number.isNaN(fecha.getTime()) && fecha >= twoMonthsAgo;
      if (!enVentana) continue;
      if (pedido.anulado) continue;
      if (pedido.recibido) group.detalleRecibidos.push(pedido);
      else group.detallePendientes.push(pedido);
    }

    const grupos = [...groupsMap.values()]
      .sort((a, b) =>
        (a.principioActivo || a.nombre).localeCompare(b.principioActivo || b.nombre, 'es', { sensitivity: 'base' })
      )
      .map((g) => ({
        ...g,
        detallePendientes: g.detallePendientes.slice(0, 40),
        detalleRecibidos: g.detalleRecibidos.slice(0, 40),
      }));

    const resumen = grupos.reduce(
      (acc, g) => {
        acc.totalOrders += g.pendientes + g.recibidos + g.anulados;
        acc.pendientes += g.pendientes;
        acc.recibidos += g.recibidos;
        acc.anulados += g.anulados;
        acc.reclamados += g.reclamados;
        return acc;
      },
      { totalOrders: 0, pendientes: 0, recibidos: 0, anulados: 0, reclamados: 0 }
    );

    return NextResponse.json({
      fuente: 'PedidosPendientes (solo lectura)',
      filtro: { estado, soloReclamados, limit, search },
      area: session.area,
      resumen,
      grupos,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado';
    return NextResponse.json(
      { error: 'No se pudo consultar PedidosPendientes.', detail: message },
      { status: 500 }
    );
  }
}
