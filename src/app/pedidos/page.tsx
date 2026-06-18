'use client';

import { useEffect, useMemo, useState } from 'react';

type EstadoFiltro = 'todos' | 'pendientes' | 'recibidos' | 'anulados';

type PedidoRow = {
  id: number;
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
  pedidos: PedidoRow[];
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  const qs = useMemo(() => {
    const params = new URLSearchParams({
      estado,
      limit: '120',
    });
    if (soloReclamados) params.set('reclamados', 'true');
    return params.toString();
  }, [estado, soloReclamados]);

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

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-3 py-2">Fecha</th>
              <th className="text-left px-3 py-2">Documento</th>
              <th className="text-left px-3 py-2">Posición</th>
              <th className="text-left px-3 py-2">Proveedor</th>
              <th className="text-left px-3 py-2">Medicamento</th>
              <th className="text-left px-3 py-2">Pendiente</th>
              <th className="text-left px-3 py-2">Estado</th>
              <th className="text-left px-3 py-2">Respuesta</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td className="px-3 py-4 text-slate-500" colSpan={8}>
                  Cargando pedidos...
                </td>
              </tr>
            )}
            {!loading && !error && data?.pedidos.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-slate-500" colSpan={8}>
                  No hay pedidos para el filtro actual.
                </td>
              </tr>
            )}
            {!loading &&
              data?.pedidos.map((pedido) => (
                <tr key={pedido.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-700">{formatFecha(pedido.fechaDocumento)}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{pedido.documentoCompras}</td>
                  <td className="px-3 py-2 text-slate-700">{pedido.posicion}</td>
                  <td className="px-3 py-2 text-slate-700">{pedido.proveedorNombre ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-700">{pedido.textoBreve ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-700">{pedido.porEntregarCantidad ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-700">
                      {pedido.anulado ? 'Anulado' : pedido.recibido ? 'Recibido' : 'Pendiente'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {pedido.reclamado
                      ? pedido.estadoRespuesta ?? pedido.historialEstado ?? 'Reclamado sin respuesta'
                      : 'No reclamado'}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
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
