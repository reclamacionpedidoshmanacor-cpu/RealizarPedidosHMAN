'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AREA_IDS, type AreaId } from '@/lib/areas';

/* ─── tipos recuento manual ─── */
type RecuentoPendiente = { id: number; origen: string; fechaRecuento: string; totalLineas: number } | null;

type MedicamentoManual = {
  cn: string;
  principioActivo: string | null;
  nombre: string;
  activo: boolean;
  unidadesPorCaja: number;
  cajas: number;
  unidadesSueltas: number;
  stockMaximo: number | null;
};

type ApiResponse = {
  area: AreaId;
  pendiente: RecuentoPendiente;
  ubicaciones: string[];
  ubicacionSeleccionada: string | null;
  medicamentos: MedicamentoManual[];
};

/* ─── tipos reposición (solo UPE) ─── */
type ReposicionBorrador = { id: number; totalLineas: number; fechaCreacion: string } | null;
type ReposicionDraftLinea = { cantidadCajas: number };
type ReposicionDetalleLinea = { ubicacion: string; cn: string; cantidadCajas: number };
type ReposicionDetalleResponse = {
  cabecera: { id: number; totalLineas: number; fechaCreacion: string };
  lineas: ReposicionDetalleLinea[];
};

type Step = 'area' | 'ubicacion' | 'recuento' | 'reposicion-ubicacion' | 'reposicion-recuento';

type DraftLinea = { cajas: number; unidadesSueltas: number };

/* ─── configuración de áreas ─── */
const AREAS: { id: AreaId; label: string; emoji: string; color: string; bg: string; border: string }[] = [
  { id: 'oncologia', label: 'Oncología',       emoji: '🏥', color: 'text-violet-700', bg: 'bg-violet-50',  border: 'border-violet-300' },
  { id: 'upe',       label: 'Pac. Externos',    emoji: '🚶', color: 'text-sky-700',    bg: 'bg-sky-50',     border: 'border-sky-300'    },
  { id: 'iv',        label: 'Medicamentos IV',  emoji: '💉', color: 'text-teal-700',   bg: 'bg-teal-50',    border: 'border-teal-300'   },
  { id: 'nutricion', label: 'Nutrición',        emoji: '🥗', color: 'text-lime-700',   bg: 'bg-lime-50',    border: 'border-lime-300'   },
  { id: 'almacen',   label: 'Almacén',          emoji: '📦', color: 'text-amber-700',  bg: 'bg-amber-50',   border: 'border-amber-300'  },
];

/* ─── helpers ─── */
function toIntInput(v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}
function formatDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('es-ES');
}

