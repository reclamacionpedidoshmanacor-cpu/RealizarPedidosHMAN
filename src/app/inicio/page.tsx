'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  ReferenceLine,
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

type DireccionMovimiento = 'sube' | 'baja' | 'parado' | 'nuevo';

type MovimientoConsumo = {
  cn: string;
  componente: string;
  medicamento: string;
  ppioActivoCima: string | null;
  unidadesPorCaja: number;
  direccion: DireccionMovimiento;
  periodoReciente: number;
  periodoAnterior: number;
  promedioSemanalReciente: number;
  promedioSemanalAnterior: number;
  variacionPct: number | null;
  deltaVialesPeriodo: number;
  semanasSeries: { semana: number; anio: number; label: string; viales: number; recepciones: number }[];
};

type MovimientoGrupoPrincipioActivo = {
  claveGrupo: string;
  principioActivo: string;
  agrupacionAproximada: boolean;
  presentaciones: MovimientoConsumo[];
};

type MovimientosConsumoResult = {
  suben: MovimientoGrupoPrincipioActivo[];
  bajan: MovimientoGrupoPrincipioActivo[];
  resumen: {
    totalSuben: number;
    totalBajan: number;
  };
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

type SugerenciaAjuste = {
  tipo: 'aumentar' | 'reducir' | 'ok';
  stockMinimoSugerido: number;
  stockMaximoSugerido: number;
  stockMinimoActual: number;
  stockMaximoActual: number;
};

type AlertaCompra = {
  cn: string;
  componente: string;
  medicamento: string;
  ppioActivoCima: string | null;
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
  sugerenciaAjuste: SugerenciaAjuste | null;
  semanasSeries: { semana: number; anio: number; label: string; viales: number; recepciones: number }[];
};

type ResumenSemaforoGrupo = {
  rojo: number;
  naranja: number;
  verde: number;
  azul: number;
  gris: number;
  peor: AlertaCompra['semaforo'];
};

type AlertaGrupoPrincipioActivo = {
  claveGrupo: string;
  principioActivo: string;
  agrupacionAproximada: boolean;
  presentaciones: AlertaCompra[];
  resumenSemaforo: ResumenSemaforoGrupo;
};

function flattenPresentaciones(grupos: AlertaGrupoPrincipioActivo[]): AlertaCompra[] {
  return grupos.flatMap(g => g.presentaciones);
}

function resumenSemaforoTexto(resumen: ResumenSemaforoGrupo): string {
  const partes: string[] = [];
  if (resumen.rojo > 0) partes.push(`${resumen.rojo} crítica${resumen.rojo > 1 ? 's' : ''}`);
  if (resumen.naranja > 0) partes.push(`${resumen.naranja} baja${resumen.naranja > 1 ? 's' : ''}`);
  if (resumen.verde > 0) partes.push(`${resumen.verde} óptima${resumen.verde > 1 ? 's' : ''}`);
  if (resumen.azul > 0) partes.push(`${resumen.azul} sobrestock`);
  if (resumen.gris > 0) partes.push(`${resumen.gris} sin datos`);
  return partes.join(' · ');
}

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

// ---------------------------------------------------------------------------
// Helpers semáforo
// ---------------------------------------------------------------------------
const SEMAFORO_CFG = {
  rojo:   { bg: 'bg-red-50 border-red-200',       dot: 'bg-red-500',      text: 'text-red-700',      label: 'Stock crítico (<1.5 sem)' },
  naranja:{ bg: 'bg-orange-50 border-orange-200', dot: 'bg-orange-400',   text: 'text-orange-700',   label: 'Stock bajo (1.5-2.5 sem)' },
  verde:  { bg: 'bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Rango óptimo (2.5-4 sem)' },
  azul:   { bg: 'bg-sky-50 border-sky-200',       dot: 'bg-sky-500',      text: 'text-sky-700',      label: 'Sobrestock (>4 sem)' },
  gris:   { bg: 'bg-slate-50 border-slate-200',   dot: 'bg-slate-400',    text: 'text-slate-600',    label: 'Sin datos suficientes' },
} as const;

const DIRECCION_CFG = {
  sube:   { label: 'SUBE',   bg: 'bg-orange-50 border-orange-200',  badge: 'bg-orange-100 text-orange-800',  text: 'text-orange-700' },
  nuevo:  { label: 'NUEVO',  bg: 'bg-emerald-50 border-emerald-200', badge: 'bg-emerald-100 text-emerald-800', text: 'text-emerald-700' },
  baja:   { label: 'BAJA',   bg: 'bg-sky-50 border-sky-200',        badge: 'bg-sky-100 text-sky-800',        text: 'text-sky-700' },
  parado: { label: 'PARADO', bg: 'bg-slate-50 border-slate-300',    badge: 'bg-slate-200 text-slate-700',    text: 'text-slate-600' },
} as const;

function fmtViales(n: number): string {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(n);
}

function fmtCobertura(c: number | null): string {
  if (c === null) return '—';
  if (c > 52) return '>1 año';
  return `${c.toFixed(1)} sem`;
}

// ---------------------------------------------------------------------------
// Componente: mini curva semanal de consumo (barras CSS puras, sin recharts)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Componente: curva semanal recharts (barras consumo + línea recepciones)
// ---------------------------------------------------------------------------
function CurvaSemanalAlertas({
  series, promedioSemanal
}: {
  series: AlertaCompra['semanasSeries'];
  promedioSemanal: number;
}) {
  if (series.length === 0) return null;
  const hasRecepciones = series.some(s => s.recepciones > 0);

  return (
    <div className="mt-4">
      <p className="text-[10px] text-slate-400 mb-2 uppercase tracking-wide font-medium">
        Últimas 8 semanas — Dispensaciones vs Recepciones
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            width={30}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
            labelStyle={{ fontWeight: 600, color: '#334155', marginBottom: 4 }}
            formatter={(value: unknown, name: unknown) => [
              `${Number(value ?? 0).toFixed(0)} uds`,
              String(name ?? ''),
            ]}
          />
          <Legend
            iconType="square"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
          />
          <Bar
            dataKey="viales"
            name="Dispensado"
            fill="#0d9488"
            fillOpacity={0.85}
            radius={[3, 3, 0, 0]}
            maxBarSize={28}
          />
          {hasRecepciones && (
            <Bar
              dataKey="recepciones"
              name="Recepcionado"
              fill="#6366f1"
              fillOpacity={0.7}
              radius={[3, 3, 0, 0]}
              maxBarSize={28}
            />
          )}
          {promedioSemanal > 0 && (
            <ReferenceLine
              y={promedioSemanal}
              stroke="#6366f1"
              strokeDasharray="4 2"
              strokeWidth={1.5}
              label={{ value: `prom. ${promedioSemanal.toFixed(1)}`, position: 'insideTopRight', fontSize: 9, fill: '#6366f1' }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
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
              <p className="text-slate-400 text-[10px]">Objetivo: 2-4 sem</p>
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

          {alerta.sugerenciaAjuste && alerta.sugerenciaAjuste.tipo !== 'ok' && (
            <div className={`mt-3 rounded-lg border px-3 py-2.5 flex items-start gap-2 ${
              alerta.sugerenciaAjuste.tipo === 'aumentar'
                ? 'border-red-200 bg-red-50'
                : 'border-sky-200 bg-sky-50'
            }`}>
              <span className="text-lg mt-0.5 flex-shrink-0">
                {alerta.sugerenciaAjuste.tipo === 'aumentar' ? '⬆️' : '⬇️'}
              </span>
              <div className="text-xs">
                <p className={`font-semibold ${alerta.sugerenciaAjuste.tipo === 'aumentar' ? 'text-red-800' : 'text-sky-800'}`}>
                  {alerta.sugerenciaAjuste.tipo === 'aumentar'
                    ? 'Stock bajo — considera aumentar los parámetros de stock'
                    : 'Sobrestock — considera reducir los parámetros de stock'}
                </p>
                <p className={`mt-1 ${alerta.sugerenciaAjuste.tipo === 'aumentar' ? 'text-red-700' : 'text-sky-700'}`}>
                  Mín. sugerido: <span className="font-medium">{fmtN(alerta.sugerenciaAjuste.stockMinimoSugerido)} uds</span>
                  {' '}(2 sem) · actual: {fmtN(alerta.sugerenciaAjuste.stockMinimoActual)} uds
                </p>
                <p className={`${alerta.sugerenciaAjuste.tipo === 'aumentar' ? 'text-red-700' : 'text-sky-700'}`}>
                  Máx. sugerido: <span className="font-medium">{fmtN(alerta.sugerenciaAjuste.stockMaximoSugerido)} uds</span>
                  {' '}(4 sem) · actual: {fmtN(alerta.sugerenciaAjuste.stockMaximoActual)} uds
                </p>
              </div>
            </div>
          )}

          <CurvaSemanalAlertas series={alerta.semanasSeries} promedioSemanal={alerta.promedioSemanal} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente: bloque agrupado por principio activo (sin sumar métricas)
// ---------------------------------------------------------------------------
function GrupoAlertaSection({
  grupo,
  expandedCn,
  onToggleCn,
  defaultOpen = true,
}: {
  grupo: AlertaGrupoPrincipioActivo;
  expandedCn: string | null;
  onToggleCn: (cn: string) => void;
  defaultOpen?: boolean;
}) {
  const [grupoOpen, setGrupoOpen] = useState(defaultOpen);

  if (grupo.presentaciones.length === 1) {
    const a = grupo.presentaciones[0];
    return (
      <AlertaCard
        alerta={a}
        expanded={expandedCn === a.cn}
        onToggle={() => onToggleCn(a.cn)}
      />
    );
  }

  const cfg = SEMAFORO_CFG[grupo.resumenSemaforo.peor];
  const resumen = resumenSemaforoTexto(grupo.resumenSemaforo);

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
      <button
        type="button"
        onClick={() => setGrupoOpen(o => !o)}
        className="w-full text-left px-4 py-3 flex items-center gap-3 bg-slate-50 hover:bg-slate-100/80 transition-colors"
      >
        <div className={`w-3 h-3 rounded-full flex-shrink-0 ${cfg.dot}`} title={cfg.label} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-semibold ${cfg.text}`}>{grupo.principioActivo}</span>
            {grupo.agrupacionAproximada && (
              <span className="text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                agrupación aprox.
              </span>
            )}
            <span className="text-[11px] text-slate-400">
              {grupo.presentaciones.length} presentaciones
            </span>
          </div>
          {resumen && (
            <p className="text-[11px] text-slate-500 mt-0.5">{resumen}</p>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${grupoOpen ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {grupoOpen && (
        <div className="p-2 space-y-2 border-t border-slate-100">
          {grupo.presentaciones.map(a => (
            <AlertaCard
              key={a.cn}
              alerta={a}
              expanded={expandedCn === a.cn}
              onToggle={() => onToggleCn(a.cn)}
            />
          ))}
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
// Componente: tarjeta de movimiento de consumo (por presentación)
// ---------------------------------------------------------------------------
function MovimientoCard({
  mov,
  expanded,
  onToggle,
}: {
  mov: MovimientoConsumo;
  expanded: boolean;
  onToggle: () => void;
}) {
  const cfg = DIRECCION_CFG[mov.direccion];

  return (
    <div className={`rounded-xl border overflow-hidden ${cfg.bg}`}>
      <button type="button" onClick={onToggle} className="w-full text-left px-4 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cfg.badge}`}>{cfg.label}</span>
            <span className="text-[11px] font-mono text-slate-400 bg-white/70 px-1.5 py-0.5 rounded">{mov.cn}</span>
            <span className="text-sm font-semibold text-slate-800">{mov.componente || '—'}</span>
            {mov.medicamento && (
              <span className="text-xs text-slate-400 italic truncate">{mov.medicamento}</span>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 text-right text-xs">
          <div className="text-slate-500 mb-0.5">8 sem ant. → 8 sem rec.</div>
          <div className="text-sm font-semibold text-slate-700 tabular-nums">
            {fmtViales(mov.periodoAnterior)} → {fmtViales(mov.periodoReciente)}
            <span className="ml-1 text-xs font-normal text-slate-400">viales</span>
          </div>
          {mov.variacionPct !== null ? (
            <div className={`mt-0.5 font-bold ${mov.direccion === 'sube' || mov.direccion === 'nuevo' ? 'text-orange-600' : 'text-sky-600'}`}>
              {mov.variacionPct > 0 ? '+' : ''}{mov.variacionPct.toFixed(1)}%
            </div>
          ) : (
            <div className="mt-0.5 text-slate-500">sin histórico previo</div>
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
              <p className="text-slate-400 uppercase tracking-wide text-[10px]">8 sem recientes</p>
              <p className="font-semibold text-slate-700">{fmtViales(mov.periodoReciente)} viales</p>
              <p className="text-slate-400 text-[10px]">Prom. {fmtViales(mov.promedioSemanalReciente)}/sem</p>
            </div>
            <div>
              <p className="text-slate-400 uppercase tracking-wide text-[10px]">8 sem anteriores</p>
              <p className="font-semibold text-slate-700">{fmtViales(mov.periodoAnterior)} viales</p>
              <p className="text-slate-400 text-[10px]">Prom. {fmtViales(mov.promedioSemanalAnterior)}/sem</p>
            </div>
            <div>
              <p className="text-slate-400 uppercase tracking-wide text-[10px]">Cambio período</p>
              <p className={`font-semibold ${mov.deltaVialesPeriodo >= 0 ? 'text-orange-600' : 'text-sky-600'}`}>
                {mov.deltaVialesPeriodo >= 0 ? '+' : ''}{fmtViales(mov.deltaVialesPeriodo)} viales
              </p>
            </div>
            <div>
              <p className="text-slate-400 uppercase tracking-wide text-[10px]">Múltiplo pedido</p>
              <p className="font-semibold text-slate-700">{mov.unidadesPorCaja} uds/caja</p>
            </div>
          </div>
          <CurvaSemanalAlertas series={mov.semanasSeries} promedioSemanal={mov.promedioSemanalReciente} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente: bloque agrupado por principio activo (movimientos)
// ---------------------------------------------------------------------------
function GrupoMovimientoSection({
  grupo,
  expandedCn,
  onToggleCn,
}: {
  grupo: MovimientoGrupoPrincipioActivo;
  expandedCn: string | null;
  onToggleCn: (cn: string) => void;
}) {
  const [grupoOpen, setGrupoOpen] = useState(true);

  if (grupo.presentaciones.length === 1) {
    const m = grupo.presentaciones[0];
    return (
      <MovimientoCard
        mov={m}
        expanded={expandedCn === m.cn}
        onToggle={() => onToggleCn(m.cn)}
      />
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
      <button
        type="button"
        onClick={() => setGrupoOpen(o => !o)}
        className="w-full text-left px-4 py-3 flex items-center gap-3 bg-slate-50 hover:bg-slate-100/80 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-800">{grupo.principioActivo}</span>
            {grupo.agrupacionAproximada && (
              <span className="text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                agrupación aprox.
              </span>
            )}
            <span className="text-[11px] text-slate-400">{grupo.presentaciones.length} presentaciones</span>
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${grupoOpen ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {grupoOpen && (
        <div className="p-2 space-y-2 border-t border-slate-100">
          {grupo.presentaciones.map(m => (
            <MovimientoCard
              key={m.cn}
              mov={m}
              expanded={expandedCn === m.cn}
              onToggle={() => onToggleCn(m.cn)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------
export default function InicioPage() {
  const [operativo, setOperativo] = useState<ResumenOperativo | null>(null);
  const [movimientos, setMovimientos] = useState<MovimientosConsumoResult | null>(null);
  const [movTab, setMovTab] = useState<'suben' | 'bajan'>('suben');
  const [loadingOp, setLoadingOp] = useState(true);
  const [loadingMov, setLoadingMov] = useState(true);
  const [errorOp, setErrorOp] = useState<string | null>(null);
  const [errorMov, setErrorMov] = useState<string | null>(null);
  const [expandedMovCn, setExpandedMovCn] = useState<string | null>(null);
  const [bajoMinimoOpen, setBajoMinimoOpen] = useState(false);
  const [bajoMinimoLoading, setBajoMinimoLoading] = useState(false);
  const [bajoMinimoError, setBajoMinimoError] = useState<string | null>(null);
  const [bajoMinimoItems, setBajoMinimoItems] = useState<BajoMinimoItem[]>([]);

  // Alertas de compra
  const [alertasOpen, setAlertasOpen] = useState(false);
  const [alertasLoading, setAlertasLoading] = useState(false);
  const [alertasError, setAlertasError] = useState<string | null>(null);
  const [alertasGrupos, setAlertasGrupos] = useState<AlertaGrupoPrincipioActivo[]>([]);
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

  const cargarMovimientos = useCallback(() => {
    setLoadingMov(true);
    setErrorMov(null);
    fetch('/api/inicio/tendencias')
      .then(r => r.json())
      .then((d: MovimientosConsumoResult & { error?: string }) => {
        if (d.error) { setErrorMov(d.error); return; }
        setMovimientos(d);
      })
      .catch(() => setErrorMov('Error al cargar movimientos de consumo'))
      .finally(() => setLoadingMov(false));
  }, []);

  useEffect(() => {
    cargarOperativo();
    cargarMovimientos();
    // Cargar alertas al montar
    setAlertasLoading(true);
    fetch('/api/inicio/alertas-compra')
      .then(r => r.json())
      .then((d: { grupos?: AlertaGrupoPrincipioActivo[]; error?: string }) => {
        if (d.error) { setAlertasError(d.error); return; }
        setAlertasGrupos(d.grupos ?? []);
      })
      .catch(() => setAlertasError('Error al cargar alertas'))
      .finally(() => setAlertasLoading(false));
  }, [cargarOperativo, cargarMovimientos]);

  const gruposMovActuales = movTab === 'suben' ? (movimientos?.suben ?? []) : (movimientos?.bajan ?? []);
  const totalSuben = movimientos?.resumen?.totalSuben ?? 0;
  const totalBajan = movimientos?.resumen?.totalBajan ?? 0;

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
          Cobertura = stock actual / consumo promedio semanal (últimas 8 semanas), calculado por presentación (CN).
          Agrupado por principio activo CIMA para comparar presentaciones sin sumar cantidades.
          Rango óptimo: 2.5-4 semanas (almacén limitado, pedidos semanales).
        </p>

        {/* Leyenda semáforo */}
        <div className="flex flex-wrap gap-3 mb-3">
          {(Object.entries(SEMAFORO_CFG) as [keyof typeof SEMAFORO_CFG, typeof SEMAFORO_CFG[keyof typeof SEMAFORO_CFG]][]).map(([key, cfg]) => {
            const cnt = flattenPresentaciones(alertasGrupos).filter(a => a.semaforo === key).length;
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

        {!alertasLoading && !alertasError && alertasGrupos.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center">
            <p className="text-sm text-slate-500 font-medium">Sin alertas activas</p>
            <p className="text-xs text-slate-400 mt-1">
              No hay medicamentos en el catálogo con datos de stock y consumo suficientes, o todos tienen cobertura adecuada.
            </p>
          </div>
        )}

        {!alertasLoading && !alertasError && alertasGrupos.length > 0 && (
          <>
            {/* Resumen siempre visible: grupos con presentaciones críticas */}
            {!alertasOpen && (
              <div className="space-y-2">
                {alertasGrupos
                  .filter(g => g.resumenSemaforo.rojo > 0 || g.resumenSemaforo.naranja > 0)
                  .slice(0, 5)
                  .map(g => (
                    <GrupoAlertaSection
                      key={g.claveGrupo}
                      grupo={g}
                      expandedCn={expandedAlertaCn}
                      onToggleCn={cn => setExpandedAlertaCn(prev => prev === cn ? null : cn)}
                    />
                  ))}
                {alertasGrupos.every(g => g.resumenSemaforo.rojo === 0 && g.resumenSemaforo.naranja === 0) && (
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
              <div className="space-y-3">
                {alertasGrupos.map(g => (
                  <GrupoAlertaSection
                    key={g.claveGrupo}
                    grupo={g}
                    expandedCn={expandedAlertaCn}
                    onToggleCn={cn => setExpandedAlertaCn(prev => prev === cn ? null : cn)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* BLOQUE 3 — Movimientos de consumo                                   */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="text-base font-semibold text-slate-700 mb-1 flex items-center gap-2">
          <span className="inline-block w-1 h-4 bg-indigo-500 rounded-full" />
          Movimientos de consumo
        </h2>
        <p className="text-xs text-slate-400 mb-3">
          Compara las últimas 8 semanas frente a las 8 anteriores (misma ventana que alertas de compra).
          Agrupado por principio activo CIMA; cada presentación mantiene sus propias cifras.
          Umbral relevante: variación &gt;25% con cambio ≥2 viales/sem o ≥1 caja/sem.
        </p>

        {movimientos && !loadingMov && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <button
              type="button"
              onClick={() => setMovTab('suben')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition-colors ${
                movTab === 'suben'
                  ? 'bg-orange-50 border-orange-300 text-orange-800'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              ↑ Suben / Nuevos ({totalSuben})
            </button>
            <button
              type="button"
              onClick={() => setMovTab('bajan')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition-colors ${
                movTab === 'bajan'
                  ? 'bg-sky-50 border-sky-300 text-sky-800'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              ↓ Bajan / Parados ({totalBajan})
            </button>
          </div>
        )}

        {loadingMov && (
          <p className="text-sm text-slate-400">Calculando movimientos…</p>
        )}
        {errorMov && (
          <p className="text-sm text-red-500">{errorMov}</p>
        )}

        {!loadingMov && !errorMov && gruposMovActuales.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center">
            <p className="text-sm text-slate-500 font-medium">
              {movTab === 'suben' ? 'Sin subidas relevantes' : 'Sin bajadas ni paradas relevantes'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              No hay medicamentos con cambio significativo en esta dirección en las últimas 16 semanas,
              o aún no hay datos de consumo importados.
            </p>
          </div>
        )}

        {!loadingMov && !errorMov && gruposMovActuales.length > 0 && (
          <div className="space-y-3">
            {gruposMovActuales.map(g => (
              <GrupoMovimientoSection
                key={g.claveGrupo}
                grupo={g}
                expandedCn={expandedMovCn}
                onToggleCn={cn => setExpandedMovCn(prev => prev === cn ? null : cn)}
              />
            ))}
          </div>
        )}
      </section>

    </div>
  );
}
