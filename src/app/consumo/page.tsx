'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

type DesgloseItem = {
  diagnostico: string;
  indicacion: string;
  protocolo: string;
  viales: number;
};

type ResumenMedicamento = {
  cn: string;
  componente: string;
  tipoComponente: string;
  medicamento: string;
  totalViales: number;
  desglose: DesgloseItem[];
};

type ResumenData = {
  medicamentos: ResumenMedicamento[];
  periodoInicio: string | null;
  periodoFin: string | null;
};

function fmt(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtNum(n: number) {
  return n.toLocaleString('es-ES', { maximumFractionDigits: 1 });
}

function groupDesgloseByDiagnostico(items: DesgloseItem[]) {
  const groups = new Map<string, DesgloseItem[]>();
  for (const item of items) {
    const key = item.diagnostico || '—';
    const prev = groups.get(key) ?? [];
    prev.push(item);
    groups.set(key, prev);
  }
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], 'es'));
}

export default function ConsumoPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [loadingRes, setLoadingRes] = useState(true);
  const [resumen, setResumen] = useState<ResumenData | null>(null);
  const [search, setSearch] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('todos');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [soloOncologiaMsg, setSoloOncologiaMsg] = useState<string | null>(null);

  const loadResumen = async (desde?: string, hasta?: string) => {
    setLoadingRes(true);
    try {
      const params = new URLSearchParams();
      if (desde) params.set('fechaDesde', desde);
      if (hasta) params.set('fechaHasta', hasta);
      const res = await fetch(`/api/consumo/resumen${params.toString() ? `?${params.toString()}` : ''}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setSoloOncologiaMsg(data?.error ?? 'Esta pestaña está disponible solo para Oncología.');
          setResumen(null);
          return;
        }
        throw new Error(data?.error ?? 'Error al cargar consumo.');
      }
      setSoloOncologiaMsg(null);
      setResumen(data);
      if (!fechaDesde && data.periodoInicio) setFechaDesde(data.periodoInicio);
      if (!fechaHasta && data.periodoFin) setFechaHasta(data.periodoFin);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado.');
    } finally {
      setLoadingRes(false);
    }
  };

  useEffect(() => { void loadResumen(); }, []);
  useEffect(() => {
    if (!fechaDesde && !fechaHasta) return;
    void loadResumen(fechaDesde, fechaHasta);
  }, [fechaDesde, fechaHasta]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/consumo/importar', { method: 'POST', body: form });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'Error al importar.');
      toast.success(`Importado: ${payload.totalLineas} filas · ${fmt(payload.periodoInicio)} – ${fmt(payload.periodoFin)}`);
      if (payload.advertencias?.length) toast.warning(`${payload.advertencias.length} advertencia(s) en la importación.`);
      setFechaDesde(payload.periodoInicio);
      setFechaHasta(payload.periodoFin);
      await loadResumen(payload.periodoInicio, payload.periodoFin);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const tipos = useMemo(
    () => Array.from(new Set((resumen?.medicamentos ?? []).map(m => (m.tipoComponente || '—').trim()))).sort(),
    [resumen]
  );

  const medicamentosFiltrados = useMemo(() => {
    return (resumen?.medicamentos ?? []).filter((m) => {
      const txt = search.trim().toLowerCase();
      const okText = !txt
        || m.componente.toLowerCase().includes(txt)
        || m.medicamento.toLowerCase().includes(txt)
        || m.cn.includes(txt)
        || m.tipoComponente.toLowerCase().includes(txt);
      const okTipo = tipoFiltro === 'todos' || (m.tipoComponente || '—') === tipoFiltro;
      return okText && okTipo;
    });
  }, [resumen, search, tipoFiltro]);

  const totalViales = medicamentosFiltrados.reduce((s, m) => s + m.totalViales, 0);

  if (soloOncologiaMsg) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Consumo</h1>
          <p className="text-sm text-slate-500">Vista específica por área.</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-sm text-amber-800 font-medium">{soloOncologiaMsg}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Consumo</h1>
          <p className="text-sm text-slate-500">
            Esta vista aplica a Oncología y trabaja con histórico acumulado del área.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50 transition-colors"
          >
            {uploading ? 'Importando…' : 'Importar Excel'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-slate-400 font-medium mb-1">Fecha desde</label>
          <input
            type="date"
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-slate-400 font-medium mb-1">Fecha hasta</label>
          <input
            type="date"
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
          />
        </div>
        <button
          onClick={() => {
            setFechaDesde(resumen?.periodoInicio ?? '');
            setFechaHasta(resumen?.periodoFin ?? '');
          }}
          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Restaurar período total
        </button>
      </div>

      {!loadingRes && resumen && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Kpi label="Medicamentos" value={String(medicamentosFiltrados.length)} />
          <Kpi label="Total viales" value={fmtNum(totalViales)} />
          <Kpi label="Período" value={`${fmt(resumen.periodoInicio)} – ${fmt(resumen.periodoFin)}`} />
        </div>
      )}

      {loadingRes && <p className="text-sm text-slate-400">Cargando datos…</p>}

      {!loadingRes && resumen && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="text"
              placeholder="Buscar por principio activo, marca, tipo o CN…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 min-w-[240px] rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
            <select
              value={tipoFiltro}
              onChange={e => setTipoFiltro(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
            >
              <option value="todos">Todos los tipos</option>
              {tipos.map(tipo => <option key={tipo} value={tipo}>{tipo}</option>)}
            </select>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 text-left">Principio activo / marca</th>
                  <th className="px-4 py-3 text-right">Viales</th>
                  <th className="px-4 py-3 text-center">Desglose</th>
                </tr>
              </thead>
              <tbody>
                {medicamentosFiltrados.map((med, idx) => (
                  <Fragment key={med.cn}>
                    <tr className={`border-t border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                      <td className="px-4 py-3">
                        <span className="inline-block rounded bg-slate-100 px-1.5 py-px font-mono text-[11px] text-slate-500 tracking-wide mb-0.5">{med.cn}</span>
                        <p className="font-semibold text-slate-800 leading-snug">{med.componente || '—'}</p>
                        <p className="text-[11px] italic text-slate-400 font-sans">{med.medicamento || '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800">{fmtNum(med.totalViales)}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setExpanded(p => ({ ...p, [med.cn]: !p[med.cn] }))}
                          className="rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                        >
                          {expanded[med.cn] ? 'Ocultar' : 'Ver desglose'}
                        </button>
                      </td>
                    </tr>

                    {expanded[med.cn] && (
                      <tr className="border-t border-slate-100 bg-teal-50/30">
                        <td colSpan={3} className="px-6 py-3">
                          <div className="space-y-3">
                            {groupDesgloseByDiagnostico(med.desglose).map(([diagnostico, items]) => (
                              <div key={diagnostico} className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
                                  <p className="text-xs font-semibold text-slate-700">{diagnostico}</p>
                                </div>
                                <table className="min-w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                                      <th className="px-3 py-2 text-left">Indicación</th>
                                      <th className="px-3 py-2 text-left">Protocolo</th>
                                      <th className="px-3 py-2 text-right">Viales</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {items.map((d, i) => (
                                      <tr key={`${diagnostico}-${d.indicacion}-${d.protocolo}-${i}`} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                                        <td className="px-3 py-1.5 text-slate-600">{d.indicacion}</td>
                                        <td className="px-3 py-1.5 text-slate-600">{d.protocolo}</td>
                                        <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-slate-800">{fmtNum(d.viales)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-400 font-medium">{label}</p>
      <p className="mt-1 text-xl font-bold leading-tight tabular-nums text-slate-800">{value}</p>
    </div>
  );
}
