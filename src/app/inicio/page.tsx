'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
type ResumenOperativo = {
  recuentosPendientes: number;
  propuestasBorrador: number;
  ultimaPropuestaTramitadaEn: string | null;
  ultimoRecuentoFecha: string | null;
  bajoMinimo: number;
  bajoOPunto: number;
};

type TendenciaMedicamento = {
  cn: string;
  componente: string;
  medicamento: string;
  periodoActual: number;
  periodoAnterior: number;
  variacionPct: number;
  temporalActual: { mes: number; anio: number; label: string; viales: number }[];
};

type CurvaMes = { anio: number; mes: number; label: string; viales: number; pacientes: number };
type PedidoMes = { anio: number; mes: number; label: string; cantidad: number };

type CurvaData = {
  consumo: CurvaMes[];
  pedidos: PedidoMes[];
};

type BajoMinimoItem = {
  cn: string;
  principioActivo: string | null;
  nombre: string;
  stockActualCajas: number;
  stockActualUnidades: number;
  stockMinimo: number;
  puntoPedido: number;
};

type AlertaCompra = {
  cn: string;
  componente: string;
  medicamento: string;
  unidadesPorCaja: number;
  stockActualUnidades: number;
  stockActualCajas: number;
  stockMinimo: number;
  stockMaximo: number;
  consumoReciente: number;
  consumoAnterior: number;
  promedioSemanal: number;
  variacionPct: number | null;
  tendenciaCreciente: boolean;
  tendenciaRelevante: boolean;
  coberturaSemanas: number | null;
  semaforo: 'rojo' | 'naranja' | 'verde' | 'azul' | 'gris';
  semanasSeries: { semana: number; anio: number; label: string; viales: number }[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatFecha(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

function variacionColor(pct: number): string {
  if (pct >= 50) return 'text-red-600';
  if (pct >= 25) return 'text-orange-500';
  return 'text-amber-500';
}

function variacionBg(pct: number): string {
  if (pct >= 50) return 'bg-red-50 border-red-200';
  if (pct >= 25) return 'bg-orange-50 border-orange-200';
  return 'bg-amber-50 border-amber-200';
}

// ---------------------------------------------------------------------------
// Helpers semáforo
// ---------------------------------------------------------------------------
const SEMAFORO_CFG = {
  rojo:   { bg: 'bg-red-50 border-red-200',     dot: 'bg-red-500',    text: 'text-red-700',    label: 'Cobertura crítica (<4 sem)' },
  naranja:{ bg: 'bg-orange-50 border-orange-200', dot: 'bg-orange-400', text: 'text-orange-700', label: 'Cobertura ajustada (4-6 sem)' },
  verde:  { bg: 'bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Cobertura adecuada (6-10 sem)' },
  azul:   { bg: 'bg-sky-50 border-sky-200',     dot: 'bg-sky-500',    text: 'text-sky-700',    label: 'Cobertura amplia (>10 sem)' },
  gris:   { bg: 'bg-slate-50 border-slate-200', dot: 'bg-slate-400',  text: 'text-slate-600',  label: 'Sin datos suficientes' },
} as const;

function fmtCobertura(c: number | null): string {
  if (c === null) return '—';
  if (c > 52) return '>1 año';
  return `${c.toFixed(1)} sem`;
}

// ---------------------------------------------------------------------------
// Componente: mini curva semanal de consumo (barras CSS puras, sin recharts)
// ---------------------------------------------------------------------------
function MiniCurvaSemanal({
  series, promedioSemanal
}: {
  series: AlertaCompra['semanasSeries'];
  promedioSemanal: number;
}) {
  if (series.length === 0) return null;
  const maxVal = Math.max(...series.map(s => s.viales), promedioSemanal * 1.2, 1);
  const w = 100 / series.length;

  return (
    <div className="mt-3">
      <p className="text-[10px] text-slate-400 mb-1 uppercase tracking-wide">Consumo semanal (últimas 16 semanas)</p>
      <div className="flex items-end gap-px h-16 relative">
        <div
          className="absolute inset-x-0 border-t border-dashed border-indigo-300 opacity-60"
          style={{ bottom: `${(promedioSemanal / maxVal) * 100}%` }}
        />
        {series.map((s) => {
          const h = maxVal > 0 ? Math.max((s.viales / maxVal) * 100, s.viales > 0 ? 4 : 0) : 0;
          return (
            <div
              key={`${s.anio}-${s.semana}`}
              className="relative group flex-1 flex flex-col justify-end"
              style={{ width: `${w}%` }}
            >
              <div
                className="w-full bg-teal-400 rounded-sm transition-all"
                style={{ height: `${h}%`, minHeight: s.viales > 0 ? '3px' : '0' }}
              />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:flex flex-col items-center z-10">
                <div className="bg-slate-800 text-white text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap shadow">
                  {s.label}: {s.viales.toFixed(0)} viales
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
        <span>{series[0]?.label ?? ''}</span>
        <span className="text-indigo-400">— prom. {promedioSemanal.toFixed(1)}/sem</span>
        <span>{series[series.length - 1]?.label ?? ''}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente: tarjeta de alerta de compra
// ---------------------------------------------------------------------------
function AlertaCard({ alerta, expanded, onToggle }: {
  alerta: AlertaCompra;
  expanded: boolean;
  onToggle: () => void;
}) {
  const cfg = SEMAFORO_CFG[alerta.semaforo];
  const fmtN = (n: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(n);

  return (
    <div className={`rounded-xl border ${cfg.bg} overflow-hidden`}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-center gap-3"
      >
        <div className={`w-3 h-3 rounded-full flex-shrink-0 ${cfg.dot}`} title={cfg.label} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono text-slate-400 bg-white/70 px-1.5 py-0.5 rounded">
              {alerta.cn}
            </span>
            <span className={`text-sm font-semibold ${cfg.text}`}>{alerta.componente || '—'}</span>
            {alerta.medicamento && (
              <span className="text-xs text-slate-400 italic truncate">{alerta.medicamento}</span>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 text-right text-xs">
          <div className={`font-bold ${cfg.text}`}>{fmtCobertura(alerta.coberturaSemanas)}</div>
          <div className="text-slate-500">Stock: {fmtN(alerta.stockActualUnidades)} uds</div>
          {alerta.tendenciaRelevante && (
            <div className={`font-semibold mt-0.5 ${alerta.tendenciaCreciente ? 'text-orange-600' : 'text-sky-600'}`}>
              {alerta.tendenciaCreciente ? '↑' : '↓'}
              {alerta.variacionPct !== null ? ` ${Math.abs(alerta.variacionPct).toFixed(0)}%` : ''}
            </div>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-white/60 bg-white/50">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-xs">
            <div>
              <p className="text-slate-400 uppercase tracking-wide text-[10px]">Cobertura</p>
              <p className={`font-bold text-base ${cfg.text}`}>{fmtCobertura(alerta.coberturaSemanas)}</p>
              <p className="text-slate-400 text-[10px]">Objetivo: 8 sem</p>
            </div>
            <div>
              <p className="text-slate-400 uppercase tracking-wide text-[10px]">Stock actual</p>
              <p className="font-semibold text-slate-700">{fmtN(alerta.stockActualUnidades)} uds</p>
              <p className="text-slate-400 text-[10px]">{fmtN(alerta.stockActualCajas)} cajas</p>
            </div>
            <div>
              <p className="text-slate-400 uppercase tracking-wide text-[10px]">Consumo (8 sem)</p>
              <p className="font-semibold text-slate-700">{fmtN(alerta.consumoReciente)} viales</p>
              <p className="text-slate-400 text-[10px]">Prom. {fmtN(alerta.promedioSemanal)}/sem</p>
            </div>
            <div>
              <p className="text-slate-400 uppercase tracking-wide text-[10px]">Tendencia</p>
              {alerta.variacionPct !== null ? (
                <>
                  <p className={`font-semibold ${alerta.tendenciaCreciente ? 'text-orange-600' : 'text-sky-600'}`}>
                    {alerta.tendenciaCreciente ? '+' : ''}{alerta.variacionPct.toFixed(1)}%
                  </p>
                  <p className="text-slate-400 text-[10px]">
                    {alerta.consumoAnterior.toFixed(0)} → {alerta.consumoReciente.toFixed(0)} viales
                  </p>
                </>
              ) : (
                <p className="text-slate-400">Sin datos previos</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3 text-xs text-slate-500">
            <div>Stock mínimo: <span className="font-medium text-slate-700">{fmtN(alerta.stockMinimo)} uds</span></div>
            <div>Stock máximo: <span className="font-medium text-slate-700">{fmtN(alerta.stockMaximo)} uds</span></div>
            <div>Múltiplo: <span className="font-medium text-slate-700">{alerta.unidadesPorCaja} uds/caja</span></div>
          </div>
          <MiniCurvaSemanal series={alerta.semanasSeries} promedioSemanal={alerta.promedioSemanal} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente: tarjeta KPI
// ---------------------------------------------------------------------------
function KpiCard({
  label, value, sub, color, icon, onClick,
}: {
  label: string; value: string | number; sub?: string; color: string; icon: string;
  onClick?: () => void;
}) {
  const clickable = typeof onClick === 'function';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={`w-full bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex items-start gap-4 text-left ${
        clickable ? 'hover:bg-slate-50 transition-colors cursor-pointer' : 'cursor-default'
      }`}
    >
      <div className={`text-2xl mt-0.5 ${color}`}>{icon}</div>
      <div>
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide leading-tight">{label}</p>
        <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Componente: mini barra de progreso para mostrar variación relativa
// ---------------------------------------------------------------------------
function MiniBar({ pct }: { pct: number }) {
  const w = Math.min(pct, 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${pct >= 50 ? 'bg-red-400' : pct >= 25 ? 'bg-orange-400' : 'bg-amber-400'}`}
          style={{ width: `${w}%` }}
        />
      </div>
      <span className={`text-xs font-semibold tabular-nums ${variacionColor(pct)}`}>
        +{pct.toFixed(1)}%
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente: panel de curva expandible
// ---------------------------------------------------------------------------
function CurvaPanel({ cn, componente, medicamento }: { cn: string; componente: string; medicamento: string }) {
  const [data, setData] = useState<CurvaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/inicio/curva?cn=${encodeURIComponent(cn)}`)
      .then(r => r.json())
      .then((d: CurvaData & { error?: string }) => {
        if (d.error) { setError(d.error); return; }
        setData(d);
      })
      .catch(() => setError('Error al cargar la curva'))
      .finally(() => setLoading(false));
  }, [cn]);

  // Fusionar consumo y pedidos por etiqueta mes
  const chartData = (() => {
    if (!data) return [];
    const map = new Map<string, { label: string; consumo?: number; pedidos?: number }>();
    for (const c of data.consumo) {
      map.set(c.label, { label: c.label, consumo: c.viales });
    }
    for (const p of data.pedidos) {
      const prev = map.get(p.label) ?? { label: p.label };
      map.set(p.label, { ...prev, pedidos: p.cantidad });
    }
    return Array.from(map.values()).sort((a, b) => {
      const ia = data.consumo.findIndex(x => x.label === a.label);
      const ib = data.consumo.findIndex(x => x.label === b.label);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  })();

  const hasPedidos = chartData.some(d => d.pedidos !== undefined);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 mt-2">
      <p className="text-xs text-slate-500 mb-1 uppercase tracking-wide font-medium">Evolución mensual</p>
      <p className="text-sm font-semibold text-slate-700 mb-4">
        {componente} <span className="text-slate-400 font-normal">· {medicamento}</span>
      </p>

      {loading && <p className="text-sm text-slate-400 text-center py-6">Cargando curva…</p>}
      {error && <p className="text-sm text-red-500 text-center py-6">{error}</p>}

      {!loading && !error && data && (
        chartData.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">Sin datos disponibles.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickLine={false}
                axisLine={false}
                width={36}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                labelStyle={{ fontWeight: 600, color: '#334155' }}
              />
              {hasPedidos && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />}
              <Line
                type="monotone"
                dataKey="consumo"
                name="Consumo (viales)"
                stroke="#0f766e"
                strokeWidth={2}
                dot={{ r: 3, fill: '#0f766e' }}
                activeDot={{ r: 5 }}
                connectNulls
              />
              {hasPedidos && (
                <Line
                  type="monotone"
                  dataKey="pedidos"
                  name="Pedidos recibidos (ud)"
                  stroke="#6366f1"
                  strokeWidth={2}
                  strokeDasharray="4 2"
                  dot={{ r: 3, fill: '#6366f1' }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        )
      )}

      {!loading && !error && !hasPedidos && (
        <p className="text-xs text-slate-400 mt-2">
          Sin pedidos recibidos en la ventana de 6 meses para este medicamento.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------
export default function InicioPage() {
  const [operativo, setOperativo] = useState<ResumenOperativo | null>(null);
  const [tendencias, setTendencias] = useState<TendenciaMedicamento[]>([]);
  const [loadingOp, setLoadingOp] = useState(true);
  const [loadingTend, setLoadingTend] = useState(true);
  const [errorOp, setErrorOp] = useState<string | null>(null);
  const [errorTend, setErrorTend] = useState<string | null>(null);
  const [expandedCn, setExpandedCn] = useState<string | null>(null);
  const [bajoMinimoOpen, setBajoMinimoOpen] = useState(false);
  const [bajoMinimoLoading, setBajoMinimoLoading] = useState(false);
  const [bajoMinimoError, setBajoMinimoError] = useState<string | null>(null);
  const [bajoMinimoItems, setBajoMinimoItems] = useState<BajoMinimoItem[]>([]);

  // Alertas de compra
  const [alertasOpen, setAlertasOpen] = useState(false);
  const [alertasLoading, setAlertasLoading] = useState(false);
  const [alertasError, setAlertasError] = useState<string | null>(null);
  const [alertas, setAlertas] = useState<AlertaCompra[]>([]);
  const [expandedAlertaCn, setExpandedAlertaCn] = useState<string | null>(null);

  const cargarOperativo = useCallback(() => {
    setLoadingOp(true);
    setErrorOp(null);
    fetch('/api/inicio/operativo')
      .then(r => r.json())
      .then((d: ResumenOperativo & { error?: string }) => {
        if (d.error) { setErrorOp(d.error); return; }
        setOperativo(d);
      })
      .catch(() => setErrorOp('Error al cargar el resumen operativo'))
      .finally(() => setLoadingOp(false));
  }, []);

  const cargarTendencias = useCallback(() => {
    setLoadingTend(true);
    setErrorTend(null);
    fetch('/api/inicio/tendencias')
      .then(r => r.json())
      .then((d: { tendencias: TendenciaMedicamento[]; error?: string }) => {
        if (d.error) { setErrorTend(d.error); return; }
        setTendencias(d.tendencias ?? []);
      })
      .catch(() => setErrorTend('Error al cargar las tendencias'))
      .finally(() => setLoadingTend(false));
  }, []);

  useEffect(() => {
    cargarOperativo();
    cargarTendencias();
    // Cargar alertas al montar
    setAlertasLoading(true);
    fetch('/api/inicio/alertas-compra')
      .then(r => r.json())
      .then((d: { alertas?: AlertaCompra[]; error?: string }) => {
        if (d.error) { setAlertasError(d.error); return; }
        setAlertas(d.alertas ?? []);
      })
      .catch(() => setAlertasError('Error al cargar alertas'))
      .finally(() => setAlertasLoading(false));
  }, [cargarOperativo, cargarTendencias]);

  const toggleCurva = (cn: string) => {
    setExpandedCn(prev => prev === cn ? null : cn);
  };

  const toggleBajoMinimo = () => {
    const nextOpen = !bajoMinimoOpen;
    setBajoMinimoOpen(nextOpen);
    if (!nextOpen) return;
    if (bajoMinimoItems.length > 0 || bajoMinimoLoading) return;

    setBajoMinimoLoading(true);
    setBajoMinimoError(null);
    fetch('/api/inicio/bajo-minimo')
      .then(r => r.json())
      .then((d: { medicamentos?: BajoMinimoItem[]; error?: string }) => {
        if (d.error) {
          setBajoMinimoError(d.error);
          return;
        }
        setBajoMinimoItems(d.medicamentos ?? []);
      })
      .catch(() => setBajoMinimoError('Error al cargar medicamentos bajo mínimo'))
      .finally(() => setBajoMinimoLoading(false));
  };

  return (
    <div className="space-y-8 px-2 pb-10">

      {/* ------------------------------------------------------------------ */}
      {/* BLOQUE 1 — Estado operativo                                          */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="text-base font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <span className="inline-block w-1 h-4 bg-teal-600 rounded-full" />
          Estado operativo
        </h2>

        {loadingOp && (
          <p className="text-sm text-slate-400">Cargando…</p>
        )}
        {errorOp && (
          <p className="text-sm text-red-500">{errorOp}</p>
        )}

        {operativo && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <KpiCard
              label="Recuentos pendientes de tramitar"
              value={operativo.recuentosPendientes}
              sub={operativo.ultimoRecuentoFecha ? `Último: ${formatFecha(operativo.ultimoRecuentoFecha)}` : undefined}
              color={operativo.recuentosPendientes > 0 ? 'text-amber-500' : 'text-teal-600'}
              icon={operativo.recuentosPendientes > 0 ? '⏳' : '✓'}
            />
            <KpiCard
              label="Propuestas en borrador"
              value={operativo.propuestasBorrador}
              sub={operativo.ultimaPropuestaTramitadaEn
                ? `Última tramitada: ${formatFecha(operativo.ultimaPropuestaTramitadaEn)}`
                : undefined}
              color={operativo.propuestasBorrador > 0 ? 'text-amber-500' : 'text-teal-600'}
              icon={operativo.propuestasBorrador > 0 ? '📋' : '✓'}
            />
            <KpiCard
              label="Medicamentos bajo stock mínimo"
              value={operativo.bajoMinimo}
              sub={operativo.bajoOPunto > 0 ? `${operativo.bajoOPunto} en o bajo punto de pedido` : undefined}
              color={operativo.bajoMinimo > 0 ? 'text-red-500' : 'text-teal-600'}
              icon={operativo.bajoMinimo > 0 ? '⚠️' : '✓'}
              onClick={operativo.bajoMinimo > 0 ? toggleBajoMinimo : undefined}
            />
          </div>
        )}

        {bajoMinimoOpen && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-rose-700">
                Medicamentos bajo stock mínimo
              </p>
              <p className="text-xs text-rose-500">
                Haz clic en un medicamento para abrir Catálogo y revisarlo.
              </p>
            </div>

            {bajoMinimoLoading && <p className="text-sm text-slate-500">Cargando listado…</p>}
            {bajoMinimoError && <p className="text-sm text-rose-600">{bajoMinimoError}</p>}

            {!bajoMinimoLoading && !bajoMinimoError && bajoMinimoItems.length === 0 && (
              <p className="text-sm text-slate-500">No se han encontrado medicamentos bajo mínimo en el último recuento.</p>
            )}

            {!bajoMinimoLoading && !bajoMinimoError && bajoMinimoItems.length > 0 && (
              <div className="space-y-2">
                {bajoMinimoItems.map((item) => (
                  <button
                    key={item.cn}
                    type="button"
                    onClick={() => { window.location.href = `/catalogo?q=${encodeURIComponent(item.cn)}`; }}
                    className="w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-left hover:bg-rose-100 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-mono text-slate-500">CN {item.cn}</p>
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {item.principioActivo ?? item.nombre}
                        </p>
                        {item.principioActivo && (
                          <p className="text-xs italic text-slate-400 truncate">{item.nombre}</p>
                        )}
                      </div>
                      <div className="text-right text-xs">
                        <p className="text-rose-700 font-semibold">
                          Stock: {item.stockActualCajas.toFixed(2)} cajas ({item.stockActualUnidades.toFixed(0)} uds)
                        </p>
                        <p className="text-slate-500">
                          Mínimo: {item.stockMinimo.toFixed(2)} · Punto pedido: {item.puntoPedido.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* BLOQUE 2 — Alertas de compra (semáforo de cobertura)               */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <div className="flex items-center justify-between mb-1 gap-3">
          <h2 className="text-base font-semibold text-slate-700 flex items-center gap-2">
            <span className="inline-block w-1 h-4 bg-orange-500 rounded-full" />
            Alertas de compra
          </h2>
          <button
            type="button"
            onClick={() => setAlertasOpen(o => !o)}
            className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
          >
            {alertasOpen ? 'Ocultar' : 'Ver listado'}
            <svg
              className={`w-3.5 h-3.5 transition-transform ${alertasOpen ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          Cobertura estimada = stock actual / consumo promedio semanal (últimas 8 semanas).
          Objetivo: 8 semanas. Umbral de tendencia relevante: variación &gt;25% con cambio ≥2 viales/sem o ≥1 caja/sem.
        </p>

        {/* Leyenda semáforo */}
        <div className="flex flex-wrap gap-3 mb-3">
          {(Object.entries(SEMAFORO_CFG) as [keyof typeof SEMAFORO_CFG, typeof SEMAFORO_CFG[keyof typeof SEMAFORO_CFG]][]).map(([key, cfg]) => {
            const cnt = alertas.filter(a => a.semaforo === key).length;
            if (cnt === 0 && !alertasLoading) return null;
            return (
              <div key={key} className="flex items-center gap-1.5 text-xs text-slate-600">
                <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                <span>{cfg.label}</span>
                {cnt > 0 && <span className="font-semibold">({cnt})</span>}
              </div>
            );
          })}
        </div>

        {alertasLoading && <p className="text-sm text-slate-400">Calculando alertas…</p>}
        {alertasError && <p className="text-sm text-red-500">{alertasError}</p>}

        {!alertasLoading && !alertasError && alertas.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center">
            <p className="text-sm text-slate-500 font-medium">Sin alertas activas</p>
            <p className="text-xs text-slate-400 mt-1">
              No hay medicamentos en el catálogo con datos de stock y consumo suficientes, o todos tienen cobertura adecuada.
            </p>
          </div>
        )}

        {!alertasLoading && !alertasError && alertas.length > 0 && (
          <>
            {/* Resumen siempre visible: solo rojos y naranjas */}
            {!alertasOpen && (
              <div className="space-y-2">
                {alertas.filter(a => a.semaforo === 'rojo' || a.semaforo === 'naranja').slice(0, 5).map(a => (
                  <AlertaCard
                    key={a.cn}
                    alerta={a}
                    expanded={expandedAlertaCn === a.cn}
                    onToggle={() => setExpandedAlertaCn(prev => prev === a.cn ? null : a.cn)}
                  />
                ))}
                {alertas.filter(a => a.semaforo === 'rojo' || a.semaforo === 'naranja').length === 0 && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                    <p className="text-sm text-emerald-700 font-medium">Sin alertas críticas</p>
                    <p className="text-xs text-emerald-600 mt-1">
                      No hay medicamentos en rojo ni naranja. Haz clic en &quot;Ver listado&quot; para revisar todos.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Listado completo cuando está abierto */}
            {alertasOpen && (
              <div className="space-y-2">
                {alertas.map(a => (
                  <AlertaCard
                    key={a.cn}
                    alerta={a}
                    expanded={expandedAlertaCn === a.cn}
                    onToggle={() => setExpandedAlertaCn(prev => prev === a.cn ? null : a.cn)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* BLOQUE 3 — Tendencias de consumo                                    */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="text-base font-semibold text-slate-700 mb-1 flex items-center gap-2">
          <span className="inline-block w-1 h-4 bg-indigo-500 rounded-full" />
          Tendencias de consumo
        </h2>
        <p className="text-xs text-slate-400 mb-3">
          Ventana visible: últimos 6 meses. El indicador de tendencia marca aumento &gt;10% comparando los 3 meses más recientes frente a los 3 anteriores.
          Haz clic en un medicamento para ver la evolución mensual y los pedidos recibidos.
        </p>

        {loadingTend && (
          <p className="text-sm text-slate-400">Cargando tendencias…</p>
        )}
        {errorTend && (
          <p className="text-sm text-red-500">{errorTend}</p>
        )}

        {!loadingTend && !errorTend && tendencias.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center">
            <p className="text-sm text-slate-500 font-medium">Sin tendencias detectadas</p>
            <p className="text-xs text-slate-400 mt-1">
              No hay medicamentos con un aumento de consumo superior al 10% en el período analizado,
              o aún no se han importado datos de consumo para esta área.
            </p>
          </div>
        )}

        {!loadingTend && tendencias.length > 0 && (
          <div className="space-y-2">
            {tendencias.map(t => (
              <div key={t.cn}>
                <button
                  onClick={() => toggleCurva(t.cn)}
                  className={`w-full text-left rounded-xl border p-4 transition-colors ${
                    expandedCn === t.cn
                      ? 'border-indigo-300 bg-indigo-50'
                      : `border ${variacionBg(t.variacionPct)}`
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                          {t.cn}
                        </span>
                        <span className="font-semibold text-slate-800 text-sm">{t.componente || '—'}</span>
                        {t.medicamento && (
                          <span className="text-xs text-slate-400 italic">{t.medicamento}</span>
                        )}
                      </div>
                      <div className="mt-2 max-w-xs">
                        <MiniBar pct={t.variacionPct} />
                      </div>
                    </div>

                    <div className="flex-shrink-0 text-right">
                      <div className="text-xs text-slate-500 mb-0.5">Período anterior → actual</div>
                      <div className="text-sm font-semibold text-slate-700 tabular-nums">
                        {t.periodoAnterior.toFixed(0)} → {t.periodoActual.toFixed(0)}
                        <span className="ml-1 text-xs font-normal text-slate-400">viales</span>
                      </div>
                      <div className="mt-1">
                        <span className={`text-xs font-bold ${variacionColor(t.variacionPct)}`}>
                          ↑ +{t.variacionPct.toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    <div className="flex-shrink-0 text-slate-400">
                      <svg
                        className={`w-4 h-4 transition-transform ${expandedCn === t.cn ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </button>

                {expandedCn === t.cn && (
                  <CurvaPanel cn={t.cn} componente={t.componente} medicamento={t.medicamento} />
                )}
              </div>
            ))}
          </div>
        )}
      </section>

    </div>
  );
}