/* ══════════════════════════════════════════════════════════ */
export default function RecuentoManualPage() {
  /* ── estado común ── */
  const [step, setStep] = useState<Step>('area');
  const [area, setArea] = useState<AreaId | null>(null);
  const [ubicacion, setUbicacion] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  /* ── estado recuento manual ── */
  const [draft, setDraft] = useState<Record<string, DraftLinea>>({});
  const [baseline, setBaseline] = useState<Record<string, DraftLinea>>({});

  /* ── estado reposición (solo UPE) ── */
  const [repoBorrador, setRepoBorrador] = useState<ReposicionBorrador>(null);
  const [repoUbicacionesUsadas, setRepoUbicacionesUsadas] = useState<string[]>([]);
  const [repoDraft, setRepoDraft] = useState<Record<string, ReposicionDraftLinea>>({});
  const [repoBaselineDraft, setRepoBaselineDraft] = useState<Record<string, ReposicionDraftLinea>>({});
  const [repoLineasByUbicacion, setRepoLineasByUbicacion] = useState<Record<string, Record<string, number>>>({});
  const [finalizando, setFinalizando] = useState(false);
  const deepLinkHandledRef = useRef(false);

  const tableRef = useRef<HTMLDivElement>(null);
  const areaConfig = AREAS.find((a) => a.id === area) ?? AREAS[0];

  /* ════════ RECUENTO MANUAL ════════ */

  const cargarUbicacion = async (ub: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/recuento-manual?ubicacion=${encodeURIComponent(ub)}`, { cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'Error al cargar medicamentos.');
      const typed = payload as ApiResponse;
      setData(typed);

      const esManual = typed.pendiente?.origen === 'manual';
      const nextDraft: Record<string, DraftLinea> = {};
      const nextBaseline: Record<string, DraftLinea> = {};
      for (const med of typed.medicamentos) {
        const vals = esManual
          ? { cajas: med.cajas, unidadesSueltas: med.unidadesSueltas }
          : { cajas: 0, unidadesSueltas: 0 };
        nextDraft[med.cn] = { ...vals };
        nextBaseline[med.cn] = { ...vals };
      }
      setDraft(nextDraft);
      setBaseline(nextBaseline);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  const seleccionarArea = async (id: AreaId) => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/area', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ area: id }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo cambiar el área.');
      const res2 = await fetch('/api/recuento-manual', { cache: 'no-store' });
      const data2 = (await res2.json()) as ApiResponse;
      setArea(id);
      setData(data2);
      setUbicacion(null);
      setDraft({});
      setBaseline({});
      setRepoBorrador(null);
      setRepoUbicacionesUsadas([]);
      setRepoDraft({});
      setRepoBaselineDraft({});
      setRepoLineasByUbicacion({});
      setStep('ubicacion');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  const seleccionarUbicacion = async (ub: string) => {
    setUbicacion(ub);
    await cargarUbicacion(ub);
    setStep('recuento');
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const setLinea = (cn: string, patch: Partial<DraftLinea>) => {
    setDraft((prev) => ({
      ...prev,
      [cn]: { cajas: prev[cn]?.cajas ?? 0, unidadesSueltas: prev[cn]?.unidadesSueltas ?? 0, ...patch },
    }));
  };

  const hasChanges = useMemo(() => {
    if (!data) return false;
    return data.medicamentos.some((med) => {
      const cur = draft[med.cn];
      const base = baseline[med.cn] ?? { cajas: 0, unidadesSueltas: 0 };
      return cur && (cur.cajas !== base.cajas || cur.unidadesSueltas !== base.unidadesSueltas);
    });
  }, [data, draft, baseline]);

  const handleGuardar = async () => {
    if (!data || !ubicacion) return;
    const cambios = data.medicamentos
      .map((med) => {
        const cur = draft[med.cn] ?? { cajas: 0, unidadesSueltas: 0 };
        const base = baseline[med.cn] ?? { cajas: 0, unidadesSueltas: 0 };
        return { cn: med.cn, cajas: cur.cajas, unidadesSueltas: cur.unidadesSueltas,
          changed: cur.cajas !== base.cajas || cur.unidadesSueltas !== base.unidadesSueltas };
      })
      .filter((l) => l.changed)
      .map(({ changed, ...l }) => l);

    if (cambios.length === 0) { toast.info('No hay cambios que guardar.'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/recuento-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ubicacion, lineas: cambios }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo guardar.');
      toast.success(`✅ Recuento guardado (${payload.insertadas + payload.actualizadas} medicamentos)`);
      await cargarUbicacion(ubicacion);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setSaving(false);
    }
  };

  /* ════════ REPOSICIÓN (solo UPE) ════════ */

  const cargarEstadoReposicion = async () => {
    const resRepo = await fetch('/api/reposicion', { cache: 'no-store' });
    const payloadRepo = await resRepo.json();
    if (!resRepo.ok) throw new Error(payloadRepo?.error ?? 'No se pudo cargar reposición.');

    if (!payloadRepo.borrador) {
      setRepoBorrador(null);
      setRepoUbicacionesUsadas([]);
      setRepoLineasByUbicacion({});
      return;
    }

    const borradorId = Number(payloadRepo.borrador.id);
    setRepoBorrador({
      id: borradorId,
      totalLineas: Number(payloadRepo.borrador.totalLineas ?? 0),
      fechaCreacion: String(payloadRepo.borrador.fechaCreacion ?? new Date().toISOString()),
    });

    const resDetalle = await fetch(`/api/reposicion/${borradorId}`, { cache: 'no-store' });
    const detalle = (await resDetalle.json()) as ReposicionDetalleResponse & { error?: string };
    if (!resDetalle.ok) throw new Error(detalle?.error ?? 'No se pudo cargar detalle del borrador.');

    const byUbicacion: Record<string, Record<string, number>> = {};
    for (const linea of detalle.lineas ?? []) {
      const ub = String(linea.ubicacion ?? '').trim();
      if (!ub) continue;
      if (!byUbicacion[ub]) byUbicacion[ub] = {};
      byUbicacion[ub][String(linea.cn)] = Number(linea.cantidadCajas ?? 0);
    }
    setRepoLineasByUbicacion(byUbicacion);
    setRepoUbicacionesUsadas(Object.keys(byUbicacion).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })));
  };

  const iniciarReposicion = async () => {
    setLoading(true);
    try {
      /* Cargamos ubicaciones (reutilizamos el API de recuento-manual) */
      const res = await fetch('/api/recuento-manual', { cache: 'no-store' });
      const payload = (await res.json()) as ApiResponse;
      setData(payload);

      /* Comprobamos si hay borrador activo y cargamos sus líneas */
      await cargarEstadoReposicion();
      setStep('reposicion-ubicacion');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  const seleccionarUbicacionRepo = async (ub: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/recuento-manual?ubicacion=${encodeURIComponent(ub)}`, { cache: 'no-store' });
      const payload = (await res.json()) as ApiResponse;
      setData(payload);
      setUbicacion(ub);

      /* Si la ubicación ya existe en borrador, precargar valores guardados */
      const saved = repoLineasByUbicacion[ub] ?? {};
      const nextDraft: Record<string, ReposicionDraftLinea> = {};
      for (const med of payload.medicamentos) {
        nextDraft[med.cn] = { cantidadCajas: Number(saved[med.cn] ?? 0) };
      }
      setRepoDraft(nextDraft);
      setRepoBaselineDraft({ ...nextDraft });
      setStep('reposicion-recuento');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  const repoHasChanges = useMemo(() => {
    const keys = new Set([...Object.keys(repoDraft), ...Object.keys(repoBaselineDraft)]);
    for (const cn of keys) {
      const cur = repoDraft[cn]?.cantidadCajas ?? 0;
      const base = repoBaselineDraft[cn]?.cantidadCajas ?? 0;
      if (cur !== base) return true;
    }
    return false;
  }, [repoDraft, repoBaselineDraft]);

  const handleGuardarUbicacionRepo = async () => {
    if (!data || !ubicacion) return;
    const lineas = (data.medicamentos ?? [])
      .map((med) => ({ cn: med.cn, cantidadCajas: repoDraft[med.cn]?.cantidadCajas ?? 0 }))
      .filter((l) => l.cantidadCajas > 0);

    if (lineas.length === 0) { toast.info('Introduce al menos una cantidad.'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/reposicion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ubicacion, lineas }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo guardar.');
      await cargarEstadoReposicion();
      toast.success(`✅ Ubicación "${ubicacion}" añadida al pedido`);
      setStep('reposicion-ubicacion');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setSaving(false);
    }
  };

  const handleFinalizarPedido = async () => {
    if (!repoBorrador) return;
    const ok = confirm('¿Finalizar el pedido de reposición? Ya no se podrán añadir más líneas.');
    if (!ok) return;
    setFinalizando(true);
    try {
      const res = await fetch(`/api/reposicion/${repoBorrador.id}/finalizar`, { method: 'POST' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo finalizar el pedido.');
      toast.success('✅ Pedido de reposición finalizado. Puedes descargarlo en la pestaña Stock.');
      setRepoBorrador(null);
      setRepoUbicacionesUsadas([]);
      setRepoLineasByUbicacion({});
      setStep('ubicacion');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setFinalizando(false);
    }
  };

  /* ── Deep-link desde Stock: /recuento-manual?area=upe&modo=reposicion ── */
  useEffect(() => {
    if (deepLinkHandledRef.current) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('modo') !== 'reposicion') return;
    deepLinkHandledRef.current = true;

    const areaParam = params.get('area');
    const targetArea: AreaId =
      areaParam && AREA_IDS.includes(areaParam as AreaId)
        ? (areaParam as AreaId)
        : 'upe';

    const run = async () => {
      await seleccionarArea(targetArea);
      if (targetArea === 'upe') {
        await iniciarReposicion();
      }
    };

    void run();
  }, []);

  /* ══════════════════════════════ RENDER ══════════════════════════════ */

  /* ── PASO 1: Área ── */
  if (step === 'area') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-2xl space-y-8">
          <div className="flex justify-start">
            <Link
              href="/inicio"
              className="rounded-xl border-2 border-slate-300 bg-white px-5 py-3 text-lg font-bold text-slate-600 shadow-sm hover:bg-slate-50 active:scale-95"
            >
              ← Volver a Inicio
            </Link>
          </div>
          <div className="text-center space-y-2">
            <div className="text-6xl">📋</div>
            <h1 className="text-4xl font-extrabold text-slate-800 tracking-tight">Recuento Manual</h1>
            <p className="text-xl text-slate-500">¿En qué área vas a trabajar hoy?</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {AREAS.map((a) => (
              <button key={a.id} onClick={() => void seleccionarArea(a.id)} disabled={loading}
                className={`flex items-center gap-5 rounded-2xl border-2 ${a.border} ${a.bg} px-6 py-6 text-left shadow-sm transition-all active:scale-95 hover:shadow-md hover:brightness-95 disabled:opacity-50`}>
                <span className="text-5xl">{a.emoji}</span>
                <span className={`text-2xl font-bold ${a.color}`}>{a.label}</span>
              </button>
            ))}
          </div>
          {loading && <p className="text-center text-lg text-slate-500 animate-pulse">Cargando…</p>}
        </div>
      </div>
    );
  }

  /* ── PASO 2: Ubicación (y botón Pedido a Farmacia para UPE) ── */
  if (step === 'ubicacion') {
    const ubicaciones = data?.ubicaciones ?? [];
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col p-6 gap-6">
        <div className="flex items-center gap-4">
          <button onClick={() => setStep('area')}
            className="rounded-xl border-2 border-slate-300 bg-white px-5 py-3 text-xl font-bold text-slate-600 shadow-sm hover:bg-slate-50 active:scale-95">
            ← Volver
          </button>
          <div>
            <p className="text-base text-slate-500">Área seleccionada</p>
            <h2 className={`text-3xl font-extrabold ${areaConfig.color}`}>{areaConfig.emoji} {areaConfig.label}</h2>
          </div>
        </div>

        {data?.pendiente ? (
          <div className="rounded-2xl border-2 border-teal-200 bg-teal-50 px-6 py-4">
            <p className="text-lg font-semibold text-teal-700">📂 Recuento en curso: #{data.pendiente.id}</p>
            <p className="text-base text-teal-600">Fecha: {formatDate(data.pendiente.fechaRecuento)} · {data.pendiente.totalLineas} líneas</p>
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 px-6 py-4">
            <p className="text-lg font-semibold text-amber-700">ℹ️ Sin recuento activo — se creará al guardar</p>
          </div>
        )}

        <div className="space-y-3">
          <h3 className="text-2xl font-bold text-slate-700">¿Qué ubicación vas a contar?</h3>
          {loading ? (
            <p className="text-xl text-slate-500 animate-pulse">Cargando ubicaciones…</p>
          ) : ubicaciones.length === 0 ? (
            <p className="text-xl text-amber-700 rounded-2xl border-2 border-amber-200 bg-amber-50 px-6 py-5">
              No hay ubicaciones configuradas para esta área.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {ubicaciones.map((ub) => (
                <button key={ub} onClick={() => void seleccionarUbicacion(ub)}
                  className="rounded-2xl border-2 border-slate-300 bg-white px-6 py-6 text-left text-2xl font-bold text-slate-700 shadow-sm hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700 active:scale-95 transition-all">
                  📍 {ub}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Botón especial solo para UPE */}
        {area === 'upe' && (
          <div className="pt-4 border-t-2 border-slate-200 space-y-3">
            <h3 className="text-xl font-bold text-slate-600">Circuito especial</h3>
            <button onClick={() => void iniciarReposicion()} disabled={loading}
              className="w-full sm:w-auto flex items-center gap-4 rounded-2xl border-2 border-orange-300 bg-orange-50 px-8 py-6 text-left shadow-sm hover:bg-orange-100 active:scale-95 transition-all disabled:opacity-50">
              <span className="text-5xl">🛒</span>
              <div>
                <p className="text-2xl font-bold text-orange-700">Pedido a Farmacia</p>
                <p className="text-base text-orange-600">Solicitar reposición de medicamentos</p>
              </div>
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ── PASO 3: Recuento de medicamentos ── */
  if (step === 'recuento') {
    const medicamentos = data?.medicamentos ?? [];
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col pb-36" ref={tableRef}>
        <div className="sticky top-0 z-20 bg-white border-b-2 border-slate-200 shadow-sm px-4 py-3 flex items-center gap-3 flex-wrap">
          <button onClick={() => setStep('ubicacion')}
            className="rounded-xl border-2 border-slate-300 bg-white px-4 py-2 text-lg font-bold text-slate-600 hover:bg-slate-50 active:scale-95">
            ← Ubicación
          </button>
          <div className="flex-1 min-w-0">
            <p className={`text-lg font-extrabold ${areaConfig.color} truncate`}>{areaConfig.emoji} {areaConfig.label}</p>
            <p className="text-base text-slate-500 truncate">📍 {ubicacion}</p>
          </div>
          {data?.pendiente && (
            <span className="rounded-full bg-teal-100 px-3 py-1 text-sm font-semibold text-teal-700">
              Recuento #{data.pendiente.id} · {data.pendiente.totalLineas} líneas
            </span>
          )}
        </div>

        <div className="flex-1 px-4 pt-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <p className="text-2xl text-slate-500 animate-pulse">Cargando medicamentos…</p>
            </div>
          ) : medicamentos.length === 0 ? (
            <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 px-6 py-10 text-center">
              <p className="text-2xl font-bold text-amber-700">No hay medicamentos en esta ubicación.</p>
            </div>
          ) : (
            <>
              <p className="text-base text-slate-500 font-semibold">
                {medicamentos.length} medicamento{medicamentos.length !== 1 ? 's' : ''}
              </p>
              {medicamentos.map((med, idx) => {
                const val = draft[med.cn] ?? { cajas: 0, unidadesSueltas: 0 };
                const base = baseline[med.cn] ?? { cajas: 0, unidadesSueltas: 0 };
                const changed = val.cajas !== base.cajas || val.unidadesSueltas !== base.unidadesSueltas;
                return (
                  <MedCard key={med.cn} med={med} val={val} changed={changed}
                    index={idx + 1} total={medicamentos.length}
                    onChange={(patch) => setLinea(med.cn, patch)} />
                );
              })}
            </>
          )}
        </div>

        {!loading && medicamentos.length > 0 && (
          <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t-2 border-slate-200 shadow-lg px-4 py-4">
            <div className="max-w-2xl mx-auto flex items-center gap-4">
              <div className="flex-1 text-sm text-slate-500">
                {hasChanges
                  ? <span className="font-semibold text-amber-600">⚠ Hay cambios sin guardar</span>
                  : <span className="text-slate-400">Todo guardado</span>}
              </div>
              <button onClick={() => void handleGuardar()} disabled={saving || !hasChanges}
                className="flex-shrink-0 rounded-2xl bg-teal-600 px-8 py-4 text-xl font-extrabold text-white shadow-lg hover:bg-teal-700 active:scale-95 transition-all disabled:opacity-40">
                {saving ? 'Guardando…' : '💾 Guardar recuento'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── REPOSICIÓN: Selección de ubicación ── */
  if (step === 'reposicion-ubicacion') {
    const ubicaciones = data?.ubicaciones ?? [];
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex flex-col p-6 gap-6">
        <div className="flex items-center gap-4">
          <button onClick={() => setStep('ubicacion')}
            className="rounded-xl border-2 border-slate-300 bg-white px-5 py-3 text-xl font-bold text-slate-600 shadow-sm hover:bg-slate-50 active:scale-95">
            ← Volver
          </button>
          <div>
            <p className="text-base text-orange-500 font-semibold">Pedido a Farmacia — Pac. Externos</p>
            <h2 className="text-3xl font-extrabold text-orange-700">🛒 Solicitar Reposición</h2>
          </div>
        </div>

        {repoBorrador ? (
          <div className="rounded-2xl border-2 border-orange-300 bg-orange-100 px-6 py-4 space-y-2">
            <p className="text-lg font-bold text-orange-800">📦 Pedido en curso #{repoBorrador.id}</p>
            <p className="text-base text-orange-700">{repoBorrador.totalLineas} líneas añadidas</p>
            {repoUbicacionesUsadas.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {repoUbicacionesUsadas.map((ub) => (
                  <span key={ub} className="rounded-full bg-orange-200 px-3 py-1 text-sm font-semibold text-orange-800">✓ {ub}</span>
                ))}
              </div>
            )}
            <button onClick={() => void handleFinalizarPedido()} disabled={finalizando}
              className="mt-2 w-full rounded-2xl bg-orange-600 px-6 py-4 text-xl font-extrabold text-white hover:bg-orange-700 active:scale-95 disabled:opacity-50">
              {finalizando ? 'Finalizando…' : '✅ Finalizar pedido de reposición'}
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 px-6 py-4">
            <p className="text-lg font-semibold text-amber-700">ℹ️ Nuevo pedido — selecciona la primera ubicación</p>
          </div>
        )}

        <div className="space-y-3">
          <h3 className="text-2xl font-bold text-slate-700">¿Qué ubicación quieres reponer?</h3>
          {loading ? (
            <p className="text-xl text-slate-500 animate-pulse">Cargando…</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {ubicaciones.map((ub) => {
                const yaUsada = repoUbicacionesUsadas.includes(ub);
                return (
                  <button key={ub} onClick={() => void seleccionarUbicacionRepo(ub)}
                    className={`rounded-2xl border-2 px-6 py-6 text-left text-2xl font-bold shadow-sm active:scale-95 transition-all
                      ${yaUsada
                        ? 'border-orange-300 bg-orange-100 text-orange-700 hover:bg-orange-200'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-orange-400 hover:bg-orange-50 hover:text-orange-700'}`}>
                    {yaUsada ? '✓' : '📍'} {ub}
                    {yaUsada && <span className="block text-sm font-normal mt-1">Ya añadida — toca para editar</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── REPOSICIÓN: Introducir cantidades ── */
  if (step === 'reposicion-recuento') {
    const medicamentos = data?.medicamentos ?? [];
    const repoHasAnyQty = medicamentos.some((med) => (repoDraft[med.cn]?.cantidadCajas ?? 0) > 0);

    return (
      <div className="min-h-screen bg-orange-50 flex flex-col pb-40">
        <div className="sticky top-0 z-20 bg-white border-b-2 border-orange-200 shadow-sm px-4 py-3 flex items-center gap-3 flex-wrap">
          <button onClick={() => setStep('reposicion-ubicacion')}
            className="rounded-xl border-2 border-slate-300 bg-white px-4 py-2 text-lg font-bold text-slate-600 hover:bg-slate-50 active:scale-95">
            ← Ubicaciones
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-extrabold text-orange-700 truncate">🛒 Pedido a Farmacia</p>
            <p className="text-base text-slate-500 truncate">📍 {ubicacion}</p>
          </div>
        </div>

        <div className="flex-1 px-4 pt-4 space-y-3">
          <p className="text-base text-slate-500 font-semibold">
            {medicamentos.length} medicamento{medicamentos.length !== 1 ? 's' : ''} — indica cuántas cajas necesitas
          </p>
          {loading ? (
            <p className="text-2xl text-slate-500 animate-pulse text-center py-20">Cargando…</p>
          ) : medicamentos.length === 0 ? (
            <p className="text-2xl font-bold text-amber-700 text-center py-10">No hay medicamentos en esta ubicación.</p>
          ) : (
            medicamentos.map((med, idx) => {
              const qty = repoDraft[med.cn]?.cantidadCajas ?? 0;
              const changed = qty > 0;
              return (
                <RepoMedCard key={med.cn} med={med} cantidadCajas={qty} changed={changed}
                  index={idx + 1} total={medicamentos.length}
                  onChange={(v) => setRepoDraft((prev) => ({ ...prev, [med.cn]: { cantidadCajas: v } }))} />
              );
            })
          )}
        </div>

        {!loading && (
          <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t-2 border-orange-200 shadow-lg px-4 py-4">
            <div className="max-w-2xl mx-auto flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="flex-1 text-sm text-slate-500">
                {repoHasChanges
                  ? <span className="font-semibold text-orange-600">⚠ Cambios sin guardar en esta ubicación</span>
                  : <span className="text-slate-400">Sin cambios pendientes</span>}
              </div>
              <button onClick={() => void handleGuardarUbicacionRepo()} disabled={saving || !repoHasChanges || !repoHasAnyQty}
                className="rounded-2xl bg-orange-500 px-8 py-4 text-xl font-extrabold text-white shadow-lg hover:bg-orange-600 active:scale-95 transition-all disabled:opacity-40">
                {saving ? 'Guardando…' : '💾 Guardar ubicación'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}

/* ════════════════ Tarjeta de medicamento — recuento manual ════════════════ */
function MedCard({
  med, val, changed, index, total, onChange,
}: {
  med: MedicamentoManual; val: DraftLinea; changed: boolean;
  index: number; total: number; onChange: (patch: Partial<DraftLinea>) => void;
}) {
  return (
    <div className={`rounded-2xl border-2 bg-white px-5 py-4 shadow-sm transition-all ${changed ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-2 mb-4">
        <div className="flex-1 min-w-0">
          <p className="text-2xl font-extrabold text-slate-800 leading-tight">{med.principioActivo ?? med.nombre}</p>
          {med.principioActivo && <p className="text-lg italic text-slate-400 leading-tight mt-0.5 truncate">{med.nombre}</p>}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="font-mono text-base bg-slate-100 text-slate-500 rounded-lg px-2 py-1">CN {med.cn}</span>
          <span className="text-sm text-slate-400">{index}/{total}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="block text-sm font-bold text-slate-600 uppercase tracking-wider">📦 Cajas</label>
          <input type="number" inputMode="numeric" min={0} step={1}
            value={val.cajas === 0 ? '' : val.cajas} placeholder="0"
            onChange={(e) => onChange({ cajas: toIntInput(e.target.value) })}
            className="w-full rounded-xl border-2 border-slate-300 px-4 py-4 text-3xl font-bold text-center text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200" />
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-bold text-slate-600 uppercase tracking-wider">💊 Unidades sueltas</label>
          <input type="number" inputMode="numeric" min={0} step={1}
            value={val.unidadesSueltas === 0 ? '' : val.unidadesSueltas} placeholder="0"
            onChange={(e) => onChange({ unidadesSueltas: toIntInput(e.target.value) })}
            className="w-full rounded-xl border-2 border-slate-300 px-4 py-4 text-3xl font-bold text-center text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200" />
          <p className="text-sm text-slate-400 text-center">(1 caja = {med.unidadesPorCaja} udes)</p>
        </div>
      </div>
      {changed && <p className="mt-3 text-sm font-semibold text-amber-600">✏ Modificado</p>}
    </div>
  );
}

/* ════════════════ Tarjeta de medicamento — reposición ════════════════ */
function RepoMedCard({
  med, cantidadCajas, changed, index, total, onChange,
}: {
  med: MedicamentoManual; cantidadCajas: number; changed: boolean;
  index: number; total: number; onChange: (v: number) => void;
}) {
  return (
    <div className={`rounded-2xl border-2 bg-white px-5 py-4 shadow-sm transition-all ${changed ? 'border-orange-400 bg-orange-50' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-2 mb-4">
        <div className="flex-1 min-w-0">
          <p className="text-2xl font-extrabold text-slate-800 leading-tight">{med.principioActivo ?? med.nombre}</p>
          {med.principioActivo && <p className="text-lg italic text-slate-400 leading-tight mt-0.5 truncate">{med.nombre}</p>}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="font-mono text-base bg-slate-100 text-slate-500 rounded-lg px-2 py-1">CN {med.cn}</span>
          <span className="text-sm text-slate-400">{index}/{total}</span>
        </div>
      </div>

      {med.stockMaximo != null && (
        <p className="text-base text-slate-500 mb-3">
          Stock máximo de referencia: <strong className="text-slate-700">{med.stockMaximo} cajas</strong>
        </p>
      )}

      <div className="space-y-1">
        <label className="block text-sm font-bold text-orange-600 uppercase tracking-wider">📦 Cajas a pedir</label>
        <input type="number" inputMode="numeric" min={0} step={1}
          value={cantidadCajas === 0 ? '' : cantidadCajas} placeholder="0"
          onChange={(e) => onChange(toIntInput(e.target.value))}
          className="w-full rounded-xl border-2 border-slate-300 px-4 py-4 text-3xl font-bold text-center text-slate-800 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200" />
      </div>
      {changed && <p className="mt-3 text-sm font-semibold text-orange-600">✏ Cantidad añadida</p>}
    </div>
  );
}
