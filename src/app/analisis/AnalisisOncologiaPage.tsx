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
  LabelList,
  ReferenceArea,
  ReferenceLine,
} from 'recharts';
import {
  GRUPO_COLORS,
  GRUPO_LABELS,
  GRUPO_ORDER,
  type DiagnosticoGrupo,
} from '@/lib/diagnostico-grupos';
import type {
  AnalisisDatos,
  DiagnosticoDetalle,
  GastoPorVia,
  GrupoCard,
  GrupoDetalle,
  IndicacionDetalle,
  MedicamentoDetalle,
  MedicamentoListItem,
  ServicioCard,
  TemporalPoint,
  TopProtocolo,
  Via,
  ViaCard,
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

const VIA_META: Record<Via, { label: string; color: string; actividad: string }> = {
  IV:   { label: 'IV',   color: '#1e3a8a', actividad: 'preparaciones' },
  ORAL: { label: 'Oral', color: '#a16207', actividad: 'dispensaciones' },
};

function actividadLabel(via: Via | null): string {
  return via ? VIA_META[via].actividad : 'prep./disp.';
}

const YEAR_PALETTE = ['#475569', '#0d9488', '#1d4ed8', '#a21caf', '#4d7c0f'] as const;

function getYearColor(anio: number): string {
  const n = YEAR_PALETTE.length;
  return YEAR_PALETTE[(((anio - 2024) % n) + n) % n] ?? YEAR_PALETTE[0];
}

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

export function fmtVariacion(pct: number): string {
  const abs = Math.abs(pct);
  return abs.toLocaleString('es-ES', { maximumFractionDigits: abs >= 100 ? 0 : 1 });
}

export function YoyBadge({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="whitespace-nowrap text-[10px] text-slate-400">sin base comparable</span>;
  }
  const down = pct < 0;
  const neutral = Math.abs(pct) < 3;
  const cls = down
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : neutral
    ? 'bg-amber-50 text-amber-700 ring-amber-200'
    : 'bg-rose-50 text-rose-700 ring-rose-200';
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${cls}`}>
      {down ? '▼' : '▲'} {fmtVariacion(pct)}%
    </span>
  );
}

function ViaSplitBar({ porVia }: { porVia?: GastoPorVia }) {
  if (!porVia) return null;
  const total = porVia.IV + porVia.ORAL;
  if (total <= 0) return null;
  const pctIv = (porVia.IV / total) * 100;
  const pctOral = 100 - pctIv;
  return (
    <div className="mt-2.5">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div style={{ width: `${pctIv}%`, backgroundColor: VIA_META.IV.color }} />
        <div style={{ width: `${pctOral}%`, backgroundColor: VIA_META.ORAL.color }} />
      </div>
      <p className="mt-1 text-[10px] tabular-nums text-slate-500">
        <span className="font-semibold" style={{ color: VIA_META.IV.color }}>IV {pctIv.toFixed(0)}%</span>
        {' · '}
        <span className="font-semibold" style={{ color: VIA_META.ORAL.color }}>Oral {pctOral.toFixed(0)}%</span>
      </p>
    </div>
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
  showGrupoBreakdown,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: Record<string, unknown> }>;
  label?: string;
  showGrupoBreakdown?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  const lunesRef = typeof row.lunesRef === 'string' ? row.lunesRef : '';

  if (showGrupoBreakdown) {
    // Reconstruir total gasto y desglose desde payload (barras apiladas por grupo)
    const grupoEntries = payload.filter((e) => String(e.name ?? '').startsWith('__g__'));
    const totalGasto   = grupoEntries.reduce((s, e) => s + (e.value ?? 0), 0);
    const nonGrupo     = payload.filter((e) => !String(e.name ?? '').startsWith('__g__'));
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs shadow-lg min-w-[210px]">
        <p className="font-semibold text-slate-800">{label}</p>
        {lunesRef && <p className="text-slate-500">Lunes: {fmtDate(lunesRef)}</p>}
        {nonGrupo.map((entry, i) => {
          if (entry.value == null || entry.value === 0) return null;
          const name = String(entry.name ?? '').toLowerCase();
          const isMoney = name.includes('gasto');
          const isPrep = name.includes('prep');
          return (
            <p key={i} style={{ color: entry.color }} className="tabular-nums mt-0.5">
              {entry.name}: {isMoney ? fmtEur(Number(entry.value)) : fmtQty(Number(entry.value), isPrep ? 0 : 1)}
            </p>
          );
        })}
        {totalGasto > 0 && (
          <>
            <p className="mt-1.5 font-semibold text-slate-700 border-t border-slate-100 pt-1.5">
              Gasto: {fmtEur(totalGasto)}
            </p>
            {grupoEntries
              .filter((e) => (e.value ?? 0) > 0)
              .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
              .map((entry, i) => {
                const pct = totalGasto > 0 ? ((entry.value ?? 0) / totalGasto) * 100 : 0;
                return (
                  <div key={i} className="flex items-center justify-between gap-2 py-[2px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="h-2 w-2 rounded-sm flex-shrink-0" style={{ backgroundColor: entry.color }} />
                      <span className="truncate text-slate-600">
                        {String(entry.name ?? '').replace('__g__', '')}
                      </span>
                    </div>
                    <span className="tabular-nums text-slate-700 flex-shrink-0">
                      {fmtEur(entry.value ?? 0)}
                      <span className="ml-1 text-slate-400">({pct.toFixed(0)}%)</span>
                    </span>
                  </div>
                );
              })}
          </>
        )}
      </div>
    );
  }

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
  showGrupoBreakdown = false,
  showMediaMovil = false,
}: {
  data: TemporalPoint[];
  title: string;
  emptyHint: string;
  showGrupoBreakdown?: boolean;
  showMediaMovil?: boolean;
}) {
  // Grupos con gasto > 0 en el período (para no renderizar barras vacías)
  const gruposPresentes = useMemo(() => {
    if (!showGrupoBreakdown) return [];
    const set = new Set<DiagnosticoGrupo>();
    for (const pt of data) {
      for (const g of (Object.keys(pt.gastoPorGrupo ?? {}) as DiagnosticoGrupo[])) {
        if ((pt.gastoPorGrupo![g] ?? 0) > 0) set.add(g);
      }
    }
    return GRUPO_ORDER.filter((g) => set.has(g));
  }, [data, showGrupoBreakdown]);

  // Aplanar gastoPorGrupo al nivel del objeto para que Recharts lo lea directamente
  const chartData = useMemo(() => {
    const now = new Date();
    // El mes en curso está incompleto: no entra en la media para no simular una caída.
    const isParcial = (pt: TemporalPoint) =>
      pt.semana == null && pt.anio === now.getFullYear() && pt.mes === now.getMonth() + 1;
    return data.map((pt, idx) => {
      const flat: Record<string, unknown> = { ...pt };
      if (showGrupoBreakdown) {
        for (const g of gruposPresentes) {
          flat[`__grupo__${g}`] = pt.gastoPorGrupo?.[g] ?? 0;
        }
      }
      if (showMediaMovil) {
        const ventana = idx >= 2 ? data.slice(idx - 2, idx + 1) : [];
        flat.__mm3 = ventana.length === 3 && !ventana.some(isParcial)
          ? ventana.reduce((s, p) => s + p.gasto, 0) / 3
          : null;
      }
      return flat;
    });
  }, [data, showGrupoBreakdown, gruposPresentes, showMediaMovil]);

  const tramosAnio = useMemo(() => {
    const tramos: Array<{ anio: number; x1: string; x2: string }> = [];
    for (const pt of data) {
      const last = tramos.at(-1);
      if (last && last.anio === pt.anio) last.x2 = pt.label;
      else tramos.push({ anio: pt.anio, x1: pt.label, x2: pt.label });
    }
    return tramos;
  }, [data]);

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
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 24 }}>
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
          <Tooltip content={<TemporalTooltip showGrupoBreakdown={showGrupoBreakdown} />} />
          {tramosAnio.length > 1 && tramosAnio.map((t) => (
            <ReferenceArea
              key={`anio-${t.anio}`}
              yAxisId="left"
              x1={t.x1}
              x2={t.x2}
              fill={getYearColor(t.anio)}
              fillOpacity={0.08}
              strokeOpacity={0}
              label={{ value: String(t.anio), position: 'insideTop', fontSize: 10, fontWeight: 700, fill: getYearColor(t.anio) }}
            />
          ))}
          {tramosAnio.slice(1).map((t) => (
            <ReferenceLine
              key={`sep-${t.anio}`}
              yAxisId="left"
              x={t.x1}
              position="start"
              stroke="#64748b"
              strokeDasharray="4 3"
            />
          ))}
          <Bar
            yAxisId="left"
            dataKey="viales"
            name="Consumo (cajas eq.)"
            fill={SERIES_COLORS.consumo}
            fillOpacity={0.9}
            minPointSize={3}
            radius={[4, 4, 0, 0]}
          >
            {data.map((pt, i) => (
              <Cell key={`${pt.label}-${i}`} fill={getYearColor(pt.anio)} />
            ))}
          </Bar>
          <Line
            yAxisId="left"
            dataKey="preparaciones"
            name="Preparaciones"
            stroke={SERIES_COLORS.preparaciones}
            strokeWidth={2}
            dot={false}
          />
          {showMediaMovil && (
            <Line
              yAxisId="right"
              dataKey="__mm3"
              name="Media móvil 3 meses (gasto)"
              stroke={SERIES_COLORS.surface}
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              connectNulls={false}
            />
          )}
          {showGrupoBreakdown ? (
            gruposPresentes.map((g, idx) => (
              <Bar
                key={g}
                yAxisId="right"
                dataKey={`__grupo__${g}`}
                name={`__g__${GRUPO_LABELS[g]}`}
                stackId="gasto"
                fill={GRUPO_COLORS[g].chart}
                fillOpacity={0.85}
                radius={idx === gruposPresentes.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              />
            ))
          ) : (
            <Bar
              yAxisId="right"
              dataKey="gasto"
              name="Gasto valorizado"
              fill={SERIES_COLORS.gastoTemporal}
              fillOpacity={0.72}
              radius={[4, 4, 0, 0]}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-600">
        <span className="font-semibold uppercase tracking-wide text-slate-400">Consumo por año</span>
        {tramosAnio.map((t) => (
          <span key={t.anio} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm flex-shrink-0" style={{ backgroundColor: getYearColor(t.anio) }} />
            {t.anio}
          </span>
        ))}
        {!showGrupoBreakdown && (
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm flex-shrink-0" style={{ backgroundColor: SERIES_COLORS.gastoTemporal }} />
            Gasto valorizado
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-3 flex-shrink-0" style={{ backgroundColor: SERIES_COLORS.preparaciones }} />
          Preparaciones
        </span>
        {showMediaMovil && (
          <span className="flex items-center gap-1">
            <span className="w-3 flex-shrink-0 border-t-2 border-dashed" style={{ borderColor: SERIES_COLORS.surface }} />
            Media móvil 3 meses del gasto
          </span>
        )}
      </div>
      {showGrupoBreakdown && gruposPresentes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {gruposPresentes.map((g) => (
            <span key={g} className="flex items-center gap-1 text-[10px] text-slate-600">
              <span className="h-2 w-2 rounded-sm flex-shrink-0" style={{ backgroundColor: GRUPO_COLORS[g].chart }} />
              {GRUPO_LABELS[g]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ServicioCardUI({
  item,
  selected,
  onClick,
  gastoAnualServicioReal,
  mostrarVia = true,
}: {
  item: ServicioCard;
  selected: boolean;
  onClick: () => void;
  gastoAnualServicioReal: import('@/lib/analisis-neon').GastoAnualServicioReal[];
  mostrarVia?: boolean;
}) {
  const color = getServiceColor(item.servicioKey);

  // Siempre todos los años disponibles, % respecto al total global de ese año
  const anioRows = useMemo(() => {
    const thisServiceByAnio = new Map<number, number>();
    const totalByAnio = new Map<number, number>();
    for (const r of gastoAnualServicioReal) {
      totalByAnio.set(r.anio, (totalByAnio.get(r.anio) ?? 0) + r.gasto);
      if (r.servicioKey === item.servicioKey) {
        thisServiceByAnio.set(r.anio, (thisServiceByAnio.get(r.anio) ?? 0) + r.gasto);
      }
    }
    return [...thisServiceByAnio.keys()]
      .sort((a, b) => a - b)
      .map((anio) => {
        const gasto = thisServiceByAnio.get(anio) ?? 0;
        const yearTotal = totalByAnio.get(anio) ?? 0;
        const pct = yearTotal > 0 ? (gasto / yearTotal) * 100 : 0;
        return { anio, gasto, pct };
      });
  }, [gastoAnualServicioReal, item.servicioKey]);

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
      {mostrarVia && <ViaSplitBar porVia={item.gastoPorVia} />}
      {anioRows.length > 1 && (
        <div className="mt-3 border-t border-white/60 pt-2.5 space-y-2.5">
          {anioRows.map((r) => (
            <div key={r.anio}>
              <div className="flex items-center justify-between gap-1 text-[11px] mb-1">
                <span className="font-semibold text-slate-700 w-9 shrink-0">{r.anio}</span>
                <span className="text-slate-400 shrink-0">({r.pct.toFixed(1)}%)</span>
                <span className="tabular-nums text-slate-700 font-medium ml-auto shrink-0">
                  {fmtEur(r.gasto)}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ backgroundColor: hexToRgba(color, 0.15) }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(r.pct, 100)}%`, backgroundColor: color, opacity: 0.75 }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

function ServicioMiniCard({
  item,
  onClick,
}: {
  item: ServicioCard;
  onClick: () => void;
}) {
  const color = getServiceColor(item.servicioKey);
  return (
    <button
      type="button"
      onClick={onClick}
      title="Cambiar a este servicio"
      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white/70 px-3 py-1.5 text-left opacity-70 transition hover:opacity-100 hover:shadow-sm"
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-xs font-semibold text-slate-700">{item.servicio}</span>
      <span className="text-[11px] tabular-nums text-slate-500">
        {fmtEurShort(item.totalGasto)} · {item.pctGasto.toFixed(1)}%
      </span>
    </button>
  );
}

function ViaCardUI({
  item,
  selected,
  onClick,
}: {
  item: ViaCard;
  selected: boolean;
  onClick: () => void;
}) {
  const meta = VIA_META[item.via];
  const vacia = item.totalGasto <= 0 && item.medicamentosDistintos === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={vacia}
      className="w-full rounded-xl border p-4 text-left shadow-sm transition-colors hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        borderColor: selected ? hexToRgba(meta.color, 0.55) : '#e2e8f0',
        background: `linear-gradient(135deg, ${hexToRgba(meta.color, selected ? 0.16 : 0.07)}, rgba(255,255,255,0.98))`,
        boxShadow: selected ? `0 0 0 2px ${hexToRgba(meta.color, 0.2)}` : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
          <p className="text-sm font-bold leading-tight" style={{ color: meta.color }}>
            Medicamentos {meta.label}
          </p>
        </div>
        <YoyBadge pct={item.variacionYoy} />
      </div>
      <p className="mt-2 text-xl font-bold tabular-nums text-slate-900">{fmtEur(item.totalGasto)}</p>
      <p className="mt-1 text-xs text-slate-500">
        {fmtQty(item.totalViales)} cajas eq. · {fmtNum(item.totalPreparaciones, 0)} {meta.actividad}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">
        {item.medicamentosDistintos} medicamentos
        {item.via === 'IV' && ` · ${item.protocolosActivos} protocolos`}
      </p>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(item.pctGasto, 100)}%`, backgroundColor: meta.color }}
        />
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{item.pctGasto.toFixed(1)}% del alcance actual</p>
    </button>
  );
}

function GrupoCardUI({
  item,
  selected,
  onClick,
  via,
}: {
  item: GrupoCard;
  selected: boolean;
  onClick: () => void;
  via: Via | null;
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
        {fmtQty(item.totalViales)} cajas eq. · {fmtNum(item.totalPreparaciones, 0)} {actividadLabel(via)}
      </p>
      <div className="mt-3 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(item.pctGasto, 100)}%`, backgroundColor: c.chart }}
        />
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{item.pctGasto.toFixed(1)}% del alcance actual</p>
      {!via && <ViaSplitBar porVia={item.gastoPorVia} />}
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
  servicioSelKey,
  onClickServicio,
}: {
  gastoAnualServicioReal: import('@/lib/analisis-neon').GastoAnualServicioReal[];
  onClickAnio: (anio: number) => void;
  anioSeleccionado: number | null;
  servicioSelKey: string | null;
  onClickServicio: (servicioKey: string) => void;
}) {
  const OTROS_KEY   = '__otros__';
  const OTROS_COLOR = '#94a3b8';
  const PCT_THRESHOLD = 0.03;

  const { anios, serviciosMostrados, chartData, serviciosByAnio } = useMemo(() => {
    const anioSet = new Set<number>();
    const totalPorServicio = new Map<string, { label: string; gasto: number }>();
    const detailByAnio = new Map<number, Array<{ key: string; label: string; gasto: number }>>();

    for (const r of gastoAnualServicioReal) {
      anioSet.add(r.anio);
      const prev = totalPorServicio.get(r.servicioKey) ?? { label: r.servicio, gasto: 0 };
      totalPorServicio.set(r.servicioKey, { label: r.servicio, gasto: prev.gasto + r.gasto });
      if (!detailByAnio.has(r.anio)) detailByAnio.set(r.anio, []);
      detailByAnio.get(r.anio)!.push({ key: r.servicioKey, label: r.servicio, gasto: r.gasto });
    }

    const grandTotal = [...totalPorServicio.values()].reduce((s, v) => s + v.gasto, 0);
    const principales: Array<{ key: string; label: string }> = [];
    const menores: Array<string> = [];
    for (const [key, { label, gasto }] of totalPorServicio.entries()) {
      if (grandTotal > 0 && gasto / grandTotal >= PCT_THRESHOLD) principales.push({ key, label });
      else menores.push(key);
    }
    principales.sort((a, b) => (totalPorServicio.get(b.key)?.gasto ?? 0) - (totalPorServicio.get(a.key)?.gasto ?? 0));
    const hayOtros = menores.length > 0;
    const serviciosMostrados = hayOtros
      ? [...principales, { key: OTROS_KEY, label: 'Otros servicios' }]
      : principales;

    const anios = [...anioSet].sort((a, b) => a - b);
    const rowsByKey = new Map<string, Map<number, number>>();
    for (const r of gastoAnualServicioReal) {
      const key = menores.includes(r.servicioKey) ? OTROS_KEY : r.servicioKey;
      if (!rowsByKey.has(key)) rowsByKey.set(key, new Map());
      rowsByKey.get(key)!.set(r.anio, (rowsByKey.get(key)!.get(r.anio) ?? 0) + r.gasto);
    }

    const chartData = anios.map((anio) => {
      const row: Record<string, unknown> = { anio: String(anio), anioNum: anio };
      let total = 0;
      for (const { key } of serviciosMostrados) {
        const v = rowsByKey.get(key)?.get(anio) ?? 0;
        row[key] = v;
        total += v;
      }
      row.__total = total;
      return row;
    });

    // Tooltip: desglose real por servicio (sin agrupar "otros"), ordenado por gasto desc
    for (const [anio, rows] of detailByAnio.entries()) {
      detailByAnio.set(anio, rows.sort((a, b) => b.gasto - a.gasto));
    }
    return { anios, serviciosMostrados, chartData, serviciosByAnio: detailByAnio };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gastoAnualServicioReal]);

  if (!chartData.length) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleBarClick = (barData: any) => {
    if (barData?.anioNum) onClickAnio(Number(barData.anioNum));
  };

  // Tooltip con total + desglose real por servicio
  function AnualTooltip({
    active, payload,
  }: { active?: boolean; payload?: Array<{ payload: Record<string, unknown> }> }) {
    if (!active || !payload?.length) return null;
    const row = payload[0]!.payload;
    const anioNum = row.anioNum as number;
    const total   = row.__total as number ?? 0;
    const anio    = row.anio as string;
    const rows    = serviciosByAnio.get(anioNum) ?? [];
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs shadow-lg min-w-[230px]">
        <p className="font-bold text-slate-800 mb-1.5 border-b border-slate-100 pb-1.5">
          {anio} · <span className="text-teal-700">{fmtEur(total)}</span>
        </p>
        {rows.map((s) => {
          const pct = total > 0 ? (s.gasto / total) * 100 : 0;
          return (
            <div key={s.key} className="flex items-center justify-between gap-3 py-[3px]">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="h-2 w-2 rounded-sm flex-shrink-0" style={{ backgroundColor: getServiceColor(s.key) }} />
                <span className="truncate text-slate-600">{s.label}</span>
              </div>
              <span className="tabular-nums font-semibold text-slate-700 flex-shrink-0">
                {fmtEur(s.gasto)}
                <span className="ml-1 font-normal text-slate-400">({pct.toFixed(1)}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  const lastServicioKey = serviciosMostrados.at(-1)?.key;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Referencia anual del gasto valorizado por servicio</h3>
          <p className="mt-1 text-xs text-slate-400">
            Haz clic en un año para filtrar el análisis · pasa el cursor para ver el desglose.
            {anioSeleccionado && (
              <> <span className="font-medium text-teal-700">Año {anioSeleccionado} seleccionado.</span></>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {serviciosMostrados.map(({ key, label }) => {
            const atenuado = servicioSelKey != null && key !== servicioSelKey;
            const swatch = (
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm flex-shrink-0"
                style={{ backgroundColor: key === OTROS_KEY ? OTROS_COLOR : getServiceColor(key) }}
              />
            );
            if (key === OTROS_KEY) {
              return (
                <span key={key} className={`flex items-center gap-1 text-[11px] text-slate-600 ${atenuado ? 'opacity-40' : ''}`}>
                  {swatch}
                  {label}
                </span>
              );
            }
            return (
              <button
                key={key}
                type="button"
                onClick={() => onClickServicio(key)}
                className={`flex items-center gap-1 text-[11px] hover:underline ${
                  servicioSelKey === key ? 'font-bold text-slate-900' : 'text-slate-600'
                } ${atenuado ? 'opacity-40' : ''}`}
              >
                {swatch}
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart
          data={chartData}
          margin={{ top: 22, right: 12, left: 0, bottom: 8 }}
          style={{ cursor: 'pointer' }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="anio" tick={{ fontSize: 10, fill: '#64748b' }} />
          <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v) => fmtEurShort(Number(v))} width={72} />
          <Tooltip content={<AnualTooltip />} />
          {serviciosMostrados.map(({ key, label }, idx) => {
            const isLast    = idx === serviciosMostrados.length - 1;
            const fillColor = key === OTROS_KEY ? OTROS_COLOR : getServiceColor(key);
            return (
              <Bar
                key={key}
                dataKey={key}
                name={label}
                stackId="a"
                fill={fillColor}
                radius={isLast ? [5, 5, 0, 0] : [0, 0, 0, 0]}
                onClick={handleBarClick}
              >
                {chartData.map((d) => {
                  const fueraAnio = anioSeleccionado != null && Number(d.anioNum) !== anioSeleccionado;
                  const fueraServicio = servicioSelKey != null && key !== servicioSelKey;
                  return (
                    <Cell
                      key={String(d.anio)}
                      fill={fillColor}
                      opacity={fueraServicio ? 0.15 : fueraAnio ? 0.28 : 0.88}
                    />
                  );
                })}
                {/* Etiqueta del total encima de la barra (solo en el último segmento) */}
                {key === lastServicioKey && (
                  <LabelList
                    dataKey="__total"
                    position="top"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    content={({ x, y, width, value, index }: any) => {
                      if (!value) return null;
                      const isSelected = anioSeleccionado && Number(chartData[index]?.anioNum) !== anioSeleccionado;
                      return (
                        <text
                          x={Number(x) + Number(width) / 2}
                          y={Number(y) - 5}
                          textAnchor="middle"
                          fontSize={9}
                          fontWeight={600}
                          fill={isSelected ? '#cbd5e1' : '#475569'}
                        >
                          {fmtEurShort(Number(value))}
                        </text>
                      );
                    }}
                  />
                )}
              </Bar>
            );
          })}
        </BarChart>
      </ResponsiveContainer>
      {anioSeleccionado && (
        <p className="mt-2 text-center text-[11px] text-slate-500">
          Año {anioSeleccionado} activo · vuelve a hacer clic para deseleccionar
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
  via,
}: {
  detalle: GrupoDetalle;
  showWeekly: boolean;
  onSelectMed: (cn: string) => void;
  via: Via | null;
}) {
  const actividad = actividadLabel(via);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Gasto" value={fmtEur(detalle.kpis.totalGasto)} tone="rose" />
        <KpiCard label="Cajas eq." value={fmtQty(detalle.kpis.totalViales)} tone="teal" />
        <KpiCard
          label={actividad.charAt(0).toUpperCase() + actividad.slice(1)}
          value={fmtNum(detalle.kpis.totalPreparaciones, 0)}
          tone="amber"
        />
        <KpiCard label="Medicamentos" value={String(detalle.kpis.medicamentosDistintos)} tone="violet" />
      </div>

      <div className={`grid gap-4 ${showWeekly ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
        <TemporalChart
          data={detalle.temporalHistorico}
          title="Evolución mensual del grupo"
          emptyHint="Sin actividad mensual en el período."
          showMediaMovil
        />
        {showWeekly && (
          <TemporalChart
            data={detalle.temporalReciente}
            title="Detalle semanal del grupo"
            emptyHint="Sin consumo semanal real en los últimos 6 meses del rango."
          />
        )}
      </div>

      {via !== 'ORAL' && <TopProtocolosTable items={detalle.topProtocolos} />}

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
              <th className="px-3 py-2 text-right">Gasto · cajas eq.</th>
              <th className="w-24 px-3 py-2 text-right">Variación</th>
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
                  <p className="font-semibold text-slate-800">
                    {item.principioActivo || item.nombre}
                    <span
                      className="ml-1.5 rounded px-1 py-px align-middle text-[9px] font-bold text-white"
                      style={{ backgroundColor: VIA_META[item.via].color }}
                    >
                      {VIA_META[item.via].label}
                    </span>
                  </p>
                  <p className="text-[10px] text-slate-500">
                    CN {item.cn} · {item.nombre}
                  </p>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <p className="whitespace-nowrap font-semibold text-slate-900">{fmtEur(item.totalGasto)}</p>
                  <p className="whitespace-nowrap text-[10px] text-slate-500">{fmtQty(item.totalViales)} cajas</p>
                </td>
                <td className="w-24 px-3 py-2.5 text-right"><YoyBadge pct={item.variacionYoy} /></td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-400">
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

type RangoFechas = { desde: string; hasta: string; activePreset: string };

type NavState = RangoFechas & {
  anio: number | null;
  /** Rango activo antes de seleccionar un año, para restaurarlo al quitarlo. */
  rangoPrevio: RangoFechas | null;
  servicio: string | null;
  grupo: DiagnosticoGrupo | null;
  via: Via | null;
  cn: string;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HISTORIAL = 30;

function servicioKeyCliente(label: string): string {
  return label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function initialNav(presets: Preset[]): NavState {
  const base: NavState = {
    desde: presets[2]?.desde ?? defaultDesde(),
    hasta: presets[2]?.hasta ?? defaultHasta(),
    activePreset: presets[2]?.label ?? '12 meses',
    anio: null,
    rangoPrevio: null,
    servicio: null,
    grupo: null,
    via: null,
    cn: '',
  };
  if (typeof window === 'undefined') return base;

  const q = new URLSearchParams(window.location.search);
  const nav: NavState = { ...base };
  const desde = q.get('desde');
  const hasta = q.get('hasta');
  if (desde && hasta && ISO_DATE_RE.test(desde) && ISO_DATE_RE.test(hasta)) {
    nav.desde = desde;
    nav.hasta = hasta;
    nav.activePreset = presets.find((p) => p.desde === desde && p.hasta === hasta)?.label ?? '';
  }
  const anio = Number(q.get('anio'));
  if (Number.isInteger(anio) && anio >= 2000 && anio <= 2100) {
    nav.anio = anio;
    nav.rangoPrevio = { desde: base.desde, hasta: base.hasta, activePreset: base.activePreset };
    nav.desde = `${anio}-01-01`;
    nav.hasta = `${anio}-12-31`;
    nav.activePreset = '';
  }
  const grupo = q.get('grupo');
  const via = q.get('via');
  nav.servicio = q.get('servicio') || null;
  nav.grupo = grupo && grupo in GRUPO_LABELS ? (grupo as DiagnosticoGrupo) : null;
  nav.via = via === 'IV' || via === 'ORAL' ? via : null;
  nav.cn = q.get('cn') ?? '';
  return nav;
}

function navToParams(nav: NavState): URLSearchParams {
  const params = new URLSearchParams({ desde: nav.desde, hasta: nav.hasta });
  if (nav.anio) params.set('anio', String(nav.anio));
  if (nav.servicio) params.set('servicio', nav.servicio);
  if (nav.grupo) params.set('grupo', nav.grupo);
  if (nav.via) params.set('via', nav.via);
  if (nav.cn) params.set('cn', nav.cn);
  return params;
}

function apiParams(nav: NavState): URLSearchParams {
  const params = navToParams(nav);
  params.delete('anio');
  params.set('comparativa', 'periodo-anterior');
  return params;
}

type FiltroChip = { key: string; label: string; color: string; onRemove: () => void };

function FiltrosActivosBar({
  chips,
  periodoLabel,
  puedeDeshacer,
  loading,
  onDeshacer,
  onLimpiar,
}: {
  chips: FiltroChip[];
  periodoLabel: string;
  puedeDeshacer: boolean;
  loading: boolean;
  onDeshacer: () => void;
  onLimpiar: () => void;
}) {
  return (
    <div className="sticky top-16 z-40 -mx-1 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Filtros</span>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
          {periodoLabel}
        </span>
        {chips.length === 0 && (
          <span className="text-[11px] text-slate-400">Vista global del área · haz clic en tarjetas o gráficas para filtrar</span>
        )}
        {chips.map((chip) => (
          <span
            key={chip.key}
            className="flex items-center gap-1.5 rounded-full border bg-white py-0.5 pl-2.5 pr-1 text-[11px] font-semibold text-slate-700"
            style={{ borderColor: hexToRgba(chip.color, 0.5), backgroundColor: hexToRgba(chip.color, 0.08) }}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: chip.color }} />
            {chip.label}
            <button
              type="button"
              onClick={chip.onRemove}
              aria-label={`Quitar filtro ${chip.label}`}
              className="flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700"
            >
              ✕
            </button>
          </span>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {loading && <span className="text-[11px] font-medium text-sky-700">Actualizando…</span>}
          <button
            type="button"
            onClick={onDeshacer}
            disabled={!puedeDeshacer}
            title="Deshacer el último cambio (Esc)"
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ↶ Deshacer
          </button>
          {chips.length > 0 && (
            <button
              type="button"
              onClick={onLimpiar}
              className="rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-700 hover:bg-teal-100"
            >
              Limpiar todo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AnalisisOncologiaPage() {
  const presets = useMemo(() => buildPresets(), []);
  const [nav, setNav] = useState<NavState>(() => initialNav(presets));
  const [historial, setHistorial] = useState<NavState[]>([]);
  const [soloSeleccionado, setSoloSeleccionado] = useState(false);
  const [medQuery, setMedQuery] = useState('');
  const [datos, setDatos] = useState<AnalisisDatos | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    desde,
    hasta,
    activePreset,
    anio: anioSeleccionado,
    servicio: servicioSel,
    grupo: grupoSel,
    via: viaSel,
    cn: cnSel,
  } = nav;

  const showWeekly = useMemo(() => daysBetween(desde, hasta) <= 186, [desde, hasta]);

  function updateNav(patch: Partial<NavState>) {
    setHistorial((h) => [...h.slice(-(MAX_HISTORIAL - 1)), nav]);
    setNav((prev) => ({ ...prev, ...patch }));
  }

  function deshacer() {
    const prev = historial.at(-1);
    if (!prev) return;
    setHistorial(historial.slice(0, -1));
    setNav(prev);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      deshacer();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const qs = navToParams(nav).toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${qs}`);
  }, [nav]);

  const apiQuery = useMemo(() => apiParams(nav).toString(), [nav]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/analisis/datos?${apiQuery}`)
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
  }, [apiQuery]);

  useEffect(() => {
    if (!datos || !cnSel) return;
    if (!datos.medicamentos.some((med) => med.cn === cnSel)) {
      setNav((prev) => ({ ...prev, cn: '' }));
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
    updateNav({
      desde: preset.desde,
      hasta: preset.hasta,
      activePreset: preset.label,
      anio: null,
      rangoPrevio: null,
    });
  }

  function setFecha(campo: 'desde' | 'hasta', value: string) {
    updateNav({ [campo]: value, activePreset: '', anio: null, rangoPrevio: null });
  }

  function rangoTrasQuitarAnio(): RangoFechas {
    if (nav.rangoPrevio) return nav.rangoPrevio;
    const todo = presets.find((p) => p.label === PRESET_TODO_PERIODO);
    return {
      desde: todo?.desde ?? DESDE_TODO_PERIODO,
      hasta: todo?.hasta ?? defaultHasta(),
      activePreset: PRESET_TODO_PERIODO,
    };
  }

  function quitarAnio() {
    updateNav({ anio: null, rangoPrevio: null, ...rangoTrasQuitarAnio() });
  }

  function handleClickAnio(anio: number) {
    if (anioSeleccionado === anio) {
      quitarAnio();
      return;
    }
    updateNav({
      anio,
      desde: `${anio}-01-01`,
      hasta: `${anio}-12-31`,
      activePreset: '',
      rangoPrevio: anioSeleccionado ? nav.rangoPrevio : { desde, hasta, activePreset },
    });
  }

  function handleSelectServicio(servicio: string | null) {
    updateNav({ servicio: servicio && servicio === servicioSel ? null : servicio });
  }

  function handleSelectServicioKey(key: string) {
    const label =
      datos?.servicios.find((s) => s.servicioKey === key)?.servicio ??
      datos?.gastoAnualServicioReal.find((s) => s.servicioKey === key)?.servicio ??
      null;
    if (label) handleSelectServicio(label);
  }

  function handleSelectGrupo(grupo: DiagnosticoGrupo) {
    updateNav({ grupo: grupoSel === grupo ? null : grupo });
  }

  function handleSelectVia(via: Via) {
    updateNav({ via: viaSel === via ? null : via });
  }

  function handleSelectCn(cn: string) {
    updateNav({ cn });
  }

  function limpiarFiltros() {
    updateNav({
      servicio: null,
      grupo: null,
      via: null,
      cn: '',
      ...(anioSeleccionado ? { anio: null, rangoPrevio: null, ...rangoTrasQuitarAnio() } : {}),
    });
  }

  const servicioSelKey = servicioSel
    ? datos?.servicios.find((s) => s.servicio === servicioSel)?.servicioKey ?? servicioKeyCliente(servicioSel)
    : null;

  const medSel = cnSel ? datos?.medicamentos.find((m) => m.cn === cnSel) : undefined;

  const chips: FiltroChip[] = [];
  if (anioSeleccionado) {
    chips.push({ key: 'anio', label: `Año ${anioSeleccionado}`, color: getYearColor(anioSeleccionado), onRemove: quitarAnio });
  }
  if (servicioSel) {
    chips.push({
      key: 'servicio',
      label: servicioSel,
      color: getServiceColor(servicioSelKey ?? servicioSel),
      onRemove: () => updateNav({ servicio: null }),
    });
  }
  if (grupoSel) {
    chips.push({
      key: 'grupo',
      label: GRUPO_LABELS[grupoSel],
      color: GRUPO_COLORS[grupoSel].chart,
      onRemove: () => updateNav({ grupo: null }),
    });
  }
  if (viaSel) {
    chips.push({
      key: 'via',
      label: `Vía ${VIA_META[viaSel].label}`,
      color: VIA_META[viaSel].color,
      onRemove: () => updateNav({ via: null }),
    });
  }
  if (cnSel) {
    chips.push({
      key: 'cn',
      label: medSel ? (medSel.principioActivo || medSel.nombre) : `CN ${cnSel}`,
      color: SERIES_COLORS.consumo,
      onRemove: () => updateNav({ cn: '' }),
    });
  }

  const periodoLabel = anioSeleccionado
    ? `Año ${anioSeleccionado}`
    : activePreset || `${fmtDate(desde)} – ${fmtDate(hasta)}`;

  const servicioFoco = servicioSel ? datos?.servicios.find((s) => s.servicio === servicioSel) : undefined;
  const serviciosResto = servicioFoco
    ? (datos?.servicios ?? []).filter((s) => s.servicioKey !== servicioFoco.servicioKey)
    : [];

  function handleExportar() {
    window.open(`/api/analisis/exportar?${apiParams(nav)}`, '_blank');
  }

  function handleExportarPdf() {
    window.open(`/api/analisis/informe/pdf?${apiParams(nav)}`, '_blank');
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
                onChange={(e) => setFecha('desde', e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
              <span>—</span>
              <input
                type="date"
                value={hasta}
                onChange={(e) => setFecha('hasta', e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>
            <p className="text-xs text-slate-500">
              Comparativa automática: <span className="font-medium text-slate-700">{datos?.comparativa.etiqueta ?? 'periodo anterior equivalente'}</span>
            </p>
          </div>
        </div>
      </div>

      <FiltrosActivosBar
        chips={chips}
        periodoLabel={periodoLabel}
        puedeDeshacer={historial.length > 0}
        loading={loading && !!datos}
        onDeshacer={deshacer}
        onLimpiar={limpiarFiltros}
      />

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {loading && !datos && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
          <span className="ml-3 text-sm text-slate-500">Cargando análisis…</span>
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
            servicioSelKey={servicioSelKey}
            onClickServicio={handleSelectServicioKey}
          />

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-700">Servicios reales</h2>
                <p className="text-xs text-slate-400">
                  {servicioFoco
                    ? 'Servicio destacado · haz clic en otro para cambiar o en el mismo para volver a todos.'
                    : 'Filtra por el servicio clínico real que consta en consumo.'}
                </p>
              </div>
              {servicioFoco && serviciosResto.length > 0 && (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={soloSeleccionado}
                    onChange={(e) => setSoloSeleccionado(e.target.checked)}
                    className="h-3.5 w-3.5 accent-teal-600"
                  />
                  Mostrar solo el seleccionado
                </label>
              )}
            </div>
            {servicioFoco ? (
              <div className="space-y-3">
                <ServicioCardUI
                  item={servicioFoco}
                  selected
                  onClick={() => handleSelectServicio(null)}
                  gastoAnualServicioReal={datos.gastoAnualServicioReal}
                  mostrarVia={!viaSel}
                />
                {!soloSeleccionado && serviciosResto.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {serviciosResto.map((item) => (
                      <ServicioMiniCard
                        key={item.servicioKey}
                        item={item}
                        onClick={() => handleSelectServicio(item.servicio)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {datos.servicios.map((item) => (
                  <ServicioCardUI
                    key={item.servicioKey}
                    item={item}
                    selected={false}
                    onClick={() => handleSelectServicio(item.servicio)}
                    gastoAnualServicioReal={datos.gastoAnualServicioReal}
                    mostrarVia={!viaSel}
                  />
                ))}
                {datos.servicios.length === 0 && (
                  <p className="text-xs text-slate-400">Ningún servicio con consumo para los filtros actuales.</p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">Tipos tumorales</h2>
              <p className="text-xs text-slate-400">
                Clasificación tumoral sobre el servicio y la vía seleccionados. La barra inferior muestra el reparto del gasto IV / Oral.
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
              {datos.grupos.map((item) => (
                <GrupoCardUI
                  key={item.grupo}
                  item={item}
                  selected={grupoSel === item.grupo}
                  onClick={() => handleSelectGrupo(item.grupo)}
                  via={viaSel}
                />
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">Medicamentos IV y orales</h2>
              <p className="text-xs text-slate-400">
                Sobre el servicio y el tipo tumoral seleccionados. Haz clic para analizar solo una vía.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {datos.vias.map((item) => (
                <ViaCardUI
                  key={item.via}
                  item={item}
                  selected={viaSel === item.via}
                  onClick={() => handleSelectVia(item.via)}
                />
              ))}
            </div>
          </div>

          <div className={`grid gap-4 ${showWeekly ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
            <TemporalChart
              data={datos.temporalHistorico}
              title="Evolución mensual del alcance actual"
              emptyHint="Sin consumo mensual para el rango seleccionado."
              showGrupoBreakdown
              showMediaMovil
            />
            {showWeekly && (
              <TemporalChart
                data={datos.temporalReciente}
                title="Detalle semanal del alcance actual"
                emptyHint="Sin consumo semanal real en los últimos 6 meses del rango."
              />
            )}
          </div>

          {viaSel !== 'ORAL' && <TopProtocolosTable items={datos.topProtocolos} />}

          {grupoSel && datos.grupoDetalle && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-5">
              <div className="flex items-center gap-2 mb-5">
                <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${GRUPO_COLORS[grupoSel].bg} ${GRUPO_COLORS[grupoSel].text} ${GRUPO_COLORS[grupoSel].ring}`}>
                  {GRUPO_LABELS[grupoSel]}
                </span>
                <h2 className="text-base font-bold text-slate-800">Detalle asistencial y económico del grupo</h2>
              </div>
              <GrupoDetallePanel
                detalle={datos.grupoDetalle}
                showWeekly={showWeekly}
                onSelectMed={handleSelectCn}
                via={viaSel}
              />
            </div>
          )}

          <div className="grid items-stretch grid-cols-1 xl:grid-cols-[1.05fr_1.45fr] gap-4">
            <MedicamentoListTable
              items={medicamentosFiltrados}
              selectedCn={cnSel}
              query={medQuery}
              onQueryChange={setMedQuery}
              onSelect={handleSelectCn}
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
