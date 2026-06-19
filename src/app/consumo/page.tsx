'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
type ImportacionConsumo = {
  id: number;
  area: string;
  periodoInicio: string;
  periodoFin: string;
  importadoEn: string;
  ficheroNombre: string | null;
  totalLineas: number;
};

type DesgloseItem = {
  diagnostico: string;
  indicacion: string;
  protocolo: string;
  viales: number;
  pacientes: number;
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
  viales: number;
  pacientes: number;
};

type ResumenData = {
  medicamentos: ResumenMedicamento[];
  temporal: TemporalGlobal[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmt(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtNum(n: number) {
  return n.toLocaleString('es-ES', { maximumFractionDigits: 1 });
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------
export default function ConsumoPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading,  setUploading]  = useState(false);
  const [importaciones, setImportaciones] = useState<ImportacionConsumo[]>([]);
  const [loadingImps,   setLoadingImps]   = useState(true);
  const [selectedId,    setSelectedId]    = useState<number | null>(null);
  const [resumen,       setResumen]       = useState<ResumenData | null>(null);
  const [loadingRes,    setLoadingRes]    = useState(false);
  const [tab,           setTab]           = useState<'medicamentos' | 'temporal'>('medicamentos');
  const [expanded,      setExpanded]      = useState<Record<string, boolean>>({});
  const [search,        setSearch]        = useState('');

  // ── Cargar lista de importaciones ────────────────────────────────────────
  const loadImportaciones = async () => {
    setLoadingImps(true);
    try {
      const res = await fetch('/api/consumo/importaciones', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Error al cargar importaciones.');
      setImportaciones(data.importaciones ?? []);
      if (!selectedId && data.importaciones?.length > 0) {
        setSelectedId(data.importaciones[0].id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado.');
    } finally {
      setLoadingImps(false);
    }
  };

  // ── Cargar resumen de la importación seleccionada ─────────────────────
  const loadResumen = async (id: number) => {
    setLoadingRes(true);
    setResumen(null);
    setExpanded({});
    try {
      const res = await fetch(`/api/consumo/resumen?importacionId=${id}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Error al cargar resumen.');
      setResumen(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado.');
    } finally {
      setLoadingRes(false);
    }
  };

  useEffect(() => { void loadImportaciones(); }, []);

  useEffect(() => {
    if (selectedId) void loadResumen(selectedId);
  }, [selectedId]);

  // ── Subir Excel ───────────────────────────────────────────────────────
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/consumo/importar', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Error al importar.');
      toast.success(`Importado: ${data.totalLineas} filas · ${fmt(data.periodoInicio)} – ${fmt(data.periodoFin)}`);
      if (data.advertencias?.length) {
        toast.warning(`${data.advertencias.length} advertencia(s) en la importación.`);
      }
      await loadImportaciones();
      setSelectedId(data.importacionId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const importSeleccionada = importaciones.find(i => i.id === selectedId);

  // ── Filtro de búsqueda ────────────────────────────────────────────────
  const medicamentosFiltrados = (resumen?.medicamentos ?? []).filter(m =>
    !search ||
    m.componente.toLowerCase().includes(search.toLowerCase()) ||
    m.medicamento.toLowerCase().includes(search.toLowerCase()) ||
    m.cn.includes(search)
  );

  const totalViales    = medicamentosFiltrados.reduce((s, m) => s + m.totalViales, 0);
  const totalPacientes = medicamentosFiltrados.reduce((s, m) => s + m.totalPacientes, 0);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Cabecera ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Consumo</h1>
          <p className="text-sm text-slate-500">
            Importa el Excel de dispensación para analizar el consumo por medicamento, diagnóstico y evolución temporal.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            {uploading ? 'Importando…' : 'Importar Excel'}
          </button>
        </div>
      </div>

      {/* ── Selector de importación ──────────────────────────────────── */}
      {loadingImps ? (
        <p className="text-sm text-slate-400">Cargando importaciones…</p>
      ) : importaciones.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-6 py-10 text-center">
          <p className="text-slate-500 text-sm">Aún no hay datos de consumo importados.</p>
          <p className="text-slate-400 text-xs mt-1">Usa el botón "Importar Excel" para comenzar.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium text-slate-600">Importación:</label>
            <select
              value={selectedId ?? ''}
              onChange={e => setSelectedId(Number(e.target.value))}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400"
            >
              {importaciones.map(i => (
                <option key={i.id} value={i.id}>
                  #{i.id} · {fmt(i.periodoInicio)} – {fmt(i.periodoFin)} · {i.totalLineas} filas
                  {i.ficheroNombre ? ` (${i.ficheroNombre})` : ''}
                </option>
              ))}
            </select>
            {importSeleccionada && (
              <span className="text-xs text-slate-400">
                Importado el {fmt(importSeleccionada.importadoEn)}
              </span>
            )}
          </div>

          {/* ── KPIs ───────────────────────────────────────────────── */}
          {resumen && !loadingRes && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Kpi label="Medicamentos" value={String(resumen.medicamentos.length)} />
              <Kpi label="Total viales" value={fmtNum(resumen.medicamentos.reduce((s, m) => s + m.totalViales, 0))} />
              <Kpi label="Total pacientes*" value={fmtNum(resumen.medicamentos.reduce((s, m) => s + m.totalPacientes, 0))} />
              <Kpi label="Período" value={`${fmt(importSeleccionada?.periodoInicio ?? null)} – ${fmt(importSeleccionada?.periodoFin ?? null)}`} />
            </div>
          )}

          {/* ── Tabs ───────────────────────────────────────────────── */}
          <div className="flex items-center gap-1 border-b border-slate-200">
            {(['medicamentos', 'temporal'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  tab === t
                    ? 'border-teal-600 text-teal-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {t === 'medicamentos' ? 'Por medicamento' : 'Evolución temporal'}
              </button>
            ))}
          </div>

          {loadingRes && <p className="text-sm text-slate-400">Cargando datos…</p>}

          {/* ── Vista: Por medicamento ──────────────────────────────── */}
          {!loadingRes && resumen && tab === 'medicamentos' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <input
                  type="text"
                  placeholder="Buscar por principio activo, nombre o CN…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="flex-1 min-w-[240px] rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
                <p className="text-xs text-slate-400">
                  {medicamentosFiltrados.length} medicamento(s) · {fmtNum(totalViales)} viales · {fmtNum(totalPacientes)} pacientes*
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3 text-left">Medicamento</th>
                      <th className="px-4 py-3 text-right">Viales</th>
                      <th className="px-4 py-3 text-right">Pacientes*</th>
                      <th className="px-4 py-3 text-center">Desglose</th>
                    </tr>
                  </thead>
                  <tbody>
                    {medicamentosFiltrados.map((med, idx) => (
                      <>
                        <tr
                          key={med.cn}
                          className={`border-t border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}
                        >
                          <td className="px-4 py-3">
                            <span className="inline-block rounded bg-slate-100 px-1.5 py-px font-mono text-[11px] text-slate-500 tracking-wide mb-0.5">{med.cn}</span>
                            <p className="font-semibold text-slate-800 leading-snug">{med.componente || '—'}</p>
                            {med.medicamento && (
                              <p className="text-[11px] italic text-slate-400 font-sans">{med.medicamento}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800">{fmtNum(med.totalViales)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-600">{fmtNum(med.totalPacientes)}</td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => setExpanded(p => ({ ...p, [med.cn]: !p[med.cn] }))}
                              className="rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                            >
                              {expanded[med.cn] ? 'Ocultar' : 'Ver desglose'}
                            </button>
                          </td>
                        </tr>

                        {/* ── Desglose expandido ─────────────────────────── */}
                        {expanded[med.cn] && (
                          <tr key={`${med.cn}-desglose`} className="border-t border-slate-100 bg-teal-50/30">
                            <td colSpan={4} className="px-6 py-3">
                              <div className="space-y-2">
                                {/* Temporal del medicamento */}
                                {med.temporal.length > 0 && (
                                  <div>
                                    <p className="text-[11px] uppercase tracking-wide text-slate-400 font-medium mb-1">Evolución temporal</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {med.temporal.map(t => (
                                        <span key={`${t.anio}-${t.mes}`} className="rounded-md bg-white border border-slate-200 px-2 py-1 text-[11px] tabular-nums text-slate-700">
                                          <span className="font-medium text-slate-500">{t.label}</span>{' '}
                                          <span className="font-semibold">{fmtNum(t.viales)}</span> viales
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Desglose diagnóstico/protocolo */}
                                <div>
                                  <p className="text-[11px] uppercase tracking-wide text-slate-400 font-medium mb-1">Por diagnóstico · protocolo</p>
                                  <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                                    <table className="min-w-full text-xs">
                                      <thead>
                                        <tr className="border-b border-slate-100 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                                          <th className="px-3 py-2 text-left">Diagnóstico</th>
                                          <th className="px-3 py-2 text-left">Indicación</th>
                                          <th className="px-3 py-2 text-left">Protocolo</th>
                                          <th className="px-3 py-2 text-right">Viales</th>
                                          <th className="px-3 py-2 text-right">Pacientes*</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {med.desglose.map((d, i) => (
                                          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                                            <td className="px-3 py-1.5 text-slate-700">{d.diagnostico}</td>
                                            <td className="px-3 py-1.5 text-slate-600">{d.indicacion}</td>
                                            <td className="px-3 py-1.5 text-slate-600">{d.protocolo}</td>
                                            <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-slate-800">{fmtNum(d.viales)}</td>
                                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{fmtNum(d.pacientes)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-400">
                * El total de pacientes puede incluir el mismo paciente en varias líneas del período.
              </p>
            </div>
          )}

          {/* ── Vista: Evolución temporal ───────────────────────────── */}
          {!loadingRes && resumen && tab === 'temporal' && (
            <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 text-left">Período</th>
                    <th className="px-4 py-3 text-right">Viales dispensados</th>
                    <th className="px-4 py-3 text-right">Pacientes*</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.temporal.map((t, idx) => (
                    <tr key={`${t.anio}-${t.mes}`} className={`border-t border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                      <td className="px-4 py-3 font-medium text-slate-700">{t.label}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800">{fmtNum(t.viales)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">{fmtNum(t.pacientes)}</td>
                    </tr>
                  ))}
                  {resumen.temporal.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-slate-400 text-sm">Sin datos temporales.</td>
                    </tr>
                  )}
                </tbody>
                {resumen.temporal.length > 1 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50">
                      <td className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Total</td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-800">
                        {fmtNum(resumen.temporal.reduce((s, t) => s + t.viales, 0))}
                      </td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-700">
                        {fmtNum(resumen.temporal.reduce((s, t) => s + t.pacientes, 0))}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </>
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
