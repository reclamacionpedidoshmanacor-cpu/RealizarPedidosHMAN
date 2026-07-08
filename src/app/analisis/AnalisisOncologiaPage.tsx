'use client';

import { useEffect, useMemo, useState } from 'react';
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
  Cell,
} from 'recharts';
import {
  GRUPO_COLORS,
  GRUPO_LABELS,
  type DiagnosticoGrupo,
} from '@/lib/diagnostico-grupos';
import type {
  AnalisisDatos,
  DiagnosticoDetalle,
  GrupoCard,
  GrupoDetalle,
  IndicacionDetalle,
  MedicamentoDetalle,
  MedicamentoListItem,
  ServicioCard,
  TemporalPoint,
  TopProtocolo,
} from '@/lib/analisis-neon';

type Preset = { label: string; desde: string; hasta: string };

function defaultHasta(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultDesde(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  d.setMonth(d.getMonth() + 1, 1);
  return d.toISOString().slice(0, 10);
}

const PRESET_TODO_PERIODO = 'Todo el período';
const DESDE_TODO_PERIODO   = '2024-01-01';

function buildPresets(): Preset[] {
  const hasta = defaultHasta();
  const now = new Date();
  const d3 = new Date(now);
  d3.setMonth(d3.getMonth() - 3);
  const d6 = new Date(now);
  d6.setMonth(d6.getMonth() - 6);
  const d12 = new Date(now);
  d12.setFullYear(d12.getFullYear() - 1);
  return [
    { label: '3 meses',           desde: d3.toISOString().slice(0, 10), hasta },
    { label: '6 meses',           desde: d6.toISOString().slice(0, 10), hasta },
    { label: '12 meses',          desde: d12.toISOString().slice(0, 10), hasta },
    { label: 'Año actual',        desde: `${now.getFullYear()}-01-01`, hasta },
    { label: PRESET_TODO_PERIODO, desde: DESDE_TODO_PERIODO,            hasta },
  ];
}

function daysBetween(desde: string, hasta: string): number {
  const a = new Date(`${desde}T12:00:00`);
  const b = new Date(`${hasta}T12:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function fmtEur(n: number): string {
  return n.toLocaleString('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  });
}

function fmtNum(n: number, dec = 1): string {
  return n.toLocaleString('es-ES', { maximumFractionDigits: dec });
}

function fmtQty(n: number, dec = 1): string {
  const abs = Math.abs(n);
  const maxFractionDigits = abs > 0 && abs < 0.1
    ? 3
    : abs > 0 && abs < 1
    ? 2
    : dec;
  return n.toLocaleString('es-ES', { maximumFractionDigits: maxFractionDigits });
}

function fmtEurShort(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} M€`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)} k€`;
  return `${Math.round(n)} €`;
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const SERIES_COLORS = {
  consumo:      '#0d9488',  // teal-600: consumo cajas (gráfico evolución)
  consumoSoft:  '#14b8a6',
  gasto:        '#1d4f91',  // azul institucional oscuro (gráficos valorizado)
  gastoTemporal:'#8b5cf6',  // violeta-500: gasto en gráfico evolución mensual (contraste con teal)
  gastoSoft:    '#7fb3e6',
  preparaciones:'#b45309',  // ámbar-700: preparaciones (línea)
  compras:      '#2563eb',
  comprasSoft:  '#38bdf8',
  comprasGasto: '#7c3aed',
  surface:      '#0f172a',
} as const;

// Paleta de servicios clínicos: rango 500-600 de Tailwind, alternando tonos
// cálidos y fríos para que las barras apiladas sean fácilmente distinguibles.
// Sin neón ni saturación extrema; agradable a la vista en contexto sanitario.
const SERVICE_PALETTE = [
  '#2563eb',  // blue-600      — azul claro corporativo
  '#ea580c',  // orange-600    — naranja cálido
  '#0891b2',  // cyan-600      — cian fresco
  '#16a34a',  // green-600     — verde claro
  '#dc2626',  // red-600       — rojo nítido
  '#7c3aed',  // violet-700    — violeta medio
  '#d97706',  // amber-600     — ámbar dorado
  '#0d9488',  // teal-600      — teal
  '#be185d',  // pink-700      — rosa profundo
  '#6366f1',  // indigo-500    — índigo suave
  '#ca8a04',  // yellow-600    — amarillo cálido
  '#9333ea',  // purple-600    — púrpura vivo
] as const;

function hashText(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getServiceColor(key: string): string {
  return SERVICE_PALETTE[hashText(key) % SERVICE_PALETTE.length] ?? SERVICE_PALETTE[0];
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const value = clean.length === 3
    ? clean.split('').map((char) => char + char).join('')
    : clean;
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const KPI_TONES = {
  teal: 'border-teal-200 bg-teal-50 text-teal-800',
  blue: 'border-sky-200 bg-sky-50 text-sky-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  rose: 'border-rose-200 bg-rose-50 text-rose-800',
  violet: 'border-violet-200 bg-violet-50 text-violet-800',
  slate: 'border-slate-200 bg-white text-slate-800',
} as const;

type KpiTone = keyof typeof KPI_TONES;

function YoyBadge({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="text-[10px] text-slate-400">sin base comparable</span>;
  }
  const down = pct < 0;
  const neutral = Math.abs(pct) < 3;
  const cls = down
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : neutral
    ? 'bg-amber-50 text-amber-700 ring-amber-200'
    : 'bg-rose-50 text-rose-700 ring-rose-200';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${cls}`}>
      {down ? '▼' : '▲'} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone = 'slate',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: KpiTone;
}) {
  const toneClasses = KPI_TONES[tone];
  return (
    <div className={`rounded-xl border px-5 py-4 shadow-sm ${toneClasses}`}>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500 leading-tight">{sub}</p>}
    </div>
  );
}

function TemporalTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: Record<string, unknown> }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  const lunesRef = typeof row.lunesRef === 'string' ? row.lunesRef : '';
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-slate-800">{label}</p>
      {lunesRef && <p className="text-slate-500">Lunes: {fmtDate(lunesRef)}</p>}
      {payload.map((entry, i) => {
        if (entry.value == null) return null;
        const isMoney = String(entry.name).toLowerCase().includes('gasto');
        const isPrep = String(entry.name).toLowerCase().includes('prep');
        return (
          <p key={i} style={{ color: entry.color }} className="tabular-nums">
            {entry.name}: {isMoney ? fmtEur(Number(entry.value)) : fmtQty(Number(entry.value), isPrep ? 0 : 1)}
          </p>
        );
      })}
    </div>
  );
}

function TemporalChart({
  data,
  title,
  emptyHint,
}: {
  data: TemporalPoint[];
  title: string;
  emptyHint: string;
}) {
  if (!data.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-400">
        <p className="font-medium text-slate-600">{title}</p>
        <p className="mt-1 text-xs">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#64748b' }}
            interval="preserveStartEnd"
            angle={data.length > 10 ? -25 : 0}
            textAnchor={data.length > 10 ? 'end' : 'middle'}
            height={data.length > 10 ? 46 : 28}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            tickFormatter={(v) => fmtQty(Number(v))}
            width={60}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            tickFormatter={(v) => fmtEurShort(Number(v))}
            width={72}
          />
          <Tooltip content={<TemporalTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar
            yAxisId="left"
            dataKey="viales"
            name="Consumo (cajas eq.)"
            fill={SERIES_COLORS.consumo}
            fillOpacity={0.9}
            minPointSize={3}
            radius={[4, 4, 0, 0]}
          />
          <Line
            yAxisId="left"
            dataKey="preparaciones"
            name="Preparaciones"
            stroke={SERIES_COLORS.preparaciones}
            strokeWidth={2}
            dot={false}
          />
          <Bar
            yAxisId="right"
            dataKey="gasto"
            name="Gasto valorizado"
            fill={SERIES_COLORS.gastoTemporal}
            fillOpacity={0.72}
            radius={[4, 4, 0, 0]}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ServicioCardUI({
  item,
  selected,
  onClick,
}: {
  item: ServicioCard;
  selected: boolean;
  onClick: () => void;
}) {
  const color = getServiceColor(item.servicioKey);
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl border p-4 text-left shadow-sm transition-colors hover:shadow-md"
      style={{
        borderColor: selected ? hexToRgba(color, 0.45) : '#e2e8f0',
        background: selected
          ? `linear-gradient(135deg, ${hexToRgba(color, 0.16)}, rgba(255,255,255,0.96))`
          : `linear-gradient(135deg, ${hexToRgba(color, 0.09)}, rgba(255,255,255,0.98))`,
        boxShadow: selected ? `0 0 0 2px ${hexToRgba(color, 0.18)}` : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-bold text-slate-800 leading-tight">{item.servicio}</p>
        <YoyBadge pct={item.variacionYoy} />
      </div>
      <p className="mt-2 text-xl font-bold text-slate-900 tabular-nums">{fmtEur(item.totalGasto)}</p>
      <p className="mt-1 text-xs text-slate-500">
        {fmtQty(item.totalViales)} cajas eq. · {fmtNum(item.totalPreparaciones, 0)} preparaciones
      </p>
      <div className="mt-3 h-1.5 w-full rounded-full bg-white/70 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(item.pctGasto, 100)}%`, backgroundColor: color }}
        />
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        {item.pctGasto.toFixed(1)}% del gasto del período
      </p>
      {item.gruposDominantes.length > 0 && (
        <p className="mt-2 text-[11px] text-slate-500">
          Predominio: {item.gruposDominantes.slice(0, 2).map((g) => `${g.label} ${g.pctServicio.toFixed(0)}%`).join(' · ')}
        </p>
      )}
      {item.gastoPorAnio.length > 1 && (() => {
        const totalAnios = item.gastoPorAnio.reduce((s, r) => s + r.gasto, 0);
        const maxGasto   = Math.max(...item.gastoPorAnio.map((r) => r.gasto));
        return (
          <div className="mt-3 border-t border-white/60 pt-2.5 space-y-2.5">
            {item.gastoPorAnio.map((r) => {
              const pct    = totalAnios > 0 ? (r.gasto / totalAnios) * 100 : 0;
              const barPct = maxGasto > 0   ? (r.gasto / maxGasto)  * 100 : 0;
              return (
                <div key={r.anio}>
                  <div className="flex items-center justify-between gap-1 text-[11px] mb-1">
                    <span className="font-semibold text-slate-700 w-9 shrink-0">{r.anio}</span>
                    <span className="text-slate-400 shrink-0">({pct.toFixed(1)}%)</span>
                    <span className="tabular-nums text-slate-700 font-medium ml-auto shrink-0">
                      {fmtEur(r.gasto)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ backgroundColor: hexToRgba(color, 0.15) }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${barPct}%`, backgroundColor: color, opacity: 0.75 }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
    </button>
  );
}

function GrupoCardUI({
  item,
  selected,
  onClick,
}: {
  item: GrupoCard;
  selected: boolean;
  onClick: () => void;
}) {
  const c = GRUPO_COLORS[item.grupo];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border p-4 text-left shadow-sm transition-colors ${
        selected
          ? `${c.bg} ring-2 ${c.ring}`
          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className={`text-sm font-bold leading-tight ${selected ? c.text : 'text-slate-800'}`}>{item.label}</p>
        <YoyBadge pct={item.variacionYoy} />
      </div>
      <p className="mt-2 text-xl font-bold text-slate-900 tabular-nums">{fmtEur(item.totalGasto)}</p>
      <p className="mt-1 text-xs text-slate-500">
        {fmtQty(item.totalViales)} cajas eq. · {fmtNum(item.totalPreparaciones, 0)} preparaciones
      </p>
      <div className="mt-3 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(item.pctGasto, 100)}%`, backgroundColor: c.chart }}
        />
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{item.pctGasto.toFixed(1)}% del alcance actual</p>
    </button>
  );
}

function TopProtocolosTable({ items }: { items: TopProtocolo[] }) {
  if (!items.length) return null;
  return (
    <div className="h-full rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
        <h3 className="text-sm font-semibold text-slate-700">Protocolos con mayor impacto económico</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50/70">
            <tr className="text-[10px] uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2 text-left w-8">#</th>
              <th className="px-3 py-2 text-left">Protocolo</th>
              <th className="px-3 py-2 text-right">Gasto</th>
              <th className="px-3 py-2 text-right">Cajas eq.</th>
              <th className="px-3 py-2 text-right">Preparaciones</th>
              <th className="px-3 py-2 text-right">€/prep.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((p, i) => (
              <tr key={`${p.protocolo}-${i}`} className={i % 2 === 1 ? 'bg-slate-50/40' : ''}>
                <td className="px-3 py-2.5 font-bold text-slate-400">{i + 1}</td>
                <td className="px-3 py-2.5 font-semibold text-slate-800">{p.protocolo}</td>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-900">{fmtEur(p.totalGasto)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmtQty(p.totalViales)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmtNum(p.totalPreparaciones, 0)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{fmtEur(p.costePorPreparacion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DistributionBars({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ id: string; label: string; gasto: number; cajas: number; color: string }>;
}) {
  if (!rows.length) return null;
  const data = rows.slice(0, 8).map((row) => ({
    ...row,
    shortLabel: row.label.length > 22 ? `${row.label.slice(0, 20)}…` : row.label,
  }));

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
        <h4 className="text-sm font-semibold text-slate-700">{title}</h4>
      </div>
      <div className="p-4">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 18, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              tickFormatter={(v) => fmtEurShort(Number(v))}
            />
            <YAxis
              type="category"
              dataKey="shortLabel"
              tick={{ fontSize: 10, fill: '#475569' }}
              width={110}
            />
            <Tooltip
              formatter={(value: unknown, name: unknown, payload: { payload?: { cajas?: number } } | undefined) => {
                if (name === 'Gasto') return fmtEur(Number(value));
                return `${fmtQty(Number(value))} cajas eq.`;
              }}
              labelFormatter={(label) => String(label)}
            />
            <Bar dataKey="gasto" name="Gasto" radius={[0, 4, 4, 0]}>
              {data.map((row) => (
                <Cell key={row.id} fill={row.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-3 space-y-2">
          {data.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 text-[11px]">
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                <span className="truncate text-slate-600">{row.label}</span>
              </div>
              <div className="text-right tabular-nums text-slate-500">
                {fmtEur(row.gasto)} · {fmtQty(row.cajas)} cajas
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GastoAnualRefChart({
  gastoAnualServicioReal,
  onClickAnio,
  anioSeleccionado,
}: {
  gastoAnualServicioReal: import('@/lib/analisis-neon').GastoAnualServicioReal[];
  onClickAnio: (anio: number) => void;
  anioSeleccionado: number | null;
}) {
  const OTROS_KEY = '__otros__';
  const OTROS_COLOR = '#94a3b8'; // slate-400 — gris neutro para servicios pequeños

  // Agrupar por año y servicio → formato para barras apiladas.
  // Servicios con < PCT_THRESHOLD del gasto total se fusionan en "Otros servicios".
  const PCT_THRESHOLD = 0.03;
  const { anios, serviciosMostrados, chartData } = useMemo(() => {
    const anioSet = new Set<number>();
    const totalPorServicio = new Map<string, { label: string; gasto: number }>();
    for (const r of gastoAnualServicioReal) {
      anioSet.add(r.anio);
      const prev = totalPorServicio.get(r.servicioKey) ?? { label: r.servicio, gasto: 0 };
      totalPorServicio.set(r.servicioKey, { label: r.servicio, gasto: prev.gasto + r.gasto });
    }
    const grandTotal = [...totalPorServicio.values()].reduce((s, v) => s + v.gasto, 0);

    const principales: Array<{ key: string; label: string }> = [];
    const menores:    Array<string> = [];
    for (const [key, { label, gasto }] of totalPorServicio.entries()) {
      if (grandTotal > 0 && gasto / grandTotal >= PCT_THRESHOLD) {
        principales.push({ key, label });
      } else {
        menores.push(key);
      }
    }
    principales.sort(
      (a, b) => (totalPorServicio.get(b.key)?.gasto ?? 0) - (totalPorServicio.get(a.key)?.gasto ?? 0),
    );

    const hayOtros = menores.length > 0;
    const serviciosMostrados = hayOtros
      ? [...principales, { key: OTROS_KEY, label: 'Otros servicios' }]
      : principales;

    const anios = [...anioSet].sort((a, b) => a - b);
    const rowsByKey = new Map<string, Map<number, number>>();
    for (const r of gastoAnualServicioReal) {
      const key = menores.includes(r.servicioKey) ? OTROS_KEY : r.servicioKey;
      if (!rowsByKey.has(key)) rowsByKey.set(key, new Map());
      const m = rowsByKey.get(key)!;
      m.set(r.anio, (m.get(r.anio) ?? 0) + r.gasto);
    }

    const chartData = anios.map((anio) => {
      const row: Record<string, unknown> = { anio: String(anio), anioNum: anio };
      for (const { key } of serviciosMostrados) {
        row[key] = rowsByKey.get(key)?.get(anio) ?? 0;
      }
      return row;
    });
    return { anios, serviciosMostrados, chartData };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gastoAnualServicioReal]);

  if (!chartData.length) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleBarClick = (barData: any) => {
    if (barData?.anioNum) onClickAnio(Number(barData.anioNum));
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Referencia anual del gasto valorizado por servicio</h3>
          <p className="mt-1 text-xs text-slate-400">
            Haz clic en un año para filtrar el análisis a ese período.{' '}
            {anioSeleccionado && (
              <span className="font-medium text-teal-700">Año {anioSeleccionado} seleccionado.</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {serviciosMostrados.map(({ key, label }) => (
            <span key={key} className="flex items-center gap-1 text-[11px] text-slate-600">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm flex-shrink-0"
                style={{ backgroundColor: key === OTROS_KEY ? OTROS_COLOR : getServiceColor(key) }}
              />
              {label}
            </span>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart
          data={chartData}
          margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
          style={{ cursor: 'pointer' }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="anio" tick={{ fontSize: 10, fill: '#64748b' }} />
          <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v) => fmtEurShort(Number(v))} width={72} />
          <Tooltip
            formatter={(value: unknown, name: unknown) => [fmtEur(Number(value)), String(name)]}
            labelFormatter={(label) => String(label)}
          />
          {serviciosMostrados.map(({ key, label }, idx) => {
            const isLast = idx === serviciosMostrados.length - 1;
            const fillColor = key === OTROS_KEY ? OTROS_COLOR : getServiceColor(key);
            return (
              <Bar
                key={key}
                dataKey={key}
                name={label}
                stackId="a"
                fill={fillColor}
                radius={isLast ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                onClick={handleBarClick}
              >
                {chartData.map((d) => (
                  <Cell
                    key={String(d.anio)}
                    fill={fillColor}
                    opacity={anioSeleccionado && Number(d.anioNum) !== anioSeleccionado ? 0.35 : 0.9}
                  />
                ))}
              </Bar>
            );
          })}
        </BarChart>
      </ResponsiveContainer>
      {anioSeleccionado && (
        <p className="mt-2 text-center text-[11px] text-slate-500">
          Año {anioSeleccionado} activo · haz clic en otra barra o usa los presets para cambiar el período
        </p>
      )}
    </div>
  );
}

function ProtocoloRow({
  prot,
  onSelectMed,
}: {
  prot: import('@/lib/analisis-neon').ProtocoloDetalle;
  onSelectMed: (cn: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-slate-100 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-slate-50 transition-colors"
      >
        <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">{prot.protocolo}</span>
        <div className="flex items-center gap-4 text-xs text-right">
          <span className="font-semibold text-slate-800">{fmtEur(prot.totalGasto)}</span>
          <span className="text-slate-500">{fmtQty(prot.totalViales)} cajas eq.</span>
          <span className="text-slate-400">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && prot.medicamentos.length > 0 && (
        <div className="border-t border-slate-50 px-4 pb-3 pt-2 bg-slate-50/50">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                <th className="text-left py-1">Medicamento</th>
                <th className="text-right py-1 w-24">Cajas eq.</th>
                <th className="text-right py-1 w-28">Gasto</th>
                <th className="text-right py-1 w-20">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {prot.medicamentos.map((med) => (
                <tr key={med.cn}>
                  <td className="py-1.5">
                    <span className="font-semibold text-slate-800">{med.principioActivo || '—'}</span>
                    <span className="ml-2 text-slate-400 italic text-[10px]">{med.nombre || ''}</span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-slate-600">{fmtQty(med.totalViales)}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold text-slate-800">{fmtEur(med.totalGasto)}</td>
                  <td className="py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => onSelectMed(med.cn)}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-white"
                    >
                      Ver ficha
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function IndicacionSection({
  ind,
  onSelectMed,
}: {
  ind: IndicacionDetalle;
  onSelectMed: (cn: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <span className="text-sm font-semibold text-slate-700">{ind.indicacion}</span>
        <div className="flex items-center gap-3 text-xs">
          <span className="font-semibold text-slate-800">{fmtEur(ind.totalGasto)}</span>
          <span className="text-slate-400">{ind.protocolos.length} protocolos</span>
          <span className="text-slate-400">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="divide-y divide-slate-100 p-2 space-y-1">
          {ind.protocolos.map((prot) => (
            <ProtocoloRow key={prot.protocolo} prot={prot} onSelectMed={onSelectMed} />
          ))}
        </div>
      )}
    </div>
  );
}

function DiagnosticoAccordion({
  dx,
  onSelectMed,
}: {
  dx: DiagnosticoDetalle;
  onSelectMed: (cn: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const c = GRUPO_COLORS[dx.grupo];
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
          <span>{dx.indicaciones.length} indicaciones</span>
          <span className="text-slate-400">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-slate-100 p-3 space-y-2 bg-white">
          {dx.indicaciones.map((ind) => (
            <IndicacionSection key={ind.indicacion} ind={ind} onSelectMed={onSelectMed} />
          ))}
        </div>
      )}
    </div>
  );
}

function GrupoDetallePanel({
  detalle,
  showWeekly,
  onSelectMed,
}: {
  detalle: GrupoDetalle;
  showWeekly: boolean;
  onSelectMed: (cn: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Gasto" value={fmtEur(detalle.kpis.totalGasto)} tone="rose" />
        <KpiCard label="Cajas eq." value={fmtQty(detalle.kpis.totalViales)} tone="teal" />
        <KpiCard label="Preparaciones" value={fmtNum(detalle.kpis.totalPreparaciones, 0)} tone="amber" />
        <KpiCard label="Medicamentos" value={String(detalle.kpis.medicamentosDistintos)} tone="violet" />
      </div>

      <div className={`grid gap-4 ${showWeekly ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
        <TemporalChart
          data={detalle.temporalHistorico}
          title="Evolución mensual del grupo"
          emptyHint="Sin actividad mensual en el período."
        />
        {showWeekly && (
          <TemporalChart
            data={detalle.temporalReciente}
            title="Detalle semanal del grupo"
            emptyHint="Sin consumo semanal real en los últimos 6 meses del rango."
          />
        )}
      </div>

      <TopProtocolosTable items={detalle.topProtocolos} />

      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-1">Diagnósticos e indicaciones</h3>
        <p className="text-xs text-slate-400 mb-3">
          Despliega cada diagnóstico para bajar hasta indicación, protocolo y medicamento.
        </p>
        <div className="space-y-2">
          {detalle.diagnosticos.map((dx) => (
            <DiagnosticoAccordion key={dx.diagnostico} dx={dx} onSelectMed={onSelectMed} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MedicamentoListTable({
  items,
  selectedCn,
  query,
  onQueryChange,
  onSelect,
}: {
  items: MedicamentoListItem[];
  selectedCn: string;
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (cn: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Ficha de medicamento</h3>
          <p className="text-xs text-slate-400">Selecciona un CN para comparar compras recibidas del área frente al consumo del filtro actual.</p>
        </div>
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Buscar CN, principio activo o nombre"
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm min-w-[260px] shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
        />
      </div>
      <div className="flex-1 min-h-[520px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50/95 backdrop-blur">
            <tr className="text-[10px] uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2 text-left">Medicamento</th>
              <th className="px-3 py-2 text-right">Gasto</th>
              <th className="px-3 py-2 text-right">Cajas eq.</th>
              <th className="px-3 py-2 text-right">Variación</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr
                key={item.cn}
                onClick={() => onSelect(item.cn)}
                className={`cursor-pointer transition-colors ${
                  selectedCn === item.cn ? 'bg-teal-50' : 'hover:bg-slate-50'
                }`}
              >
                <td className="px-3 py-2.5">
                  <p className="font-semibold text-slate-800">{item.principioActivo || item.nombre}</p>
                  <p className="text-[10px] text-slate-500">
                    CN {item.cn} · {item.nombre}
                  </p>
                </td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">{fmtEur(item.totalGasto)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmtQty(item.totalViales)}</td>
                <td className="px-3 py-2.5 text-right"><YoyBadge pct={item.variacionYoy} /></td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">
                  No hay medicamentos para el filtro actual.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MedicamentoDetallePanel({
  detalle,
  showWeeklyByDefault,
  desde,
  hasta,
}: {
  detalle: MedicamentoDetalle;
  showWeeklyByDefault: boolean;
  desde: string;
  hasta: string;
}) {
  const meses = useMemo(() => {
    const a = new Date(`${desde}T12:00:00`);
    const b = new Date(`${hasta}T12:00:00`);
    const raw = (b.getTime() - a.getTime()) / (86400000 * 30.4375);
    return Math.max(1, raw);
  }, [desde, hasta]);
  const [modo, setModo] = useState<'mensual' | 'semanal'>(showWeeklyByDefault ? 'semanal' : 'mensual');

  useEffect(() => {
    setModo(showWeeklyByDefault ? 'semanal' : 'mensual');
  }, [showWeeklyByDefault, detalle.cn]);

  const canShowWeekly = detalle.temporalSemanal.length > 0;
  const data = modo === 'semanal' && canShowWeekly ? detalle.temporalSemanal : detalle.temporalMensual;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-800">{detalle.principioActivo || detalle.nombre}</h3>
            <p className="text-xs text-slate-500">
              CN {detalle.cn} · {detalle.unidadesPorCaja} uds/caja · precio actual {fmtNum(detalle.precioUnidad, 2)} €/unidad
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Compras: pedido recibido del área. Consumo: filtro actual del dashboard.
            </p>
          </div>
          <div className="text-xs text-slate-500">
            <p>Comparativa: {detalle.comparativaEtiqueta}</p>
            <div className="mt-1">
              <YoyBadge pct={detalle.consumo.variacionYoy} />
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="Consumo valorizado" value={fmtEur(detalle.consumo.totalGasto)} tone="rose" />
          <KpiCard
            label="Consumo medio mensual (nº cajas)"
            value={fmtQty(detalle.consumo.totalViales / meses, 1)}
            sub={`Total período: ${fmtQty(detalle.consumo.totalViales)} cajas · ${fmtNum(detalle.consumo.totalUnidades, 0)} uds`}
            tone="teal"
          />
          <KpiCard
            label="Compras media mensual (nº cajas)"
            value={fmtQty(detalle.compras.totalViales / meses, 1)}
            sub={`Total período: ${fmtQty(detalle.compras.totalViales)} cajas · ${fmtNum(detalle.compras.totalUnidades, 0)} uds`}
            tone="blue"
          />
          <KpiCard label="Compras valorizadas" value={fmtEur(detalle.compras.totalGasto)} tone="violet" />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setModo('mensual')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              modo === 'mensual'
                ? 'bg-slate-800 text-white'
                : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Mensual
          </button>
          <button
            type="button"
            disabled={!canShowWeekly}
            onClick={() => setModo('semanal')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              modo === 'semanal'
                ? 'bg-slate-800 text-white'
                : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            Últimos 6 meses por semanas
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 p-4">
            <h4 className="text-sm font-semibold text-slate-700 mb-3">Compras recibidas vs consumo en cajas equivalentes</h4>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  interval="preserveStartEnd"
                  angle={data.length > 10 ? -25 : 0}
                  textAnchor={data.length > 10 ? 'end' : 'middle'}
                  height={data.length > 10 ? 46 : 28}
                />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={60} tickFormatter={(v) => fmtQty(Number(v))} />
                <Tooltip content={<TemporalTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="comprasCajas" name="Compras recibidas" fill={SERIES_COLORS.compras} minPointSize={3} radius={[4, 4, 0, 0]} />
                <Bar dataKey="consumoCajas" name="Consumo" fill={SERIES_COLORS.consumo} minPointSize={3} radius={[4, 4, 0, 0]} />
                <Line
                  dataKey="preparaciones"
                  name="Preparaciones"
                  stroke={SERIES_COLORS.preparaciones}
                  strokeWidth={2}
                  dot={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl border border-slate-200 p-4">
            <h4 className="text-sm font-semibold text-slate-700 mb-3">Compras valorizadas vs consumo valorizado</h4>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  interval="preserveStartEnd"
                  angle={data.length > 10 ? -25 : 0}
                  textAnchor={data.length > 10 ? 'end' : 'middle'}
                  height={data.length > 10 ? 46 : 28}
                />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={72} tickFormatter={(v) => fmtEurShort(Number(v))} />
                <Tooltip content={<TemporalTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="comprasGasto" name="Compras valorizadas" fill={SERIES_COLORS.comprasGasto} minPointSize={3} radius={[4, 4, 0, 0]} />
                <Bar dataKey="consumoGasto" name="Consumo valorizado" fill={SERIES_COLORS.gasto} minPointSize={3} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <DistributionBars
            title="Distribución por servicio real"
            rows={detalle.porServicio.map((row) => ({
              id: row.servicioKey,
              label: row.servicio,
              gasto: row.totalGasto,
              cajas: row.totalViales,
              color: getServiceColor(row.servicioKey),
            }))}
          />

          <DistributionBars
            title="Distribución por tipo tumoral"
            rows={detalle.porGrupo.map((row) => ({
              id: row.grupo,
              label: row.label,
              gasto: row.totalGasto,
              cajas: row.totalViales,
              color: GRUPO_COLORS[row.grupo].chart,
            }))}
          />

          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
              <h4 className="text-sm font-semibold text-slate-700">Diagnósticos / indicaciones</h4>
            </div>
            <div className="max-h-[280px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50/95">
                  <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-2 text-left">Diagnóstico</th>
                    <th className="px-3 py-2 text-right">Gasto</th>
                    <th className="px-3 py-2 text-right">Cajas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detalle.topDiagnosticos.slice(0, 12).map((row, idx) => (
                    <tr key={`${row.diagnostico}-${row.indicacion}-${idx}`}>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-slate-700">{row.diagnostico}</p>
                        <p className="text-[10px] text-slate-500">{row.indicacion}</p>
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmtEur(row.gasto)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmtQty(row.viales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AnalisisOncologiaPage() {
  const presets = useMemo(() => buildPresets(), []);
  const [desde, setDesde] = useState(presets[2]?.desde ?? defaultDesde());
  const [hasta, setHasta] = useState(presets[2]?.hasta ?? defaultHasta());
  const [activePreset, setActivePreset] = useState(presets[2]?.label ?? '12 meses');
  const [servicioSel, setServicioSel] = useState<string | null>(null);
  const [grupoSel, setGrupoSel] = useState<DiagnosticoGrupo | null>(null);
  const [cnSel, setCnSel] = useState('');
  const [medQuery, setMedQuery] = useState('');
  const [datos, setDatos] = useState<AnalisisDatos | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anioSeleccionado, setAnioSeleccionado] = useState<number | null>(null);

  const showWeekly = useMemo(() => daysBetween(desde, hasta) <= 186, [desde, hasta]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ desde, hasta, comparativa: 'periodo-anterior' });
    if (servicioSel) params.set('servicio', servicioSel);
    if (grupoSel) params.set('grupo', grupoSel);
    if (cnSel) params.set('cn', cnSel);

    fetch(`/api/analisis/datos?${params}`)
      .then((res) => res.ok ? res.json() : res.json().then((payload) => Promise.reject(payload?.error ?? 'Error al cargar análisis')))
      .then((payload: AnalisisDatos) => {
        if (!cancelled) setDatos(payload);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setDatos(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [desde, hasta, servicioSel, grupoSel, cnSel]);

  useEffect(() => {
    if (!datos || !cnSel) return;
    if (!datos.medicamentos.some((med) => med.cn === cnSel)) {
      setCnSel('');
    }
  }, [datos, cnSel]);

  const medicamentosFiltrados = useMemo(() => {
    if (!datos) return [];
    const q = medQuery.trim().toLowerCase();
    if (!q) return datos.medicamentos;
    return datos.medicamentos.filter((m) =>
      m.cn.includes(q) ||
      m.nombre.toLowerCase().includes(q) ||
      m.principioActivo.toLowerCase().includes(q)
    );
  }, [datos, medQuery]);

  function applyPreset(preset: Preset) {
    setDesde(preset.desde);
    setHasta(preset.hasta);
    setActivePreset(preset.label);
    setAnioSeleccionado(null);
  }

  function handleClickAnio(anio: number) {
    if (anioSeleccionado === anio) {
      setAnioSeleccionado(null);
      const preset = presets.find((p) => p.label === PRESET_TODO_PERIODO);
      if (preset) { setDesde(preset.desde); setHasta(preset.hasta); }
      setActivePreset(PRESET_TODO_PERIODO);
    } else {
      setAnioSeleccionado(anio);
      setDesde(`${anio}-01-01`);
      setHasta(`${anio}-12-31`);
      setActivePreset('');
    }
  }

  function handleSelectServicio(servicio: string | null) {
    setServicioSel(servicio);
    setGrupoSel(null);
  }

  function handleSelectGrupo(grupo: DiagnosticoGrupo) {
    setGrupoSel((prev) => (prev === grupo ? null : grupo));
  }

  function handleExportar() {
    const params = new URLSearchParams({ desde, hasta, comparativa: 'periodo-anterior' });
    if (servicioSel) params.set('servicio', servicioSel);
    if (grupoSel) params.set('grupo', grupoSel);
    window.open(`/api/analisis/exportar?${params}`, '_blank');
  }

  function handleExportarPdf() {
    const params = new URLSearchParams({ desde, hasta, comparativa: 'periodo-anterior' });
    if (servicioSel) params.set('servicio', servicioSel);
    if (grupoSel) params.set('grupo', grupoSel);
    if (cnSel) params.set('cn', cnSel);
    window.open(`/api/analisis/informe/pdf?${params}`, '_blank');
  }

  return (
    <div
      className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6"
      style={{
        background: 'linear-gradient(180deg, #fffdf8 0%, #f8fafc 36%, #ffffff 100%)',
      }}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Análisis de Oncología</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Consumo valorizado y compras recibidas con servicio real de base de datos y métricas en cajas equivalentes.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleExportarPdf}
              disabled={!datos}
              className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 shadow-sm hover:bg-teal-100 disabled:opacity-40"
            >
              Exportar PDF
            </button>
            <button
              type="button"
              onClick={handleExportar}
              disabled={!datos}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-40"
            >
              Exportar Excel
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset)}
                className={`rounded-full px-3 py-1 text-xs font-semibold border transition-colors ${
                  activePreset === preset.label
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <input
                type="date"
                value={desde}
                onChange={(e) => {
                  setDesde(e.target.value);
                  setActivePreset('');
                }}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
              <span>—</span>
              <input
                type="date"
                value={hasta}
                onChange={(e) => {
                  setHasta(e.target.value);
                  setActivePreset('');
                }}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>
            <p className="text-xs text-slate-500">
              Comparativa automática: <span className="font-medium text-slate-700">{datos?.comparativa.etiqueta ?? 'periodo anterior equivalente'}</span>
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {loading && !datos && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
          <span className="ml-3 text-sm text-slate-500">Cargando análisis…</span>
        </div>
      )}

      {loading && datos && (
        <div className="sticky top-3 z-10 flex justify-center">
          <div className="rounded-full border border-sky-200 bg-white/95 px-3 py-1 text-xs font-medium text-sky-700 shadow-sm backdrop-blur">
            Actualizando análisis…
          </div>
        </div>
      )}

      {datos && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <KpiCard label="Gasto valorizado" value={fmtEur(datos.kpis.totalGasto)} tone="rose" />
            <KpiCard label="Consumo cajas eq." value={fmtQty(datos.kpis.totalViales)} tone="teal" />
            <KpiCard label="Servicios activos" value={String(datos.kpis.serviciosActivos)} tone="violet" />
            <KpiCard label="Medicamentos" value={String(datos.kpis.medicamentosDistintos)} tone="slate" />
          </div>

          <GastoAnualRefChart
            gastoAnualServicioReal={datos.gastoAnualServicioReal}
            onClickAnio={handleClickAnio}
            anioSeleccionado={anioSeleccionado}
          />

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-700">Servicios reales</h2>
                <p className="text-xs text-slate-400">Filtra por el servicio clínico real que consta en consumo.</p>
              </div>
              {servicioSel && (
                <button
                  type="button"
                  onClick={() => handleSelectServicio(null)}
                  className="text-xs font-medium text-teal-700 hover:underline"
                >
                  Quitar filtro de servicio
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {datos.servicios.map((item) => (
                <ServicioCardUI
                  key={item.servicioKey}
                  item={item}
                  selected={servicioSel === item.servicio}
                  onClick={() => handleSelectServicio(servicioSel === item.servicio ? null : item.servicio)}
                />
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-700">Tipos tumorales</h2>
                <p className="text-xs text-slate-400">
                  Mantiene la clasificación tumoral actual, pero sobre el filtro de servicio real seleccionado.
                </p>
              </div>
              {grupoSel && (
                <button
                  type="button"
                  onClick={() => setGrupoSel(null)}
                  className="text-xs font-medium text-teal-700 hover:underline"
                >
                  Quitar filtro de grupo
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
              {datos.grupos.map((item) => (
                <GrupoCardUI
                  key={item.grupo}
                  item={item}
                  selected={grupoSel === item.grupo}
                  onClick={() => handleSelectGrupo(item.grupo)}
                />
              ))}
            </div>
          </div>

          <div className={`grid gap-4 ${showWeekly ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
            <TemporalChart
              data={datos.temporalHistorico}
              title="Evolución mensual del alcance actual"
              emptyHint="Sin consumo mensual para el rango seleccionado."
            />
            {showWeekly && (
              <TemporalChart
                data={datos.temporalReciente}
                title="Detalle semanal del alcance actual"
                emptyHint="Sin consumo semanal real en los últimos 6 meses del rango."
              />
            )}
          </div>

          <TopProtocolosTable items={datos.topProtocolos} />

          {grupoSel && datos.grupoDetalle && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-5">
              <div className="flex items-center gap-2 mb-5">
                <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${GRUPO_COLORS[grupoSel].bg} ${GRUPO_COLORS[grupoSel].text} ${GRUPO_COLORS[grupoSel].ring}`}>
                  {GRUPO_LABELS[grupoSel]}
                </span>
                <h2 className="text-base font-bold text-slate-800">Detalle asistencial y económico del grupo</h2>
              </div>
              <GrupoDetallePanel detalle={datos.grupoDetalle} showWeekly={showWeekly} onSelectMed={setCnSel} />
            </div>
          )}

          <div className="grid items-stretch grid-cols-1 xl:grid-cols-[1.05fr_1.45fr] gap-4">
            <MedicamentoListTable
              items={medicamentosFiltrados}
              selectedCn={cnSel}
              query={medQuery}
              onQueryChange={setMedQuery}
              onSelect={setCnSel}
            />
            {datos.medicamentoDetalle ? (
              <MedicamentoDetallePanel detalle={datos.medicamentoDetalle} showWeeklyByDefault={showWeekly} desde={desde} hasta={hasta} />
            ) : (
              <div className="h-full rounded-xl border border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500 flex items-center justify-center">
                Selecciona un medicamento para abrir su ficha de análisis.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
