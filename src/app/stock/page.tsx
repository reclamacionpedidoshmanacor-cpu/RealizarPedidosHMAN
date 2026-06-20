'use client';

import Link from 'next/link';
import { Fragment, useEffect, useRef, useState } from 'react';
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

type ReposicionCabecera = {
  id: number;
  estado: 'borrador' | 'finalizado';
  fechaCreacion: string;
  fechaFinalizado: string | null;
  totalLineas: number;
};

type RecuentoLinea = {
  cn: string;
  principioActivo: string | null;
  nombre: string;
  unidadesPorCaja: number;
  stockCajas: number;
  stockUnidades: number;
  valorTotal: number | null;
};

type ApiResponse = {
  pendiente: RecuentoCabecera | null;
  pendienteLineas: RecuentoLinea[];
  historico: RecuentoCabecera[];
};

type RecuentoDetalleResponse = {
  recuento: RecuentoCabecera;
  lineas: RecuentoLinea[];
};

const stockCajasFormatter = new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const stockUnidadesFormatter = new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatStockCajas(value: number): string {
  return stockCajasFormatter.format(roundOneDecimal(value));
}

function formatStockUnidades(value: number): string {
  return stockUnidadesFormatter.format(value);
}

function parseStockCajasInput(input: string): number | null {
  const raw = input.trim();
  if (!raw) return null;

  const compact = raw.replace(/\s/g, '');
  let normalized = compact;

  if (compact.includes(',')) {
    normalized = compact.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(compact)) {
    normalized = compact.replace(/\./g, '');
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return roundOneDecimal(value);
}

export default function StockPage() {
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [updatingFromCatalog, setUpdatingFromCatalog] = useState(false);
  const [deletingPending, setDeletingPending] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [origen, setOrigen] = useState<'SAP' | 'MANUAL'>('SAP');
  const [fechaRecuento, setFechaRecuento] = useState(new Date().toISOString().slice(0, 10));
  const fileRef = useRef<HTMLInputElement>(null);
  const [lastWarnings, setLastWarnings] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [historicoExpanded, setHistoricoExpanded] = useState<Record<number, boolean>>({});
  const [historicoLineas, setHistoricoLineas] = useState<Record<number, RecuentoLinea[]>>({});
  const [historicoLoading, setHistoricoLoading] = useState<Record<number, boolean>>({});
  const [recoveringId, setRecoveringId] = useState<number | null>(null);
  const [deletingHistoricoId, setDeletingHistoricoId] = useState<number | null>(null);
  const [sendingEmailId, setSendingEmailId] = useState<number | null>(null);

  /* ── Pedidos de Reposición (solo UPE) ── */
  const [reposicion, setReposicion] = useState<{ borrador: ReposicionCabecera | null; historial: ReposicionCabecera[] } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/stock/recuentos', { cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo cargar stock.');
      setData(payload);
      const nextEdits: Record<string, string> = {};
      for (const row of payload.pendienteLineas as RecuentoLinea[]) {
        nextEdits[row.cn] = formatStockCajas(row.stockCajas);
      }
      setEdits(nextEdits);
      setHistoricoExpanded({});
      setHistoricoLineas({});
      setHistoricoLoading({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    void loadReposicion();
  }, []);

  const loadReposicion = async () => {
    try {
      const res = await fetch('/api/reposicion', { cache: 'no-store' });
      if (res.status === 403) { setReposicion(null); return; }
      const payload = await res.json();
      if (!res.ok) return;
      setReposicion({ borrador: payload.borrador ?? null, historial: payload.historial ?? [] });
    } catch { /* área no UPE: silencioso */ }
  };

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setLastWarnings([]);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('origen', origen);
      form.append('fechaRecuento', fechaRecuento);
      const res = await fetch('/api/stock/recuentos', { method: 'POST', body: form });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo importar recuento.');
      const advertencias = Array.isArray(payload?.errores)
        ? payload.errores.map((msg: unknown) => String(msg))
        : [];
      setLastWarnings(advertencias);
      const preciosActualizados = Number(payload?.preciosActualizados ?? 0);
      toast.success(
        preciosActualizados > 0
          ? `Recuento creado con ${payload.totalLineas} lineas. Precios actualizados: ${preciosActualizados}.`
          : `Recuento creado con ${payload.totalLineas} lineas.`
      );
      if (advertencias.length > 0) {
        toast.warning(`Se detectaron ${advertencias.length} advertencias en la importacion. Revisa el detalle debajo.`);
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const normalizeEdit = (cn: string, fallback: number) => {
    setEdits((prev) => {
      const parsed = parseStockCajasInput(prev[cn] ?? '');
      return {
        ...prev,
        [cn]: parsed == null ? formatStockCajas(fallback) : formatStockCajas(parsed),
      };
    });
  };

  const saveRecuentoCompleto = async () => {
    if (!data?.pendiente) return;
    const cambios: Array<{ cn: string; stockCajas: number }> = [];
    const invalidos: string[] = [];

    for (const linea of data.pendienteLineas) {
      const input = edits[linea.cn] ?? formatStockCajas(linea.stockCajas);
      const parsed = parseStockCajasInput(input);
      if (parsed == null) {
        invalidos.push(linea.cn);
        continue;
      }
      if (Math.abs(parsed - roundOneDecimal(linea.stockCajas)) > 0.0001) {
        cambios.push({ cn: linea.cn, stockCajas: parsed });
      }
    }

    if (invalidos.length > 0) {
      toast.error(`Hay valores de cajas no validos (${invalidos.join(', ')}).`);
      return;
    }

    if (cambios.length === 0) {
      toast.info('No hay cambios pendientes de guardar.');
      return;
    }

    setSavingAll(true);
    try {
      const res = await fetch(`/api/stock/recuentos/${data.pendiente.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineas: cambios }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo guardar el recuento.');
      let propuestaSyncMsg = '';
      try {
        const syncRes = await fetch(`/api/stock/recuentos/${data.pendiente.id}/actualizar`, { method: 'POST' });
        const syncPayload = await syncRes.json();
        if (syncRes.ok && syncPayload?.propuestaActualizada) {
          propuestaSyncMsg = ` Propuesta borrador sincronizada (${syncPayload?.lineasPropuesta ?? 0} líneas).`;
        }
      } catch {
        // Silencioso: el recuento ya quedó guardado.
      }
      toast.success(`Recuento guardado (${payload?.updated ?? cambios.length} lineas actualizadas).${propuestaSyncMsg}`);
      const omitidosCatalogo = Array.isArray(payload?.omitidosCatalogo)
        ? (payload.omitidosCatalogo as unknown[]).map((cn) => String(cn))
        : [];
      if (omitidosCatalogo.length > 0) {
        toast.warning(`Se omitieron ${omitidosCatalogo.length} CN fuera del catálogo activo.`);
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setSavingAll(false);
    }
  };

  const actualizarDesdeCatalogo = async () => {
    if (!data?.pendiente) return;
    if (!confirm('¿Actualizar el recuento pendiente con los datos actuales de catálogo? También se actualizará la propuesta borrador vinculada si existe.')) {
      return;
    }

    setUpdatingFromCatalog(true);
    try {
      const res = await fetch(`/api/stock/recuentos/${data.pendiente.id}/actualizar`, { method: 'POST' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo actualizar desde catálogo.');

      const sinCatalogo = Array.isArray(payload?.cnsSinCatalogo)
        ? (payload.cnsSinCatalogo as unknown[]).map((cn) => String(cn))
        : [];

      toast.success(
        payload?.propuestaActualizada
          ? `Recuento actualizado (${payload?.lineasRecuentoActualizadas ?? 0} líneas). Propuesta borrador regenerada (${payload?.lineasPropuesta ?? 0} líneas).`
          : `Recuento actualizado (${payload?.lineasRecuentoActualizadas ?? 0} líneas).`
      );
      if (sinCatalogo.length > 0) {
        toast.warning(`Hay ${sinCatalogo.length} CN del recuento sin catálogo activo.`);
      }

      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setUpdatingFromCatalog(false);
    }
  };

  const eliminarRecuentoPendiente = async () => {
    if (!data?.pendiente) return;
    const ok = confirm(
      '¿Eliminar el recuento pendiente actual? Se borrarán sus líneas y cualquier propuesta en borrador vinculada.'
    );
    if (!ok) return;

    setDeletingPending(true);
    try {
      const res = await fetch(`/api/stock/recuentos/${data.pendiente.id}`, { method: 'DELETE' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo eliminar el recuento pendiente.');
      toast.success(
        `Recuento eliminado (${payload?.lineasEliminadas ?? 0} lineas, ${payload?.propuestasEliminadas ?? 0} propuestas borrador).`
      );
      setLastWarnings([]);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setDeletingPending(false);
    }
  };

  const copiarAdvertencias = async () => {
    if (lastWarnings.length === 0) return;
    try {
      await navigator.clipboard.writeText(lastWarnings.join('\n'));
      toast.success('Advertencias copiadas al portapapeles.');
    } catch {
      toast.error('No se pudieron copiar las advertencias.');
    }
  };

  const toggleHistorico = async (recuentoId: number) => {
    const alreadyOpen = historicoExpanded[recuentoId] ?? false;
    if (alreadyOpen) {
      setHistoricoExpanded((prev) => ({ ...prev, [recuentoId]: false }));
      return;
    }

    setHistoricoExpanded((prev) => ({ ...prev, [recuentoId]: true }));
    if (historicoLineas[recuentoId] || historicoLoading[recuentoId]) return;

    setHistoricoLoading((prev) => ({ ...prev, [recuentoId]: true }));
    try {
      const res = await fetch(`/api/stock/recuentos/${recuentoId}`, { cache: 'no-store' });
      const payload = (await res.json()) as RecuentoDetalleResponse & { error?: string };
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo cargar el detalle del recuento.');
      setHistoricoLineas((prev) => ({ ...prev, [recuentoId]: payload.lineas ?? [] }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
      setHistoricoExpanded((prev) => ({ ...prev, [recuentoId]: false }));
    } finally {
      setHistoricoLoading((prev) => ({ ...prev, [recuentoId]: false }));
    }
  };

  const recuperarHistorico = async (recuentoId: number) => {
    if (!confirm('¿Recuperar este recuento generado y dejarlo pendiente para nueva propuesta?')) return;

    setRecoveringId(recuentoId);
    try {
      const res = await fetch(`/api/stock/recuentos/${recuentoId}/recuperar`, { method: 'POST' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo recuperar el recuento.');
      toast.success('Recuento recuperado y marcado como pendiente.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setRecoveringId(null);
    }
  };

  const eliminarRecuentoHistorico = async (recuentoId: number) => {
    const ok = confirm(
      `¿Eliminar el recuento histórico #${recuentoId}? Esta acción también borrará propuestas vinculadas a ese recuento.`
    );
    if (!ok) return;

    setDeletingHistoricoId(recuentoId);
    try {
      const res = await fetch(`/api/stock/recuentos/${recuentoId}/historial`, { method: 'DELETE' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo eliminar el recuento histórico.');
      toast.success(
        `Recuento #${recuentoId} eliminado (${payload?.lineasEliminadas ?? 0} líneas, ${payload?.propuestasEliminadas ?? 0} propuestas).`
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setDeletingHistoricoId(null);
    }
  };

  const enviarPedidoReposicionEmail = async (pedidoId: number) => {
    setSendingEmailId(pedidoId);
    try {
      const res = await fetch(`/api/reposicion/${pedidoId}/email`, { method: 'POST' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo enviar el email.');
      toast.success(`Email enviado para pedido #${pedidoId}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setSendingEmailId(null);
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
              disabled={uploading || !!data?.pendiente}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {uploading
                ? 'Importando...'
                : data?.pendiente
                  ? 'Hay un recuento pendiente'
                  : 'Subir Excel de recuento'}
            </button>
          </div>
        </div>
        {data?.pendiente ? (
          <p className="mt-3 text-xs text-amber-700">
            Ya existe un recuento pendiente. Tramítalo o elimínalo para cargar un nuevo archivo.
          </p>
        ) : null}
      </div>

      {lastWarnings.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-amber-800">
              Advertencias de la última importación ({lastWarnings.length})
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={copiarAdvertencias}
                className="rounded border border-amber-300 bg-white px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
              >
                Copiar advertencias
              </button>
              <button
                onClick={() => setLastWarnings([])}
                className="rounded border border-amber-300 bg-white px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
              >
                Ocultar
              </button>
            </div>
          </div>
          <p className="mb-2 text-xs text-amber-700">
            Formato: [TIPO] detalle. Ejemplo: [ARCHIVO], [CATALOGO], [PRECIO].
          </p>
          <textarea
            readOnly
            value={lastWarnings.join('\n')}
            className="h-44 w-full rounded border border-amber-200 bg-white p-2 text-xs text-slate-700"
          />
        </div>
      ) : null}

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
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-600">
                    Formato de stock en cajas: <span className="font-semibold">0.000,0</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={actualizarDesdeCatalogo}
                      disabled={updatingFromCatalog}
                      className="rounded-lg border border-indigo-300 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                      title="Sincroniza el recuento pendiente con el catálogo actual y regenera propuesta borrador"
                    >
                      {updatingFromCatalog ? 'Actualizando...' : 'Actualizar desde catálogo'}
                    </button>
                    <button
                      onClick={eliminarRecuentoPendiente}
                      disabled={deletingPending}
                      className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      {deletingPending ? 'Eliminando...' : 'Eliminar recuento pendiente'}
                    </button>
                    <button
                      onClick={saveRecuentoCompleto}
                      disabled={savingAll}
                      className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                    >
                      {savingAll ? 'Guardando recuento...' : 'Guardar recuento completo'}
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">CN</th>
                        <th className="px-3 py-2 text-left">Principio activo</th>
                        <th className="px-3 py-2 text-left">Marca / nombre comercial</th>
                        <th className="px-3 py-2 text-center">Stock cajas</th>
                        <th className="px-3 py-2 text-center">Stock unidades</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.pendienteLineas.map((linea) => (
                        <tr key={linea.cn} className="border-t border-slate-100">
                          <td className="px-3 py-2">
                            <span className="inline-block rounded bg-slate-100 px-1.5 py-px font-mono text-[11px] text-slate-500 tracking-wide">{linea.cn}</span>
                          </td>
                          <td className="px-3 py-2 font-semibold text-slate-800">{linea.principioActivo ?? '—'}</td>
                          <td className="px-3 py-2 text-[12px] italic text-slate-400 font-sans">{linea.nombre}</td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={edits[linea.cn] ?? formatStockCajas(linea.stockCajas)}
                              onChange={(e) =>
                                setEdits((prev) => ({
                                  ...prev,
                                  [linea.cn]: e.target.value,
                                }))
                              }
                              onBlur={() => normalizeEdit(linea.cn, linea.stockCajas)}
                              className="w-28 rounded border border-slate-300 px-2 py-1 text-center"
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            {(() => {
                              const parsed = parseStockCajasInput(
                                edits[linea.cn] ?? formatStockCajas(linea.stockCajas)
                              );
                              if (parsed == null) return formatStockUnidades(linea.stockUnidades);
                              const unidadesPreview = parsed * (linea.unidadesPorCaja > 0 ? linea.unidadesPorCaja : 1);
                              const changed = Math.abs(unidadesPreview - linea.stockUnidades) > 0.0001;
                              return (
                                <span className={changed ? 'font-semibold text-indigo-700' : undefined}>
                                  {formatStockUnidades(unidadesPreview)}
                                </span>
                              );
                            })()}
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
            <h2 className="text-lg font-semibold text-slate-800">Historial de recuentos</h2>
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
                    <th className="px-3 py-2 text-left">Detalle</th>
                    <th className="px-3 py-2 text-left">Recuperar</th>
                    <th className="px-3 py-2 text-left">Eliminar</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.historico ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-4 text-slate-500">
                        No hay recuentos historicos.
                      </td>
                    </tr>
                  ) : (
                    data?.historico.map((it) => (
                      <Fragment key={it.id}>
                        <tr className="border-t border-slate-100">
                          <td className="px-3 py-2">#{it.id}</td>
                          <td className="px-3 py-2">{it.fechaRecuento}</td>
                          <td className="px-3 py-2">{it.origen}</td>
                          <td className="px-3 py-2">{it.estado}</td>
                          <td className="px-3 py-2">{it.totalLineas}</td>
                          <td className="px-3 py-2">{it.propuestaId ? `#${it.propuestaId}` : '—'}</td>
                          <td className="px-3 py-2">
                            <button
                              onClick={() => toggleHistorico(it.id)}
                              className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              {historicoExpanded[it.id] ? 'Ocultar' : 'Desplegar'}
                            </button>
                          </td>
                          <td className="px-3 py-2">
                            {it.estado === 'generado' ? (
                              <button
                                onClick={() => recuperarHistorico(it.id)}
                                disabled={recoveringId === it.id}
                                className="rounded border border-teal-300 px-2 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50"
                              >
                                {recoveringId === it.id ? 'Recuperando...' : 'Recuperar'}
                              </button>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              onClick={() => void eliminarRecuentoHistorico(it.id)}
                              disabled={deletingHistoricoId === it.id}
                              className="inline-flex h-7 w-7 items-center justify-center rounded border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                              title="Eliminar recuento histórico"
                              aria-label={`Eliminar recuento ${it.id}`}
                            >
                              {deletingHistoricoId === it.id ? '…' : '🗑'}
                            </button>
                          </td>
                        </tr>
                        {historicoExpanded[it.id] && (
                          <tr className="border-t border-slate-100 bg-slate-50">
                            <td colSpan={9} className="px-3 py-3">
                              {historicoLoading[it.id] ? (
                                <p className="text-sm text-slate-500">Cargando detalle...</p>
                              ) : (historicoLineas[it.id] ?? []).length === 0 ? (
                                <p className="text-sm text-slate-500">Sin lineas de detalle.</p>
                              ) : (
                                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                  <table className="min-w-full text-xs">
                                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                                      <tr>
                                        <th className="px-2 py-2 text-left">CN</th>
                                        <th className="px-2 py-2 text-left">Principio activo</th>
                                        <th className="px-2 py-2 text-left">Marca / nombre comercial</th>
                                        <th className="px-2 py-2 text-right">Stock cajas</th>
                                        <th className="px-2 py-2 text-right">Stock unidades</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(historicoLineas[it.id] ?? []).map((linea) => (
                                        <tr key={`${it.id}-${linea.cn}`} className="border-t border-slate-100">
                                          <td className="px-2 py-1">
                                            <span className="inline-block rounded bg-slate-100 px-1.5 py-px font-mono text-[11px] text-slate-500 tracking-wide">{linea.cn}</span>
                                          </td>
                                          <td className="px-2 py-1 text-xs font-semibold text-slate-800">{linea.principioActivo ?? '—'}</td>
                                          <td className="px-2 py-1 text-[11px] italic text-slate-400 font-sans">{linea.nombre}</td>
                                          <td className="px-2 py-1 text-right">{formatStockCajas(linea.stockCajas)}</td>
                                          <td className="px-2 py-1 text-right">{formatStockUnidades(linea.stockUnidades)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ══ Pedidos de Reposición (solo área Pac. Externos) ══ */}
      {reposicion !== null && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Pedidos de Reposición</h2>
              <p className="text-xs text-slate-500">Solo disponible para el área de Pacientes Externos</p>
            </div>
            <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">Pac. Externos</span>
          </div>

          {/* Borrador activo */}
          {reposicion.borrador && (
            <div className="rounded-xl border-2 border-orange-300 bg-orange-50 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-bold text-orange-700">🛒 Pedido en borrador #{reposicion.borrador.id}</p>
                <p className="text-xs text-orange-600">
                  Creado: {new Date(reposicion.borrador.fechaCreacion).toLocaleDateString('es-ES')} · {reposicion.borrador.totalLineas} líneas
                </p>
              </div>
              <a href={`/api/reposicion/${reposicion.borrador.id}/pdf`} target="_blank" rel="noopener noreferrer"
                className="rounded-lg border border-orange-300 bg-white px-3 py-1.5 text-xs font-semibold text-orange-700 hover:bg-orange-100">
                ⬇ Descargar PDF
              </a>
              <Link
                href="/recuento-manual?area=upe&modo=reposicion"
                className="rounded-lg border border-teal-300 bg-white px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50"
              >
                ✎ Editar pedido
              </Link>
              <button
                onClick={() => enviarPedidoReposicionEmail(reposicion.borrador!.id)}
                disabled={sendingEmailId === reposicion.borrador.id}
                className="rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
              >
                {sendingEmailId === reposicion.borrador.id ? 'Enviando…' : '✉ Enviar email'}
              </button>
            </div>
          )}

          {/* Historial */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Nº</th>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-center">Estado</th>
                  <th className="px-3 py-2 text-right">Líneas</th>
                  <th className="px-3 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {reposicion.historial.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-slate-400 text-center">
                      No hay pedidos de reposición aún. Usa la APP de Recuento → Pedido a Farmacia.
                    </td>
                  </tr>
                ) : (
                  reposicion.historial.map((rep) => (
                    <tr key={rep.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono text-slate-600">#{rep.id}</td>
                      <td className="px-3 py-2 text-slate-700">
                        {new Date(rep.fechaCreacion).toLocaleDateString('es-ES')}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          rep.estado === 'finalizado'
                            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                            : 'bg-orange-50 text-orange-700 ring-1 ring-orange-200'
                        }`}>
                          {rep.estado === 'finalizado' ? 'Finalizado' : 'Borrador'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700">{rep.totalLineas}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-2">
                          <a href={`/api/reposicion/${rep.id}/pdf`} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                            ⬇ PDF
                          </a>
                          {rep.estado === 'borrador' && (
                            <Link
                              href="/recuento-manual?area=upe&modo=reposicion"
                              className="inline-flex items-center gap-1 rounded-lg border border-teal-300 px-2 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-50"
                            >
                              ✎ Editar pedido
                            </Link>
                          )}
                          <button
                            onClick={() => enviarPedidoReposicionEmail(rep.id)}
                            disabled={sendingEmailId === rep.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                          >
                            {sendingEmailId === rep.id ? 'Enviando…' : '✉ Enviar email'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
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
