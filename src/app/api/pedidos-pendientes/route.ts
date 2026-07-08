import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import {
  loadPedidosConRespuestas,
  loadPedidosCuentasByCn,
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

function toCn6(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length > 6) return digits.slice(-6);
  return digits.padStart(6, '0');
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

    // Traemos siempre TODOS los pedidos (sin filtro de estado) para poder mostrar
    // correctamente los contadores de pendientes/recibidos/anulados por cada CN.
    // El filtro de estado se aplica localmente al construir los grupos.
    const [catalogo, pedidos, cuentasByCn] = await Promise.all([
      listMedicamentosByArea(session.area),
      loadPedidosConRespuestas({ estado: 'todos', soloReclamados, limit: Math.max(limit, 3000) }),
      loadPedidosCuentasByCn(),
    ]);

    const medsByCn = new Map<
      string,
      {
        cn: string;
        nombre: string;
        principioActivo: string;
      }
    >();
    for (const med of catalogo) {
      const cn6 = toCn6(med.cn);
      if (!cn6) continue;
      medsByCn.set(cn6, {
        cn: cn6,
        nombre: med.nombre,
        principioActivo: med.principioActivo ?? '',
      });
    }
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

    // Construimos los grupos con TODOS los pedidos. Los contadores exactos
    // vienen de cuentasByCn (sin límite); los detalles vienen de pedidos (limitado).
    for (const pedido of pedidos) {
      const cnPedido = toCn6(pedido.cnRaw);
      if (!cnPedido) continue;
      const med = medsByCn.get(cnPedido);
      if (!med) continue;

      if (search) {
        const hayMatch =
          med.cn.toLowerCase().includes(search) ||
          med.principioActivo.toLowerCase().includes(search) ||
          med.nombre.toLowerCase().includes(search);
        if (!hayMatch) continue;
      }

      const groupKey = med.cn;
      if (!groupsMap.has(groupKey)) {
        const cuentas = cuentasByCn.get(cnPedido);
        groupsMap.set(groupKey, {
          cn: med.cn,
          nombre: med.nombre,
          principioActivo: med.principioActivo,
          // Contadores exactos desde el agregado sin límite
          pendientes: cuentas?.pendientes ?? 0,
          recibidos:  cuentas?.recibidos  ?? 0,
          anulados:   cuentas?.anulados   ?? 0,
          reclamados: cuentas?.reclamados ?? 0,
          detallePendientes: [],
          detalleRecibidos: [],
        });
      }

      const group = groupsMap.get(groupKey)!;
      const fecha = new Date(pedido.fechaDocumento);
      const enVentana = !Number.isNaN(fecha.getTime()) && fecha >= twoMonthsAgo;
      if (!enVentana || pedido.anulado) continue;
      // Siempre rellenamos ambas listas de detalle independientemente del filtro de estado
      if (pedido.recibido) group.detalleRecibidos.push(pedido);
      else group.detallePendientes.push(pedido);
    }

    // Aplicamos el filtro de estado sobre los grupos ya construidos
    const gruposFiltrados = [...groupsMap.values()].filter((g) => {
      if (estado === 'pendientes') return g.pendientes > 0;
      if (estado === 'recibidos')  return g.recibidos  > 0;
      if (estado === 'anulados')   return g.anulados   > 0;
      return true;
    });

    const grupos = gruposFiltrados
      .sort((a, b) =>
        (a.principioActivo || a.nombre).localeCompare(b.principioActivo || b.nombre, 'es', { sensitivity: 'base' })
      )
      .map((g) => ({
        ...g,
        detallePendientes: g.detallePendientes.slice(0, 40),
        detalleRecibidos: g.detalleRecibidos.slice(0, 40),
      }));

    // Resumen global: suma de contadores exactos de todos los CNs del catálogo
    const resumen = { totalOrders: 0, pendientes: 0, recibidos: 0, anulados: 0, reclamados: 0 };
    for (const [cn6, cuentas] of cuentasByCn) {
      if (!medsByCn.has(cn6)) continue;
      resumen.pendientes  += cuentas.pendientes;
      resumen.recibidos   += cuentas.recibidos;
      resumen.anulados    += cuentas.anulados;
      resumen.reclamados  += cuentas.reclamados;
      resumen.totalOrders += cuentas.pendientes + cuentas.recibidos + cuentas.anulados;
    }

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
