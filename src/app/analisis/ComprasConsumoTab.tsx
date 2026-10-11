'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  ComprasConsumoDatos,
  MedicamentoOpcionCompras,
  MedicamentoTemporalPoint,
} from '@/lib/analisis-neon';
import {
  INICIO_SEMANAS_HDD,
  KpiCard,
  SERIES_COLORS,
  VIA_META,
  fmtCajasSigno,
  fmtDate,
  fmtEur,
  fmtEurShort,
  fmtQty,
  getYearColor,
  periodoAntesDeCompras,
} from './AnalisisOncologiaPage';

export type FilaCompraConsumo = MedicamentoTemporalPoint & { sinRegistro: boolean; acumulado: number | null };
type Fila = FilaCompraConsumo;
type Unidad = 'eur' | 'cajas';

/** Marca los periodos sin registro de compras y acumula compra − consumo en cajas desde el inicio del registro. */
export function filasCompraConsumo(serie: MedicamentoTemporalPoint[], registroDesde: string | null): FilaCompraConsumo[] {
  let acumulado = 0;
  return serie.map((p) => {
    const sinRegistro = registroDesde != null && periodoAntesDeCompras(p, registroDesde);
    if (!sinRegistro) acumulado += p.comprasCajas - p.consumoCajas;
    return { ...p, sinRegistro, acumulado: sinRegistro ? null : acumulado };
  });
}

/** Etiqueta del primer periodo del tramo final sin consumo cargado; null si el último periodo tiene consumo. */
export function inicioSinConsumoFinal(filas: FilaCompraConsumo[]): string | null {
  let i = filas.length;
  while (i > 0 && filas[i - 1]!.consumoGasto === 0) i--;
  return i < filas.length && i > 0 ? filas[i]!.label : null;
}

/** Con HDD incluido, la vista semanal solo es completa si el período empieza cuando HDD ya registra por semanas. */
export function vistaPorDefecto(datos: ComprasConsumoDatos, desde: string): 'mensual' | 'semanal' {
  const hayHdd = datos.medicamentos.some((m) => m.via === 'IV');
  return datos.temporalSemanal.length > 0 && (!hayHdd || desde >= INICIO_SEMANAS_HDD) ? 'semanal' : 'mensual';
}

const MAX_RESULTADOS_BUSCADOR = 40;

function fmtPctEntero(n: number): string {
  return `${n.toLocaleString('es-ES', { maximumFractionDigits: n >= 100 ? 0 : 1 })} %`;
}

function ViaPill({ via }: { via: MedicamentoOpcionCompras['via'] }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-bold"
      style={{ color: VIA_META[via].texto, backgroundColor: `${VIA_META[via].color}1f` }}
    >
      {VIA_META[via].label}
    </span>
  );
}

