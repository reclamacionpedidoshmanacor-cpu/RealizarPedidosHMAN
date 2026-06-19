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
  tipoComponente: string;
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
// Componente: tarjeta KPI
// ---------------------------------------------------------------------------
function KpiCard({
  label, value, sub, color, icon,
}: {
  label: string; value: string | number; sub?: string; color: string; icon: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex items-start gap-4">
      <div className={`text-2xl mt-0.5 ${color}`}>{icon}</div>
      <div>
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide leading-tight">{label}</p>
        <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
      </div>
    </div>
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
          Sin datos de pedidos recibidos disponibles para este medicamento en el sistema externo.
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
  }, [cargarOperativo, cargarTendencias]);

  const toggleCurva = (cn: string) => {
    setExpandedCn(prev => prev === cn ? null : cn);
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
            />
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* BLOQUE 2 — Tendencias de consumo                                    */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="text-base font-semibold text-slate-700 mb-1 flex items-center gap-2">
          <span className="inline-block w-1 h-4 bg-indigo-500 rounded-full" />
          Tendencias de consumo
        </h2>
        <p className="text-xs text-slate-400 mb-3">
          Medicamentos con aumento de consumo &gt;10% en los últimos 3 meses respecto a los 3 meses anteriores.
          Haz clic en un medicamento para ver la evolución y cruzarla con los pedidos recibidos.
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
