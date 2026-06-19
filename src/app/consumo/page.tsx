'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

type DesgloseItem = {
  diagnostico: string;
  indicacion: string;
  protocolo: string;
  viales: number;
};

type TemporalItem = {
  anio: number;
  mes: number;
  label: string;
  viales: number;
  pacientes: number;
};

type ResumenMedicamento = {
  cn: string;
  componente: string;
  tipoComponente: string;
  medicamento: string;
  totalViales: number;
  totalPacientes: number;
  desglose: DesgloseItem[];
  temporal: TemporalItem[];
};

type TemporalGlobal = {
  anio: number;
  mes: number;
  label: string;
  pacientes: number;
  preparaciones: number;
  medicamentosDistintos: number;
};

type ResumenData = {
  medicamentos: ResumenMedicamento[];
  temporal: TemporalGlobal[];
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

export default function ConsumoPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [resumen, setResumen] = useState<ResumenData | null>(null);
  const [loadingRes, setLoadingRes] = useState(true);
  const [tab, setTab] = useState<'medicamentos' | 'temporal'>('medicamentos');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('todos');

  const loadResumen = async (desde?: string, hasta?: string) => {
    setLoadingRes(true);
    try {
      const params = new URLSearchParams();
      if (desde) params.set('fechaDesde', desde);
      if (hasta) params.set('fechaHasta', hasta);
      const qs = params.toString();
      const res = await fetch(`/api/consumo/resumen${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Error al cargar consumo.');
      setResumen(data);
      if (!fechaDesde && data.periodoInicio) setFechaDesde(data.periodoInicio);
      if (!fechaHasta && data.periodoFin) setFechaHasta(data.periodoFin);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado.');
      setResumen({ medicamentos: [], temporal: [], periodoInicio: null, periodoFin: null });
    } finally {
      setLoadingRes(false);
    }
  };

  useEffect(() => { void loadResumen(); }, []);
  useEffect(() => { void loadResumen(fechaDesde, fechaHasta); }, [fechaDesde, fechaHasta]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/consumo/importar', { method: 'POST', body: form });
      const text = await res.text();
      let data: { error?: string; totalLineas: number; periodoInicio: string; periodoFin: string; advertencias?: string[] };
      try { data = JSON.parse(text); }
      catch { throw new Error(`Error del servidor: ${text.slice(0, 300)}`); }
      if (!res.ok) throw new Error(data?.error ?? 'Error al importar.');
      toast.success(`Importado: ${data.totalLineas} filas · ${fmt(data.periodoInicio)} – ${fmt(data.periodoFin)}`);
      if (data.advertencias?.length) toast.warning(`${data.advertencias.length} advertencia(s) en la importación.`);
      setFechaDesde(data.periodoInicio);
      setFechaHasta(data.periodoFin);
      await loadResumen(data.periodoInicio, data.periodoFin);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const tipos = Array.from(new Set((resumen?.medicamentos ?? []).map(m => (m.tipoComponente || '—').trim()))).sort();
  const medicamentosFiltrados = (resumen?.medicamentos ?? []).filter(m => {
    const txt = search.trim().toLowerCase();
    const okText = !txt
      || m.componente.toLowerCase().includes(txt)
      || m.tipoComponente.toLowerCase().includes(txt)
      || m.medicamento.toLowerCase().includes(txt)
      || m.cn.includes(txt);
    const okTipo = tipoFiltro === 'todos' || (m.tipoComponente || '—') === tipoFiltro;
    return okText && okTipo;
  });

  const totalViales = medicamentosFiltrados.reduce((s, m) => s + m.totalViales, 0);
  const totalPacientes = medicamentosFiltrados.reduce((s, m) => s + m.totalPacientes, 0);
  const totalPreparaciones = resumen?.temporal.reduce((s, t) => s + (t.preparaciones ?? 0), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Consumo</h1>
          <p className="text-sm text-slate-500">
            La importación es acumulativa por área. El análisis se calcula sobre todo el histórico cargado.
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
          <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700" />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-slate-400 font-medium mb-1">Fecha hasta</label>
          <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700" />
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="Medicamentos" value={String(medicamentosFiltrados.length)} />
          <Kpi label="Preparaciones" value={fmtNum(totalPreparaciones)} />
          <Kpi label="Pacientes (reportados)" value={fmtNum(totalPacientes)} />
          <Kpi label="Período" value={`${fmt(resumen.periodoInicio)} – ${fmt(resumen.periodoFin)}`} />
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-slate-200">
        {(['medicamentos', 'temporal'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'medicamentos' ? 'Por medicamento' : 'Evolución temporal'}
          </button>
        ))}
      </div>

      {loadingRes && <p className="text-sm text-slate-400">Cargando datos…</p>}

      {!loadingRes && resumen && tab === 'medicamentos' && (
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
            <p className="text-xs text-slate-400">
              {medicamentosFiltrados.length} medicamento(s) · {fmtNum(totalViales)} viales
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 text-left">Medicamento</th>
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
                        <p className="font-semibold text-slate-800 leading-snug">{med.componente || med.medicamento || '—'}</p>
                        <p className="text-[11px] italic text-slate-400 font-sans">{med.medicamento || '—'} · {med.tipoComponente || '—'}</p>
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
                          <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                            <table className="min-w-full text-xs">
                              <thead>
                                <tr className="border-b border-slate-100 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                                  <th className="px-3 py-2 text-left">Diagnóstico</th>
                                  <th className="px-3 py-2 text-left">Indicación</th>
                                  <th className="px-3 py-2 text-left">Protocolo</th>
                                  <th className="px-3 py-2 text-right">Viales</th>
                                </tr>
                              </thead>
                              <tbody>
                                {med.desglose.map((d, i) => (
                                  <tr key={`${d.diagnostico}-${d.indicacion}-${d.protocolo}-${i}`} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                                    <td className="px-3 py-1.5 text-slate-700">{d.diagnostico}</td>
                                    <td className="px-3 py-1.5 text-slate-600">{d.indicacion}</td>
                                    <td className="px-3 py-1.5 text-slate-600">{d.protocolo}</td>
                                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-slate-800">{fmtNum(d.viales)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
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

      {!loadingRes && resumen && tab === 'temporal' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 text-left">Período</th>
                <th className="px-4 py-3 text-right">Pacientes (reportados)</th>
                <th className="px-4 py-3 text-right">Preparaciones</th>
                <th className="px-4 py-3 text-right">Medicamentos distintos</th>
              </tr>
            </thead>
            <tbody>
              {resumen.temporal.map((t, idx) => (
                <tr key={`${t.anio}-${t.mes}`} className={`border-t border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                  <td className="px-4 py-3 font-medium text-slate-700">{t.label}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{fmtNum(t.pacientes)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800">{fmtNum(t.preparaciones ?? 0)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{fmtNum(t.medicamentosDistintos ?? 0)}</td>
                </tr>
              ))}
              {resumen.temporal.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400 text-sm">Sin datos temporales.</td>
                </tr>
              )}
            </tbody>
          </table>
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
