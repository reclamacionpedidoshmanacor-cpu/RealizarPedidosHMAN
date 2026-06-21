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

type DiagnosticoGrupo =
  | 'mama'
  | 'pulmon'
  | 'digestivo'
  | 'ginecologico'
  | 'urologico'
  | 'piel'
  | 'cabeza-cuello'
  | 'snc'
  | 'hematologia'
  | 'otros';

const DIAGNOSTICO_GROUP_ORDER: DiagnosticoGrupo[] = [
  'mama',
  'pulmon',
  'digestivo',
  'ginecologico',
  'urologico',
  'piel',
  'cabeza-cuello',
  'snc',
  'hematologia',
  'otros',
];

function fmt(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtNum(n: number) {
  return n.toLocaleString('es-ES', { maximumFractionDigits: 1 });
}

function normalizeDx(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function classifyDiagnostico(text: string): DiagnosticoGrupo {
  const dx = normalizeDx(text);
  if (!dx || dx === '—') return 'otros';

  const has = (keywords: string[]) => keywords.some((k) => dx.includes(k));

  if (has(['mama', 'mamario', 'breast'])) return 'mama';
  if (has(['colon', 'recto', 'colorrectal', 'gastric', 'gastrico', 'estomago', 'pancreas', 'hepato', 'higado', 'esofag', 'biliar', 'colangio'])) return 'digestivo';
  if (has(['pulmon', 'pulmonar', 'bronco', 'nsclc', 'sclc', 'microcitico', 'adenocarcinoma'])) return 'pulmon';
  if (has(['ovario', 'endometrio', 'utero', 'cervix', 'cervical', 'vulva'])) return 'ginecologico';
  if (has(['prostata', 'vejiga', 'renal', 'rinon', 'urotelial', 'testiculo'])) return 'urologico';
  if (has(['melanoma', 'piel', 'cutaneo'])) return 'piel';
  if (has(['cabeza', 'cuello', 'orofaring', 'laringe', 'hipofaring', 'nasofaring'])) return 'cabeza-cuello';
  if (has(['glioblastoma', 'glioma', 'snc', 'cerebral', 'meningioma'])) return 'snc';
  if (has(['linfoma', 'hodgkin', 'leucemia', 'mieloma', 'mielofibrosis', 'pti', 'anemia'])) return 'hematologia';
  return 'otros';
}

function getGrupoColorClasses(grupo: DiagnosticoGrupo): { bg: string; text: string; ring: string; label: string } {
  switch (grupo) {
    case 'mama':
      return { bg: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-200', label: 'Mama' };
    case 'pulmon':
      return { bg: 'bg-sky-50', text: 'text-sky-700', ring: 'ring-sky-200', label: 'Pulmón' };
    case 'digestivo':
      return { bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200', label: 'Digestivo' };
    case 'ginecologico':
      return { bg: 'bg-violet-50', text: 'text-violet-700', ring: 'ring-violet-200', label: 'Ginecológico' };
    case 'urologico':
      return { bg: 'bg-cyan-50', text: 'text-cyan-700', ring: 'ring-cyan-200', label: 'Urológico' };
    case 'piel':
      return { bg: 'bg-orange-50', text: 'text-orange-700', ring: 'ring-orange-200', label: 'Piel' };
    case 'cabeza-cuello':
      return { bg: 'bg-teal-50', text: 'text-teal-700', ring: 'ring-teal-200', label: 'Cabeza y cuello' };
    case 'snc':
      return { bg: 'bg-indigo-50', text: 'text-indigo-700', ring: 'ring-indigo-200', label: 'SNC' };
    case 'hematologia':
      return { bg: 'bg-fuchsia-50', text: 'text-fuchsia-700', ring: 'ring-fuchsia-200', label: 'Hematología' };
    default:
      return { bg: 'bg-slate-50', text: 'text-slate-700', ring: 'ring-slate-200', label: 'Otros' };
  }
}

function toIsoDateUTC(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoWeekStartDate(isoYear: number, week: number): Date {
  const base = new Date(Date.UTC(isoYear, 0, 1 + (week - 1) * 7));
  const day = base.getUTCDay(); // 0 dom ... 6 sab
  const diff = day <= 4 ? 1 - day : 8 - day; // lunes ISO
  base.setUTCDate(base.getUTCDate() + diff);
  return base;
}

function normalizeToIsoMonday(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateIso;
  const dow = d.getUTCDay() || 7; // lunes=1 ... domingo=7
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return toIsoDateUTC(d);
}

function getIsoWeekAndYearToday() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { isoYear, week };
}

function groupDesgloseByDiagnostico(items: DesgloseItem[]) {
  const groups = new Map<string, DesgloseItem[]>();
  for (const item of items) {
    const key = item.diagnostico || '—';
    const prev = groups.get(key) ?? [];
    prev.push(item);
    groups.set(key, prev);
  }
  const rank = (dx: string) => {
    const g = classifyDiagnostico(dx);
    const idx = DIAGNOSTICO_GROUP_ORDER.indexOf(g);
    return idx === -1 ? 999 : idx;
  };
  return Array.from(groups.entries()).sort((a, b) => {
    const byGroup = rank(a[0]) - rank(b[0]);
    if (byGroup !== 0) return byGroup;
    return a[0].localeCompare(b[0], 'es');
  });
}

type DiagnosticoRow = {
  diagnostico: string;
  indicacion: string;
  protocolo: string;
  viales: number;
  showDiagnostico: boolean;
  diagnosticoRowSpan: number;
};

function buildDiagnosticoRows(items: DesgloseItem[]): DiagnosticoRow[] {
  const rows: DiagnosticoRow[] = [];
  for (const [diagnostico, group] of groupDesgloseByDiagnostico(items)) {
    const sorted = [...group].sort((a, b) => {
      const byIndicacion = (a.indicacion || '—').localeCompare((b.indicacion || '—'), 'es');
      if (byIndicacion !== 0) return byIndicacion;
      return (a.protocolo || '—').localeCompare((b.protocolo || '—'), 'es');
    });
    sorted.forEach((row, idx) => {
      rows.push({
        diagnostico,
        indicacion: row.indicacion || '—',
        protocolo: row.protocolo || '—',
        viales: row.viales,
        showDiagnostico: idx === 0,
        diagnosticoRowSpan: idx === 0 ? sorted.length : 0,
      });
    });
  }
  return rows;
}

const MESES_LABEL = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export default function ConsumoPage() {
  const initialWeek = getIsoWeekAndYearToday();
  const initialMonday = toIsoDateUTC(isoWeekStartDate(initialWeek.isoYear, initialWeek.week));
  const fileRef = useRef<HTMLInputElement>(null);
  const historicoFileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingHistorico, setUploadingHistorico] = useState(false);
  const [loadingRes, setLoadingRes] = useState(true);
  const [resumen, setResumen] = useState<ResumenData | null>(null);
  const [search, setSearch] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('todos');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [anioHistorico, setAnioHistorico] = useState(2025);
  const [mesHistorico, setMesHistorico] = useState(1);
  const [usarPeriodoManual, setUsarPeriodoManual] = useState(false);
  const [anioManual, setAnioManual] = useState(initialWeek.isoYear);
  const [semanaManual, setSemanaManual] = useState(initialWeek.week);
  const [lunesReferencia, setLunesReferencia] = useState(initialMonday);
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

  const handleUploadHistorico = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingHistorico(true);
    try {
      const form = new FormData();
      form.append('file', file);
      if (usarPeriodoManual) {
        form.append('anioManual', String(anioHistorico));
        form.append('mesManual', String(mesHistorico));
      }
      const res = await fetch('/api/consumo/importar-historico', { method: 'POST', body: form });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'Error al importar histórico.');
      const resumenMeses = payload.mesesLabel
        ?? (payload.meses?.length
          ? payload.meses.map((m: { mes: number; anio: number }) => `${MESES_LABEL[m.mes - 1]} ${m.anio}`).join(', ')
          : `${MESES_LABEL[mesHistorico - 1]} ${anioHistorico}`);
      toast.success(`Histórico importado: ${payload.totalLineas} filas · ${resumenMeses}`);
      if (payload.advertencias?.length) toast.warning(`${payload.advertencias.length} advertencia(s) en la importación.`);
      setFechaDesde(payload.periodoInicio);
      setFechaHasta(payload.periodoFin);
      await loadResumen(payload.periodoInicio, payload.periodoFin);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado.');
    } finally {
      setUploadingHistorico(false);
      if (historicoFileRef.current) historicoFileRef.current.value = '';
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('anioManual', String(anioManual));
      form.append('semanaManual', String(semanaManual));
      const res = await fetch('/api/consumo/importar', { method: 'POST', body: form });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'Error al importar.');
      toast.success(`Semana importada: ${payload.totalLineas} filas · Semana ${semanaManual}/${anioManual}`);
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
          <p className="text-sm text-slate-500 max-w-2xl">
            Histórico mensual (sin semana ISO) hasta abril 2026. Desde mayo 2026, importación por semana.
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 mb-2">Importar histórico (mensual)</p>
          <p className="text-xs text-amber-900/80 mb-3">
            El Excel debe incluir columnas AÑO y MES (puede traer varios meses en un mismo archivo). No se registra semana ISO.
          </p>
          <div className="flex items-end gap-2 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-amber-900/90 pb-2 mr-1 cursor-pointer">
              <input
                type="checkbox"
                checked={usarPeriodoManual}
                onChange={(e) => setUsarPeriodoManual(e.target.checked)}
                className="rounded border-amber-300"
              />
              Un solo mes sin columnas AÑO/MES
            </label>
            {usarPeriodoManual && (
              <>
                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-amber-700/80 font-medium mb-1">Año</label>
                  <input
                    type="number"
                    min={2000}
                    max={2100}
                    value={anioHistorico}
                    onChange={(e) => setAnioHistorico(Math.max(2000, Math.min(2100, Number(e.target.value) || 2025)))}
                    className="w-24 rounded-lg border border-amber-200 bg-white px-2 py-2 text-sm text-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-amber-700/80 font-medium mb-1">Mes</label>
                  <select
                    value={mesHistorico}
                    onChange={(e) => setMesHistorico(Number(e.target.value))}
                    className="w-28 rounded-lg border border-amber-200 bg-white px-2 py-2 text-sm text-slate-700"
                  >
                    {MESES_LABEL.map((label, idx) => (
                      <option key={label} value={idx + 1}>{label}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
            <input ref={historicoFileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUploadHistorico} />
            <button
              onClick={() => historicoFileRef.current?.click()}
              disabled={uploadingHistorico || uploading}
              className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50 transition-colors"
            >
              {uploadingHistorico ? 'Importando…' : 'Importar histórico'}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-teal-200 bg-teal-50/40 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-800 mb-2">Importar semana (desde mayo 2026)</p>
          <p className="text-xs text-teal-900/80 mb-3">Ancla la carga por año ISO + semana + lunes de referencia.</p>
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-teal-700/80 font-medium mb-1">Lunes ref.</label>
              <input
                type="date"
                value={lunesReferencia}
                onChange={(e) => {
                  const normalized = normalizeToIsoMonday(e.target.value);
                  if (normalized !== e.target.value) {
                    toast.info('La fecha se ajustó al lunes de esa semana.');
                  }
                  const iso = getIsoWeekAndYearToday();
                  const d = new Date(`${normalized}T00:00:00Z`);
                  const dow = d.getUTCDay() || 7;
                  d.setUTCDate(d.getUTCDate() + 4 - dow);
                  const isoYear = d.getUTCFullYear();
                  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
                  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
                  setLunesReferencia(normalized);
                  setAnioManual(Number.isFinite(isoYear) ? isoYear : iso.isoYear);
                  setSemanaManual(Number.isFinite(week) ? week : iso.week);
                }}
                className="w-40 rounded-lg border border-teal-200 bg-white px-2 py-2 text-sm text-slate-700"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-teal-700/80 font-medium mb-1">Año</label>
              <input
                type="number"
                min={2000}
                max={2100}
                value={anioManual}
                onChange={(e) => {
                  const nextYear = Math.max(2000, Math.min(2100, Number(e.target.value) || initialWeek.isoYear));
                  setAnioManual(nextYear);
                  setLunesReferencia(toIsoDateUTC(isoWeekStartDate(nextYear, semanaManual)));
                }}
                className="w-24 rounded-lg border border-teal-200 bg-white px-2 py-2 text-sm text-slate-700"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-teal-700/80 font-medium mb-1">Semana</label>
              <input
                type="number"
                min={1}
                max={53}
                value={semanaManual}
                onChange={(e) => {
                  const nextWeek = Math.max(1, Math.min(53, Number(e.target.value) || initialWeek.week));
                  setSemanaManual(nextWeek);
                  setLunesReferencia(toIsoDateUTC(isoWeekStartDate(anioManual, nextWeek)));
                }}
                className="w-20 rounded-lg border border-teal-200 bg-white px-2 py-2 text-sm text-slate-700"
              />
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading || uploadingHistorico}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50 transition-colors"
            >
              {uploading ? 'Importando…' : 'Importar semana'}
            </button>
          </div>
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
                  <th className="px-4 py-3 text-right">Diagnósticos</th>
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
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800">
                        {groupDesgloseByDiagnostico(med.desglose).length}
                      </td>
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
                          <div className="mb-2 flex flex-wrap gap-1.5">
                            {[
                              'mama', 'pulmon', 'digestivo', 'ginecologico', 'urologico',
                              'piel', 'cabeza-cuello', 'snc', 'hematologia', 'otros',
                            ].map((g) => {
                              const c = getGrupoColorClasses(g as DiagnosticoGrupo);
                              return (
                                <span
                                  key={g}
                                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${c.bg} ${c.text} ${c.ring}`}
                                >
                                  {c.label}
                                </span>
                              );
                            })}
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                            <table className="min-w-full table-fixed text-xs">
                              <colgroup>
                                <col className="w-[26%]" />
                                <col className="w-[26%]" />
                                <col className="w-[34%]" />
                                <col className="w-[14%]" />
                              </colgroup>
                              <thead>
                                <tr className="border-b border-slate-100 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                                  <th className="px-3 py-2 text-left">Diagnóstico</th>
                                  <th className="px-3 py-2 text-left">Indicación</th>
                                  <th className="px-3 py-2 text-left">Protocolo</th>
                                  <th className="px-3 py-2 text-right">Viales</th>
                                </tr>
                              </thead>
                              <tbody>
                                {buildDiagnosticoRows(med.desglose).map((d, i) => (
                                  <tr key={`${med.cn}-${d.diagnostico}-${d.indicacion}-${d.protocolo}-${i}`} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                                    {d.showDiagnostico && (
                                      <td rowSpan={d.diagnosticoRowSpan} className="px-3 py-1.5 align-top">
                                        {(() => {
                                          const grupo = classifyDiagnostico(d.diagnostico);
                                          const color = getGrupoColorClasses(grupo);
                                          return (
                                            <div className={`rounded-md px-2 py-1 ring-1 ${color.bg} ${color.text} ${color.ring}`}>
                                              <p className="font-medium leading-tight">{d.diagnostico}</p>
                                              <p className="text-[10px] opacity-80 mt-0.5">{color.label}</p>
                                            </div>
                                          );
                                        })()}
                                      </td>
                                    )}
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