function SelectorMedicamentos({
  opciones,
  seleccionados,
  onChange,
}: {
  opciones: MedicamentoOpcionCompras[];
  seleccionados: string[];
  onChange: (cns: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [abierto, setAbierto] = useState(false);
  const porCn = useMemo(() => new Map(opciones.map((o) => [o.cn, o])), [opciones]);

  const resultados = useMemo(() => {
    const q = query.trim().toLowerCase();
    return opciones
      .filter((o) => !seleccionados.includes(o.cn))
      .filter((o) => !q || o.cn.includes(q) || o.nombre.toLowerCase().includes(q) || o.principioActivo.toLowerCase().includes(q))
      .slice(0, MAX_RESULTADOS_BUSCADOR);
  }, [opciones, seleccionados, query]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Medicamentos a comparar</h2>
          <p className="text-xs text-slate-400">
            Busca y añade uno o varios. La lista muestra los medicamentos con consumo en el período, de mayor a menor consumo.
          </p>
        </div>
        {seleccionados.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
          >
            Quitar todos
          </button>
        )}
      </div>

      {seleccionados.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {seleccionados.map((cn) => {
            const o = porCn.get(cn);
            return (
              <span
                key={cn}
                className="flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 py-0.5 pl-2.5 pr-1 text-[11px] font-semibold text-slate-700"
              >
                {o && <ViaPill via={o.via} />}
                {o ? o.principioActivo || o.nombre : `CN ${cn}`}
                <span className="font-normal text-slate-400">CN {cn}</span>
                <button
                  type="button"
                  onClick={() => onChange(seleccionados.filter((c) => c !== cn))}
                  aria-label={`Quitar ${o?.principioActivo || cn}`}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="relative mt-3">
        <input
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setAbierto(true); }}
          onFocus={() => setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          placeholder="Buscar por principio activo, nombre o CN…"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
        />
        {abierto && resultados.length > 0 && (
          <div className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
            {resultados.map((o) => (
              <button
                key={o.cn}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange([...seleccionados, o.cn]); setQuery(''); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-teal-50"
              >
                <ViaPill via={o.via} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-800">{o.principioActivo || o.nombre}</span>
                  <span className="block truncate text-[10px] text-slate-500">CN {o.cn} · {o.nombre}</span>
                </span>
                <span className="tabular-nums text-slate-500">{fmtEur(o.consumoGasto)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CompraConsumoTooltip({
  active,
  payload,
  label,
  unidad,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Fila }>;
  label?: string;
  unidad: Unidad;
}) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  const consumo = unidad === 'eur' ? fmtEur(p.consumoGasto) : `${fmtQty(p.consumoCajas)} cajas`;
  const compra = unidad === 'eur' ? fmtEur(p.comprasGasto) : `${fmtQty(p.comprasCajas)} cajas`;
  const diferencia = unidad === 'eur'
    ? fmtEur(p.comprasGasto - p.consumoGasto)
    : `${fmtCajasSigno(p.comprasCajas - p.consumoCajas)} cajas`;
  return (
    <div className="min-w-[220px] rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs shadow-lg tabular-nums">
      <p className="font-semibold text-slate-800">{label}</p>
      <div className="mt-1.5 space-y-0.5 text-slate-700">
        <p><span className="font-semibold" style={{ color: SERIES_COLORS.gasto }}>Consumo:</span> {consumo}</p>
        {p.sinRegistro ? (
          <p className="text-slate-400">Compra: sin registro de compras</p>
        ) : (
          <>
            <p><span className="font-semibold" style={{ color: SERIES_COLORS.comprasGasto }}>Compra:</span> {compra}</p>
            <p className="text-slate-600">Compra − consumo: {diferencia}</p>
            {unidad === 'cajas' && p.acumulado != null && (
              <p className="text-slate-600">Acumulado: {fmtCajasSigno(p.acumulado)} cajas</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function GraficoCompraConsumo({
  filas,
  unidad,
  titulo,
  anchoFijo,
  altoFijo,
}: {
  filas: Fila[];
  unidad: Unidad;
  titulo: string;
  /** Para impresión: el contenedor no debe re-medirse. */
  anchoFijo?: number;
  altoFijo?: number;
}) {
  const tramosAnio = useMemo(() => {
    const tramos: Array<{ anio: number; x1: string; x2: string }> = [];
    for (const p of filas) {
      const last = tramos.at(-1);
      if (last && last.anio === p.anio) last.x2 = p.label;
      else tramos.push({ anio: p.anio, x1: p.label, x2: p.label });
    }
    return tramos;
  }, [filas]);
  const sinRegistro = filas.filter((p) => p.sinRegistro);
  const eur = unidad === 'eur';
  const fmtEje = eur ? (v: number) => fmtEurShort(v) : (v: number) => fmtQty(v, 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold text-slate-700">{titulo}</h3>
      <ResponsiveContainer width={anchoFijo ?? '100%'} height={altoFijo ?? 300}>
        <ComposedChart data={filas} margin={{ top: 10, right: 16, left: 0, bottom: 24 }} barGap={1}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#64748b' }}
            interval="preserveStartEnd"
            angle={filas.length > 10 ? -25 : 0}
            textAnchor={filas.length > 10 ? 'end' : 'middle'}
            height={filas.length > 10 ? 46 : 28}
          />
          <YAxis
            yAxisId="valor"
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            tickFormatter={(v) => fmtEje(Number(v))}
            width={eur ? 64 : 52}
          />
          <Tooltip content={<CompraConsumoTooltip unidad={unidad} />} />
          {tramosAnio.length > 1 && tramosAnio.map((t) => (
            <ReferenceArea
              key={`anio-${t.anio}`}
              yAxisId="valor"
              x1={t.x1}
              x2={t.x2}
              fill={getYearColor(t.anio)}
              fillOpacity={0.06}
              strokeOpacity={0}
              label={{ value: String(t.anio), position: 'insideTop', fontSize: 10, fontWeight: 700, fill: getYearColor(t.anio) }}
            />
          ))}
          {sinRegistro.length > 0 && (
            <ReferenceArea
              yAxisId="valor"
              x1={sinRegistro[0]!.label}
              x2={sinRegistro.at(-1)!.label}
              fill="#94a3b8"
              fillOpacity={0.14}
              strokeOpacity={0}
              label={{ value: 'Sin registro de compras', position: 'insideTop', offset: 22, fontSize: 10, fill: '#64748b' }}
            />
          )}
          <ReferenceLine yAxisId="valor" y={0} stroke="#cbd5e1" />
          <Bar
            yAxisId="valor"
            dataKey={eur ? 'consumoGasto' : 'consumoCajas'}
            name="Consumo"
            fill={SERIES_COLORS.gasto}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
          <Bar
            yAxisId="valor"
            dataKey={eur ? 'comprasGasto' : 'comprasCajas'}
            name="Compra"
            fill={SERIES_COLORS.comprasGasto}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
          {!eur && (
            <Line
              yAxisId="valor"
              dataKey="acumulado"
              name="Compra − consumo acumulado"
              stroke={SERIES_COLORS.surface}
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={{ r: 2, fill: SERIES_COLORS.surface }}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-600">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 flex-shrink-0 rounded-sm" style={{ backgroundColor: SERIES_COLORS.gasto }} />
          {eur ? 'Consumo valorizado' : 'Cajas consumidas'}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 flex-shrink-0 rounded-sm" style={{ backgroundColor: SERIES_COLORS.comprasGasto }} />
          {eur ? 'Compra valorizada' : 'Cajas compradas'}
        </span>
        {!eur && (
          <span className="flex items-center gap-1">
            <span className="w-3 flex-shrink-0 border-t-2 border-dashed" style={{ borderColor: SERIES_COLORS.surface }} />
            Compra − consumo acumulado (cajas, desde el inicio del registro)
          </span>
        )}
      </div>
    </div>
  );
}

function TablaMedicamentos({ datos }: { datos: ComprasConsumoDatos }) {
  const TH = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400';
  const THR = `${TH} text-right`;
  const TD = 'px-3 py-2 text-xs text-slate-700';
  const TDR = `${TD} text-right tabular-nums`;
  const fila = (m: ComprasConsumoDatos['totales']) => {
    const difEur = m.comprasGasto - m.consumoComparableGasto;
    const difCajas = m.comprasCajas - m.consumoComparableCajas;
    const cobertura = m.consumoComparableGasto > 0 ? (m.comprasGasto / m.consumoComparableGasto) * 100 : null;
    return { difEur, difCajas, cobertura };
  };
  const varios = datos.medicamentos.length > 1;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-100">
        <thead className="bg-slate-50">
          <tr>
            <th className={TH}>Medicamento</th>
            <th className={THR}>Consumo €</th>
            <th className={THR}>Compra €</th>
            <th className={THR}>Diferencia €</th>
            <th className={THR}>Cajas consumidas</th>
            <th className={THR}>Cajas compradas</th>
            <th className={THR}>Diferencia cajas</th>
            <th className={THR}>Cobertura</th>
            <th className={THR}>Pedidos</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {datos.medicamentos.map((m) => {
            const f = fila(m);
            return (
              <tr key={m.cn}>
                <td className={TD}>
                  <span className="flex items-center gap-1.5">
                    <ViaPill via={m.via} />
                    <span className="font-semibold text-slate-800">{m.principioActivo || m.nombre}</span>
                  </span>
                  <span className="block text-[10px] text-slate-500">
                    CN {m.cn} · {m.nombre} · {fmtEur(m.precioUnidad)}/ud · {fmtQty(m.unidadesPorCaja, 0)} uds/caja
                  </span>
                  {m.servicios.length > 0 && (
                    <span className="block text-[10px] text-slate-400">Consumo en: {m.servicios.join(', ')}</span>
                  )}
                </td>
                <td className={TDR}>{fmtEur(m.consumoComparableGasto)}</td>
                <td className={TDR}>{fmtEur(m.comprasGasto)}</td>
                <td className={`${TDR} font-semibold`}>{fmtEur(f.difEur)}</td>
                <td className={TDR}>{fmtQty(m.consumoComparableCajas)}</td>
                <td className={TDR}>{fmtQty(m.comprasCajas)}</td>
                <td className={`${TDR} font-semibold`}>{fmtCajasSigno(f.difCajas)}</td>
                <td className={TDR}>{f.cobertura == null ? '—' : fmtPctEntero(f.cobertura)}</td>
                <td className={TDR}>{m.pedidosRecibidos}</td>
              </tr>
            );
          })}
          {varios && (() => {
            const t = datos.totales;
            const f = fila(t);
            return (
              <tr className="bg-slate-50 font-semibold">
                <td className={TD}>Total selección</td>
                <td className={TDR}>{fmtEur(t.consumoComparableGasto)}</td>
                <td className={TDR}>{fmtEur(t.comprasGasto)}</td>
                <td className={TDR}>{fmtEur(f.difEur)}</td>
                <td className={TDR}>{fmtQty(t.consumoComparableCajas)}</td>
                <td className={TDR}>{fmtQty(t.comprasCajas)}</td>
                <td className={TDR}>{fmtCajasSigno(f.difCajas)}</td>
                <td className={TDR}>{f.cobertura == null ? '—' : fmtPctEntero(f.cobertura)}</td>
                <td className={TDR}>{t.pedidosRecibidos}</td>
              </tr>
            );
          })()}
        </tbody>
      </table>
    </div>
  );
}

export default function ComprasConsumoTab({
  desde,
  hasta,
  cns,
  onChangeCns,
}: {
  desde: string;
  hasta: string;
  cns: string[];
  onChangeCns: (cns: string[]) => void;
}) {
  const [datos, setDatos] = useState<ComprasConsumoDatos | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modoElegido, setModoElegido] = useState<'mensual' | 'semanal' | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams({ desde, hasta });
    if (cns.length) p.set('cns', cns.join(','));
    return p.toString();
  }, [desde, hasta, cns]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/analisis/compras-consumo?${query}`)
      .then((res) => res.ok ? res.json() : res.json().then((payload) => Promise.reject(payload?.error ?? 'Error al cargar la comparación')))
      .then((payload: ComprasConsumoDatos) => { if (!cancelled) setDatos(payload); })
      .catch((err) => { if (!cancelled) { setError(String(err)); setDatos(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query]);

  useEffect(() => { setModoElegido(null); }, [desde, hasta]);

  const hayHdd = datos?.medicamentos.some((m) => m.via === 'IV') ?? false;
  const semanalDisponible = (datos?.temporalSemanal.length ?? 0) > 0;
  const modo = datos && semanalDisponible ? modoElegido ?? vistaPorDefecto(datos, desde) : 'mensual';

  const filas = useMemo<Fila[]>(() => {
    if (!datos) return [];
    return filasCompraConsumo(modo === 'semanal' ? datos.temporalSemanal : datos.temporalMensual, datos.comprasRegistroDesde);
  }, [datos, modo]);

  const sinConsumoDesde = inicioSinConsumoFinal(filas);

  function exportarPdf() {
    const p = new URLSearchParams({ desde, hasta, cns: cns.join(','), vista: modo });
    window.open(`/analisis/informe/compras?${p}`, '_blank');
  }

  const t = datos?.totales;
  const comparableDesde = datos?.comparableDesde ?? null;
  const recortado = comparableDesde != null && comparableDesde > desde
    && t != null && t.consumoGasto - t.consumoComparableGasto > 0.5;
  const cobertura = t && t.consumoComparableGasto > 0 ? (t.comprasGasto / t.consumoComparableGasto) * 100 : null;
  const seleccion = cns.length > 0 && datos && datos.medicamentos.length > 0;

  return (
    <div className="space-y-5">
      <SelectorMedicamentos opciones={datos?.opciones ?? []} seleccionados={cns} onChange={onChangeCns} />

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {loading && !datos && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
          <span className="ml-3 text-sm text-slate-500">Cargando comparación…</span>
        </div>
      )}

      {datos && cns.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500">
          Selecciona uno o varios medicamentos para comparar sus compras con su consumo.
        </div>
      )}

      {datos && seleccion && t && (
        <>
          {loading && <p className="text-[11px] font-medium text-sky-700">Actualizando…</p>}

          {!comparableDesde && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              El período termina antes del inicio del registro de compras
              {datos.comprasRegistroDesde ? ` (${fmtDate(datos.comprasRegistroDesde)})` : ''}: no hay compras que comparar.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiCard
              label="Consumo valorizado"
              value={fmtEur(t.consumoComparableGasto)}
              sub={`${fmtQty(t.consumoComparableCajas)} cajas${recortado ? ` · desde ${fmtDate(comparableDesde!)}` : ''}`}
              tone="rose"
            />
            <KpiCard
              label="Compra valorizada"
              value={fmtEur(t.comprasGasto)}
              sub={`${fmtQty(t.comprasCajas)} cajas · ${t.pedidosRecibidos} pedidos recibidos`}
              tone="violet"
            />
            <KpiCard
              label="Compra − consumo"
              value={fmtEur(t.comprasGasto - t.consumoComparableGasto)}
              sub={`${fmtCajasSigno(t.comprasCajas - t.consumoComparableCajas)} cajas`}
              tone="slate"
            />
            <KpiCard
              label="Cobertura"
              value={cobertura == null ? '—' : fmtPctEntero(cobertura)}
              sub="Compra / consumo en euros"
              tone="teal"
            />
          </div>

          {recortado && (
            <p className="text-[11px] text-slate-500">
              Las tarjetas y la tabla comparan desde {fmtDate(comparableDesde!)}, inicio del registro de compras. El consumo de todo el período
              ({fmtDate(desde)} – {fmtDate(hasta)}) es de {fmtEur(t.consumoGasto)} · {fmtQty(t.consumoCajas)} cajas.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {semanalDisponible && (
              <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-semibold">
                {(['mensual', 'semanal'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModoElegido(m)}
                    className={`rounded-md px-3 py-1 ${modo === m ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    {m === 'mensual' ? 'Por meses' : 'Por semanas'}
                  </button>
                ))}
              </div>
            )}
            {modo === 'semanal' && hayHdd && desde < INICIO_SEMANAS_HDD && (
              <span className="text-[11px] text-slate-500">
                Hospital de Día solo tiene datos semanales desde el {fmtDate(INICIO_SEMANAS_HDD)}; antes, su consumo no aparece por semanas.
              </span>
            )}
            {!semanalDisponible && (
              <span className="text-[11px] text-slate-500">Vista por semanas disponible para períodos de 6 meses o menos.</span>
            )}
            {sinConsumoDesde && (
              <span className="text-[11px] text-amber-700">
                Sin consumo cargado desde {modo === 'semanal' ? 'la semana del ' : ''}{sinConsumoDesde}: ahí el acumulado solo suma compras.
              </span>
            )}
            <button
              type="button"
              onClick={exportarPdf}
              className="ml-auto rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 shadow-sm hover:bg-teal-100"
            >
              Exportar PDF
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <GraficoCompraConsumo
              filas={filas}
              unidad="eur"
              titulo={`Consumo y compra en euros · ${modo === 'semanal' ? 'por semanas' : 'por meses'}`}
            />
            <GraficoCompraConsumo
              filas={filas}
              unidad="cajas"
              titulo={`Consumo y compra en cajas · ${modo === 'semanal' ? 'por semanas' : 'por meses'}`}
            />
          </div>

          <TablaMedicamentos datos={datos} />

          <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] leading-relaxed text-slate-600">
            <p>
              <span className="font-semibold text-slate-700">Compras:</span> pedidos recibidos de todo el hospital para estos medicamentos,
              sin desglose por servicio
              {datos.comprasRegistroDesde ? `; registradas desde el ${fmtDate(datos.comprasRegistroDesde)}` : ''}.
            </p>
            <p>
              <span className="font-semibold text-slate-700">Consumo:</span> incluye los servicios{' '}
              {datos.serviciosConsumo.length
                ? datos.serviciosConsumo.map((s) => `${s.servicio} (${fmtPctEntero(s.pct)})`).join(', ')
                : 'sin consumo en el período'}
              . Si un medicamento también se usa fuera de estos servicios, la compra puede quedar por encima del consumo.
            </p>
            <p>
              <span className="font-semibold text-slate-700">Valoración:</span> consumo y compra en euros con el precio por unidad del catálogo
              (unidades × precio unidad); las cajas, con las unidades por caja del catálogo.
            </p>
            {datos.medicamentos.length > 1 && (
              <p>
                <span className="font-semibold text-slate-700">Varios medicamentos:</span> las cajas se suman aunque las presentaciones sean distintas;
                para comparar presentaciones, mira la tabla por medicamento.
              </p>
            )}
          </div>
        </>
      )}

      {datos && cns.length > 0 && datos.medicamentos.length === 0 && !loading && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500">
          Los medicamentos seleccionados no tienen datos en el catálogo del área.
        </div>
      )}
    </div>
  );
}
