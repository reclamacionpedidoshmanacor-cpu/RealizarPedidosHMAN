'use client';

import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
} from 'recharts';
import {
  type DiagnosticoGrupo,
  type Servicio,
  GRUPO_LABELS,
  GRUPO_COLORS,
  gruposParaServicio,
} from '@/lib/diagnostico-grupos';
import type {
  AnalisisDatos, GrupoCard, TopMed, TopProtocolo,
  GrupoDetalle, DiagnosticoDetalle, IndicacionDetalle, GastoAnualServicio,
  AbcItem, CostePacienteCiclo, OutlierItem, TemporalMesStacked,
} from '@/lib/analisis-neon';
import {
  type ModoComparativa,
  MODO_COMPARATIVA_LABELS,
} from '@/lib/analisis-comparativa';

// Alcance de visualización: total del área o un servicio concreto
type ServicioSel = Servicio | 'total';
const TOTAL_COLOR = '#0d9488'; // teal-600, color del total del área

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------
function fmtEur(n: number): string {
  return n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}
function fmtNum(n: number, dec = 1): string {
  return n.toLocaleString('es-ES', { maximumFractionDigits: dec });
}
// Euro compacto para etiquetas sobre barras (evita solaparse)
function fmtEurShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} M€`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)} k€`;
  return `${Math.round(n)} €`;
}
function fmtDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------------------
// Colores de servicio
// ---------------------------------------------------------------------------
const SERVICIO_COLORS: Record<Servicio, string> = {
  'oncologia-solida': '#0f766e', // teal-700
  'hematologia':      '#7c3aed', // violet-700
};
const SERVICIO_LABELS: Record<Servicio, string> = {
  'oncologia-solida': 'Oncología sólida',
  'hematologia':      'Hematología',
};

function scopeLabel(s: ServicioSel): string {
  return s === 'total' ? 'Total (Onco + Hemato)' : SERVICIO_LABELS[s];
}
function scopeColor(s: ServicioSel): string {
  return s === 'total' ? TOTAL_COLOR : SERVICIO_COLORS[s];
}

// ---------------------------------------------------------------------------
// Presets de período (calculados al vuelo para fechas siempre actuales)
// ---------------------------------------------------------------------------
function buildPresets() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const year = now.getFullYear();
  const presetDesde = (months: number) => {
    const d = new Date(); d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
  };
  return [
    { label: '3 meses',      desde: presetDesde(3),  hasta: today },
    { label: '6 meses',      desde: presetDesde(6),  hasta: today },
    { label: 'Año actual',   desde: `${year}-01-01`, hasta: today },
    { label: 'Año anterior', desde: `${year - 1}-01-01`, hasta: `${year - 1}-12-31` },
    { label: 'Todo el periodo', desde: `${year - 2}-01-01`, hasta: today },
  ];
}

function defaultDesde() {
  const year = new Date().getFullYear();
  return `${year - 2}-01-01`;
}
function defaultHasta() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Badge YoY (semáforo: bajar es bueno para gasto)
// ---------------------------------------------------------------------------
function YoyBadge({ pct, compact, label }: { pct: number | null; compact?: boolean; label?: string }) {
  if (pct === null) return <span className="text-[10px] text-slate-400">sin dato</span>;
  const down = pct < 0;
  const high = Math.abs(pct) > 10;
  const cls  = down
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : high
    ? 'bg-red-50 text-red-700 ring-red-200'
    : 'bg-orange-50 text-orange-700 ring-orange-200';
  const suffix = compact ? '' : (label ? ` ${label}` : ' YoY');
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${cls}`}>
      {down ? '▼' : '▲'} {Math.abs(pct).toFixed(1)}%{suffix}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Mini barras anuales dentro de las tarjetas de grupo
// ---------------------------------------------------------------------------
function MiniAnualBars({ data, color }: { data: { anio: number; gasto: number }[]; color: string }) {
  if (!data.length) return null;
  const max = Math.max(...data.map(d => d.gasto), 1);
  return (
    <div className="flex items-end gap-1 mt-3">
      {data.map(d => (
        <div key={d.anio} className="flex flex-col items-center gap-0.5 flex-1">
          <div className="w-full rounded-t transition-all"
            style={{ height: `${Math.max(3, (d.gasto / max) * 32)}px`, backgroundColor: color + 'aa' }} />
          <span className="text-[8px] text-slate-400 tabular-nums">{d.anio}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------
function KpiCard({ label, value, sub, highlight }: {
  label: string; value: string; sub?: string; highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl border px-5 py-4 shadow-sm ${highlight ? 'border-teal-200 bg-teal-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${highlight ? 'text-teal-800' : 'text-slate-800'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500 leading-tight">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tarjeta de grupo tumoral
// ---------------------------------------------------------------------------
function GrupoCardUI({ g, selected, onClick }: { g: GrupoCard; selected: boolean; onClick: () => void }) {
  const c = GRUPO_COLORS[g.grupo];
  return (
    <button onClick={onClick}
      className={['relative w-full rounded-xl border p-4 text-left transition-all duration-200 shadow-sm',
        selected ? `${c.bg} ring-2 ${c.ring} shadow-md` : 'border-slate-200 bg-white hover:shadow-md hover:border-slate-300',
      ].join(' ')}>
      <div className="absolute right-2 top-2"><YoyBadge pct={g.variacionYoy} /></div>
      <p className={`text-sm font-bold pr-20 leading-tight ${selected ? c.text : 'text-slate-700'}`}>{g.label}</p>
      <p className="mt-1.5 text-xl font-bold text-slate-800 tabular-nums">{fmtEur(g.totalGasto)}</p>
      <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(g.pctGasto, 100)}%`, backgroundColor: c.chart }} />
      </div>
      <p className="mt-1 text-[10px] text-slate-400">{Math.round(g.pctGasto * 10) / 10}% del total área</p>
      <MiniAnualBars data={g.gastoPorAnio} color={c.chart} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Gráfico anual — siempre muestra el TOTAL; si hay servicio, apila su porción en color
