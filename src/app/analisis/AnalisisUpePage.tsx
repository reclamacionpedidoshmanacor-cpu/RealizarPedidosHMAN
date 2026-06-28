'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type {
  AnalisisComprasDatos,
  IncidenciasMedicamento,
  VistaAnalisisCompras,
} from '@/lib/analisis-compras-neon';

type Preset = { label: string; desde: string; hasta: string };

function defaultHasta(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildPresets(): Preset[] {
  const hasta = defaultHasta();
  const now = new Date();
  const m6 = new Date(now);
  m6.setMonth(m6.getMonth() - 6);
  const m3 = new Date(now);
  m3.setMonth(m3.getMonth() - 3);
  const yearStart = `${now.getFullYear()}-01-01`;
  return [
    { label: 'Últimos 6 meses', desde: m6.toISOString().slice(0, 10), hasta },
    { label: 'Últimos 3 meses', desde: m3.toISOString().slice(0, 10), hasta },
    { label: 'Año actual', desde: yearStart, hasta },
  ];
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function IncidenciasBadges({ inc }: { inc: IncidenciasMedicamento }) {
  const items: Array<{ show: boolean; label: string; className: string }> = [
    { show: inc.cima, label: 'CIMA suministro', className: 'bg-amber-100 text-amber-800' },
    { show: inc.enFalta, label: 'En falta', className: 'bg-rose-100 text-rose-800' },
    { show: inc.sinExistencias, label: 'Sin existencias', className: 'bg-orange-100 text-orange-800' },
    { show: inc.problemaSuministro, label: 'Problema suministro', className: 'bg-orange-100 text-orange-800' },
    { show: inc.situacionEspecial, label: 'Situación especial', className: 'bg-violet-100 text-violet-800' },
  ];
  const activos = items.filter((i) => i.show);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {activos.length === 0 && (
        <span className="text-xs text-slate-400">Sin incidencias activas en alertas</span>
      )}
      {activos.map((i) => (
        <span key={i.label} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${i.className}`}>
          {i.label}
        </span>
      ))}
      {inc.reclamaciones > 0 && (
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800">
          Reclamado ×{inc.reclamaciones}
        </span>
      )}
    </div>
  );
}

export default function AnalisisUpePage() {
  const presets = useMemo(() => buildPresets(), []);
  const [vista, setVista] = useState<VistaAnalisisCompras>('global');
  const [desde, setDesde] = useState(presets[0]!.desde);
  const [hasta, setHasta] = useState(presets[0]!.hasta);
  const [activePreset, setActivePreset] = useState(presets[0]!.label);
  const [cnSel, setCnSel] = useState('');
  const [proveedorSel, setProveedorSel] = useState('');
  const [datos, setDatos] = useState<AnalisisComprasDatos | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const p = new URLSearchParams({ desde, hasta, vista });
    if (vista === 'medicamento' && cnSel) p.set('cn', cnSel);
    if (vista === 'proveedor' && proveedorSel) p.set('proveedor', proveedorSel);
    try {
      const res = await fetch(`/api/analisis-compras/datos?${p}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'Error al cargar análisis');
      setDatos(payload as AnalisisComprasDatos);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
      setDatos(null);
    } finally {
      setLoading(false);
    }
  }, [desde, hasta, vista, cnSel, proveedorSel]);

  useEffect(() => {
    void load();
  }, [load]);

  const chartPropuestas = datos?.semanalPropuestas ?? [];
  const chartSap = datos?.semanalSap ?? [];

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Análisis de compras</h1>
            <p className="text-xs text-slate-500 mt-0.5">Pacientes Externos · pedidos SAP y propuestas tramitadas</p>
          </div>
          <button
            type="button"
            disabled
            title="Próximamente: PDF de la vista actual"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-400 cursor-not-allowed"
          >
            PDF informe UPE (próximamente)
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['global', 'medicamento', 'proveedor'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVista(v)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                vista === v
                  ? 'bg-teal-700 text-white'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {v === 'global' ? 'Análisis global' : v === 'medicamento' ? 'Por medicamento' : 'Por proveedor'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setDesde(p.desde);
                  setHasta(p.hasta);
                  setActivePreset(p.label);
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                  activePreset === p.label
                    ? 'bg-teal-50 text-teal-800 ring-1 ring-teal-200'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="text-xs text-slate-500">
            Desde
            <input
              type="date"
              value={desde}
              onChange={(e) => {
                setDesde(e.target.value);
                setActivePreset('');
              }}
              className="ml-1 rounded border border-slate-200 px-2 py-1 text-sm text-slate-700"
            />
          </label>
          <label className="text-xs text-slate-500">
            Hasta
            <input
              type="date"
              value={hasta}
              onChange={(e) => {
                setHasta(e.target.value);
                setActivePreset('');
              }}
              className="ml-1 rounded border border-slate-200 px-2 py-1 text-sm text-slate-700"
            />
          </label>
        </div>
      </div>

      {loading && <p className="text-sm text-slate-500">Cargando análisis…</p>}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {datos && vista === 'global' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Propuestas tramitadas', value: datos.kpis.propuestasTramitadas },
              { label: 'Pedidos SAP emitidos', value: datos.kpis.pedidosSapEmitidos },
              { label: 'Pedidos recibidos', value: datos.kpis.pedidosSapRecibidos },
              { label: 'Pedidos pendientes', value: datos.kpis.pedidosSapPendientes },
              { label: 'Con reclamación', value: datos.kpis.pedidosReclamados },
              {
                label: 'Lead time mediano',
                value: datos.kpis.leadTimeMedianoDias != null ? `${datos.kpis.leadTimeMedianoDias} d` : '—',
              },
            ].map((k) => (
              <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">{k.label}</p>
                <p className="mt-1 text-2xl font-bold text-slate-800 tabular-nums">{k.value}</p>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">Propuestas tramitadas (nº pedidos / semana)</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartPropuestas}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="nPedidos" name="Propuestas" fill="#0d9488" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">Pedidos SAP emitidos vs recibidos (semana)</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartSap}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="emitidos" name="Emitidos" fill="#0369a1" radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="recibidos" name="Recibidos" stroke="#7c3aed" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <h2 className="px-4 py-3 text-sm font-semibold text-slate-700 border-b border-slate-100">Top 10 medicamentos (nº pedidos)</h2>
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Medicamento</th>
                    <th className="px-3 py-2 text-center">Pedidos</th>
                    <th className="px-3 py-2 text-center">Pend.</th>
                    <th className="px-3 py-2 text-center">Recl.</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.topMedicamentos.map((m) => (
                    <tr
                      key={m.cn}
                      className="border-t border-slate-100 hover:bg-teal-50/50 cursor-pointer"
                      onClick={() => {
                        setCnSel(m.cn);
                        setVista('medicamento');
                      }}
                    >
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs text-slate-400">{m.cn}</span>
                        <p className="font-medium text-slate-800">{m.principioActivo || m.nombre}</p>
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">{m.nPedidos}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{m.nPendientes}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{m.nReclamados}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <h2 className="px-4 py-3 text-sm font-semibold text-slate-700 border-b border-slate-100">Top 10 proveedores (nº pedidos)</h2>
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Proveedor</th>
                    <th className="px-3 py-2 text-center">Pedidos</th>
                    <th className="px-3 py-2 text-center">CN dist.</th>
                    <th className="px-3 py-2 text-center">Recl.</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.topProveedores.map((p) => (
                    <tr
                      key={p.proveedor}
                      className="border-t border-slate-100 hover:bg-teal-50/50 cursor-pointer"
                      onClick={() => {
                        setProveedorSel(p.proveedor);
                        setVista('proveedor');
                      }}
                    >
                      <td className="px-3 py-2 font-medium text-slate-800">{p.proveedor}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{p.nPedidos}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{p.nCnsDistintos}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{p.nReclamados}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {datos && vista === 'medicamento' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-slate-600">
              CN
              <input
                value={cnSel}
                onChange={(e) => setCnSel(e.target.value)}
                placeholder="ej. 731343"
                className="ml-2 rounded border border-slate-200 px-2 py-1.5 text-sm w-28 font-mono"
              />
            </label>
            <select
              value={cnSel}
              onChange={(e) => setCnSel(e.target.value)}
              className="rounded border border-slate-200 px-2 py-1.5 text-sm min-w-[220px]"
            >
              <option value="">— Elegir del top —</option>
              {datos.topMedicamentos.map((m) => (
                <option key={m.cn} value={m.cn}>
                  {m.cn} · {m.principioActivo || m.nombre}
                </option>
              ))}
            </select>
          </div>

          {!cnSel && (
            <p className="text-sm text-slate-500">Selecciona un medicamento para ver el detalle por semanas.</p>
          )}

          {datos.medicamentoDetalle && (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                <p className="font-semibold text-slate-800">
                  {datos.medicamentoDetalle.principioActivo || datos.medicamentoDetalle.nombre}
                </p>
                <p className="text-xs text-slate-500 font-mono">CN {datos.medicamentoDetalle.cn}</p>
                <IncidenciasBadges inc={datos.medicamentoDetalle.incidencias} />
                <p className="text-sm text-slate-600">
                  {datos.medicamentoDetalle.nPedidos} pedidos · lead time mediano{' '}
                  {datos.medicamentoDetalle.leadTimeMedianoDias != null
                    ? `${datos.medicamentoDetalle.leadTimeMedianoDias} días`
                    : '—'}
                </p>
              </div>

              {datos.medicamentoDetalle.semanas.map((sem) => (
                <div key={sem.semanaKey} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex justify-between text-sm">
                    <span className="font-semibold text-slate-700">{sem.label}</span>
                    <span className="text-slate-500">
                      {sem.nPedidos} pedidos · {sem.cajas} cajas (este CN)
                    </span>
                  </div>
                  <table className="min-w-full text-xs">
                    <thead className="text-slate-500 uppercase">
                      <tr>
                        <th className="px-3 py-2 text-left">Documento</th>
                        <th className="px-3 py-2 text-left">Proveedor</th>
                        <th className="px-3 py-2 text-center">Emisión</th>
                        <th className="px-3 py-2 text-center">Recepción</th>
                        <th className="px-3 py-2 text-center">Días</th>
                        <th className="px-3 py-2 text-center">Cajas</th>
                        <th className="px-3 py-2 text-center">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sem.pedidos.map((p) => (
                        <tr key={p.id} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-mono">{p.documentoCompras}/{p.posicion}</td>
                          <td className="px-3 py-2">{p.proveedorNombre ?? '—'}</td>
                          <td className="px-3 py-2 text-center">{fmtDate(p.fechaDocumento)}</td>
                          <td className="px-3 py-2 text-center">{p.recibidoAt ? fmtDate(p.recibidoAt) : '—'}</td>
                          <td className="px-3 py-2 text-center tabular-nums">{p.leadTimeDias ?? '—'}</td>
                          <td className="px-3 py-2 text-center tabular-nums">{p.cajas}</td>
                          <td className="px-3 py-2 text-center">
                            {p.reclamado && <span className="text-red-600 font-medium">Reclamado</span>}
                            {!p.reclamado && p.recibido && <span className="text-teal-700">Recibido</span>}
                            {!p.reclamado && !p.recibido && <span className="text-amber-700">Pendiente</span>}
                            {p.estadoRespuesta && (
                              <span className="block text-[10px] text-slate-400">{p.estadoRespuesta}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {datos && vista === 'proveedor' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <select
              value={proveedorSel}
              onChange={(e) => setProveedorSel(e.target.value)}
              className="rounded border border-slate-200 px-2 py-1.5 text-sm min-w-[280px]"
            >
              <option value="">— Elegir proveedor —</option>
              {datos.topProveedores.map((p) => (
                <option key={p.proveedor} value={p.proveedor}>
                  {p.proveedor}
                </option>
              ))}
            </select>
          </div>

          {!proveedorSel && (
            <p className="text-sm text-slate-500">Selecciona un proveedor para ver la evolución semanal por CN.</p>
          )}

          {datos.proveedorDetalle && (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="font-semibold text-slate-800">{datos.proveedorDetalle.proveedor}</p>
                <p className="text-sm text-slate-600 mt-1">
                  {datos.proveedorDetalle.nPedidos} pedidos · {datos.proveedorDetalle.nReclamados} reclamados ·
                  lead time mediano{' '}
                  {datos.proveedorDetalle.leadTimeMedianoDias != null
                    ? `${datos.proveedorDetalle.leadTimeMedianoDias} días`
                    : '—'}
                </p>
              </div>

              {datos.proveedorDetalle.semanas.map((sem) => (
                <div key={sem.semanaKey} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 font-semibold text-sm text-slate-700">
                    {sem.label}
                  </div>
                  <table className="min-w-full text-sm">
                    <thead className="bg-white text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">CN</th>
                        <th className="px-3 py-2 text-left">Medicamento</th>
                        <th className="px-3 py-2 text-center">Nº pedidos</th>
                        <th className="px-3 py-2 text-center">Cajas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sem.porCn.map((row) => (
                        <tr key={row.cn} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-mono text-xs">{row.cn}</td>
                          <td className="px-3 py-2">{row.nombre}</td>
                          <td className="px-3 py-2 text-center tabular-nums">{row.nPedidos}</td>
                          <td className="px-3 py-2 text-center tabular-nums">{row.cajas}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
