'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import {
  type DiagnosticoGrupo,
  type Servicio,
  GRUPO_LABELS,
  GRUPO_COLORS,
  gruposParaServicio,
  GRUPO_ORDER,
} from '@/lib/diagnostico-grupos';
import type {
  AnalisisDatos, GrupoCard, TopMed, TopProtocolo,
  GrupoDetalle, DiagnosticoDetalle, GastoAnual, IndicacionDetalle,
} from '@/lib/analisis-neon';
import { computeYoy } from '@/lib/analisis-neon';

// ---------------------------------------------------------------------------
// Helpers de formato
// ---------------------------------------------------------------------------
function fmtEur(n: number): string {
  return n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}
function fmtNum(n: number, dec = 1): string {
  return n.toLocaleString('es-ES', { maximumFractionDigits: dec });
}
function fmtDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function defaultDesde(): string {
  const d = new Date(); d.setFullYear(d.getFullYear() - 2); d.setMonth(0); d.setDate(1);
  return d.toISOString().slice(0, 10);
}
function defaultHasta(): string { return new Date().toISOString().slice(0, 10); }

// ---------------------------------------------------------------------------
// YoY badge (semáforo)
// ---------------------------------------------------------------------------
function YoyBadge({ pct, inverse = false }: { pct: number | null; inverse?: boolean }) {
  if (pct === null) return <span className="text-[10px] text-slate-400">sin dato YoY</span>;
  const down = pct < 0;
  const high = Math.abs(pct) > 10;

  // inverse=true: bajar es bueno (para gasto, subir es malo)
  const isGood  = inverse ? down : !down;
  const color   = isGood ? 'emerald' : (high ? 'red' : 'orange');
  const arrow   = down ? '▼' : '▲';

  const cls: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    red:     'bg-red-50 text-red-700 ring-red-200',
    orange:  'bg-orange-50 text-orange-700 ring-orange-200',
  };

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${cls[color]}`}>
      {arrow} {Math.abs(pct).toFixed(1)}% vs año ant.
    </span>
  );
}

// ---------------------------------------------------------------------------
// Mini barras anuales (dentro de tarjeta de grupo)
// ---------------------------------------------------------------------------
function MiniAnualBars({ data, color }: { data: { anio: number; gasto: number }[]; color: string }) {
  if (!data.length) return null;
  const max = Math.max(...data.map(d => d.gasto), 1);
  return (
    <div className="flex items-end gap-1 mt-3">
      {data.map(d => (
        <div key={d.anio} className="flex flex-col items-center gap-0.5 flex-1">
          <div
            className="w-full rounded-t-sm transition-all"
            style={{ height: `${Math.max(3, (d.gasto / max) * 32)}px`, backgroundColor: color + 'aa' }}
          />
          <span className="text-[8px] text-slate-400 tabular-nums">{d.anio}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------
function KpiCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border px-5 py-4 shadow-sm ${highlight ? 'border-teal-200 bg-teal-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${highlight ? 'text-teal-800' : 'text-slate-800'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tarjeta de grupo tumoral
// ---------------------------------------------------------------------------
function GrupoCardUI({ g, selected, onClick }: { g: GrupoCard; selected: boolean; onClick: () => void }) {
  const c = GRUPO_COLORS[g.grupo];
  return (
    <button
      onClick={onClick}
      className={[
        'relative w-full rounded-xl border p-4 text-left transition-all duration-200 shadow-sm',
        selected ? `${c.bg} ring-2 ${c.ring} shadow-md` : 'border-slate-200 bg-white hover:shadow-md hover:border-slate-300',
      ].join(' ')}
    >
      {/* YoY badge */}
      <div className="absolute right-2 top-2">
        <YoyBadge pct={g.variacionYoy} inverse />
      </div>

      <p className={`text-sm font-bold pr-20 ${selected ? c.text : 'text-slate-700'}`}>{g.label}</p>
      <p className="mt-1.5 text-xl font-bold text-slate-800 tabular-nums">{fmtEur(g.totalGasto)}</p>

      {/* Barra de % — proporcional al gasto total */}
      <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(g.pctGasto, 100)}%`, backgroundColor: c.chart }}
        />
      </div>
      <p className="mt-1 text-[10px] text-slate-400">{Math.round(g.pctGasto * 10) / 10}% del gasto total</p>

      {/* Mini barras anuales */}
      <MiniAnualBars data={g.gastoPorAnio} color={c.chart} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tabla Top 10 protocolos
