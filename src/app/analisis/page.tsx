'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import {
  type DiagnosticoGrupo,
  type Servicio,
  GRUPO_LABELS,
  GRUPO_COLORS,
  GRUPOS_ONCOLOGIA,
  GRUPOS_HEMATOLOGIA,
  gruposParaServicio,
} from '@/lib/diagnostico-grupos';
import type {
  AnalisisDatos, GrupoCard, TopMed, GrupoDetalle, DiagnosticoDetalle,
} from '@/lib/analisis-neon';

// ---------------------------------------------------------------------------
// Helpers de formato
// ---------------------------------------------------------------------------
function fmtEur(n: number): string {
  return n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}
function fmtNum(n: number): string {
  return n.toLocaleString('es-ES', { maximumFractionDigits: 1 });
}
function fmtDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function defaultDesde(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}
function defaultHasta(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-800 tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function GrupoCardUI({
  g,
  selected,
  onClick,
}: {
  g: GrupoCard;
  selected: boolean;
  onClick: () => void;
}) {
  const c = GRUPO_COLORS[g.grupo];
  return (
    <button
      onClick={onClick}
      className={[
        'relative w-full rounded-xl border p-4 text-left transition-all duration-200 shadow-sm',
        selected
          ? `${c.bg} ${c.ring} ring-2 shadow-md`
          : 'border-slate-200 bg-white hover:shadow-md hover:border-slate-300',
      ].join(' ')}
    >
      {/* % gasto badge */}
      <span className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-bold ${c.bg} ${c.text}`}>
        {Math.round(g.pctGasto)}%
      </span>

      <p className={`text-sm font-bold ${selected ? c.text : 'text-slate-700'}`}>{g.label}</p>
      <p className="mt-2 text-xl font-bold text-slate-800 tabular-nums">{fmtEur(g.totalGasto)}</p>
      <div className="mt-2 flex gap-3 text-[11px] text-slate-500">
        <span>{fmtNum(g.totalPreparaciones)} prep.</span>
        <span>·</span>
        <span>{g.medicamentosDistintos} fármacos</span>
        <span>·</span>
        <span>{g.protocolosActivos} protocolos</span>
      </div>

      {/* Barra de % */}
      <div className="mt-3 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${c.bg.replace('50', '400').replace('100', '500')}`}
          style={{ width: `${Math.min(g.pctGasto, 100)}%` }}
        />
      </div>
    </button>
  );
}