// ---------------------------------------------------------------------------
type AnualChartItem = {
  anio: number;
  gastoTotal: number;     // total del área (siempre)
  gastoServicio: number;  // porción del servicio seleccionado (0 en modo total)
  gastoResto: number;     // resto del área (0 en modo total)
  variacionYoy: number | null;
  parcial: boolean;
};

function GastoAnualStackedChart({
  items,
  servicio,
  title,
}: {
  items: AnualChartItem[];
  servicio: ServicioSel;
  title: string;
}) {
  if (!items.length) return null;
  const isTotal  = servicio === 'total';
  const svcColor = scopeColor(servicio);
  const svcLabel = scopeLabel(servicio);

  // Etiqueta con el GASTO TOTAL encima de cada barra. Anidada en la barra superior
  // de la pila: position="top" la sitúa en la cima del total y dataKey="gastoTotal"
  // muestra el total del área (no la porción del servicio).
  const totalLabel = (
    <LabelList dataKey="gastoTotal" position="top"
      formatter={(v: unknown) => fmtEurShort(Number(v ?? 0))}
      fill="#334155" fontSize={10} fontWeight={700} />
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        {items.some(d => d.parcial) && (
          <span className="text-[10px] text-slate-400 italic">año en curso: datos parciales</span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={items} margin={{ top: 20, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="anio" tick={{ fontSize: 11, fill: '#64748b' }} />
          <YAxis tickFormatter={v => fmtEurShort(Number(v))} tick={{ fontSize: 10, fill: '#94a3b8' }} width={64} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]!.payload as AnualChartItem;
              const pct = d.gastoTotal > 0 ? Math.round((d.gastoServicio / d.gastoTotal) * 100) : 0;
              return (
                <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg text-xs space-y-0.5">
                  <p className="font-bold text-slate-800">{d.anio}{d.parcial ? ' (año en curso)' : ''}</p>
                  <p className="text-slate-600">Total área: <span className="font-semibold">{fmtEur(d.gastoTotal)}</span></p>
                  {!isTotal && (
                    <p style={{ color: svcColor }}>
                      {svcLabel}: <span className="font-semibold">{fmtEur(d.gastoServicio)}</span> ({pct}%)
                    </p>
                  )}
                  {d.variacionYoy !== null && (
                    <p className={`font-semibold mt-1 ${d.variacionYoy > 10 ? 'text-red-600' : d.variacionYoy < 0 ? 'text-emerald-600' : 'text-orange-600'}`}>
                      YoY total: {d.variacionYoy > 0 ? '+' : ''}{d.variacionYoy.toFixed(1)}%
                      {d.parcial ? ' · vs mismo período año ant.' : ''}
                    </p>
                  )}
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {isTotal ? (
            <Bar dataKey="gastoTotal" name="Total área" fill={svcColor} radius={[4, 4, 0, 0]}>
              {totalLabel}
            </Bar>
          ) : (
            <>
              <Bar dataKey="gastoResto" name="Resto del área" stackId="g" fill="#e2e8f0" />
              <Bar dataKey="gastoServicio" name={svcLabel} stackId="g" fill={svcColor} radius={[4, 4, 0, 0]}>
                {totalLabel}
              </Bar>
            </>
          )}
        </BarChart>
      </ResponsiveContainer>
      {/* Leyenda resumen por año */}
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-slate-500">
        {items.map(d => (
          <span key={d.anio}>
            <span className="font-bold text-slate-600">{d.anio}{d.parcial ? '*' : ''}:</span>{' '}
            <span className="font-semibold text-slate-800">{fmtEur(d.gastoTotal)}</span>
            {d.variacionYoy !== null && <> · <YoyBadge pct={d.variacionYoy} /></>}
          </span>
        ))}
        {items.some(d => d.parcial) && (
          <span className="italic text-slate-400">* año en curso — YoY sobre el mismo período del año anterior</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top 10 protocolos
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

// Paleta para segmentos dx/indicación (vista grupo)
const DX_CHART_COLORS = [
  '#0d9488', '#6366f1', '#f59e0b', '#ec4899', '#14b8a6', '#8b5cf6', '#94a3b8',
];

function stackedToChartRows(data: TemporalMesStacked[]) {
  const segIds = new Set<string>();
  for (const m of data) for (const s of m.segmentos) segIds.add(s.id);
  return data.map(m => {
    const row: Record<string, string | number> = { label: m.label, gastoTotal: m.gastoTotal };
    for (const id of segIds) {
      row[id] = m.segmentos.find(s => s.id === id)?.gasto ?? 0;
    }
    return row;
  });
}

function buildSegmentMeta(
  data: TemporalMesStacked[],
  mode: 'total' | 'grupo',
): Record<string, { label: string; color: string }> {
  const meta: Record<string, { label: string; color: string }> = {};
  const seen = new Set<string>();
  let colorIdx = 0;
  for (const m of data) {
    for (const s of m.segmentos) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      if (s.id === '__otros__') {
        meta[s.id] = { label: 'Otros', color: '#cbd5e1' };
      } else if (mode === 'total' && s.id in GRUPO_COLORS) {
        meta[s.id] = { label: GRUPO_LABELS[s.id as DiagnosticoGrupo], color: GRUPO_COLORS[s.id as DiagnosticoGrupo].chart };
      } else {
        meta[s.id] = { label: s.label.length > 42 ? s.label.slice(0, 40) + '…' : s.label, color: DX_CHART_COLORS[colorIdx++ % DX_CHART_COLORS.length]! };
      }
    }
  }
  return meta;
}

function MedStackedChart({
  data,
  mode,
}: {
  data: TemporalMesStacked[];
  mode: 'total' | 'grupo';
}) {
  if (!data.length || data.every(m => m.gastoTotal === 0)) {
    return <p className="text-xs text-slate-400">Sin datos en el período.</p>;
  }
  const segmentMeta = buildSegmentMeta(data, mode);
  const chartRows = stackedToChartRows(data);
  const segmentIds = Object.keys(segmentMeta);

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={chartRows} margin={{ top: 8, right: 16, left: 0, bottom: 18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#94a3b8' }}
            angle={-25} textAnchor="end" height={42} interval="preserveStartEnd" />
          <YAxis tickFormatter={v => fmtEurShort(Number(v))} tick={{ fontSize: 10, fill: '#94a3b8' }} width={64} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const items = payload.filter(p => Number(p.value ?? 0) > 0 && p.dataKey !== 'gastoTotal');
              const total = items.reduce((s, p) => s + Number(p.value ?? 0), 0);
              return (
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg max-w-xs">
                  <p className="font-bold text-slate-800 mb-1">{label}</p>
                  {items.map(p => {
                    const id = String(p.dataKey);
                    const meta = segmentMeta[id];
                    const val = Number(p.value ?? 0);
                    const pct = total > 0 ? Math.round(val / total * 1000) / 10 : 0;
                    return (
                      <p key={id} className="text-slate-600 truncate" style={{ color: meta?.color }}>
                        {meta?.label ?? id}: {fmtEur(val)} ({pct}%)
                      </p>
                    );
                  })}
                  <p className="font-semibold text-slate-800 mt-1 pt-1 border-t border-slate-100">
                    Total: {fmtEur(total)}
                  </p>
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} formatter={(v: string) => segmentMeta[v]?.label ?? v} />
          {segmentIds.map(id => (
            <Bar key={id} dataKey={id} name={id} stackId="gasto" fill={segmentMeta[id]!.color}
              fillOpacity={0.82} radius={id === segmentIds[segmentIds.length - 1] ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
          ))}
          <Line dataKey="gastoTotal" name="Total" stroke="#334155" strokeWidth={1.5}
            dot={{ r: 2, fill: '#334155' }} strokeDasharray="4 2" />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-slate-400 mt-1">
        {mode === 'total'
          ? 'Barras apiladas por tipo tumoral · línea = gasto total del medicamento'
          : 'Barras apiladas por diagnóstico/indicación · % del gasto del medicamento en este grupo'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top 10 medicamentos — expandible: dx/indicación | evolución mensual apilada
// ---------------------------------------------------------------------------
function TopMedRow({ m, rank, mode = 'total' }: { m: TopMed; rank: number; mode?: 'total' | 'grupo' }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab]   = useState<'dx' | 'chart'>('dx');
  const stackedData = mode === 'total' ? m.temporalPorGrupo : m.temporalPorDx;
  return (
    <>
      <tr className="cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => setOpen(v => !v)}>
        <td className="px-3 py-2.5 text-xs font-bold text-slate-400">{rank}</td>
        <td className="px-3 py-2.5">
          <p className="text-sm font-semibold text-slate-800">{m.principioActivo || '—'}</p>
          <p className="text-[11px] text-slate-400 italic">{m.nombre || ''}</p>
        </td>
        <td className="px-3 py-2.5 text-right text-sm font-bold text-slate-800 tabular-nums">{fmtEur(m.totalGasto)}</td>
        <td className="px-3 py-2.5 text-right text-xs text-slate-500 tabular-nums">{fmtNum(m.totalPreparaciones, 0)}</td>
        <td className="px-3 py-2.5 text-right text-xs text-slate-500 tabular-nums">{fmtNum(m.totalViales)}</td>
        <td className="px-3 py-2.5 text-right text-xs text-slate-500 tabular-nums">{fmtEur(m.costePorPreparacion)}</td>
        <td className="px-3 py-2.5"><YoyBadge pct={m.variacionYoy} /></td>
        <td className="px-3 py-2.5 text-xs text-slate-400 select-none">{open ? '▲' : '▼'}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} className="bg-slate-50/80 px-6 pb-4 pt-2">
            <div className="flex gap-2 mb-3">
              {(['dx', 'chart'] as const).map(t => (
                <button key={t}
                  onClick={e => { e.stopPropagation(); setTab(t); }}
                  className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${tab === t ? 'bg-slate-800 text-white' : 'border border-slate-200 text-slate-600 hover:bg-white'}`}>
                  {t === 'dx' ? 'Por diagnóstico / indicación' : 'Evolución mensual'}
                </button>
              ))}
            </div>

            {tab === 'dx' && (
              m.desgloseByDx.length > 0 ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="text-left py-1 w-[34%]">Diagnóstico</th>
                      <th className="text-left py-1 w-[26%]">Indicación</th>
                      <th className="text-right py-1 w-[10%]">Prep.</th>
                      <th className="text-right py-1 w-[14%]">Gasto</th>
                      <th className="text-right py-1 w-[10%]">% med.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {m.desgloseByDx.map((dx, i) => {
                      const gc = GRUPO_COLORS[dx.grupo];
                      const pctMed = m.totalGasto > 0 ? (dx.gasto / m.totalGasto) * 100 : 0;
                      return (
                        <tr key={i} className="hover:bg-slate-100/50">
                          <td className="py-1.5 pr-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {mode === 'total' && (
                                <span className={`inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1 ${gc.bg} ${gc.text} ${gc.ring}`}>
                                  {GRUPO_LABELS[dx.grupo]}
                                </span>
                              )}
                              <span className="text-slate-700">{dx.diagnostico}</span>
                            </div>
                          </td>
                          <td className="py-1.5 pr-2 text-slate-600">{dx.indicacion}</td>
                          <td className="py-1.5 text-right text-slate-600 tabular-nums">{fmtNum(dx.preparaciones, 0)}</td>
                          <td className="py-1.5 text-right font-semibold text-slate-800 tabular-nums">{fmtEur(dx.gasto)}</td>
                          <td className="py-1.5 text-right tabular-nums text-teal-700 font-medium">{pctMed.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : <p className="text-xs text-slate-400">Sin desglose disponible.</p>
            )}

            {tab === 'chart' && (
              <MedStackedChart data={stackedData} mode={mode} />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Acordeón jerárquico: Diagnóstico → Indicación (cerrada) → Protocolo → Medicamentos
// ---------------------------------------------------------------------------
function ProtocoloRow({ prot }: { prot: import('@/lib/analisis-neon').ProtocoloDetalle }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-slate-100 bg-white">
      <button onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-slate-50 transition-colors">
        <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">{prot.protocolo}</span>
        <div className="flex items-center gap-4 text-xs text-right">
          <span className="font-semibold text-slate-800">{fmtEur(prot.totalGasto)}</span>
          <span className="text-slate-500">{prot.totalPreparaciones} prep.</span>
          <span className="text-slate-400">{fmtEur(prot.costePorPreparacion)}/prep.</span>
          <span className="text-slate-400 ml-2">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && prot.medicamentos.length > 0 && (
        <div className="border-t border-slate-50 px-4 pb-3 pt-2 bg-slate-50/50">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                <th className="text-left py-1">Medicamento</th>
                <th className="text-right py-1 w-24">Prep.</th>
                <th className="text-right py-1 w-20">Viales</th>
                <th className="text-right py-1 w-28">Gasto</th>
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

// Indicación: empieza cerrada
function IndicacionSection({ ind }: { ind: IndicacionDetalle }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors">
        <span className="text-sm font-semibold text-slate-700">{ind.indicacion}</span>
        <div className="flex items-center gap-3 text-xs">
          <span className="font-semibold text-slate-800">{fmtEur(ind.totalGasto)}</span>
          <span className="text-slate-400">{ind.totalPreparaciones} prep.</span>
          <span className="text-slate-400">{ind.protocolos.length} protocolos</span>
          <span className="text-slate-400">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="divide-y divide-slate-100 p-2 space-y-1">
          {ind.protocolos.map(prot => <ProtocoloRow key={prot.protocolo} prot={prot} />)}
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
      <button onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
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
          {dx.indicaciones.map(ind => <IndicacionSection key={ind.indicacion} ind={ind} />)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gráfico temporal (histórico o semanal)
// ---------------------------------------------------------------------------
function TemporalChart({ data, title, color = '#475569', emptyHint }: {
  data: import('@/lib/analisis-neon').TemporalPoint[];
  title: string;
  color?: string;
  emptyHint?: string;
}) {
  if (!data.length) return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-6 py-8 text-center text-sm text-slate-400">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-xs">{emptyHint ?? 'Sin datos en el período seleccionado.'}</p>
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
          <YAxis yAxisId="right" orientation="right" tickFormatter={v => fmtEur(Number(v))}
            tick={{ fontSize: 10, fill: '#94a3b8' }} width={72} />
          <Tooltip formatter={(v: unknown, n: unknown) => {
            const val = Number(v ?? 0);
            return n === 'Gasto (€)' ? fmtEur(val) : fmtNum(val, 0);
          }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar yAxisId="left" dataKey="preparaciones" name="Preparaciones" fill={color} fillOpacity={0.65} radius={[3, 3, 0, 0]} />
          <Line yAxisId="right" dataKey="gasto" name="Gasto (€)" stroke="#0d9488" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pareto / ABC
// ---------------------------------------------------------------------------
function ParetoSection({ items }: { items: AbcItem[] }) {
  if (!items.length) return null;
  const clsColor = { A: 'bg-red-100 text-red-700 ring-red-200', B: 'bg-amber-100 text-amber-700 ring-amber-200', C: 'bg-slate-100 text-slate-600 ring-slate-200' };
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-700">Concentración del gasto (Pareto / ABC)</h3>
        <p className="text-xs text-slate-400 mt-0.5">Clase A ≈ 80% del gasto · B ≈ 15% · C ≈ 5%</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-slate-400 bg-slate-50">
              <th className="text-left px-4 py-2">Medicamento</th>
              <th className="text-center px-2 py-2 w-12">ABC</th>
              <th className="text-right px-3 py-2">Gasto</th>
              <th className="text-right px-3 py-2">% total</th>
              <th className="text-right px-4 py-2 w-32">% acum.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map(it => (
              <tr key={it.cn} className="hover:bg-slate-50">
                <td className="px-4 py-2">
                  <p className="font-semibold text-slate-800">{it.principioActivo || '—'}</p>
                  <p className="text-[10px] text-slate-400 italic">{it.nombre}</p>
                </td>
                <td className="px-2 py-2 text-center">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${clsColor[it.clase]}`}>{it.clase}</span>
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtEur(it.gasto)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{it.pctTotal.toFixed(1)}%</td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full bg-teal-500" style={{ width: `${Math.min(it.pctAcumulado, 100)}%` }} />
                    </div>
                    <span className="text-[10px] tabular-nums text-slate-500 w-10 text-right">{it.pctAcumulado.toFixed(0)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coste paciente-ciclo
// ---------------------------------------------------------------------------
function CosteCicloSection({ items }: { items: CostePacienteCiclo[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-700">Coste medio por paciente-ciclo</h3>
        <p className="text-xs text-slate-400 mt-0.5">Gasto / nº pacientes por protocolo · aproximación (no distingue repeticiones)</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-slate-400 bg-slate-50">
              <th className="text-left px-4 py-2">Protocolo</th>
              <th className="text-left px-3 py-2">Indicación</th>
              <th className="text-right px-3 py-2">Pacientes</th>
              <th className="text-right px-3 py-2">Gasto</th>
              <th className="text-right px-4 py-2">€ / paciente</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((it, i) => {
              const gc = GRUPO_COLORS[it.grupo];
              return (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-800">{it.protocolo}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1 mr-1 ${gc.bg} ${gc.text} ${gc.ring}`}>
                      {GRUPO_LABELS[it.grupo]}
                    </span>
                    <span className="text-slate-600">{it.indicacion}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(it.pacientes, 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtEur(it.gasto)}</td>
                  <td className="px-4 py-2 text-right font-bold tabular-nums text-teal-700">{fmtEur(it.costeMedio)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outliers semanales
// ---------------------------------------------------------------------------
function OutliersSection({ items }: { items: OutlierItem[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/30 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-amber-100">
        <h3 className="text-sm font-semibold text-amber-900">Picos de gasto detectados (outliers)</h3>
        <p className="text-xs text-amber-700/70 mt-0.5">Semanas con gasto &gt; media + 2 desviaciones · solo dato semanal real</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-amber-700/60 bg-amber-50">
              <th className="text-left px-4 py-2">Medicamento</th>
              <th className="text-left px-3 py-2">Semana</th>
              <th className="text-right px-3 py-2">Gasto sem.</th>
              <th className="text-right px-3 py-2">Media</th>
              <th className="text-right px-4 py-2">× media</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100/50">
            {items.map((it, i) => (
              <tr key={i} className="hover:bg-amber-50">
                <td className="px-4 py-2">
                  <p className="font-semibold text-slate-800">{it.principioActivo}</p>
                  <p className="text-[10px] text-slate-500">{it.protocolo}</p>
                </td>
                <td className="px-3 py-2 text-slate-600">{it.semanaLabel}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-amber-800">{fmtEur(it.gastoSemana)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmtEur(it.mediaSemanal)}</td>
                <td className="px-4 py-2 text-right font-bold tabular-nums text-red-600">{it.ratio.toFixed(1)}×</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel de detalle de grupo tumoral
// ---------------------------------------------------------------------------
function GrupoDetallePanel({ gd }: { gd: GrupoDetalle }) {
  const c = GRUPO_COLORS[gd.grupo];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Gasto total" value={fmtEur(gd.kpis.totalGasto)} highlight />
        <KpiCard label="Coste / prep." value={fmtEur(gd.kpis.costePorPreparacion)} />
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">vs año anterior</p>
          <div className="mt-2"><YoyBadge pct={gd.kpis.variacionYoy} /></div>
        </div>
        <KpiCard label="Pac. est. / sem." value={fmtNum(gd.kpis.mediaPackientesSemana)} sub="Suma dispensaciones" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TemporalChart data={gd.temporalHistorico} title="Evolución mensual (todos los meses del periodo)" color={c.chart} />
        <TemporalChart data={gd.temporalReciente}  title="Últimas semanas (dato semanal real)" color={c.chart + 'cc'}
          emptyHint="Sin importaciones semanales recientes para este grupo." />
      </div>

      <TopProtocolosTable data={gd.topProtocolos} />

      {gd.topMedicamentos.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Top 10 medicamentos del grupo</h3>
            <span className="text-xs text-slate-400">Clic para desglose dx/indicación y evolución apilada</span>
          </div>
          <table className="w-full">
            <thead className="bg-slate-50/50">
              <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2 w-7 text-left">#</th>
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
                <TopMedRow key={m.cn} m={m} rank={i + 1} mode="grupo" />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {gd.diagnosticos.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-1">Diagnósticos — Indicaciones — Protocolos</h3>
          <p className="text-xs text-slate-400 mb-3">Ordenados por gasto · clic para desplegar por niveles</p>
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
export default function AnalisisOncologiaPage() {
  const [servicio, setServicio]         = useState<ServicioSel>('total');
  const [grupoSel, setGrupoSel]         = useState<DiagnosticoGrupo | null>(null);
  const [desde, setDesde]               = useState(defaultDesde());
  const [hasta, setHasta]               = useState(defaultHasta());
  const [modoComparativa, setModoComparativa] = useState<ModoComparativa>('yoy');
  const [activePreset, setActivePreset] = useState<string | null>('Todo el periodo');
  const [sortGrupos, setSortGrupos]     = useState<'gasto' | 'yoy'>('gasto');
  const [datos, setDatos]               = useState<AnalisisDatos | null>(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const presets = buildPresets();

  // Auto-fetch reactivo: cualquier cambio de filtro dispara la petición
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    const p = new URLSearchParams({ desde, hasta, comparativa: modoComparativa });
    if (servicio !== 'total') p.set('servicio', servicio);
    if (grupoSel) p.set('grupo', grupoSel);
    fetch(`/api/analisis/datos?${p}`)
      .then(r => r.ok ? r.json() : r.json().then((j: { error?: string }) => Promise.reject(j.error ?? 'Error')))
      .then(d => { if (!cancelled) setDatos(d); })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [desde, hasta, servicio, grupoSel, modoComparativa]);

  // ── Handlers ──
  function handleSelectGrupo(g: DiagnosticoGrupo) {
    setGrupoSel(prev => prev === g ? null : g);
  }
  function handleSetServicio(s: ServicioSel) {
    setServicio(s);
    setGrupoSel(null); // al cambiar de alcance, reseteamos grupo
  }
  function applyPreset(p: { label: string; desde: string; hasta: string }) {
    setDesde(p.desde); setHasta(p.hasta); setActivePreset(p.label);
  }
  function handleExportar() {
    const p = new URLSearchParams({ desde, hasta, comparativa: modoComparativa });
    if (servicio !== 'total') p.set('servicio', servicio);
    if (grupoSel) p.set('grupo', grupoSel);
    window.open(`/api/analisis/exportar?${p}`, '_blank');
  }
  function handlePdfInforme(tipo: 'servicio' | 'grupo', svc?: Servicio) {
    const p = new URLSearchParams({ tipo });
    if (tipo === 'servicio') {
      const s = svc ?? (servicio === 'total' ? 'oncologia-solida' : servicio);
      p.set('servicio', s);
    } else if (grupoSel) {
      p.set('grupo', grupoSel);
    }
    window.open(`/api/analisis/informe/pdf?${p}`, '_blank');
  }

  // ── Gráfico anual: histórico (todos los años) por servicio, viene del servidor ──
  const anualChartItems: AnualChartItem[] = (datos?.gastoAnualServicio ?? []).map((d: GastoAnualServicio) => {
    const svc = servicio === 'total' ? 0
      : servicio === 'hematologia' ? d.gastoHemato : d.gastoOnco;
    return {
      anio: d.anio,
      gastoTotal: d.gastoTotal,
      gastoServicio: svc,
      gastoResto: servicio === 'total' ? 0 : Math.max(0, d.gastoTotal - svc),
      variacionYoy: d.variacionYoy,
      parcial: d.parcial,
    };
  });

  // Gasto total del área en el período (suma de todos los grupos, siempre disponible)
  const areaTotal = (datos?.grupos ?? []).reduce((s, g) => s + g.totalGasto, 0);

  const tarjetasBase = servicio === 'total'
    ? (datos?.grupos ?? [])
    : (datos?.grupos ?? []).filter(g => gruposParaServicio(servicio).includes(g.grupo));

  const tarjetas = [...tarjetasBase].sort((a, b) => {
    if (sortGrupos === 'yoy') {
      const ya = a.variacionYoy ?? -Infinity;
      const yb = b.variacionYoy ?? -Infinity;
      return yb - ya;
    }
    return b.totalGasto - a.totalGasto;
  });

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">

      {/* ── Cabecera ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Análisis farmaoeconómico</h1>
            <p className="text-xs text-slate-500 mt-0.5">Medicamentos preparados en Farmacia · Oncología + Hematología</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {(servicio !== 'total'
              ? [servicio]
              : (['oncologia-solida', 'hematologia'] as Servicio[])
            ).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => handlePdfInforme('servicio', s)}
                disabled={!datos}
                title="Informe PDF del servicio (ultimos 12 meses)"
                className="flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-800 shadow-sm hover:bg-teal-100 disabled:opacity-40 transition-colors">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                PDF {SERVICIO_LABELS[s]}
              </button>
            ))}
            <button onClick={handleExportar} disabled={!datos}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-40 transition-colors">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Exportar Excel
            </button>
          </div>
        </div>

        {/* Badges de período + selector manual + comparativa */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {presets.map(p => (
              <button key={p.label} onClick={() => applyPreset(p)}
                className={['rounded-full px-3 py-1 text-xs font-semibold transition-colors border',
                  activePreset === p.label
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                ].join(' ')}>
                {p.label}
              </button>
            ))}
            <div className="flex items-center gap-1.5 ml-2 text-xs text-slate-500">
              <input type="date" value={desde}
                onChange={e => { setDesde(e.target.value); setActivePreset(null); }}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              <span>—</span>
              <input type="date" value={hasta}
                onChange={e => { setHasta(e.target.value); setActivePreset(null); }}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="font-medium text-slate-500 whitespace-nowrap">Comparar con:</span>
            <select
              value={modoComparativa}
              onChange={e => setModoComparativa(e.target.value as ModoComparativa)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-400 max-w-[220px] sm:max-w-none"
            >
              {(Object.entries(MODO_COMPARATIVA_LABELS) as [ModoComparativa, string][]).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>
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
          {/* ── Selector de alcance: Total / Oncología / Hematología ──────── */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Alcance:</span>
            {(['total', 'oncologia-solida', 'hematologia'] as ServicioSel[]).map(s => (
              <button key={s} onClick={() => handleSetServicio(s)}
                className={['rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors',
                  servicio === s
                    ? 'text-white shadow'
                    : 'border border-slate-200 text-slate-600 hover:bg-slate-50',
                ].join(' ')}
                style={servicio === s ? { backgroundColor: scopeColor(s) } : {}}>
                {s === 'total' ? 'Total' : SERVICIO_LABELS[s]}
              </button>
            ))}
          </div>

          {/* ── Gráfico anual histórico (total + servicio resaltado) ──────── */}
          <GastoAnualStackedChart
            items={anualChartItems}
            servicio={servicio}
            title={servicio === 'total'
              ? 'Gasto histórico anual — total del área (Onco + Hemato)'
              : `Gasto histórico anual — total área · porción ${SERVICIO_LABELS[servicio as Servicio]} resaltada`}
          />

          {/* ── KPIs (referidos al alcance seleccionado) ──────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard
              label={`Gasto período · ${scopeLabel(servicio)}`}
              value={fmtEur(datos.kpis.totalGasto)}
              sub={servicio === 'total'
                ? 'Suma Oncología + Hematología'
                : `${areaTotal > 0 ? Math.round(datos.kpis.totalGasto / areaTotal * 100) : 0}% del total área (${fmtEur(areaTotal)})`}
              highlight
            />
            <KpiCard label="€ / preparación" value={fmtEur(datos.kpis.costePorPreparacion)} />
            <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                {modoComparativa === 'yoy' ? 'vs año anterior' : 'vs periodo anterior'}
              </p>
              <div className="mt-2">
                <YoyBadge
                  pct={datos.kpis.variacionYoy}
                  label={modoComparativa === 'yoy' ? 'YoY' : 'Δ'}
                />
              </div>
              <p className="mt-1.5 text-[10px] text-slate-400 leading-tight">{datos.comparativa?.etiqueta ?? datos.yoyEtiqueta}</p>
            </div>
            <KpiCard label="Preparaciones" value={fmtNum(datos.kpis.totalPreparaciones, 0)} />
            <KpiCard label="Protocolos activos" value={String(datos.kpis.protocolosActivos)} />
            <KpiCard label="Medicamentos" value={String(datos.kpis.medicamentosDistintos)} />
          </div>

          {/* ── Tarjetas de grupo ─────────────────────────────────────────── */}
          {tarjetas.length > 0 ? (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Grupos tumorales — {fmtDate(desde)} al {fmtDate(hasta)}
                  {grupoSel && (
                    <button onClick={() => setGrupoSel(null)}
                      className="ml-3 text-teal-600 hover:underline normal-case font-normal">✕ Ver todos</button>
                  )}
                </p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wide">Ordenar:</span>
                  {(['gasto', 'yoy'] as const).map(s => (
                    <button key={s} onClick={() => setSortGrupos(s)}
                      className={['rounded-full px-2.5 py-0.5 text-[10px] font-semibold border transition-colors',
                        sortGrupos === s ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-500 hover:bg-slate-50',
                      ].join(' ')}>
                      {s === 'gasto' ? 'Por gasto' : 'Por variación YoY'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {tarjetas.map(g => (
                  <GrupoCardUI key={g.grupo} g={g} selected={grupoSel === g.grupo} onClick={() => handleSelectGrupo(g.grupo)} />
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500">
              No hay datos para este período y servicio.
            </div>
          )}

          {/* ── Detalle de grupo tumoral ──────────────────────────────────── */}
          {grupoSel && datos.grupoDetalle && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-5">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${GRUPO_COLORS[grupoSel].bg} ${GRUPO_COLORS[grupoSel].text} ${GRUPO_COLORS[grupoSel].ring}`}>
                    {GRUPO_LABELS[grupoSel]}
                  </span>
                  <h2 className="text-base font-bold text-slate-800">Análisis detallado</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handlePdfInforme('grupo')}
                    title="Informe PDF del grupo tumoral (ultimos 12 meses)"
                    className="flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-800 shadow-sm hover:bg-teal-100 transition-colors">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                    PDF grupo
                  </button>
                  <button onClick={handleExportar}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 transition-colors">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Exportar Excel
                  </button>
                </div>
              </div>
              <GrupoDetallePanel gd={datos.grupoDetalle} />
            </div>
          )}

          {/* ── Vista global del servicio (sin grupo específico seleccionado) ── */}
          {!grupoSel && (
            <div className="space-y-5">
              <TopProtocolosTable data={datos.topProtocolos} />

              {datos.topMedicamentos.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-700">
                      Top 10 medicamentos — {scopeLabel(servicio)}
                    </h3>
                    <span className="text-xs text-slate-400">Clic para ver detalle por diagnóstico o evolución</span>
                  </div>
                  <table className="w-full">
                    <thead className="bg-slate-50/50">
                      <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                        <th className="px-3 py-2 w-7 text-left">#</th>
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
                      {datos.topMedicamentos.map((m, i) => <TopMedRow key={m.cn} m={m} rank={i + 1} mode="total" />)}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <TemporalChart
                  data={datos.temporalHistorico}
                  title={`Evolución mensual (todos los meses del periodo) — ${scopeLabel(servicio)}`}
                  color={scopeColor(servicio)}
                />
                <TemporalChart
                  data={datos.temporalReciente}
                  title={`Últimas 6 semanas (dato semanal real) — ${scopeLabel(servicio)}`}
                  color={scopeColor(servicio)}
                  emptyHint="Importa consumo semanal desde el 4 de mayo de 2026 para ver este detalle."
                />
              </div>

              <ParetoSection items={datos.pareto} />
              <CosteCicloSection items={datos.costePacienteCiclo} />
              <OutliersSection items={datos.outliers} />
            </div>
          )}

          {datos.grupos.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500">
              No hay datos para el período seleccionado.
            </div>
          )}
        </>
      )}
    </div>
  );
}
