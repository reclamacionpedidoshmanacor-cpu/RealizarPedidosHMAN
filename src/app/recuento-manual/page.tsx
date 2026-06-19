'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AREA_IDS, type AreaId } from '@/lib/areas';

/* ─── tipos ─── */
type RecuentoPendiente = {
  id: number;
  origen: string;
  fechaRecuento: string;
  totalLineas: number;
} | null;

type MedicamentoManual = {
  cn: string;
  principioActivo: string | null;
  nombre: string;
  activo: boolean;
  unidadesPorCaja: number;
  cajas: number;
  unidadesSueltas: number;
};

type ApiResponse = {
  area: AreaId;
  pendiente: RecuentoPendiente;
  ubicaciones: string[];
  ubicacionSeleccionada: string | null;
  medicamentos: MedicamentoManual[];
};

type DraftLinea = { cajas: number; unidadesSueltas: number };
type Step = 'area' | 'ubicacion' | 'recuento';

/* ─── configuración de áreas ─── */
const AREAS: {
  id: AreaId;
  label: string;
  emoji: string;
  color: string;
  bg: string;
  border: string;
}[] = [
  { id: 'oncologia',  label: 'Oncología',        emoji: '🏥', color: 'text-violet-700', bg: 'bg-violet-50',  border: 'border-violet-300' },
  { id: 'upe',        label: 'Pac. Externos',     emoji: '🚶', color: 'text-sky-700',    bg: 'bg-sky-50',     border: 'border-sky-300'    },
  { id: 'iv',         label: 'Medicamentos IV',   emoji: '💉', color: 'text-teal-700',   bg: 'bg-teal-50',    border: 'border-teal-300'   },
  { id: 'nutricion',  label: 'Nutrición',         emoji: '🥗', color: 'text-lime-700',   bg: 'bg-lime-50',    border: 'border-lime-300'   },
  { id: 'almacen',    label: 'Almacén',           emoji: '📦', color: 'text-amber-700',  bg: 'bg-amber-50',   border: 'border-amber-300'  },
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
  const [step, setStep] = useState<Step>('area');
  const [area, setArea] = useState<AreaId | null>(null);
  const [ubicacion, setUbicacion] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, DraftLinea>>({});
  const [baseline, setBaseline] = useState<Record<string, DraftLinea>>({});
  const tableRef = useRef<HTMLDivElement>(null);

  /* ── carga de medicamentos ── */
  const cargarUbicacion = async (ub: string, areaId: AreaId) => {
    setLoading(true);
    try {
      const qs = `?ubicacion=${encodeURIComponent(ub)}`;
      const res = await fetch(`/api/recuento-manual${qs}`, { cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'Error al cargar medicamentos.');
      const typed = payload as ApiResponse;
      setData(typed);

      // Si el recuento pendiente es de origen manual, se recuperan los valores
      // para que el usuario pueda continuar. Si es SAP (o no hay pendiente), todo a cero.
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

  /* ── cambiar área ── */
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
      /* cargamos solo ubicaciones (sin ubicacion param) */
      const res2 = await fetch('/api/recuento-manual', { cache: 'no-store' });
      const data2 = await res2.json() as ApiResponse;
      setArea(id);
      setData(data2);
      setUbicacion(null);
      setDraft({});
      setBaseline({});
      setStep('ubicacion');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  /* ── seleccionar ubicación ── */
  const seleccionarUbicacion = async (ub: string) => {
    if (!area) return;
    setUbicacion(ub);
    await cargarUbicacion(ub, area);
    setStep('recuento');
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  /* ── control del draft ── */
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

  /* ── guardar ── */
  const handleGuardar = async () => {
    if (!data || !ubicacion) return;

    const cambios = data.medicamentos
      .map((med) => {
        const cur = draft[med.cn] ?? { cajas: 0, unidadesSueltas: 0 };
        const base = baseline[med.cn] ?? { cajas: 0, unidadesSueltas: 0 };
        return {
          cn: med.cn,
          cajas: cur.cajas,
          unidadesSueltas: cur.unidadesSueltas,
          changed: cur.cajas !== base.cajas || cur.unidadesSueltas !== base.unidadesSueltas,
        };
      })
      .filter((l) => l.changed)
      .map(({ changed, ...l }) => l);

    if (cambios.length === 0) {
      toast.info('No hay cambios que guardar.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/recuento-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ubicacion, lineas: cambios }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo guardar.');
      toast.success(`✅ Recuento guardado correctamente (${payload.insertadas + payload.actualizadas} medicamentos)`);
      await cargarUbicacion(ubicacion, area!);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setSaving(false);
    }
  };

  /* ═══════════════════════════════════════════ RENDER ═══════════════════════════════════════════ */

  /* ── PASO 1: Selección de área ── */
  if (step === 'area') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-2xl space-y-8">
          {/* Cabecera */}
          <div className="text-center space-y-2">
            <div className="text-6xl">📋</div>
            <h1 className="text-4xl font-extrabold text-slate-800 tracking-tight">
              Recuento Manual
            </h1>
            <p className="text-xl text-slate-500">¿En qué área vas a contar hoy?</p>
          </div>

          {/* Tarjetas de área */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {AREAS.map((a) => (
              <button
                key={a.id}
                onClick={() => void seleccionarArea(a.id)}
                disabled={loading}
                className={`
                  flex items-center gap-5 rounded-2xl border-2 ${a.border} ${a.bg} px-6 py-6
                  text-left shadow-sm transition-all active:scale-95
                  hover:shadow-md hover:brightness-95 disabled:opacity-50
                `}
              >
                <span className="text-5xl">{a.emoji}</span>
                <span className={`text-2xl font-bold ${a.color}`}>{a.label}</span>
              </button>
            ))}
          </div>

          {loading && (
            <p className="text-center text-lg text-slate-500 animate-pulse">Cargando…</p>
          )}
        </div>
      </div>
    );
  }

  /* ── PASO 2: Selección de ubicación ── */
  if (step === 'ubicacion') {
    const areaConfig = AREAS.find((a) => a.id === area)!;
    const ubicaciones = data?.ubicaciones ?? [];

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col p-6 gap-6">
        {/* Cabecera */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => setStep('area')}
            className="rounded-xl border-2 border-slate-300 bg-white px-5 py-3 text-xl font-bold text-slate-600 shadow-sm hover:bg-slate-50 active:scale-95"
          >
            ← Volver
          </button>
          <div>
            <p className="text-base text-slate-500">Área seleccionada</p>
            <h2 className={`text-3xl font-extrabold ${areaConfig.color}`}>
              {areaConfig.emoji} {areaConfig.label}
            </h2>
          </div>
        </div>

        {/* Info recuento pendiente */}
        {data?.pendiente ? (
          <div className="rounded-2xl border-2 border-teal-200 bg-teal-50 px-6 py-4">
            <p className="text-lg font-semibold text-teal-700">
              📂 Recuento en curso: #{data.pendiente.id}
            </p>
            <p className="text-base text-teal-600">
              Fecha: {formatDate(data.pendiente.fechaRecuento)} · {data.pendiente.totalLineas} líneas registradas
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 px-6 py-4">
            <p className="text-lg font-semibold text-amber-700">
              ℹ️ No hay recuento activo — se creará uno nuevo al guardar
            </p>
          </div>
        )}

        {/* Selección de ubicación */}
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
                <button
                  key={ub}
                  onClick={() => void seleccionarUbicacion(ub)}
                  className="rounded-2xl border-2 border-slate-300 bg-white px-6 py-6 text-left text-2xl font-bold text-slate-700 shadow-sm hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700 active:scale-95 transition-all"
                >
                  📍 {ub}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── PASO 3: Recuento (listado de medicamentos) ── */
  const areaConfig = AREAS.find((a) => a.id === area)!;
  const medicamentos = data?.medicamentos ?? [];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-36" ref={tableRef}>

      {/* Cabecera fija */}
      <div className="sticky top-0 z-20 bg-white border-b-2 border-slate-200 shadow-sm px-4 py-3 flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setStep('ubicacion')}
          className="rounded-xl border-2 border-slate-300 bg-white px-4 py-2 text-lg font-bold text-slate-600 hover:bg-slate-50 active:scale-95"
        >
          ← Ubicación
        </button>
        <div className="flex-1 min-w-0">
          <p className={`text-lg font-extrabold ${areaConfig.color} truncate`}>
            {areaConfig.emoji} {areaConfig.label}
          </p>
          <p className="text-base text-slate-500 truncate">📍 {ubicacion}</p>
        </div>
        {data?.pendiente && (
          <span className="rounded-full bg-teal-100 px-3 py-1 text-sm font-semibold text-teal-700">
            Recuento #{data.pendiente.id} · {data.pendiente.totalLineas} líneas
          </span>
        )}
      </div>

      {/* Lista de medicamentos */}
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
              {medicamentos.length} medicamento{medicamentos.length !== 1 ? 's' : ''} — escribe las cantidades y pulsa <strong>Guardar</strong>
            </p>
            {medicamentos.map((med, idx) => {
              const val = draft[med.cn] ?? { cajas: 0, unidadesSueltas: 0 };
              const base = baseline[med.cn] ?? { cajas: 0, unidadesSueltas: 0 };
              const changed = val.cajas !== base.cajas || val.unidadesSueltas !== base.unidadesSueltas;
              return (
                <MedCard
                  key={med.cn}
                  med={med}
                  val={val}
                  changed={changed}
                  index={idx + 1}
                  total={medicamentos.length}
                  onChange={(patch) => setLinea(med.cn, patch)}
                />
              );
            })}
          </>
        )}
      </div>

      {/* Barra inferior fija */}
      {!loading && medicamentos.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t-2 border-slate-200 shadow-lg px-4 py-4">
          <div className="max-w-2xl mx-auto flex items-center gap-4">
            <div className="flex-1 text-sm text-slate-500">
              {hasChanges ? (
                <span className="font-semibold text-amber-600">⚠ Hay cambios sin guardar</span>
              ) : (
                <span className="text-slate-400">Todo guardado</span>
              )}
            </div>
            <button
              onClick={() => void handleGuardar()}
              disabled={saving || !hasChanges}
              className="flex-shrink-0 rounded-2xl bg-teal-600 px-8 py-4 text-xl font-extrabold text-white shadow-lg hover:bg-teal-700 active:scale-95 transition-all disabled:opacity-40"
            >
              {saving ? 'Guardando…' : '💾 Guardar recuento'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ Componente de tarjeta de medicamento ════════════════ */
function MedCard({
  med, val, changed, index, total, onChange,
}: {
  med: MedicamentoManual;
  val: DraftLinea;
  changed: boolean;
  index: number;
  total: number;
  onChange: (patch: Partial<DraftLinea>) => void;
}) {
  return (
    <div
      className={`
        rounded-2xl border-2 bg-white px-5 py-4 shadow-sm transition-all
        ${changed ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}
      `}
    >
      {/* Identificación del medicamento */}
      <div className="flex items-start justify-between gap-2 mb-4">
        <div className="flex-1 min-w-0">
          <p className="text-2xl font-extrabold text-slate-800 leading-tight">
            {med.principioActivo ?? med.nombre}
          </p>
          {med.principioActivo && (
            <p className="text-lg italic text-slate-400 leading-tight mt-0.5 truncate">
              {med.nombre}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="font-mono text-base bg-slate-100 text-slate-500 rounded-lg px-2 py-1">
            CN {med.cn}
          </span>
          <span className="text-sm text-slate-400">
            {index}/{total}
          </span>
        </div>
      </div>

      {/* Inputs de cantidad */}
      <div className="grid grid-cols-2 gap-4">
        {/* Cajas */}
        <div className="space-y-1">
          <label className="block text-sm font-bold text-slate-600 uppercase tracking-wider">
            📦 Cajas
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={val.cajas === 0 ? '' : val.cajas}
            placeholder="0"
            onChange={(e) => onChange({ cajas: toIntInput(e.target.value) })}
            className="w-full rounded-xl border-2 border-slate-300 px-4 py-4 text-3xl font-bold text-center text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
          />
        </div>

        {/* Unidades sueltas */}
        <div className="space-y-1">
          <label className="block text-sm font-bold text-slate-600 uppercase tracking-wider">
            💊 Unidades sueltas
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={val.unidadesSueltas === 0 ? '' : val.unidadesSueltas}
            placeholder="0"
            onChange={(e) => onChange({ unidadesSueltas: toIntInput(e.target.value) })}
            className="w-full rounded-xl border-2 border-slate-300 px-4 py-4 text-3xl font-bold text-center text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
          />
          <p className="text-sm text-slate-400 text-center">
            (1 caja = {med.unidadesPorCaja} udes)
          </p>
        </div>
      </div>

      {changed && (
        <p className="mt-3 text-sm font-semibold text-amber-600">✏ Modificado — recuerda guardar</p>
      )}
    </div>
  );
}
