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
  ReferenceLine,
  Cell,
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

function fmtNum(n: number): string {
  return n.toLocaleString('es-ES');
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

function SemanaTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ payload?: Record<string, unknown> }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  const lunes = typeof row.lunesRef === 'string' ? row.lunesRef : '';
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-semibold text-slate-800">{label}</p>
      {lunes && <p className="text-slate-500">Lunes: {lunes.split('-').reverse().join('/')}</p>}
      {payload.map((p, i) => {
        const entry = p as { name?: string; value?: number; color?: string };
        if (entry.value == null) return null;
        return (
          <p key={i} style={{ color: entry.color }} className="tabular-nums">
            {entry.name}: {fmtNum(Number(entry.value))}
          </p>
        );
      })}
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
  const [filtroMed, setFiltroMed] = useState('');

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

  const medicamentosFiltrados = useMemo(() => {
    if (!datos) return [];
    const q = filtroMed.trim().toLowerCase();
    if (!q) return datos.medicamentos;
    return datos.medicamentos.filter(
      (m) =>
        m.cn.includes(q) ||
        m.nombre.toLowerCase().includes(q) ||
        m.principioActivo.toLowerCase().includes(q)
    );
  }, [datos, filtroMed]);

  const chartActividad = datos?.semanalActividad ?? [];
  const chartSap = datos?.semanalSap ?? [];

  const medChartPedidos = useMemo(() => {
    const det = datos?.medicamentoDetalle;
    if (!det) return [];
    return det.semanas.map((s) => ({ ...s }));
  }, [datos?.medicamentoDetalle]);

  const medChartStock = useMemo(() => {
    const det = datos?.medicamentoDetalle;
    if (!det) return [];
    return det.semanas
      .filter((s) => s.tienePropuesta)
      .map((s) => ({
        label: s.label,
        lunesRef: s.lunesRef,
        stockActual: s.stockActual ?? 0,
        stockMinimo: s.stockMinimo ?? det.stockMinimo,
        puntoPedido: s.puntoPedido ?? det.puntoPedido,
        stockMaximo: s.stockMaximo ?? det.stockMaximo ?? 0,
        bajoMinimo: s.bajoMinimo,
        enPuntoPedido: s.enPuntoPedido,
        superaMaximo: s.superaMaximo,
      }));
  }, [datos?.medicamentoDetalle]);

  const medChartComparativa = useMemo(() => {
    const det = datos?.medicamentoDetalle;
    if (!det) return [];
    return det.semanas
      .filter((s) => s.tienePropuesta || s.cajasPedidas > 0)
      .map((s) => ({
        label: s.label,
        lunesRef: s.lunesRef,
        cajasSap: s.cajasPedidas,
        cajasPropuesta: s.cajasPropuesta ?? 0,
        tienePropuesta: s.tienePropuesta,
      }));
  }, [datos?.medicamentoDetalle]);

  const provChartSemanal = datos?.proveedorDetalle?.semanas ?? [];
  const provChartMeds = useMemo(() => {
    const meds = datos?.proveedorDetalle?.medicamentos ?? [];
    return meds.slice(0, 15).map((m) => ({
      nombre: m.nombre.length > 28 ? `${m.nombre.slice(0, 26)}…` : m.nombre,
      cn: m.cn,
      cajas: m.cajas,
      nPedidos: m.nPedidos,
    }));
  }, [datos?.proveedorDetalle]);

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Análisis de compras</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Pacientes Externos · cantidades en cajas (SAP en uds, convertidas con uds/caja)
            </p>
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            {[
              { label: 'Propuestas tramitadas', value: datos.kpis.propuestasTramitadas },
              { label: 'Pedidos SAP emitidos', value: datos.kpis.pedidosSapEmitidos },
              { label: 'Cajas pedidas (SAP)', value: datos.kpis.cajasPedidas },
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
              <h2 className="text-sm font-semibold text-slate-700 mb-1">
                Actividad semanal (SAP vs propuestas)
              </h2>
              <p className="text-[11px] text-slate-400 mb-3">Eje X: lunes de la semana ISO</p>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartActividad}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" angle={-35} textAnchor="end" height={55} />
                    <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip content={<SemanaTooltip />} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="nPedidosSap" name="Pedidos SAP" fill="#0369a1" radius={[4, 4, 0, 0]} />
                    <Bar yAxisId="left" dataKey="nPropuestas" name="Propuestas" fill="#0d9488" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="cajasSap" name="Cajas SAP" stroke="#7c3aed" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="cajasPropuesta" name="Cajas propuesta" stroke="#ea580c" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-700 mb-1">Pedidos SAP emitidos vs recibidos</h2>
              <p className="text-[11px] text-slate-400 mb-3">Eje X: lunes de la semana ISO · cajas emitidas</p>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartSap}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" angle={-35} textAnchor="end" height={55} />
                    <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip content={<SemanaTooltip />} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="emitidos" name="Emitidos" fill="#0369a1" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="left" type="monotone" dataKey="recibidos" name="Recibidos" stroke="#7c3aed" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="cajasEmitidas" name="Cajas emitidas" stroke="#0d9488" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-700">
                  Medicamentos ({datos.medicamentos.length})
                </h2>
                <input
                  type="search"
                  placeholder="Filtrar CN o nombre…"
                  value={filtroMed}
                  onChange={(e) => setFiltroMed(e.target.value)}
                  className="rounded border border-slate-200 px-2 py-1 text-xs w-44"
                />
              </div>
              <div className="max-h-96 overflow-y-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Medicamento</th>
                      <th className="px-3 py-2 text-center">Pedidos</th>
                      <th className="px-3 py-2 text-center">Cajas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {medicamentosFiltrados.map((m) => (
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
                        <td className="px-3 py-2 text-center tabular-nums">{m.nCajas}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <h2 className="px-4 py-3 text-sm font-semibold text-slate-700 border-b border-slate-100">
                Proveedores ({datos.proveedores.length})
              </h2>
              <div className="max-h-96 overflow-y-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Proveedor</th>
                      <th className="px-3 py-2 text-center">Pedidos</th>
                      <th className="px-3 py-2 text-center">Cajas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.proveedores.map((p) => (
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
                        <td className="px-3 py-2 text-center tabular-nums">{p.nCajas}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
              className="rounded border border-slate-200 px-2 py-1.5 text-sm min-w-[280px]"
            >
              <option value="">— Elegir medicamento —</option>
              {datos.medicamentos.map((m) => (
                <option key={m.cn} value={m.cn}>
                  {m.cn} · {m.principioActivo || m.nombre}
                </option>
              ))}
            </select>
          </div>

          {!cnSel && (
            <p className="text-sm text-slate-500">
              Selecciona un medicamento para ver el análisis de pedidos y umbrales de stock.
            </p>
          )}

          {datos.medicamentoDetalle && (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                <p className="font-semibold text-slate-800">
                  {datos.medicamentoDetalle.principioActivo || datos.medicamentoDetalle.nombre}
                </p>
                <p className="text-xs text-slate-500 font-mono">
                  CN {datos.medicamentoDetalle.cn} · {datos.medicamentoDetalle.unidadesPorCaja} uds/caja
                </p>
                <IncidenciasBadges inc={datos.medicamentoDetalle.incidencias} />
                <p className="text-sm text-slate-600">
                  {datos.medicamentoDetalle.nPedidos} pedidos · {datos.medicamentoDetalle.nCajas} cajas · lead time mediano{' '}
                  {datos.medicamentoDetalle.leadTimeMedianoDias != null
                    ? `${datos.medicamentoDetalle.leadTimeMedianoDias} días`
                    : '—'}
                </p>
                <p className="text-xs text-slate-500">
                  Umbrales catálogo (cajas): mín. {datos.medicamentoDetalle.stockMinimo} · punto pedido{' '}
                  {datos.medicamentoDetalle.puntoPedido}
                  {datos.medicamentoDetalle.stockMaximo != null &&
                    ` · máx. ${datos.medicamentoDetalle.stockMaximo}`}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="text-sm font-semibold text-slate-700 mb-1">Cajas pedidas por semana (SAP)</h2>
                <p className="text-[11px] text-slate-400 mb-3">
                  Líneas de referencia: stock mínimo y punto de pedido (cajas)
                </p>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={medChartPedidos}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" angle={-35} textAnchor="end" height={55} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip content={<SemanaTooltip />} />
                      <Legend />
                      <ReferenceLine y={datos.medicamentoDetalle.stockMinimo} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Mín.', fontSize: 10, fill: '#ef4444' }} />
                      <ReferenceLine y={datos.medicamentoDetalle.puntoPedido} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'P.P.', fontSize: 10, fill: '#f59e0b' }} />
                      {datos.medicamentoDetalle.stockMaximo != null && (
                        <ReferenceLine y={datos.medicamentoDetalle.stockMaximo} stroke="#6366f1" strokeDasharray="4 4" label={{ value: 'Máx.', fontSize: 10, fill: '#6366f1' }} />
                      )}
                      <Bar dataKey="cajasPedidas" name="Cajas pedidas" fill="#0369a1" radius={[4, 4, 0, 0]} />
                      <Line type="monotone" dataKey="nPedidosSap" name="Nº pedidos" stroke="#0d9488" strokeWidth={2} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {medChartStock.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h2 className="text-sm font-semibold text-slate-700 mb-1">
                    Stock en semana de propuesta vs umbrales
                  </h2>
                  <p className="text-[11px] text-slate-400 mb-3">
                    Snapshot al tramitar propuesta · rojo = bajo mínimo · ámbar = en punto pedido
                  </p>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={medChartStock}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" angle={-35} textAnchor="end" height={55} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip content={<SemanaTooltip />} />
                        <Legend />
                        <Bar dataKey="stockActual" name="Stock actual (cajas)">
                          {medChartStock.map((entry, i) => (
                            <Cell
                              key={i}
                              fill={entry.bajoMinimo ? '#ef4444' : entry.enPuntoPedido ? '#f59e0b' : entry.superaMaximo ? '#6366f1' : '#0d9488'}
                            />
                          ))}
                        </Bar>
                        <Line type="monotone" dataKey="stockMinimo" name="Mínimo" stroke="#ef4444" strokeDasharray="4 4" dot={false} />
                        <Line type="monotone" dataKey="puntoPedido" name="Punto pedido" stroke="#f59e0b" strokeDasharray="4 4" dot={false} />
                        <Line type="monotone" dataKey="stockMaximo" name="Máximo" stroke="#6366f1" strokeDasharray="4 4" dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {medChartComparativa.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h2 className="text-sm font-semibold text-slate-700 mb-1">Propuesta vs SAP (cajas / semana)</h2>
                  <p className="text-[11px] text-slate-400 mb-3">
                    Comparación cuando hay propuesta tramitada en esa semana
                  </p>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={medChartComparativa}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" angle={-35} textAnchor="end" height={55} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip content={<SemanaTooltip />} />
                        <Legend />
                        <Bar dataKey="cajasSap" name="Cajas SAP" fill="#0369a1" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="cajasPropuesta" name="Cajas propuesta" fill="#ea580c" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {medChartStock.length === 0 && medChartPedidos.length === 0 && (
                <p className="text-sm text-slate-500">Sin actividad de pedidos ni propuestas en el periodo.</p>
              )}
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
              {datos.proveedores.map((p) => (
                <option key={p.proveedor} value={p.proveedor}>
                  {p.proveedor}
                </option>
              ))}
            </select>
          </div>

          {!proveedorSel && (
            <p className="text-sm text-slate-500">Selecciona un proveedor para ver la evolución de pedidos.</p>
          )}

          {datos.proveedorDetalle && (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="font-semibold text-slate-800">{datos.proveedorDetalle.proveedor}</p>
                <p className="text-sm text-slate-600 mt-1">
                  {datos.proveedorDetalle.nPedidos} pedidos · {datos.proveedorDetalle.nCajas} cajas ·{' '}
                  {datos.proveedorDetalle.nReclamados} reclamados · lead time mediano{' '}
                  {datos.proveedorDetalle.leadTimeMedianoDias != null
                    ? `${datos.proveedorDetalle.leadTimeMedianoDias} días`
                    : '—'}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="text-sm font-semibold text-slate-700 mb-1">Evolución semanal (cajas y pedidos)</h2>
                <p className="text-[11px] text-slate-400 mb-3">Lunes de referencia en eje X</p>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={provChartSemanal}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" angle={-35} textAnchor="end" height={55} />
                      <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="right" orientation="right" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip content={<SemanaTooltip />} />
                      <Legend />
                      <Bar yAxisId="left" dataKey="nPedidos" name="Nº pedidos" fill="#0369a1" radius={[4, 4, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="cajas" name="Cajas" stroke="#7c3aed" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {provChartMeds.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h2 className="text-sm font-semibold text-slate-700 mb-1">Medicamentos del proveedor (cajas)</h2>
                  <p className="text-[11px] text-slate-400 mb-3">Top 15 por cajas pedidas en el periodo</p>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={provChartMeds} layout="vertical" margin={{ left: 8, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="nombre" width={140} tick={{ fontSize: 10 }} />
                        <Tooltip
                          formatter={(value, name) => [fmtNum(Number(value)), name === 'cajas' ? 'Cajas' : String(name)]}
                          labelFormatter={(_, payload) => {
                            const row = payload?.[0]?.payload as { cn?: string } | undefined;
                            return row?.cn ? `CN ${row.cn}` : '';
                          }}
                        />
                        <Bar dataKey="cajas" name="Cajas" fill="#0d9488" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