// ---------------------------------------------------------------------------
function TopProtocolosTable({ data }: { data: TopProtocolo[] }) {
  if (!data.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
        <h3 className="text-sm font-semibold text-slate-700">Top 10 protocolos por gasto</h3>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-slate-400 bg-slate-50/50">
            <th className="px-3 py-2 text-left w-6">#</th>
            <th className="px-3 py-2 text-left">Protocolo</th>
            <th className="px-3 py-2 text-right">Gasto (€)</th>
            <th className="px-3 py-2 text-right">Preparaciones</th>
            <th className="px-3 py-2 text-right">€/prep.</th>
            <th className="px-3 py-2 text-right">Fármacos</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((p, i) => (
            <tr key={p.protocolo} className={i % 2 === 1 ? 'bg-slate-50/40' : ''}>
              <td className="px-3 py-2.5 font-bold text-slate-400">{i + 1}</td>
              <td className="px-3 py-2.5 font-semibold text-slate-800">{p.protocolo}</td>
              <td className="px-3 py-2.5 text-right font-bold text-slate-800 tabular-nums">{fmtEur(p.totalGasto)}</td>
              <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">{fmtNum(p.totalPreparaciones, 0)}</td>
              <td className="px-3 py-2.5 text-right text-slate-500 tabular-nums">{fmtEur(p.costePorPreparacion)}</td>
              <td className="px-3 py-2.5 text-right text-slate-400 tabular-nums">{p.medicamentosDistintos}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fila de Top 10 medicamentos (expandible)
// ---------------------------------------------------------------------------
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
          <p className="text-[11px] text-slate-400 italic">{m.nombre || ''}</p>
        </td>
        <td className="px-3 py-2.5">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${c.bg} ${c.text} ${c.ring}`}>
            {GRUPO_LABELS[m.grupo]}
          </span>
        </td>
        <td className="px-3 py-2.5 text-right text-sm font-bold text-slate-800 tabular-nums">{fmtEur(m.totalGasto)}</td>
        <td className="px-3 py-2.5 text-right text-xs text-slate-500 tabular-nums">{fmtNum(m.totalPreparaciones, 0)}</td>
        <td className="px-3 py-2.5 text-right text-xs text-slate-500 tabular-nums">{fmtNum(m.totalViales)}</td>
        <td className="px-3 py-2.5 text-right text-xs text-slate-500 tabular-nums">{fmtEur(m.costePorPreparacion)}</td>
        <td className="px-3 py-2.5"><YoyBadge pct={m.variacionYoy} inverse /></td>
        <td className="px-3 py-2.5 text-xs text-slate-400">{open ? '▲' : '▼'}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} className="bg-slate-50 px-6 pb-4 pt-2">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Evolución semanal — gasto (€)
            </p>
            {m.temporalSemanal.length > 0 ? (
              <ResponsiveContainer width="100%" height={120}>
                <ComposedChart data={m.temporalSemanal} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis tickFormatter={v => fmtEur(Number(v))} tick={{ fontSize: 10, fill: '#94a3b8' }} width={70} />
                  <Tooltip formatter={(v: unknown) => fmtEur(Number(v ?? 0))} />
                  <Bar dataKey="gasto" name="Gasto (€)" fill={c.chart} radius={[3, 3, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-slate-400">Sin datos en el período reciente (últimas semanas).</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Acordeón diagnóstico → indicación → protocolo
// ---------------------------------------------------------------------------
function ProtocoloRow({ prot }: { prot: import('@/lib/analisis-neon').ProtocoloDetalle }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-slate-100 bg-white">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-slate-50 transition-colors"
      >
        <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">{prot.protocolo}</span>
        <div className="flex items-center gap-4 text-xs">
          <span className="font-semibold text-slate-800">{fmtEur(prot.totalGasto)}</span>
          <span className="text-slate-500">{prot.totalPreparaciones} prep.</span>
          <span className="text-slate-400">{fmtEur(prot.costePorPreparacion)}/prep.</span>
          <span className="text-slate-400">~{fmtNum(prot.mediaPackientesSemana)} pac./sem.</span>
          <span className="text-slate-400 ml-2">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && prot.medicamentos.length > 0 && (
        <div className="border-t border-slate-50 px-4 pb-3 pt-2 bg-slate-50/50">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                <th className="text-left py-1 font-medium">Medicamento</th>
                <th className="text-right py-1 font-medium w-24">Preparaciones</th>
                <th className="text-right py-1 font-medium w-20">Viales</th>
                <th className="text-right py-1 font-medium w-28">Gasto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {prot.medicamentos.map(med => (
                <tr key={med.cn} className="hover:bg-white/70">
                  <td className="py-1.5">
                    <span className="font-semibold text-slate-800">{med.principioActivo || '—'}</span>
                    <span className="ml-2 text-slate-400 italic text-[10px]">{med.nombre || ''}</span>
                  </td>
                  <td className="py-1.5 text-right text-slate-600 tabular-nums">{med.totalPreparaciones}</td>
                  <td className="py-1.5 text-right text-slate-600 tabular-nums">{fmtNum(med.totalViales)}</td>
                  <td className="py-1.5 text-right font-semibold text-slate-800 tabular-nums">{fmtEur(med.totalGasto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function IndicacionSection({ ind }: { ind: IndicacionDetalle }) {
  const [open, setOpen] = useState(true); // indicaciones abiertas por defecto
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <span className="text-sm font-semibold text-slate-700">Indicación: {ind.indicacion}</span>
        <div className="flex items-center gap-3 text-xs">
          <span className="font-semibold text-slate-800">{fmtEur(ind.totalGasto)}</span>
          <span className="text-slate-400">{ind.totalPreparaciones} prep.</span>
          <span className="text-slate-400">{ind.protocolos.length} protocolos</span>
          <span className="text-slate-400">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="divide-y divide-slate-100 p-2 space-y-1">
          {ind.protocolos.map(prot => (
            <ProtocoloRow key={prot.protocolo} prot={prot} />
          ))}
        </div>
      )}
    </div>
  );
}

function DiagnosticoAccordion({ dx }: { dx: DiagnosticoDetalle }) {
  const [open, setOpen] = useState(false);
  const c = GRUPO_COLORS[dx.grupo];
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
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
          <span>{dx.indicaciones.length} indicaciones</span>
          <span className="text-slate-400">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-slate-100 p-3 space-y-2 bg-white">
          {dx.indicaciones.map(ind => (
            <IndicacionSection key={ind.indicacion} ind={ind} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gráfico temporal (histórico mensual o semanal reciente)
// ---------------------------------------------------------------------------
function TemporalChart({
  data,
  title,
  color = '#1e3a5f',
}: {
  data: import('@/lib/analisis-neon').TemporalPoint[];
  title: string;
  color?: string;
}) {
  if (!data.length) return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-6 py-8 text-center text-sm text-slate-400">
      {title} — sin datos en este período.
    </div>
  );
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 4, right: 60, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} />
          <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#94a3b8' }} />
          <YAxis yAxisId="right" orientation="right" tickFormatter={v => fmtEur(Number(v))} tick={{ fontSize: 10, fill: '#94a3b8' }} width={72} />
          <Tooltip formatter={(v: unknown, n: unknown) => { const val = Number(v ?? 0); return n === 'Gasto (€)' ? fmtEur(val) : fmtNum(val, 0); }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar yAxisId="left" dataKey="preparaciones" name="Preparaciones" fill={color} fillOpacity={0.65} radius={[3, 3, 0, 0]} />
          <Line yAxisId="right" dataKey="gasto" name="Gasto (€)" stroke="#0d9488" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gráfico anual de gasto global
// ---------------------------------------------------------------------------
function GastoAnualChart({ data }: { data: GastoAnual[] }) {
  if (!data.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700">Gasto total histórico · Oncología + Hematología</h3>
        <span className="text-xs text-slate-400">Todos los años disponibles en BD</span>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="anio" tick={{ fontSize: 11, fill: '#64748b' }} />
          <YAxis tickFormatter={v => fmtEur(Number(v))} tick={{ fontSize: 10, fill: '#94a3b8' }} width={76} />
          <Tooltip
            formatter={(v: unknown, n: unknown) => {
              const val = Number(v ?? 0);
              return n === 'Gasto (€)' ? fmtEur(val) : fmtNum(val, 0);
            }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]!.payload as GastoAnual;
              return (
                <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg text-xs">
                  <p className="font-bold text-slate-800 mb-1">{d.anio}</p>
                  <p className="text-slate-700">Gasto: <span className="font-semibold">{fmtEur(d.gasto)}</span></p>
                  <p className="text-slate-500">Preparaciones: {fmtNum(d.preparaciones, 0)}</p>
                  <p className="text-slate-500">€/preparación: {fmtEur(d.costePorPreparacion)}</p>
                  {d.variacionYoy !== null && (
                    <p className={`mt-1 font-semibold ${d.variacionYoy > 10 ? 'text-red-600' : d.variacionYoy < 0 ? 'text-emerald-600' : 'text-orange-600'}`}>
                      {d.variacionYoy > 0 ? '+' : ''}{d.variacionYoy.toFixed(1)}% vs año anterior
                    </p>
                  )}
                </div>
              );
            }}
          />
          <Bar dataKey="gasto" name="Gasto (€)" fill="#1e3a5f" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <rect
                key={d.anio}
                fill={d.variacionYoy != null && d.variacionYoy > 10 ? '#ef4444' :
                      d.variacionYoy != null && d.variacionYoy < 0 ? '#10b981' : '#1e3a5f'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {/* Leyenda de YoY debajo */}
      <div className="mt-3 flex flex-wrap gap-3 text-[10px]">
        {data.map(d => (
          <div key={d.anio} className="flex items-center gap-1.5">
            <span className="font-bold text-slate-600">{d.anio}:</span>
            <span className="text-slate-800 font-semibold">{fmtEur(d.gasto)}</span>
            {d.variacionYoy !== null && <YoyBadge pct={d.variacionYoy} inverse />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel de detalle del grupo
// ---------------------------------------------------------------------------
function GrupoDetallePanel({ gd }: { gd: GrupoDetalle }) {
  const c = GRUPO_COLORS[gd.grupo];

  return (
    <div className="space-y-5">
      {/* KPIs del grupo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Gasto total" value={fmtEur(gd.kpis.totalGasto)} highlight />
        <KpiCard label="Coste / preparación" value={fmtEur(gd.kpis.costePorPreparacion)} />
        <KpiCard label="Variación vs año ant." value={gd.kpis.variacionYoy !== null ? `${gd.kpis.variacionYoy > 0 ? '+' : ''}${gd.kpis.variacionYoy.toFixed(1)}%` : '—'} />
        <KpiCard label="Pac. est. / semana" value={fmtNum(gd.kpis.mediaPackientesSemana)} sub="Suma dispensaciones" />
      </div>

      {/* Evolución anual del grupo */}
      {gd.gastoPorAnio.length > 1 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h4 className="text-sm font-semibold text-slate-700 mb-3">Gasto anual — {gd.label}</h4>
          <div className="flex items-end gap-3">
            {gd.gastoPorAnio.map((ya, i) => {
              const max = Math.max(...gd.gastoPorAnio.map(d => d.gasto), 1);
              const yoy = i > 0 ? computeYoy(ya.gasto, gd.gastoPorAnio[i - 1]!.gasto) : null;
              return (
                <div key={ya.anio} className="flex flex-col items-center gap-1 flex-1">
                  <div className="text-xs font-bold text-slate-700">{fmtEur(ya.gasto)}</div>
                  {yoy !== null && <YoyBadge pct={yoy} inverse />}
                  <div
                    className="w-full rounded-t transition-all"
                    style={{ height: `${Math.max(8, (ya.gasto / max) * 80)}px`, backgroundColor: c.chart + 'cc' }}
                  />
                  <div className="text-xs font-semibold text-slate-500">{ya.anio}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Gráficos temporales: histórico + reciente */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TemporalChart
          data={gd.temporalHistorico}
          title="Evolución histórica mensual (hasta 3 meses atrás)"
          color={c.chart}
        />
        <TemporalChart
          data={gd.temporalReciente}
          title="Detalle semanal — últimas 12 semanas"
          color={c.chart + 'cc'}
        />
      </div>

      {/* Top 10 protocolos del grupo */}
      <TopProtocolosTable data={gd.topProtocolos} />

      {/* Top 10 medicamentos del grupo */}
      {gd.topMedicamentos.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Top 10 medicamentos por gasto</h3>
            <span className="text-xs text-slate-400">Haz clic para ver evolución semanal</span>
          </div>
          <table className="w-full">
            <thead className="bg-slate-50/50">
              <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2 text-left w-7">#</th>
                <th className="px-3 py-2 text-left">Medicamento</th>
                <th className="px-3 py-2 text-right">Gasto</th>
                <th className="px-3 py-2 text-right">Prep.</th>
                <th className="px-3 py-2 text-right">Viales</th>
                <th className="px-3 py-2 text-right">€/prep.</th>
                <th className="px-3 py-2">YoY</th>
                <th className="px-3 py-2 w-5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {gd.topMedicamentos.map((m, i) => (
                <tr key={m.cn} className={i % 2 === 1 ? 'bg-slate-50/30' : ''}>
                  <td className="px-3 py-2.5 text-xs font-bold text-slate-400">{i + 1}</td>
                  <td className="px-3 py-2.5">
                    <p className="text-sm font-semibold text-slate-800">{m.principioActivo || '—'}</p>
                    <p className="text-[11px] text-slate-400 italic">{m.nombre || ''}</p>
                  </td>
                  <td className="px-3 py-2.5 text-right text-sm font-bold text-slate-800 tabular-nums">{fmtEur(m.totalGasto)}</td>
                  <td className="px-3 py-2.5 text-right text-xs text-slate-500 tabular-nums">{fmtNum(m.totalPreparaciones, 0)}</td>
                  <td className="px-3 py-2.5 text-right text-xs text-slate-500 tabular-nums">{fmtNum(m.totalViales)}</td>
                  <td className="px-3 py-2.5 text-right text-xs text-slate-500 tabular-nums">{fmtEur(m.costePorPreparacion)}</td>
                  <td className="px-3 py-2.5"><YoyBadge pct={m.variacionYoy} inverse /></td>
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
            Diagnósticos — Indicaciones — Protocolos
            <span className="ml-2 text-xs font-normal text-slate-400">ordenados por gasto · haz clic para desplegar</span>
          </h3>
          <div className="space-y-2">
            {gd.diagnosticos.map(dx => <DiagnosticoAccordion key={dx.diagnostico} dx={dx} />)}
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
  const [hasta, setHasta] = useState(defaultHasta());
  const [datos, setDatos] = useState<AnalisisDatos | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDatos = useCallback(async (grupo?: string | null) => {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams({ desde, hasta });
      if (grupo) p.set('grupo', grupo);
      const res = await fetch(`/api/analisis/datos?${p}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((j as { error?: string }).error ?? 'Error del servidor');
      }
      setDatos(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, [desde, hasta]);

  useEffect(() => { fetchDatos(grupoSeleccionado); }, [fetchDatos]); // eslint-disable-line

  function handleSelectGrupo(g: DiagnosticoGrupo) {
    const nuevo = grupoSeleccionado === g ? null : g;
    setGrupoSeleccionado(nuevo);
    fetchDatos(nuevo);
  }

  function handleExportar() {
    const p = new URLSearchParams({ desde, hasta });
    if (grupoSeleccionado) p.set('grupo', grupoSeleccionado);
    window.open(`/api/analisis/exportar?${p}`, '_blank');
  }

  const gruposDelServicio = gruposParaServicio(servicio);
  const tarjetas = (datos?.grupos ?? []).filter(g => gruposDelServicio.includes(g.grupo));

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">

      {/* ── Cabecera ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Análisis farmaoeconómico</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Medicamentos preparados y administrados en Farmacia · <strong>Oncología + Hematología</strong>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-500">Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          <label className="text-xs text-slate-500">Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          <button onClick={() => fetchDatos(grupoSeleccionado)}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-teal-700 transition-colors">
            Aplicar
          </button>
          <button onClick={handleExportar} disabled={!datos}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-40 transition-colors">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Exportar Excel
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
          <span className="ml-3 text-sm text-slate-500">Cargando análisis…</span>
        </div>
      )}

      {!loading && datos && (
        <>
          {/* ── Gráfico gasto anual (siempre visible) ────────────────────── */}
          <GastoAnualChart data={datos.gastoPorAnio} />

          {/* ── KPIs globales del período seleccionado ───────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <KpiCard label="Gasto período" value={fmtEur(datos.kpis.totalGasto)} highlight />
            <KpiCard label="€ / preparación" value={fmtEur(datos.kpis.costePorPreparacion)} />
            <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">vs año anterior</p>
              <div className="mt-2"><YoyBadge pct={datos.kpis.variacionYoy} inverse /></div>
            </div>
            <KpiCard label="Preparaciones" value={fmtNum(datos.kpis.totalPreparaciones, 0)} />
            <KpiCard label="Protocolos activos" value={String(datos.kpis.protocolosActivos)} />
            <KpiCard label="Medicamentos" value={String(datos.kpis.medicamentosDistintos)} />
          </div>

          {/* ── Selector de servicio ────────────────────────────────────── */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Servicio:</span>
            {(['oncologia-solida', 'hematologia'] as Servicio[]).map(s => (
              <button key={s}
                onClick={() => { setServicio(s); setGrupoSeleccionado(null); }}
                className={[
                  'rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors',
                  servicio === s ? 'bg-slate-800 text-white shadow' : 'border border-slate-200 text-slate-600 hover:bg-slate-50',
                ].join(' ')}>
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
                  <button onClick={() => { setGrupoSeleccionado(null); fetchDatos(null); }}
                    className="ml-3 text-teal-600 hover:underline normal-case">
                    ✕ Ver todos
                  </button>
                )}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {tarjetas.map(g => (
                  <GrupoCardUI key={g.grupo} g={g} selected={grupoSeleccionado === g.grupo} onClick={() => handleSelectGrupo(g.grupo)} />
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
                <button onClick={handleExportar}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 transition-colors">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Exportar informe
                </button>
              </div>
              <GrupoDetallePanel gd={datos.grupoDetalle} />
            </div>
          )}

          {/* ── Vista global (sin grupo seleccionado) ────────────────────── */}
          {!grupoSeleccionado && (
            <div className="space-y-5">
              {/* Top 10 protocolos globales */}
              <TopProtocolosTable data={datos.topProtocolos} />

              {/* Top 10 medicamentos globales */}
              {datos.topMedicamentos.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-700">Top 10 medicamentos por gasto — global</h3>
                    <span className="text-xs text-slate-400">Haz clic para ver evolución semanal</span>
                  </div>
                  <table className="w-full">
                    <thead className="bg-slate-50/50">
                      <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                        <th className="px-3 py-2 text-left w-7">#</th>
                        <th className="px-3 py-2 text-left">Medicamento</th>
                        <th className="px-3 py-2 text-left">Grupo</th>
                        <th className="px-3 py-2 text-right">Gasto</th>
                        <th className="px-3 py-2 text-right">Prep.</th>
                        <th className="px-3 py-2 text-right">Viales</th>
                        <th className="px-3 py-2 text-right">€/prep.</th>
                        <th className="px-3 py-2">YoY</th>
                        <th className="px-3 py-2 w-5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {datos.topMedicamentos.map((m, i) => <TopMedRow key={m.cn} m={m} rank={i + 1} />)}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Gráficos temporales globales */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <TemporalChart
                  data={datos.temporalHistorico}
                  title="Evolución histórica mensual (hasta 3 meses atrás)"
                />
                <TemporalChart
                  data={datos.temporalReciente}
                  title="Detalle semanal — últimas semanas"
                />
              </div>
            </div>
          )}

          {datos.grupos.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500">
              No hay datos de consumo para el período seleccionado.
              <br /><span className="text-xs text-slate-400">Importa datos en la pestaña Consumo.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
