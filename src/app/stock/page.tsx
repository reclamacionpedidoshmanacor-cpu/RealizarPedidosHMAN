'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

type RecuentoCabecera = {
  id: number;
  estado: string;
  origen: string;
  fechaRecuento: string;
  importadoEn: string;
  totalLineas: number;
  propuestaId: number | null;
};

type RecuentoLinea = {
  cn: string;
  nombre: string;
  stockCajas: number;
  stockUnidades: number;
  valorTotal: number | null;
};

type ApiResponse = {
  pendiente: RecuentoCabecera | null;
  pendienteLineas: RecuentoLinea[];
  historico: RecuentoCabecera[];
};

export default function StockPage() {
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [savingCn, setSavingCn] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [origen, setOrigen] = useState<'SAP' | 'MANUAL'>('SAP');
  const [fechaRecuento, setFechaRecuento] = useState(new Date().toISOString().slice(0, 10));
  const fileRef = useRef<HTMLInputElement>(null);
  const [edits, setEdits] = useState<Record<string, number>>({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/stock/recuentos', { cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo cargar stock.');
      setData(payload);
      const nextEdits: Record<string, number> = {};
      for (const row of payload.pendienteLineas as RecuentoLinea[]) {
        nextEdits[row.cn] = row.stockCajas;
      }
      setEdits(nextEdits);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('origen', origen);
      form.append('fechaRecuento', fechaRecuento);
      const res = await fetch('/api/stock/recuentos', { method: 'POST', body: form });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo importar recuento.');
      toast.success(`Recuento creado con ${payload.totalLineas} lineas.`);
      if (payload.errores?.length) {
        toast.warning(`Se detectaron ${payload.errores.length} advertencias en la importacion.`);
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const saveLinea = async (cn: string) => {
    if (!data?.pendiente) return;
    setSavingCn(cn);
    try {
      const res = await fetch(`/api/stock/recuentos/${data.pendiente.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cn, stockCajas: edits[cn] }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo guardar la linea.');
      toast.success('Linea actualizada');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setSavingCn(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Stock y recuentos</h1>
        <p className="text-sm text-slate-500">
          Sube recuentos SAP o manuales. Solo el recuento pendiente es editable y se usa para Propuesta.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Origen</label>
            <select
              value={origen}
              onChange={(e) => setOrigen(e.target.value as 'SAP' | 'MANUAL')}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="SAP">SAP</option>
              <option value="MANUAL">Manual</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Fecha recuento</label>
            <input
              type="date"
              value={fechaRecuento}
              onChange={(e) => setFechaRecuento(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={upload}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {uploading ? 'Importando...' : 'Subir Excel de recuento'}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Cargando recuentos...</p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-800">Recuento pendiente</h2>
            {!data?.pendiente ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                No hay recuento pendiente. Sube un Excel para iniciar propuesta.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <Kpi label="ID" value={`#${data.pendiente.id}`} />
                  <Kpi label="Origen" value={data.pendiente.origen} />
                  <Kpi label="Fecha recuento" value={data.pendiente.fechaRecuento} />
                  <Kpi label="Lineas" value={String(data.pendiente.totalLineas)} />
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left">CN</th>
                        <th className="px-3 py-2 text-left">Medicamento</th>
                        <th className="px-3 py-2 text-center">Stock cajas</th>
                        <th className="px-3 py-2 text-center">Stock unidades</th>
                        <th className="px-3 py-2 text-center">Accion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.pendienteLineas.map((linea) => (
                        <tr key={linea.cn} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-mono text-xs">{linea.cn}</td>
                          <td className="px-3 py-2">{linea.nombre}</td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="number"
                              min={0}
                              value={edits[linea.cn] ?? linea.stockCajas}
                              onChange={(e) =>
                                setEdits((prev) => ({
                                  ...prev,
                                  [linea.cn]: Math.max(Number(e.target.value), 0),
                                }))
                              }
                              className="w-24 rounded border border-slate-300 px-2 py-1 text-center"
                            />
                          </td>
                          <td className="px-3 py-2 text-center">{linea.stockUnidades.toFixed(2)}</td>
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => saveLinea(linea.cn)}
                              disabled={savingCn === linea.cn}
                              className="rounded bg-teal-700 px-2 py-1 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                            >
                              Guardar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-800">Recuentos historicos</h2>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left">ID</th>
                    <th className="px-3 py-2 text-left">Fecha</th>
                    <th className="px-3 py-2 text-left">Origen</th>
                    <th className="px-3 py-2 text-left">Estado</th>
                    <th className="px-3 py-2 text-left">Lineas</th>
                    <th className="px-3 py-2 text-left">Propuesta</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.historico ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-slate-500">
                        No hay recuentos historicos.
                      </td>
                    </tr>
                  ) : (
                    data?.historico.map((it) => (
                      <tr key={it.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">#{it.id}</td>
                        <td className="px-3 py-2">{it.fechaRecuento}</td>
                        <td className="px-3 py-2">{it.origen}</td>
                        <td className="px-3 py-2">{it.estado}</td>
                        <td className="px-3 py-2">{it.totalLineas}</td>
                        <td className="px-3 py-2">{it.propuestaId ? `#${it.propuestaId}` : '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
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
