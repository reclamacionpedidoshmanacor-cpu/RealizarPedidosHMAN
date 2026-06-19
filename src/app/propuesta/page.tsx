'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MOTIVOS_AJUSTE } from '@/lib/propuesta';

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

const ORIGEN_LABEL: Record<string, string> = {
  manual: 'Manual',
  importacion: 'Importación',
  automatico: 'Automático',
};

function fmt(date: string) {
  return new Date(date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function PropuestaPage() {
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);
  const [tramiting, setTramiting] = useState(false);
  const [error,   setError]     = useState<string | null>(null);
  const [data,    setData]      = useState<ApiResponse | null>(null);
  const [edits,   setEdits]     = useState<Record<number, DraftEdit>>({});

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
          cajasValidadas:    linea.cajasValidadas ?? linea.cajasPropuestas,
          motivoAjuste:      linea.motivoAjuste ?? '',
          motivoAjusteOtro:  linea.motivoAjusteOtro ?? '',
        };
      }
      setEdits(nextEdits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  /** Valida los edits y devuelve el primer error encontrado o null */
  const validateEdits = (lineas: Linea[]): string | null => {
    for (const linea of lineas) {
      const draft   = edits[linea.id];
      if (!draft) continue;
      const ajustado = draft.cajasValidadas !== linea.cajasPropuestas;
      if (ajustado && !draft.motivoAjuste) {
        return `"${linea.nombreMedicamento ?? linea.cn}": se ajustó la cantidad pero falta el motivo.`;
      }
      if (ajustado && draft.motivoAjuste === 'Otro' && !draft.motivoAjusteOtro.trim()) {
        return `"${linea.nombreMedicamento ?? linea.cn}": indica el motivo personalizado.`;
      }
    }
    return null;
  };

  /** Guarda todas las líneas con cambios via PATCH */
  const saveAll = async (lineas: Linea[]) => {
    for (const linea of lineas) {
      const draft   = edits[linea.id];
      if (!draft) continue;
      await fetch(`/api/propuestas/lineas/${linea.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
    }
  };

  const handleGuardarBorrador = async () => {
    if (!data) return;
    const err = validateEdits(data.lineas);
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      await saveAll(data.lineas);
      toast.success('Borrador guardado.');
      await load();
    } catch {
      toast.error('Error al guardar.');
    } finally {
      setSaving(false);
    }
  };

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
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado.');
    } finally {
      setTramiting(false);
    }
  };

  const descargarExcel = () => {
    if (!data) return;
    window.open(`/api/propuestas/${data.propuesta.id}/excel`, '_blank');
  };

  const setLinea = (id: number, patch: Partial<DraftEdit>) => {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  return (
    <div className="space-y-5">
      {/* Cabecera */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Propuesta de pedido</h1>
          <p className="text-sm text-slate-500">
            Calculada a partir del recuento pendiente. Solo incluye artículos activos.
            Si ajustas cantidades debes indicar el motivo.
          </p>
        </div>
        {data?.propuesta.estado === 'tramitada' && (
          <button
            onClick={descargarExcel}
            className="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-700 hover:bg-teal-100 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Exportar Excel
          </button>
        )}
      </div>

      {loading && <p className="text-sm text-slate-500">Cargando propuesta…</p>}
      {error   && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {data && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                  <th className="px-4 py-3 text-center">Stock objetivo<br/><span className="normal-case font-normal text-[10px]">min · PP · max</span></th>
                  <th className="px-4 py-3 text-center">Stock actual</th>
                  <th className="px-4 py-3 text-center">Calculado<br/><span className="normal-case font-normal text-[10px]">cajas</span></th>
                  <th className="px-4 py-3 text-center">Validado<br/><span className="normal-case font-normal text-[10px]">cajas</span></th>
                  <th className="px-4 py-3 text-left">Motivo ajuste</th>
                </tr>
              </thead>
              <tbody>
                {data.lineas.map((linea, idx) => {
                  const draft     = edits[linea.id];
                  const editable  = data.propuesta.estado === 'borrador';
                  const cajasVal  = draft?.cajasValidadas ?? linea.cajasPropuestas;
                  const ajustado  = cajasVal !== linea.cajasPropuestas;
                  const bajoPP    = linea.stockActual <= linea.puntoPedidoSnap;

                  return (
                    <tr
                      key={linea.id}
                      className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}
                    >
                      {/* Medicamento */}
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2">
                          {bajoPP && (
                            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-400" title="Stock bajo punto de pedido" />
                          )}
                          <div>
                            <p className="font-semibold text-slate-800 leading-tight">
                              {linea.nombreMedicamento ?? '—'}
                            </p>
                            <span className="inline-block mt-0.5 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">
                              {linea.cn}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Stock objetivo */}
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1 text-xs text-slate-500 flex-wrap">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5">{linea.stockMinimoSnap}</span>
                          <span className="text-slate-300">·</span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">{linea.puntoPedidoSnap}</span>
                          <span className="text-slate-300">·</span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5">{linea.stockMaximoSnap}</span>
                        </div>
                      </td>

                      {/* Stock actual */}
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block rounded-lg px-3 py-1 text-base font-bold ${
                          bajoPP
                            ? 'bg-red-50 text-red-700 ring-1 ring-red-200'
                            : 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                        }`}>
                          {Number(linea.stockActual).toFixed(1)}
                        </span>
                      </td>

                      {/* Calculado */}
                      <td className="px-4 py-3 text-center">
                        <span className="inline-block rounded-lg bg-amber-50 px-3 py-1 text-base font-bold text-amber-700 ring-1 ring-amber-200">
                          {linea.cajasPropuestas}
                        </span>
                      </td>

                      {/* Validado */}
                      <td className="px-4 py-3 text-center">
                        {editable ? (
                          <input
                            type="number"
                            min={0}
                            value={cajasVal}
                            onChange={e => setLinea(linea.id, { cajasValidadas: Math.max(Number(e.target.value), 0) })}
                            className={`w-20 rounded-lg border px-2 py-1 text-center text-base font-bold transition-colors ${
                              ajustado
                                ? 'border-green-400 bg-green-50 text-green-800 ring-1 ring-green-300'
                                : 'border-slate-200 bg-white text-slate-700'
                            }`}
                          />
                        ) : (
                          <span className={`inline-block rounded-lg px-3 py-1 text-base font-bold ${
                            ajustado
                              ? 'bg-green-50 text-green-800 ring-1 ring-green-200'
                              : 'bg-slate-50 text-slate-700'
                          }`}>
                            {linea.cajasValidadas ?? linea.cajasPropuestas}
                          </span>
                        )}
                      </td>

                      {/* Motivo ajuste */}
                      <td className="px-4 py-3">
                        {editable ? (
                          <div className="space-y-1 min-w-[180px]">
                            <select
                              value={draft?.motivoAjuste ?? ''}
                              disabled={!ajustado}
                              onChange={e => setLinea(linea.id, { motivoAjuste: e.target.value })}
                              className={`w-full rounded border px-2 py-1 text-xs transition-colors ${
                                ajustado && !draft?.motivoAjuste
                                  ? 'border-red-300 bg-red-50'
                                  : 'border-slate-200 bg-white text-slate-600'
                              } disabled:opacity-40`}
                            >
                              <option value="">Sin ajuste</option>
                              {MOTIVOS_AJUSTE.map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                            {draft?.motivoAjuste === 'Otro' && ajustado && (
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

          {/* Acciones finales */}
          {data.propuesta.estado === 'borrador' && (
            <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
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
    </div>
  );
}

function Kpi({
  label, value, sub, accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'green' | 'amber';
}) {
  const valueClass =
    accent === 'green'  ? 'text-teal-700' :
    accent === 'amber'  ? 'text-amber-600' :
    'text-slate-800';

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-400 font-medium">{label}</p>
      <p className={`mt-1 text-xl font-bold leading-tight ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}