function TopMedRow({ m, rank }: { m: TopMed; rank: number }) {
  const [open, setOpen] = useState(false);
  const c = GRUPO_COLORS[m.grupo];
  return (
    <>
      <tr
        className="cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <td className="px-3 py-2.5 text-xs font-bold text-slate-400 tabular-nums">{rank}</td>
        <td className="px-3 py-2.5">
          <p className="text-sm font-semibold text-slate-800">{m.principioActivo || '—'}</p>
          <p className="text-xs text-slate-400 italic">{m.nombre || '—'}</p>
        </td>
        <td className="px-3 py-2.5 text-xs">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${c.bg} ${c.text} ${c.ring}`}>
            {GRUPO_LABELS[m.grupo]}
          </span>
        </td>
        <td className="px-3 py-2.5 text-right text-sm font-bold text-slate-800 tabular-nums">{fmtEur(m.totalGasto)}</td>
        <td className="px-3 py-2.5 text-right text-xs text-slate-500 tabular-nums">{fmtNum(m.totalPreparaciones)}</td>
        <td className="px-3 py-2.5 text-right text-xs text-slate-500 tabular-nums">{fmtNum(m.totalViales)}</td>
        <td className="px-3 py-2.5 text-right text-xs text-slate-400">
          {open ? '▲' : '▼'}
        </td>
      </tr>
      {open && m.temporalSemanal.length > 0 && (
        <tr>
          <td colSpan={7} className="bg-slate-50 px-6 pb-4 pt-2">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Evolución semanal — gasto (€)</p>
            <ResponsiveContainer width="100%" height={120}>
              <ComposedChart data={m.temporalSemanal} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis tickFormatter={v => fmtEur(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} width={70} />
                <Tooltip formatter={(v: unknown) => fmtEur(Number(v ?? 0))} />
                <Bar dataKey="gasto" name="Gasto (€)" fill={c.chart} radius={[3, 3, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </td>
        </tr>
      )}
    </>
  );
}

function DiagnosticoAccordion({ dx }: { dx: DiagnosticoDetalle }) {
  const [open, setOpen] = useState(false);
  const c = GRUPO_COLORS[dx.grupo];
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${c.bg} ${c.text} ${c.ring}`}>
            {GRUPO_LABELS[dx.grupo]}
          </span>
          <span className="text-sm font-semibold text-slate-800">{dx.diagnostico}</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="font-bold text-slate-800">{fmtEur(dx.totalGasto)}</span>
          <span>{dx.totalPreparaciones} prep.</span>
          <span>{dx.protocolos.length} protocolos</span>
          <span className="text-slate-400">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 divide-y divide-slate-100">
          {dx.protocolos.map(prot => (
            <div key={prot.protocolo} className="px-4 py-3 bg-white">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                  {prot.protocolo}
                </p>
                <div className="flex gap-4 text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{fmtEur(prot.totalGasto)}</span>
                  <span>{prot.totalPreparaciones} prep.</span>
                  <span>~{fmtNum(prot.mediaPackientesSemana)} pac./sem.</span>
                </div>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                    <th className="text-left py-1 font-medium w-[40%]">Principio activo / Marca</th>
                    <th className="text-right py-1 font-medium w-[20%]">Preparaciones</th>
                    <th className="text-right py-1 font-medium w-[15%]">Viales</th>
                    <th className="text-right py-1 font-medium w-[25%]">Gasto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {prot.medicamentos.map(med => (
                    <tr key={med.cn} className="hover:bg-slate-50">
                      <td className="py-1.5">
                        <p className="font-semibold text-slate-800">{med.principioActivo || '—'}</p>
                        <p className="text-slate-400 italic text-[10px]">{med.nombre || ''}</p>
                      </td>
                      <td className="py-1.5 text-right text-slate-600 tabular-nums">{med.totalPreparaciones}</td>
                      <td className="py-1.5 text-right text-slate-600 tabular-nums">{fmtNum(med.totalViales)}</td>
                      <td className="py-1.5 text-right font-semibold text-slate-800 tabular-nums">{fmtEur(med.totalGasto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GrupoDetallePanel({ gd, chartColor }: { gd: GrupoDetalle; chartColor: string }) {
  return (
    <div className="space-y-6">
      {/* KPIs del grupo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard label="Gasto total" value={fmtEur(gd.kpis.totalGasto)} />
        <KpiCard label="Preparaciones" value={fmtNum(gd.kpis.totalPreparaciones)} />
        <KpiCard label="Viales" value={fmtNum(gd.kpis.totalViales)} />
        <KpiCard label="Pac. estimados/sem." value={fmtNum(gd.kpis.mediaPackientesSemana)} sub="Suma dispensaciones por semana" />
      </div>

      {/* Evolución semanal — gráfico */}
      {gd.temporal.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Evolución semanal — preparaciones y gasto</h3>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={gd.temporal} margin={{ top: 4, right: 60, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={v => fmtEur(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} width={72} />
              <Tooltip
                formatter={(value: unknown, name: unknown) => {
                  const v = Number(value ?? 0);
                  return name === 'Gasto (€)' ? fmtEur(v) : fmtNum(v);
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="preparaciones" name="Preparaciones" fill={chartColor} fillOpacity={0.7} radius={[3, 3, 0, 0]} />
              <Line yAxisId="right" dataKey="gasto" name="Gasto (€)" stroke="#1e3a5f" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Top 10 meds del grupo */}
      {gd.topMedicamentos.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">Top 10 medicamentos por gasto</h3>
          </div>
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2 text-left w-8">#</th>
                <th className="px-3 py-2 text-left">Medicamento</th>
                <th className="px-3 py-2 text-right">Gasto</th>
                <th className="px-3 py-2 text-right">Prep.</th>
                <th className="px-3 py-2 text-right">Viales</th>
                <th className="px-3 py-2 w-6" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {gd.topMedicamentos.map((m, i) => (
                <tr key={m.cn} className={i % 2 === 1 ? 'bg-slate-50/50' : ''}>
                  <td className="px-3 py-2.5 text-xs font-bold text-slate-400">{i + 1}</td>
                  <td className="px-3 py-2.5">
                    <p className="text-sm font-semibold text-slate-800">{m.principioActivo || '—'}</p>
                    <p className="text-xs text-slate-400 italic">{m.nombre || ''}</p>
                  </td>
                  <td className="px-3 py-2.5 text-right text-sm font-bold text-slate-800 tabular-nums">{fmtEur(m.totalGasto)}</td>
                  <td className="px-3 py-2.5 text-right text-xs text-slate-500 tabular-nums">{fmtNum(m.totalPreparaciones)}</td>
                  <td className="px-3 py-2.5 text-right text-xs text-slate-500 tabular-nums">{fmtNum(m.totalViales)}</td>
                  <td className="px-3 py-2.5" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Diagnósticos */}
      {gd.diagnosticos.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">
            Diagnósticos y protocolos
            <span className="ml-2 text-xs font-normal text-slate-400">(ordenados por gasto — haz clic para desplegar)</span>
          </h3>
          <div className="space-y-2">
            {gd.diagnosticos.map(dx => (
              <DiagnosticoAccordion key={dx.diagnostico} dx={dx} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------
export default function AnalisisPage() {
  const [servicio, setServicio] = useState<Servicio>('oncologia-solida');
  const [grupoSeleccionado, setGrupoSeleccionado] = useState<DiagnosticoGrupo | null>(null);
  const [desde, setDesde] = useState(defaultDesde());
  const [hasta, setHasta]  = useState(defaultHasta());
  const [datos, setDatos]  = useState<AnalisisDatos | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]    = useState<string | null>(null);

  const fetchDatos = useCallback(async (grupo?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ desde, hasta });
      if (grupo) params.set('grupo', grupo);
      const res = await fetch(`/api/analisis/datos?${params}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(j.error ?? 'Error del servidor');
      }
      setDatos(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, [desde, hasta]);

  // Fetch al montar y al cambiar período
  useEffect(() => {
    fetchDatos(grupoSeleccionado);
  }, [fetchDatos]);  // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelectGrupo(g: DiagnosticoGrupo) {
    const nuevo = grupoSeleccionado === g ? null : g;
    setGrupoSeleccionado(nuevo);
    fetchDatos(nuevo);
  }

  function handleAplicarPeriodo() {
    fetchDatos(grupoSeleccionado);
  }

  function handleExportar() {
    const params = new URLSearchParams({ desde, hasta });
    if (grupoSeleccionado) params.set('grupo', grupoSeleccionado);
    window.open(`/api/analisis/exportar?${params}`, '_blank');
  }

  const gruposDelServicio = gruposParaServicio(servicio);
  const tarjetas = datos?.grupos.filter(g => gruposDelServicio.includes(g.grupo)) ?? [];

  const chartColor = grupoSeleccionado
    ? GRUPO_COLORS[grupoSeleccionado].chart
    : '#1e3a5f';

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">

      {/* ── Cabecera ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Análisis de consumo</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Medicamentos preparados y administrados en Farmacia · Oncología
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Período */}
          <label className="text-xs text-slate-500">Desde</label>
          <input
            type="date" value={desde} onChange={e => setDesde(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
          <label className="text-xs text-slate-500">Hasta</label>
          <input
            type="date" value={hasta} onChange={e => setHasta(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
          <button
            onClick={handleAplicarPeriodo}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-teal-700 transition-colors"
          >
            Aplicar
          </button>

          {/* Exportar */}
          <button
            onClick={handleExportar}
            disabled={!datos}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-40 transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Exportar Excel
          </button>
        </div>
      </div>

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Loading ───────────────────────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
          <span className="ml-3 text-sm text-slate-500">Cargando análisis…</span>
        </div>
      )}

      {!loading && datos && (
        <>
          {/* ── KPIs globales ───────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Gasto total" value={fmtEur(datos.kpis.totalGasto)} />
            <KpiCard label="Preparaciones" value={fmtNum(datos.kpis.totalPreparaciones)} />
            <KpiCard label="Viales" value={fmtNum(datos.kpis.totalViales)} />
            <KpiCard
              label="Pac. est./semana"
              value={fmtNum(datos.kpis.mediaPackientesSemana)}
              sub="Suma dispensaciones por semana"
            />
            <KpiCard label="Protocolos activos" value={String(datos.kpis.protocolosActivos)} />
            <KpiCard label="Medicamentos" value={String(datos.kpis.medicamentosDistintos)} />
          </div>

          {/* ── Selector de servicio ────────────────────────────────────── */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Servicio:</span>
            {(['oncologia-solida', 'hematologia'] as Servicio[]).map(s => (
              <button
                key={s}
                onClick={() => { setServicio(s); setGrupoSeleccionado(null); }}
                className={[
                  'rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors',
                  servicio === s
                    ? 'bg-slate-800 text-white shadow'
                    : 'border border-slate-200 text-slate-600 hover:bg-slate-50',
                ].join(' ')}
              >
                {s === 'oncologia-solida' ? 'Oncología sólida' : 'Hematología'}
              </button>
            ))}
          </div>

          {/* ── Tarjetas de grupo ────────────────────────────────────────── */}
          {tarjetas.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
                Grupos tumorales — {fmtDate(desde)} al {fmtDate(hasta)}
                {grupoSeleccionado && (
                  <button
                    onClick={() => { setGrupoSeleccionado(null); fetchDatos(null); }}
                    className="ml-3 text-teal-600 hover:underline normal-case"
                  >
                    ✕ Ver todos
                  </button>
                )}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {tarjetas.map(g => (
                  <GrupoCardUI
                    key={g.grupo}
                    g={g}
                    selected={grupoSeleccionado === g.grupo}
                    onClick={() => handleSelectGrupo(g.grupo)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500">
              No hay datos de consumo para este período y servicio.
            </div>
          )}

          {/* ── Detalle de grupo seleccionado ───────────────────────────── */}
          {grupoSeleccionado && datos.grupoDetalle && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-5">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${GRUPO_COLORS[grupoSeleccionado].bg} ${GRUPO_COLORS[grupoSeleccionado].text} ${GRUPO_COLORS[grupoSeleccionado].ring}`}>
                    {GRUPO_LABELS[grupoSeleccionado]}
                  </span>
                  <h2 className="text-base font-bold text-slate-800">Análisis detallado</h2>
                </div>
                <button
                  onClick={handleExportar}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Exportar informe
                </button>
              </div>
              <GrupoDetallePanel gd={datos.grupoDetalle} chartColor={chartColor} />
            </div>
          )}

          {/* ── Top 10 global (cuando no hay grupo seleccionado) ─────────── */}
          {!grupoSeleccionado && datos.topMedicamentos.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">
                  Top 10 medicamentos por gasto — global
                </h3>
                <span className="text-xs text-slate-400">Haz clic para ver evolución semanal</span>
              </div>
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-2 text-left w-8">#</th>
                    <th className="px-3 py-2 text-left">Medicamento</th>
                    <th className="px-3 py-2 text-left">Grupo</th>
                    <th className="px-3 py-2 text-right">Gasto</th>
                    <th className="px-3 py-2 text-right">Prep.</th>
                    <th className="px-3 py-2 text-right">Viales</th>
                    <th className="px-3 py-2 w-6" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {datos.topMedicamentos.map((m, i) => (
                    <TopMedRow key={m.cn} m={m} rank={i + 1} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Evolución semanal global (cuando no hay grupo) ───────────── */}
          {!grupoSeleccionado && datos.temporal.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Evolución semanal global — preparaciones y gasto</h3>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={datos.temporal} margin={{ top: 4, right: 60, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={v => fmtEur(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} width={72} />
                  <Tooltip formatter={(v: unknown, n: unknown) => { const val = Number(v ?? 0); return n === 'Gasto (€)' ? fmtEur(val) : fmtNum(val); }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="preparaciones" name="Preparaciones" fill="#1e3a5f" fillOpacity={0.6} radius={[3, 3, 0, 0]} />
                  <Line yAxisId="right" dataKey="gasto" name="Gasto (€)" stroke="#0d9488" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Sin datos */}
          {!loading && datos.grupos.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500">
              No hay datos de consumo registrados para el período seleccionado.
              <br />
              <span className="text-xs text-slate-400">Importa datos de consumo en la pestaña Consumo.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
