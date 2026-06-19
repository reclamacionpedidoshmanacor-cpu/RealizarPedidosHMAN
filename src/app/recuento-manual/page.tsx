'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AREA_IDS, type AreaId } from '@/lib/areas';

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

type DraftLinea = {
  cajas: number;
  unidadesSueltas: number;
};

const AREA_LABELS: Record<AreaId, string> = {
  oncologia: 'Oncología',
  upe: 'Pac. Externos',
  iv: 'Medicamentos IV',
  nutricion: 'Nutrición',
  almacen: 'Almacén',
};

function toIntInput(value: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.trunc(num);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-ES');
}

export default function RecuentoManualPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingArea, setChangingArea] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [selectedArea, setSelectedArea] = useState<AreaId>('oncologia');
  const [draft, setDraft] = useState<Record<string, DraftLinea>>({});

  const load = async (ubicacion?: string) => {
    setLoading(true);
    try {
      const qs = ubicacion ? `?ubicacion=${encodeURIComponent(ubicacion)}` : '';
      const res = await fetch(`/api/recuento-manual${qs}`, { cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo cargar recuento manual.');

      const typed = payload as ApiResponse;
      setData(typed);
      setSelectedArea(typed.area);

      const nextDraft: Record<string, DraftLinea> = {};
      for (const med of typed.medicamentos) {
        nextDraft[med.cn] = { cajas: med.cajas, unidadesSueltas: med.unidadesSueltas };
      }
      setDraft(nextDraft);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const hasChanges = useMemo(() => {
    if (!data) return false;
    return data.medicamentos.some((med) => {
      const current = draft[med.cn];
      if (!current) return false;
      return current.cajas !== med.cajas || current.unidadesSueltas !== med.unidadesSueltas;
    });
  }, [data, draft]);

  const handleAreaChange = async (nextArea: AreaId) => {
    if (nextArea === selectedArea) return;
    if (hasChanges) {
      const ok = confirm(
        'Hay cambios sin guardar en la ubicación actual. ¿Quieres cambiar de área y perder esos cambios?'
      );
      if (!ok) return;
    }

    setChangingArea(true);
    try {
      const res = await fetch('/api/auth/area', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ area: nextArea }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo cambiar el área.');
      toast.success(`Área activa: ${AREA_LABELS[nextArea]}.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setChangingArea(false);
    }
  };

  const handleUbicacionChange = async (nextUbicacion: string) => {
    if (!data || nextUbicacion === data.ubicacionSeleccionada) return;
    if (hasChanges) {
      const ok = confirm(
        'Hay cambios sin guardar en esta ubicación. ¿Cambiar igualmente de ubicación?'
      );
      if (!ok) return;
    }
    await load(nextUbicacion);
  };

  const setLinea = (cn: string, patch: Partial<DraftLinea>) => {
    setDraft((prev) => ({
      ...prev,
      [cn]: {
        cajas: prev[cn]?.cajas ?? 0,
        unidadesSueltas: prev[cn]?.unidadesSueltas ?? 0,
        ...patch,
      },
    }));
  };

  const handleGuardar = async () => {
    if (!data || !data.ubicacionSeleccionada) return;

    const cambios = data.medicamentos
      .map((med) => {
        const current = draft[med.cn] ?? { cajas: med.cajas, unidadesSueltas: med.unidadesSueltas };
        return {
          cn: med.cn,
          cajas: current.cajas,
          unidadesSueltas: current.unidadesSueltas,
          changed:
            current.cajas !== med.cajas ||
            current.unidadesSueltas !== med.unidadesSueltas,
        };
      })
      .filter((linea) => linea.changed)
      .map(({ changed, ...linea }) => linea);

    if (cambios.length === 0) {
      toast.info('No hay cambios pendientes en esta ubicación.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/recuento-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ubicacion: data.ubicacionSeleccionada,
          lineas: cambios,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        const detalle = Array.isArray(payload?.errores)
          ? ` ${payload.errores.slice(0, 4).join(' | ')}`
          : '';
        throw new Error(`${payload?.error ?? 'No se pudo guardar.'}${detalle}`);
      }

      toast.success(
        `Guardado en recuento #${payload.importacionId}. Insertadas: ${payload.insertadas}, actualizadas: ${payload.actualizadas}, eliminadas: ${payload.eliminadas}.`
      );
      await load(data.ubicacionSeleccionada);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">APP Recuento manual</h1>
          <p className="text-sm text-slate-500">
            Registra stock por ubicación (cajas y unidades sueltas). Cada guardado se incorpora al
            recuento pendiente sin tramitar.
          </p>
        </div>
        <Link
          href="/stock"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Ir a pestaña Stock
        </Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Área</label>
            <select
              value={selectedArea}
              onChange={(e) => void handleAreaChange(e.target.value as AreaId)}
              disabled={changingArea}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {AREA_IDS.map((area) => (
                <option key={area} value={area}>
                  {AREA_LABELS[area]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Ubicación</label>
            <select
              value={data?.ubicacionSeleccionada ?? ''}
              onChange={(e) => void handleUbicacionChange(e.target.value)}
              disabled={loading || !data || data.ubicaciones.length === 0}
              className="min-w-[240px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {(data?.ubicaciones ?? []).map((ubicacion) => (
                <option key={ubicacion} value={ubicacion}>
                  {ubicacion}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {data?.pendiente ? (
            <>
              Recuento pendiente activo: <strong>#{data.pendiente.id}</strong> ({data.pendiente.origen}) ·
              Fecha: <strong>{formatDate(data.pendiente.fechaRecuento)}</strong> · Líneas: <strong>{data.pendiente.totalLineas}</strong>
            </>
          ) : (
            <>
              No hay recuento pendiente. Al guardar por primera vez se creará automáticamente un recuento manual pendiente.
            </>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Cargando formulario de recuento manual...</p>
      ) : !data || !data.ubicacionSeleccionada ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          No hay ubicaciones configuradas para el área seleccionada.
        </p>
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">CN</th>
                  <th className="px-3 py-2 text-left">Principio activo</th>
                  <th className="px-3 py-2 text-left">Medicamento (marca)</th>
                  <th className="px-3 py-2 text-center">Estado</th>
                  <th className="px-3 py-2 text-center">Cajas</th>
                  <th className="px-3 py-2 text-center">Udes sueltas</th>
                </tr>
              </thead>
              <tbody>
                {data.medicamentos.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-slate-500">
                      No hay medicamentos en esta ubicación.
                    </td>
                  </tr>
                ) : (
                  data.medicamentos.map((med) => {
                    const value = draft[med.cn] ?? { cajas: med.cajas, unidadesSueltas: med.unidadesSueltas };
                    return (
                      <tr key={med.cn} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <span className="inline-block rounded bg-slate-100 px-1.5 py-px font-mono text-[11px] text-slate-500 tracking-wide">
                            {med.cn}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-800">
                          {med.principioActivo ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-[12px] italic text-slate-500">{med.nombre}</td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              med.activo
                                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                                : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
                            }`}
                          >
                            {med.activo ? 'Activo' : 'Inactivo'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={value.cajas}
                            onChange={(e) => setLinea(med.cn, { cajas: toIntInput(e.target.value) })}
                            className="w-24 rounded border border-slate-300 px-2 py-1 text-center"
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={value.unidadesSueltas}
                            onChange={(e) =>
                              setLinea(med.cn, { unidadesSueltas: toIntInput(e.target.value) })
                            }
                            className="w-28 rounded border border-slate-300 px-2 py-1 text-center"
                          />
                          <p className="mt-1 text-[11px] text-slate-400">Caja: {med.unidadesPorCaja} udes</p>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-600">
              Ubicación actual: <strong>{data.ubicacionSeleccionada}</strong> · Medicamentos: <strong>{data.medicamentos.length}</strong>
            </p>
            <button
              onClick={handleGuardar}
              disabled={saving}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Guardar recuento manual'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
