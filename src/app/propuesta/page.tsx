'use client';

import { useEffect, useMemo, useState } from 'react';
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

export default function PropuestaPage() {
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [tramiting, setTramiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [edits, setEdits] = useState<Record<number, DraftEdit>>({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/propuestas/actual', { cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error ?? 'No se pudo preparar la propuesta.');
      }
      setData(payload);
      const nextEdits: Record<number, DraftEdit> = {};
      for (const linea of payload.lineas as Linea[]) {
        nextEdits[linea.id] = {
          cajasValidadas: linea.cajasValidadas ?? linea.cajasPropuestas,
          motivoAjuste: linea.motivoAjuste ?? '',
          motivoAjusteOtro: linea.motivoAjusteOtro ?? '',
        };
      }
      setEdits(nextEdits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const totalUnidades = useMemo(() => {
    if (!data) return 0;
    return data.lineas.reduce((acc, linea) => {
      const draft = edits[linea.id];
      const cajas = draft?.cajasValidadas ?? linea.cajasValidadas ?? linea.cajasPropuestas;
      return acc + Math.round(cajas * linea.unidadesPorCaja);
    }, 0);
  }, [data, edits]);

  const saveLinea = async (linea: Linea) => {
    const draft = edits[linea.id];
    if (!draft) return;

    const ajustado = draft.cajasValidadas !== linea.cajasPropuestas;
    if (ajustado && !draft.motivoAjuste) {
      toast.error('Selecciona un motivo para el ajuste.');
      return;
    }
    if (ajustado && draft.motivoAjuste === 'Otro' && !draft.motivoAjusteOtro.trim()) {
      toast.error('Escribe el motivo personalizado.');
      return;
    }

    setSavingId(linea.id);
    try {
      const res = await fetch(`/api/propuestas/lineas/${linea.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo guardar la linea.');
      toast.success('Linea guardada');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado.');
    } finally {
      setSavingId(null);
    }
  };

  const tramitar = async () => {
    if (!data) return;
    setTramiting(true);
    try {
      const res = await fetch('/api/propuestas/tramitar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propuestaId: data.propuesta.id }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo tramitar la propuesta.');
      toast.success('Propuesta tramitada y recuento marcado como generado.');
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

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Propuesta de pedido</h1>
          <p className="text-sm text-slate-500">
            Calculada desde el recuento pendiente. Si ajustas cantidades, debes indicar motivo.
          </p>
        </div>
        {data?.propuesta.estado === 'tramitada' && (
          <button
            onClick={descargarExcel}
            className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-100"
          >
            Descargar Excel
          </button>
        )}
      </div>

      {loading && <p className="text-sm text-slate-500">Cargando propuesta...</p>}
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Kpi label="Recuento pendiente" value={`#${data.recuento.id}`} />
            <Kpi label="Fecha recuento" value={data.recuento.fechaRecuento} />
            <Kpi label="Estado propuesta" value={data.propuesta.estado} />
            <Kpi label="Unidades totales" value={String(totalUnidades)} />
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">CN</th>
                  <th className="px-3 py-2 text-left">Medicamento</th>
                  <th className="px-3 py-2 text-center">Stock actual</th>
                  <th className="px-3 py-2 text-center">Stock min</th>
                  <th className="px-3 py-2 text-center">Punto pedido</th>
                  <th className="px-3 py-2 text-center">Stock max</th>
                  <th className="px-3 py-2 text-center">Calculado (cajas)</th>
                  <th className="px-3 py-2 text-center">Propuesto final</th>
                  <th className="px-3 py-2 text-left">Motivo ajuste</th>
                  <th className="px-3 py-2 text-center">Accion</th>
                </tr>
              </thead>
              <tbody>
                {data.lineas.map((linea) => {
                  const draft = edits[linea.id];
                  const editable = data.propuesta.estado === 'borrador';
                  const ajustado = draft ? draft.cajasValidadas !== linea.cajasPropuestas : false;
                  return (
                    <tr key={linea.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">{linea.cn}</td>
                      <td className="px-3 py-2">{linea.nombreMedicamento ?? '—'}</td>
                      <td className="px-3 py-2 text-center">{linea.stockActual.toFixed(2)}</td>
                      <td className="px-3 py-2 text-center">{linea.stockMinimoSnap}</td>
                      <td className="px-3 py-2 text-center">{linea.puntoPedidoSnap}</td>
                      <td className="px-3 py-2 text-center">{linea.stockMaximoSnap}</td>
                      <td className="px-3 py-2 text-center font-semibold text-amber-700">{linea.cajasPropuestas}</td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="number"
                          min={0}
                          disabled={!editable}
                          value={draft?.cajasValidadas ?? linea.cajasPropuestas}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [linea.id]: {
                                ...prev[linea.id],
                                cajasValidadas: Math.max(Number(e.target.value), 0),
                              },
                            }))
                          }
                          className="w-20 rounded border border-slate-300 px-2 py-1 text-center"
                        />
                      </td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <div className="space-y-1">
                            <select
                              value={draft?.motivoAjuste ?? ''}
                              disabled={!ajustado}
                              onChange={(e) =>
                                setEdits((prev) => ({
                                  ...prev,
                                  [linea.id]: {
                                    ...prev[linea.id],
                                    motivoAjuste: e.target.value,
                                  },
                                }))
                              }
                              className="w-full rounded border border-slate-300 px-2 py-1"
                            >
                              <option value="">Sin ajuste</option>
                              {MOTIVOS_AJUSTE.map((motivo) => (
                                <option key={motivo} value={motivo}>
                                  {motivo}
                                </option>
                              ))}
                            </select>
                            {(draft?.motivoAjuste ?? '') === 'Otro' && ajustado && (
                              <input
                                value={draft?.motivoAjusteOtro ?? ''}
                                onChange={(e) =>
                                  setEdits((prev) => ({
                                    ...prev,
                                    [linea.id]: {
                                      ...prev[linea.id],
                                      motivoAjusteOtro: e.target.value,
                                    },
                                  }))
                                }
                                className="w-full rounded border border-slate-300 px-2 py-1"
                                placeholder="Escribe motivo"
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
                      <td className="px-3 py-2 text-center">
                        {editable && (
                          <button
                            onClick={() => saveLinea(linea)}
                            disabled={savingId === linea.id}
                            className="rounded bg-teal-700 px-2 py-1 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                          >
                            Guardar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {data.propuesta.estado === 'borrador' && (
            <div className="flex justify-end">
              <button
                onClick={tramitar}
                disabled={tramiting}
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {tramiting ? 'Tramitando...' : 'Validacion farmaceutica'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-800">{value}</p>
    </div>
  );
}
