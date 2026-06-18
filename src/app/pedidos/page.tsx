'use client';

import { useEffect, useMemo, useState } from 'react';

type EstadoFiltro = 'todos' | 'pendientes' | 'recibidos' | 'anulados';

type PedidoRow = {
  id: number;
  cnRaw: string | null;
  documentoCompras: string;
  posicion: string;
  fechaDocumento: string;
  proveedorNombre: string | null;
  textoBreve: string | null;
  porEntregarCantidad: string | null;
  recibido: boolean;
  anulado: boolean;
  reclamado: boolean;
  estadoRespuesta: string | null;
  historialEstado: string | null;
};

type Resumen = {
  totalOrders: number;
  pendientes: number;
  recibidos: number;
  anulados: number;
  reclamados: number;
};

type ApiResponse = {
  resumen: Resumen;
  area: string;
  grupos: GrupoMedicamento[];
};

type GrupoMedicamento = {
  cn: string;
  nombre: string;
  principioActivo: string;
  pendientes: number;
  recibidos: number;
  anulados: number;
  reclamados: number;
  detallePendientes: PedidoRow[];
  detalleRecibidos: PedidoRow[];
};

const estadoLabel: Record<EstadoFiltro, string> = {
  todos: 'Todos',
  pendientes: 'Pendientes',
  recibidos: 'Recibidos',
  anulados: 'Anulados',
};

function formatFecha(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-ES');
}

export default function PedidosPage() {
  const [estado, setEstado] = useState<EstadoFiltro>('pendientes');
  const [soloReclamados, setSoloReclamados] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  const qs = useMemo(() => {
    const params = new URLSearchParams({
      estado,
      limit: '400',
    });
    if (soloReclamados) params.set('reclamados', 'true');
    if (busqueda.trim()) params.set('search', busqueda.trim());
    return params.toString();
  }, [estado, soloReclamados, busqueda]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/pedidos-pendientes?${qs}`, { cache: 'no-store' });
        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload?.detail ?? payload?.error ?? 'No se pudo cargar el listado.');
        }
        if (active) setData(payload);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Error inesperado.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [qs]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Pedidos</h1>
        <p className="text-sm text-slate-500">
          Lectura en tiempo real desde PedidosPendientes (solo consulta, sin escrituras).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-700 font-medium">Estado:</label>
        <select
          value={estado}
          onChange={(e) => setEstado(e.target.value as EstadoFiltro)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          {Object.entries(estadoLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={soloReclamados}
            onChange={(e) => setSoloReclamados(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Solo reclamados
        </label>

        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por CN o principio activo..."
          className="min-w-[280px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />
      </div>

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Kpi label="Total" value={data.resumen.totalOrders} />
          <Kpi label="Pendientes" value={data.resumen.pendientes} />
          <Kpi label="Recibidos" value={data.resumen.recibidos} />
          <Kpi label="Anulados" value={data.resumen.anulados} />
          <Kpi label="Reclamados" value={data.resumen.reclamados} />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white">
        {loading && <p className="px-4 py-4 text-sm text-slate-500">Cargando pedidos...</p>}
        {!loading && !error && data?.grupos.length === 0 && (
          <p className="px-4 py-4 text-sm text-slate-500">No hay pedidos para el filtro actual.</p>
        )}

        {!loading &&
          data?.grupos.map((grupo) => {
            const isOpen = expanded[grupo.cn] ?? false;
            return (
              <div key={grupo.cn} className="border-t first:border-t-0 border-slate-100">
                <button
                  className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50"
                  onClick={() => setExpanded((prev) => ({ ...prev, [grupo.cn]: !isOpen }))}
                >
                  <div>
                    <p className="font-semibold text-slate-800">
                      {grupo.nombre} <span className="text-slate-500">({grupo.cn})</span>
                    </p>
                    <p className="text-xs text-slate-500">{grupo.principioActivo || 'Sin principio activo'}</p>
                  </div>
                  <div className="text-xs text-slate-600 flex gap-3">
                    <span>Pendientes: {grupo.pendientes}</span>
                    <span>Recibidos: {grupo.recibidos}</span>
                    <span>Anulados: {grupo.anulados}</span>
                    <span>{isOpen ? 'Ocultar' : 'Ver detalle'}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <DetalleTabla titulo="Pendientes (últimos 2 meses)" rows={grupo.detallePendientes} />
                      <DetalleTabla titulo="Recibidos (últimos 2 meses)" rows={grupo.detalleRecibidos} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-800">{value}</p>
    </div>
  );
}

function DetalleTabla({ titulo, rows }: { titulo: string; rows: PedidoRow[] }) {
  return (
    <div className="rounded-lg border border-slate-200 overflow-x-auto">
      <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 bg-slate-50">{titulo}</p>
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="text-left px-3 py-2">Fecha</th>
            <th className="text-left px-3 py-2">Documento</th>
            <th className="text-left px-3 py-2">Pos.</th>
            <th className="text-left px-3 py-2">Proveedor</th>
            <th className="text-left px-3 py-2">Pendiente</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="px-3 py-3 text-slate-500" colSpan={5}>
                Sin registros en la ventana de 2 meses.
              </td>
            </tr>
          )}
          {rows.map((pedido) => (
            <tr key={pedido.id} className="border-t border-slate-100">
              <td className="px-3 py-2 text-slate-700">{formatFecha(pedido.fechaDocumento)}</td>
              <td className="px-3 py-2 font-medium text-slate-800">{pedido.documentoCompras}</td>
              <td className="px-3 py-2 text-slate-700">{pedido.posicion}</td>
              <td className="px-3 py-2 text-slate-700">{pedido.proveedorNombre ?? '—'}</td>
              <td className="px-3 py-2 text-slate-700">{pedido.porEntregarCantidad ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
