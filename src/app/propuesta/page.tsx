'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MOTIVOS_AJUSTE } from '@/lib/propuesta';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
type RecuentoPendiente = {
  id: number;
  fechaRecuento: string;
  origen: string;
  estado: string;
};

type Propuesta = {
  id: number;
  estado: string;
  fechaGeneracion: string;
  tramitadaEn: string | null;
  importacionStockId?: number;
};

type Linea = {
  id: number;
  cn: string;
  nombreMedicamento: string | null;
  unidadesPorCaja: number;
  stockActual: number;
  stockMinimoSnap: number;
  puntoPedidoSnap: number;
  stockMaximoSnap: number;
  cajasPropuestas: number;
  cajasValidadas: number | null;
  motivoAjuste: string | null;
  motivoAjusteOtro: string | null;
  ajustado: boolean;
};

type ApiResponse = {
  recuento: RecuentoPendiente;
  propuesta: Propuesta;
  lineas: Linea[];
};

type DraftEdit = {
  cajasValidadas: number;
  motivoAjuste: string;
  motivoAjusteOtro: string;
};

type PropuestaResumen = {
  id: number;
  estado: string;
  fechaGeneracion: string;
  tramitadaEn: string | null;
  totalLineas: number;
  recuentoId: number | null;
  recuentoFecha: string | null;
  recuentoOrigen: string | null;
  excelGeneradoEn: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ORIGEN_LABEL: Record<string, string> = {
  manual: 'Manual',
  importacion: 'Importación',
  automatico: 'Automático',
};

function fmt(date: string | null) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------
export default function PropuestaPage() {
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [tramiting,   setTramiting]   = useState(false);
  const [deshaciendo, setDeshaciendo] = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [data,        setData]        = useState<ApiResponse | null>(null);
  const [edits,       setEdits]       = useState<Record<number, DraftEdit>>({});

  const [historial,       setHistorial]       = useState<PropuestaResumen[]>([]);
  const [loadingHistorial, setLoadingHistorial] = useState(false);

  // ── Carga propuesta activa ────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res     = await fetch('/api/propuestas/actual', { cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo preparar la propuesta.');
      setData(payload);
      const nextEdits: Record<number, DraftEdit> = {};
      for (const linea of payload.lineas as Linea[]) {
        nextEdits[linea.id] = {
          cajasValidadas:   linea.cajasValidadas ?? linea.cajasPropuestas,
          motivoAjuste:     linea.motivoAjuste ?? '',
          motivoAjusteOtro: linea.motivoAjusteOtro ?? '',
        };
      }
      setEdits(nextEdits);
    } catch (err) {
      // No hay recuento pendiente — es normal si ya se tramitó
      setData(null);
      setError(null); // No mostramos error, mostramos historial
    } finally {
      setLoading(false);
    }
  };

  // ── Carga historial ───────────────────────────────────────────────────────
  const loadHistorial = async () => {
    setLoadingHistorial(true);
    try {
      const res     = await fetch('/api/propuestas/historial', { cache: 'no-store' });
      const payload = await res.json();
      if (res.ok) setHistorial(payload.propuestas ?? []);
    } finally {
      setLoadingHistorial(false);
    }
  };

  useEffect(() => {
    void load();
    void loadHistorial();
  }, []);

  // ── Validación ────────────────────────────────────────────────────────────
  const validateEdits = (lineas: Linea[]): string | null => {
    for (const linea of lineas) {
      const draft   = edits[linea.id];
      if (!draft) continue;
      const ajustado = draft.cajasValidadas !== linea.cajasPropuestas;
      if (ajustado && !draft.motivoAjuste)
        return `"${linea.nombreMedicamento ?? linea.cn}": se ajustó la cantidad pero falta el motivo.`;
      if (ajustado && draft.motivoAjuste === 'Otro' && !draft.motivoAjusteOtro.trim())
        return `"${linea.nombreMedicamento ?? linea.cn}": indica el motivo personalizado.`;
    }
    return null;
  };

  const saveAll = async (lineas: Linea[]) => {
    for (const linea of lineas) {
      const draft = edits[linea.id];
      if (!draft) continue;
      await fetch(`/api/propuestas/lineas/${linea.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
    }
  };

  // ── Guardar borrador ──────────────────────────────────────────────────────
  const handleGuardarBorrador = async () => {
    if (!data) return;
    const err = validateEdits(data.lineas);
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      await saveAll(data.lineas);
      toast.success('Borrador guardado.');
      await load();
    } catch { toast.error('Error al guardar.'); }
    finally { setSaving(false); }
  };

  // ── Tramitar ──────────────────────────────────────────────────────────────
  const handleTramitar = async () => {
    if (!data) return;
    const err = validateEdits(data.lineas);
    if (err) { toast.error(err); return; }
    setTramiting(true);
    try {
      await saveAll(data.lineas);
      const res     = await fetch('/api/propuestas/tramitar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propuestaId: data.propuesta.id }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo tramitar.');
      toast.success('Propuesta tramitada correctamente.');
      // Actualizar estado local sin recargar: así el botón Excel aparece de inmediato
      setData(prev =>
        prev ? { ...prev, propuesta: { ...prev.propuesta, estado: 'tramitada' } } : prev
      );
      // Refrescar historial en segundo plano
      void loadHistorial();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Error inesperado.'); }
    finally { setTramiting(false); }
  };

  // ── Deshacer tramitación ──────────────────────────────────────────────────
  const handleDeshacer = async () => {
    if (!data) return;
    if (!confirm('¿Deshacer la tramitación? La propuesta volverá a borrador y el recuento quedará pendiente de nuevo.')) return;
    setDeshaciendo(true);
    try {
      const res     = await fetch('/api/propuestas/deshacer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propuestaId: data.propuesta.id }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo deshacer.');
      toast.success('Propuesta revertida a borrador.');
      setData(prev =>
        prev ? { ...prev, propuesta: { ...prev.propuesta, estado: 'borrador' } } : prev
      );
      void loadHistorial();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Error inesperado.'); }
    finally { setDeshaciendo(false); }
  };

  // ── Deshacer desde historial ──────────────────────────────────────────────
  const handleDeshacerDesdeHistorial = async (p: PropuestaResumen) => {
    if (!confirm(`¿Deshacer la propuesta #${p.id}? Volverá a borrador y el recuento quedará pendiente.`)) return;
    try {
      const res     = await fetch('/api/propuestas/deshacer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propuestaId: p.id }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo deshacer.');
      toast.success('Propuesta revertida a borrador. Recargando…');
      await load();
      await loadHistorial();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Error inesperado.'); }
  };

  const descargarExcel = (propuestaId: number) =>
    window.open(`/api/propuestas/${propuestaId}/excel`, '_blank');

  const setLinea = (id: number, patch: Partial<DraftEdit>) =>
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">

      {/* ── PROPUESTA ACTIVA ─────────────────────────────────────────────── */}
      <section>
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 mb-1">Propuesta de pedido</h1>
            <p className="text-sm text-slate-500">
              Calculada a partir del recuento pendiente. Solo incluye artículos activos.
              Si ajustas cantidades debes indicar el motivo.
            </p>
          </div>

          {data && (
            <div className="flex items-center gap-2">
              {data.propuesta.estado === 'tramitada' && (
                <>
                  <button
                    onClick={handleDeshacer}
                    disabled={deshaciendo}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                    </svg>
                    {deshaciendo ? 'Deshaciendo…' : 'Deshacer tramitación'}
                  </button>
                  <button
                    onClick={() => descargarExcel(data.propuesta.id)}
                    className="flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-100 transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Exportar Excel
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {loading && <p className="text-sm text-slate-500">Cargando propuesta…</p>}

        {!loading && !data && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-6 py-10 text-center">
            <p className="text-slate-500 text-sm">No hay ningún recuento pendiente de propuesta.</p>
            <p className="text-slate-400 text-xs mt-1">Importa un recuento de stock para generar una nueva propuesta.</p>
          </div>
        )}

        {data && (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <Kpi label="Recuento" value={`#${data.recuento.id}`} sub={fmt(data.recuento.fechaRecuento)} />
              <Kpi label="Origen" value={ORIGEN_LABEL[data.recuento.origen] ?? data.recuento.origen} />
              <Kpi
                label="Estado propuesta"
                value={data.propuesta.estado.charAt(0).toUpperCase() + data.propuesta.estado.slice(1)}
                accent={data.propuesta.estado === 'tramitada' ? 'green' : 'amber'}
              />
              <Kpi label="Líneas" value={String(data.lineas.length)} sub="artículos activos" />
            </div>

            {/* Tabla */}
            <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 text-left">Medicamento</th>
                    <th className="px-4 py-3 text-center">Stock objetivo</th>
                    <th className="px-4 py-3 text-center">Stock actual</th>
                    <th className="px-4 py-3 text-center">Calculado</th>
                    <th className="px-4 py-3 text-center">Validado</th>
                    <th className="px-4 py-3 text-left">Motivo ajuste</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lineas.map((linea, idx) => {
                    const draft      = edits[linea.id];
                    const editable   = data.propuesta.estado === 'borrador';
                    const cajasVal   = draft?.cajasValidadas ?? linea.cajasPropuestas;
                    const diff       = cajasVal - linea.cajasPropuestas;
                    const aumentado  = diff > 0;
                    const reducido   = diff < 0;
                    // Rojo: stock por debajo del punto de pedido; azul: stock normal
                    const bajoMinimo = linea.stockActual <= linea.puntoPedidoSnap;

                    return (
                      <tr key={linea.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>

                        {/* Medicamento */}
                        <td className="px-4 py-3">
                          <div className="flex items-start gap-2">
                            {bajoMinimo && (
                              <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-rose-400" title="Stock por debajo del punto de pedido" />
                            )}
                            <div>
                              <p className="font-semibold text-slate-800 leading-snug">{linea.nombreMedicamento ?? '—'}</p>
                              <span className="mt-0.5 inline-block rounded bg-slate-100 px-1.5 py-px font-mono text-[11px] text-slate-500 tracking-wide">
                                {linea.cn}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Stock objetivo */}
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm font-medium text-slate-600 tabular-nums">
                            Min:&nbsp;<strong className="text-slate-800">{linea.stockMinimoSnap}</strong>
                            &nbsp;·&nbsp;
                            Máx:&nbsp;<strong className="text-slate-800">{linea.stockMaximoSnap}</strong>
                          </span>
                        </td>

                        {/* Stock actual — azul corporativo / rojo si bajo mínimo */}
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-block rounded-md px-3 py-1 text-base font-semibold tabular-nums ring-1 ${
                            bajoMinimo
                              ? 'bg-rose-50 text-rose-800 ring-rose-200'
                              : 'bg-sky-50 text-sky-800 ring-sky-200'
                          }`}>
                            {Number(linea.stockActual).toFixed(1)}
                          </span>
                        </td>

                        {/* Calculado */}
                        <td className="px-4 py-3 text-center">
                          <span className="inline-block rounded-md bg-slate-100 px-3 py-1 text-base font-semibold tabular-nums text-slate-700 ring-1 ring-slate-200">
                            {linea.cajasPropuestas}
                          </span>
                        </td>

                        {/* Validado */}
                        <td className="px-4 py-3 text-center">
                          {editable ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <input
                                type="number"
                                min={0}
                                value={cajasVal}
                                onChange={e => setLinea(linea.id, { cajasValidadas: Math.max(Number(e.target.value), 0) })}
                                className={`w-20 rounded-md border px-2 py-1 text-center text-base font-semibold tabular-nums transition-colors outline-none ${
                                  aumentado
                                    ? 'border-emerald-400 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-300'
                                    : reducido
                                      ? 'border-amber-400 bg-amber-50 text-amber-800 ring-1 ring-amber-300'
                                      : 'border-slate-200 bg-white text-slate-800'
                                }`}
                              />
                              {aumentado && (
                                <span className="flex items-center gap-0.5 text-[11px] font-medium text-emerald-600">
                                  <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3l5 6H3z"/></svg>
                                  +{diff} cajas
                                </span>
                              )}
                              {reducido && (
                                <span className="flex items-center gap-0.5 text-[11px] font-medium text-amber-600">
                                  <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor"><path d="M8 13l-5-6h10z"/></svg>
                                  {diff} cajas
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className={`inline-block rounded-md px-3 py-1 text-base font-semibold tabular-nums ring-1 ${
                                aumentado
                                  ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                                  : reducido
                                    ? 'bg-amber-50 text-amber-800 ring-amber-200'
                                    : 'bg-slate-100 text-slate-700 ring-slate-200'
                              }`}>
                                {linea.cajasValidadas ?? linea.cajasPropuestas}
                              </span>
                              {aumentado && (
                                <span className="flex items-center gap-0.5 text-[11px] font-medium text-emerald-600">
                                  <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3l5 6H3z"/></svg>
                                  +{diff} cajas
                                </span>
                              )}
                              {reducido && (
                                <span className="flex items-center gap-0.5 text-[11px] font-medium text-amber-600">
                                  <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor"><path d="M8 13l-5-6h10z"/></svg>
                                  {diff} cajas
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Motivo */}
                        <td className="px-4 py-3">
                          {editable ? (
                            <div className="space-y-1 min-w-[190px]">
                              <select
                                value={draft?.motivoAjuste ?? ''}
                                disabled={diff === 0}
                                onChange={e => setLinea(linea.id, { motivoAjuste: e.target.value })}
                                className={`w-full rounded border px-2 py-1 text-xs transition-colors ${
                                  diff !== 0 && !draft?.motivoAjuste
                                    ? 'border-red-300 bg-red-50 text-red-700'
                                    : 'border-slate-200 bg-white text-slate-600'
                                } disabled:opacity-40 disabled:cursor-not-allowed`}
                              >
                                <option value="">Sin ajuste</option>
                                {MOTIVOS_AJUSTE.map(m => <option key={m} value={m}>{m}</option>)}
                              </select>
                              {draft?.motivoAjuste === 'Otro' && diff !== 0 && (
                                <input
                                  value={draft?.motivoAjusteOtro ?? ''}
                                  onChange={e => setLinea(linea.id, { motivoAjusteOtro: e.target.value })}
                                  placeholder="Escribe el motivo…"
                                  className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                                />
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-600">
                              {linea.motivoAjuste === 'Otro'
                                ? linea.motivoAjusteOtro ?? 'Otro'
                                : linea.motivoAjuste ?? '—'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Acciones al pie */}
            {data.propuesta.estado === 'borrador' && (
              <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4 mt-2">
                <p className="text-xs text-slate-400 mr-auto">
                  {data.lineas.length} artículo{data.lineas.length !== 1 ? 's' : ''} en la propuesta
                </p>
                <button
                  onClick={handleGuardarBorrador}
                  disabled={saving || tramiting}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Guardando…' : 'Guardar borrador'}
                </button>
                <button
                  onClick={handleTramitar}
                  disabled={saving || tramiting}
                  className="rounded-lg bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50 transition-colors"
                >
                  {tramiting ? 'Tramitando…' : 'Tramitar propuesta'}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── HISTORIAL DE PROPUESTAS ─────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-slate-700 mb-3">Historial de propuestas</h2>

        {loadingHistorial && <p className="text-sm text-slate-400">Cargando historial…</p>}

        {!loadingHistorial && historial.length === 0 && (
          <p className="text-sm text-slate-400">No hay propuestas anteriores.</p>
        )}

        {historial.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 text-left">Propuesta</th>
                  <th className="px-4 py-2.5 text-left">Recuento</th>
                  <th className="px-4 py-2.5 text-left">Origen</th>
                  <th className="px-4 py-2.5 text-center">Líneas</th>
                  <th className="px-4 py-2.5 text-center">Estado</th>
                  <th className="px-4 py-2.5 text-left">Tramitada</th>
                  <th className="px-4 py-2.5 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((p, idx) => (
                  <tr key={p.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs text-slate-500">#{p.id}</span>
                      <p className="text-xs text-slate-400">{fmt(p.fechaGeneracion)}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {p.recuentoId ? `#${p.recuentoId}` : '—'}
                      {p.recuentoFecha && <p className="text-slate-400">{fmt(p.recuentoFecha)}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {p.recuentoOrigen ? (ORIGEN_LABEL[p.recuentoOrigen] ?? p.recuentoOrigen) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs text-slate-600">{p.totalLineas}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        p.estado === 'tramitada'
                          ? 'bg-teal-50 text-teal-700 ring-1 ring-teal-200'
                          : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                      }`}>
                        {p.estado.charAt(0).toUpperCase() + p.estado.slice(1)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{fmt(p.tramitadaEn)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {p.estado === 'tramitada' && (
                          <>
                            <button
                              onClick={() => descargarExcel(p.id)}
                              className="rounded border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] font-medium text-teal-700 hover:bg-teal-100 transition-colors"
                              title="Descargar Excel"
                            >
                              Excel
                            </button>
                            <button
                              onClick={() => handleDeshacerDesdeHistorial(p)}
                              className="rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                              title="Revertir a borrador"
                            >
                              Deshacer
                            </button>
                          </>
                        )}
                        {p.estado === 'borrador' && (
                          <span className="text-[11px] text-slate-400 italic">En edición</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------
function Kpi({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: 'green' | 'amber';
}) {
  const valueClass =
    accent === 'green' ? 'text-teal-700' :
    accent === 'amber' ? 'text-amber-600' :
    'text-slate-800';
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-400 font-medium">{label}</p>
      <p className={`mt-1 text-xl font-bold leading-tight tabular-nums ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}
