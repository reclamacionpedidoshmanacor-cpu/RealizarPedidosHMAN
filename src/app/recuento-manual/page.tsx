'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AREA_IDS, type AreaId } from '@/lib/areas';
import { normalizeAlmacenText, ubicacionAlmacenUsaLetras } from '@/lib/almacen';
import { cn } from '@/lib/utils';
import type { AlertaSuministroCn } from '@/lib/pedidos-pendientes';
import { BadgeSuministro } from '@/components/BadgeSuministro';

/* ─── tipos recuento manual ─── */
type RecuentoPendiente = { id: number; origen: string; fechaRecuento: string; totalLineas: number } | null;

type MedicamentoManual = {
  cn: string;
  principioActivo: string | null;
  nombre: string;
  presentacion?: string | null;
  ubicacion?: string | null;
  activo: boolean;
  unidadesPorCaja: number;
  cajas?: number;
  unidadesSueltas?: number;
  registradoEnRecuento?: boolean;
  cajasPedidas?: number;
  stockMinimo?: number | null;
  puntoPedido?: number | null;
  stockMaximo?: number | null;
  tieneStockOrientativo?: boolean;
  pedidosRecibidos14d?: number;
  unidadesRecibidas14d?: number;
  pedidosPendientes?: number;
  unidadesPendientes?: number;
  ultimoRecibidoFecha?: string | null;
  ultimoRecibidoUnidades?: number;
  alertaSuministro?: AlertaSuministroCn | null;
};

type ApiResponse = {
  area: AreaId;
  modo?: 'recuento' | 'pedido-almacen';
  pendiente?: RecuentoPendiente;
  pedidoPendiente?: RecuentoPendiente;
  ubicaciones: string[];
  ubicacionSeleccionada: string | null;
  letraSeleccionada?: string | null;
  letrasDisponibles?: string[];
  usaLetrasUbicacion?: boolean;
  totalUbicacion?: number;
  medicamentos: MedicamentoManual[];
  faltantesActivosArea?: number;
  faltantesActivosUbicacion?: number;
};

/* ─── tipos reposición (solo UPE) ─── */
type ReposicionBorrador = { id: number; totalLineas: number; fechaCreacion: string } | null;
type ReposicionDraftLinea = { cantidadCajas: number };
type ReposicionDetalleLinea = { ubicacion: string; cn: string; cantidadCajas: number };
type ReposicionDetalleResponse = {
  cabecera: { id: number; totalLineas: number; fechaCreacion: string };
  lineas: ReposicionDetalleLinea[];
};

type Step = 'area' | 'ubicacion' | 'letra-almacen' | 'recuento' | 'pedido-almacen' | 'reposicion-ubicacion' | 'reposicion-recuento';

type DraftLinea = { cajas: number; unidadesSueltas: number };
type AlmacenDraftLinea = { cajasPedidas: number };

type GrupoPrincipioAlmacen = {
  key: string;
  principioActivo: string;
  medicamentos: MedicamentoManual[];
};

type EditarPasilloPayload = {
  principioActivo: string;
  nombre: string;
  presentacion: string;
  ubicacion: string;
  unidadesPorCaja: number;
};

type CimaPreview = {
  cn: string;
  nombre: string;
  principioActivo: string;
  presentacion: string;
  unidadesPorCajaInferidas: number | null;
};

/* ─── configuración de áreas ─── */
const AREAS: { id: AreaId; label: string; emoji: string; color: string; bg: string; border: string }[] = [
  { id: 'oncologia', label: 'Oncología',       emoji: '🏥', color: 'text-violet-700', bg: 'bg-violet-50',  border: 'border-violet-300' },
  { id: 'upe',       label: 'Pac. Externos',    emoji: '🚶', color: 'text-sky-700',    bg: 'bg-sky-50',     border: 'border-sky-300'    },
  { id: 'iv',        label: 'Medicamentos IV',  emoji: '💉', color: 'text-teal-700',   bg: 'bg-teal-50',    border: 'border-teal-300'   },
  { id: 'nutricion', label: 'Nutrición',        emoji: '🥗', color: 'text-lime-700',   bg: 'bg-lime-50',    border: 'border-lime-300'   },
  { id: 'almacen',   label: 'Almacén',          emoji: '📦', color: 'text-amber-700',  bg: 'bg-amber-50',   border: 'border-amber-300'  },
];

/* ─── helpers ─── */
function formatUnidadesPedido(value: number): string {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(Math.round(value));
}

function formatFechaPedido(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

function textoRecibidoAlmacen(med: MedicamentoManual): string {
  const recibidos = med.pedidosRecibidos14d ?? 0;
  const udsRecibidas = med.unidadesRecibidas14d ?? 0;
  if (recibidos > 0) {
    return `${recibidos} pedido${recibidos !== 1 ? 's' : ''}, ${formatUnidadesPedido(udsRecibidas)} uds`;
  }
  const fecha = med.ultimoRecibidoFecha?.trim();
  const udsUltimo = med.ultimoRecibidoUnidades ?? 0;
  if (fecha) {
    return `Sin recibos en 2 sem · último: ${formatFechaPedido(fecha)}, ${formatUnidadesPedido(udsUltimo)} uds`;
  }
  return 'Sin recibos en 2 sem';
}

function parseUdsCajaInput(value: string): number {
  const raw = value.trim();
  if (!raw) return 0;
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

async function parseApiJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    if (res.redirected || text.includes('<!DOCTYPE') || text.includes('<html')) {
      throw new Error('Sesión no válida. Vuelve a entrar en la app.');
    }
    throw new Error('Respuesta no válida del servidor.');
  }
}

function restoreScrollY(y: number) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.scrollTo(0, y);
    });
  });
}

function toIntInput(v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

function RecuentoCantidadInput({
  value,
  onCommit,
  className,
}: {
  value: number;
  onCommit: (n: number) => void;
  className: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const valueOnFocusRef = useRef(value);

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    valueOnFocusRef.current = value;
    setEditing('');
    requestAnimationFrame(() => e.currentTarget.select());
  };

  const handleBlur = () => {
    if (editing === null) return;
    const next = editing === '' ? valueOnFocusRef.current : toIntInput(editing);
    onCommit(next);
    setEditing(null);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="0"
      value={editing !== null ? editing : String(value)}
      onFocus={handleFocus}
      onChange={(e) => setEditing(e.target.value.replace(/\D/g, ''))}
      onBlur={handleBlur}
      className={className}
    />
  );
}
function formatDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('es-ES');
}

function recuentoLineaCambiada(
  med: MedicamentoManual,
  cur: DraftLinea,
  base: DraftLinea,
  editado: boolean,
): boolean {
  const valorCambiado = cur.cajas !== base.cajas || cur.unidadesSueltas !== base.unidadesSueltas;
  const registroExplicito = editado && !med.registradoEnRecuento;
  return valorCambiado || registroExplicito;
}

/* ══════════════════════════════════════════════════════════ */
export default function RecuentoManualPage() {
  /* ── estado común ── */
  const [step, setStep] = useState<Step>('area');
  const [area, setArea] = useState<AreaId | null>(null);
  const [ubicacion, setUbicacion] = useState<string | null>(null);
  const [letra, setLetra] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [incorporando, setIncorporando] = useState(false);

  /* ── estado recuento manual ── */
  const [draft, setDraft] = useState<Record<string, DraftLinea>>({});
  const [baseline, setBaseline] = useState<Record<string, DraftLinea>>({});
  const [editadosCn, setEditadosCn] = useState<Record<string, boolean>>({});
  const [almacenDraft, setAlmacenDraft] = useState<Record<string, AlmacenDraftLinea>>({});
  const [almacenBaseline, setAlmacenBaseline] = useState<Record<string, AlmacenDraftLinea>>({});
  const [extrasAlmacen, setExtrasAlmacen] = useState<MedicamentoManual[]>([]);
  const [sustitucionCnViejo, setSustitucionCnViejo] = useState<string | null>(null);
  const [sustituyendo, setSustituyendo] = useState(false);
  const [edicionCn, setEdicionCn] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [inactivandoCn, setInactivandoCn] = useState<string | null>(null);

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
  const almacenConLetras = ubicacion ? ubicacionAlmacenUsaLetras(ubicacion) : false;

  /* ════════ RECUENTO MANUAL ════════ */

  const cargarUbicacion = async (ub: string, letraFiltro?: string | null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ ubicacion: ub });
      if (letraFiltro) params.set('letra', letraFiltro);
      const res = await fetch(`/api/recuento-manual?${params.toString()}`, { cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'Error al cargar medicamentos.');
      const typed = payload as ApiResponse;
      setData(typed);

      if (typed.modo === 'pedido-almacen') {
        const nextDraft: Record<string, AlmacenDraftLinea> = {};
        const nextBaseline: Record<string, AlmacenDraftLinea> = {};
        for (const med of typed.medicamentos) {
          const vals = { cajasPedidas: med.cajasPedidas ?? 0 };
          nextDraft[med.cn] = { ...vals };
          nextBaseline[med.cn] = { ...vals };
        }
        setAlmacenDraft(nextDraft);
        setAlmacenBaseline(nextBaseline);
        return;
      }

      const nextDraft: Record<string, DraftLinea> = {};
      const nextBaseline: Record<string, DraftLinea> = {};
      for (const med of typed.medicamentos) {
        const vals = { cajas: med.cajas ?? 0, unidadesSueltas: med.unidadesSueltas ?? 0 };
        nextDraft[med.cn] = { ...vals };
        nextBaseline[med.cn] = { ...vals };
      }
      setDraft(nextDraft);
      setBaseline(nextBaseline);
      setEditadosCn({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  const refrescarPedidoAlmacen = async (
    ub: string,
    letraFiltro?: string | null,
    opts?: { resetBaseline?: boolean },
  ) => {
    const scrollY = window.scrollY;
    try {
      const params = new URLSearchParams({ ubicacion: ub });
      if (letraFiltro) params.set('letra', letraFiltro);
      const res = await fetch(`/api/recuento-manual?${params.toString()}`, { cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'Error al cargar medicamentos.');
      const typed = payload as ApiResponse;
      setData(typed);

      if (typed.modo === 'pedido-almacen') {
        const reset = opts?.resetBaseline === true;
        setAlmacenDraft((prev) => {
          const next: Record<string, AlmacenDraftLinea> = {};
          for (const med of typed.medicamentos) {
            const vals = { cajasPedidas: med.cajasPedidas ?? 0 };
            next[med.cn] = reset ? { ...vals } : (prev[med.cn] ?? { ...vals });
          }
          return next;
        });
        setAlmacenBaseline((prev) => {
          const next: Record<string, AlmacenDraftLinea> = {};
          for (const med of typed.medicamentos) {
            const vals = { cajasPedidas: med.cajasPedidas ?? 0 };
            next[med.cn] = reset ? { ...vals } : (prev[med.cn] ?? { ...vals });
          }
          return next;
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      restoreScrollY(scrollY);
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
      setLetra(null);
      setDraft({});
      setBaseline({});
      setEditadosCn({});
      setAlmacenDraft({});
      setAlmacenBaseline({});
      setExtrasAlmacen([]);
      setSustitucionCnViejo(null);
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
    setExtrasAlmacen([]);
    setSustitucionCnViejo(null);
    setEdicionCn(null);
    if (area === 'almacen') {
      setLetra(null);
      if (ubicacionAlmacenUsaLetras(ub)) {
        const res = await fetch(`/api/recuento-manual?ubicacion=${encodeURIComponent(ub)}`, { cache: 'no-store' });
        const payload = (await res.json()) as ApiResponse;
        setData(payload);
        setStep('letra-almacen');
      } else {
        await cargarUbicacion(ub);
        setStep('pedido-almacen');
        setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      }
      return;
    }
    await cargarUbicacion(ub);
    setStep('recuento');
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const seleccionarLetraAlmacen = async (ltr: string) => {
    if (!ubicacion) return;
    setLetra(ltr);
    await cargarUbicacion(ubicacion, ltr);
    setStep('pedido-almacen');
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const setLinea = (cn: string, patch: Partial<DraftLinea>) => {
    setEditadosCn((prev) => ({ ...prev, [cn]: true }));
    setDraft((prev) => ({
      ...prev,
      [cn]: { cajas: prev[cn]?.cajas ?? 0, unidadesSueltas: prev[cn]?.unidadesSueltas ?? 0, ...patch },
    }));
  };

  const hasChanges = useMemo(() => {
    if (!data) return false;
    return data.medicamentos.some((med) => {
      const cur = draft[med.cn] ?? { cajas: 0, unidadesSueltas: 0 };
      const base = baseline[med.cn] ?? { cajas: 0, unidadesSueltas: 0 };
      return recuentoLineaCambiada(med, cur, base, Boolean(editadosCn[med.cn]));
    });
  }, [data, draft, baseline, editadosCn]);

  const handleIncorporarFaltantes = async (alcance: 'ubicacion' | 'area') => {
    if (!data?.pendiente) {
      toast.error('No hay recuento pendiente.');
      return;
    }
    if (alcance === 'ubicacion' && !ubicacion) return;

    setIncorporando(true);
    try {
      const res = await fetch('/api/recuento-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'incorporar-faltantes',
          ubicacion: alcance === 'ubicacion' ? ubicacion : undefined,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudieron incorporar faltantes.');
      toast.success(`✅ ${payload.insertadas} medicamento(s) añadido(s) con stock 0`);
      if (alcance === 'ubicacion' && ubicacion) {
        await cargarUbicacion(ubicacion);
      } else {
        const res2 = await fetch('/api/recuento-manual', { cache: 'no-store' });
        const data2 = (await res2.json()) as ApiResponse;
        setData(data2);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setIncorporando(false);
    }
  };

  const medicamentosAlmacenVisibles = useMemo(() => {
    const base = data?.medicamentos ?? [];
    const extras = extrasAlmacen.filter((e) => !base.some((b) => b.cn === e.cn));
    return [...extras, ...base];
  }, [data?.medicamentos, extrasAlmacen]);

  const gruposAlmacen = useMemo((): GrupoPrincipioAlmacen[] => {
    const map = new Map<string, GrupoPrincipioAlmacen>();
    for (const med of medicamentosAlmacenVisibles) {
      const principio = (med.principioActivo ?? med.nombre ?? med.cn).trim() || med.cn;
      const key = principio.toLocaleUpperCase('es');
      const grupo = map.get(key);
      if (grupo) {
        grupo.medicamentos.push(med);
      } else {
        map.set(key, { key, principioActivo: principio, medicamentos: [med] });
      }
    }
    for (const grupo of map.values()) {
      grupo.medicamentos.sort((a, b) =>
        a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })
      );
    }
    return [...map.values()].sort((a, b) =>
      a.principioActivo.localeCompare(b.principioActivo, 'es', { sensitivity: 'base' })
    );
  }, [medicamentosAlmacenVisibles]);

  const almacenHasChanges = useMemo(() => {
    if (!data || data.modo !== 'pedido-almacen') return false;
    return medicamentosAlmacenVisibles.some((med) => {
      const cur = almacenDraft[med.cn];
      const base = almacenBaseline[med.cn] ?? { cajasPedidas: 0 };
      return cur && cur.cajasPedidas !== base.cajasPedidas;
    });
  }, [data, almacenDraft, almacenBaseline, medicamentosAlmacenVisibles]);

  const handleConfirmarSustitucion = async (
    cnViejo: string,
    cnNuevo: string,
    cajasPedidas: number,
  ) => {
    if (!ubicacion) return;
    setSustituyendo(true);
    try {
      const res = await fetch('/api/pedido-almacen/sustituir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cnViejo, cnNuevo, ubicacion, cajasPedidas }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo sustituir.');

      const nuevo = payload.medicamento as MedicamentoManual;
      const cajas = Number(nuevo.cajasPedidas ?? cajasPedidas);

      setExtrasAlmacen((prev) => {
        const filtrados = prev.filter((m) => m.cn !== cnViejo && m.cn !== nuevo.cn);
        const yaEnLetra = (data?.medicamentos ?? []).some((m) => m.cn === nuevo.cn);
        if (yaEnLetra) return filtrados;
        return [{ ...nuevo, activo: true }, ...filtrados];
      });

      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          medicamentos: prev.medicamentos.filter((m) => m.cn !== cnViejo),
        };
      });

      setAlmacenDraft((prev) => {
        const next = { ...prev };
        delete next[cnViejo];
        return next;
      });
      setAlmacenBaseline((prev) => {
        const next = { ...prev };
        delete next[cnViejo];
        return next;
      });

      const draftVal = { cajasPedidas: cajas };
      setAlmacenDraft((prev) => ({ ...prev, [nuevo.cn]: draftVal }));
      if (cajas > 0) {
        setAlmacenBaseline((prev) => ({ ...prev, [nuevo.cn]: draftVal }));
      }

      setSustitucionCnViejo(null);
      setEdicionCn(null);
      toast.success(
        `Sustituido CN ${cnViejo} → ${nuevo.cn}${cajas > 0 ? ` · ${cajas} caja(s) en pedido` : ''}`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setSustituyendo(false);
    }
  };

  const handleGuardarEdicionPasillo = async (cn: string, payload: EditarPasilloPayload) => {
    if (!ubicacion) return;
    const medActual = medicamentosAlmacenVisibles.find((m) => m.cn === cn);
    const cambiaUbicacion =
      normalizeAlmacenText(payload.ubicacion) !== normalizeAlmacenText(ubicacion);
    const ppioNuevo = payload.principioActivo.trim();
    const ppioViejo = (medActual?.principioActivo ?? medActual?.nombre ?? '').trim();
    const cambiaLetra = almacenConLetras
      && ppioNuevo.toLocaleUpperCase('es').charAt(0) !== ppioViejo.toLocaleUpperCase('es').charAt(0);

    if (cambiaUbicacion || cambiaLetra) {
      const aviso = cambiaUbicacion && cambiaLetra
        ? 'Cambias ubicación y principio activo: el artículo saldrá de esta letra y aparecerá donde corresponda.'
        : cambiaUbicacion
          ? 'Cambias la ubicación: el artículo saldrá de este pasillo.'
          : 'Cambias el principio activo: el artículo puede salir de esta letra.';
      if (!confirm(`${aviso}\n\n¿Guardar los cambios en catálogo?`)) return;
    }

    setEditando(true);
    try {
      const res = await fetch('/api/recuento-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'editar-catalogo',
          cn,
          principioActivo: ppioNuevo || null,
          nombre: payload.nombre.trim(),
          presentacion: payload.presentacion.trim() || null,
          ubicacion: payload.ubicacion.trim(),
          unidadesPorCaja: payload.unidadesPorCaja,
        }),
      });
      const result = await parseApiJson(res);
      if (!res.ok) throw new Error(String(result?.error ?? 'No se pudo guardar.'));

      setEdicionCn(null);
      setSustitucionCnViejo(null);
      toast.success('Datos actualizados en catálogo.');

      setData((prev) => {
        if (!prev) return prev;
        const patch = {
          principioActivo: ppioNuevo || null,
          nombre: payload.nombre.trim(),
          presentacion: payload.presentacion.trim() || null,
          ubicacion: payload.ubicacion.trim(),
          unidadesPorCaja: payload.unidadesPorCaja,
        };
        if (cambiaLetra || cambiaUbicacion) {
          setAlmacenDraft((prev) => {
            const next = { ...prev };
            delete next[cn];
            return next;
          });
          setAlmacenBaseline((prev) => {
            const next = { ...prev };
            delete next[cn];
            return next;
          });
          return { ...prev, medicamentos: prev.medicamentos.filter((m) => m.cn !== cn) };
        }
        return {
          ...prev,
          medicamentos: prev.medicamentos.map((m) => (m.cn === cn ? { ...m, ...patch } : m)),
        };
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setEditando(false);
    }
  };

  const handleMarcarInactivo = async (cn: string) => {
    if (!ubicacion) return;
    const med = medicamentosAlmacenVisibles.find((m) => m.cn === cn);
    const qty = almacenDraft[cn]?.cajasPedidas ?? 0;
    const etiqueta = med?.nombre ?? cn;
    let aviso =
      `${etiqueta}\nCN ${cn}\n\nDejará de aparecer en el pedido de almacén. Podrás reactivarlo desde Catálogo.`;
    if (qty > 0) {
      aviso += `\n\nTiene ${qty} caja(s) en el pedido actual; también se quitarán.`;
    }
    if (!confirm(`¿Marcar como inactivo?\n\n${aviso}`)) return;

    setInactivandoCn(cn);
    try {
      const res = await fetch('/api/recuento-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'marcar-inactivo', cn }),
      });
      const result = await parseApiJson(res);
      if (!res.ok) throw new Error(String(result?.error ?? 'No se pudo marcar como inactivo.'));

      setEdicionCn(null);
      setSustitucionCnViejo(null);
      setExtrasAlmacen((prev) => prev.filter((e) => e.cn !== cn));
      setData((prev) => {
        if (!prev) return prev;
        return { ...prev, medicamentos: prev.medicamentos.filter((m) => m.cn !== cn) };
      });
      setAlmacenDraft((prev) => {
        const next = { ...prev };
        delete next[cn];
        return next;
      });
      setAlmacenBaseline((prev) => {
        const next = { ...prev };
        delete next[cn];
        return next;
      });
      toast.success('Artículo marcado como inactivo.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setInactivandoCn(null);
    }
  };

  const handleGuardarAlmacen = async () => {
    if (!data || !ubicacion) return;
    const cambios = medicamentosAlmacenVisibles
      .map((med) => {
        const cur = almacenDraft[med.cn] ?? { cajasPedidas: 0 };
        const base = almacenBaseline[med.cn] ?? { cajasPedidas: 0 };
        return {
          cn: med.cn,
          cajasPedidas: cur.cajasPedidas,
          changed: cur.cajasPedidas !== base.cajasPedidas,
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
      const res = await fetch('/api/pedido-almacen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ubicacion, lineas: cambios }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo guardar el pedido.');
      toast.success(`✅ Pedido guardado (${payload.upserted} línea(s))`);
      await refrescarPedidoAlmacen(ubicacion, almacenConLetras ? letra : null, { resetBaseline: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setSaving(false);
    }
  };

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
          changed: recuentoLineaCambiada(med, cur, base, Boolean(editadosCn[med.cn])),
        };
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
      toast.success(`✅ Recuento guardado (${payload.insertadas + payload.actualizadas} líneas)`);
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
      for (const med of payload.medicamentos.filter((m) => m.activo)) {
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
    const medicamentosActivos = (data.medicamentos ?? []).filter((med) => med.activo);
    const lineas = medicamentosActivos
      .map((med) => ({ cn: med.cn, cantidadCajas: repoDraft[med.cn]?.cantidadCajas ?? 0 }))
      .filter((l) => l.cantidadCajas > 0);

    if (lineas.length === 0) { toast.info('Introduce al menos una cantidad.'); return; }

    const excedidas = medicamentosActivos.filter((med) => {
      const qty = repoDraft[med.cn]?.cantidadCajas ?? 0;
      return med.stockMaximo != null && qty > med.stockMaximo;
    });

    if (excedidas.length > 0) {
      const ok = confirm(
        `Hay ${excedidas.length} medicamentos por encima del stock máximo. ¿Guardar igualmente?`
      );
      if (!ok) return;
    }

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

  const volverAAcceso = async () => {
    try {
      // Reinicia sesión para asegurar que el login vuelve limpio
      await fetch('/api/auth', { method: 'DELETE' });
    } catch {
      // Silencioso: aunque falle, redirigimos igualmente.
    } finally {
      window.location.href = '/login';
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
            <button
              type="button"
              onClick={() => void volverAAcceso()}
              className="rounded-xl border-2 border-slate-300 bg-white px-5 py-3 text-lg font-bold text-slate-600 shadow-sm hover:bg-slate-50 active:scale-95"
            >
              ← Volver a acceso
            </button>
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

        {area === 'almacen' ? (
          data?.pedidoPendiente ? (
            <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 px-6 py-4">
              <p className="text-lg font-semibold text-amber-800">📦 Pedido en curso #{data.pedidoPendiente.id}</p>
              <p className="text-base text-amber-700">
                {data.pedidoPendiente.totalLineas} línea(s) · {formatDate(data.pedidoPendiente.fechaRecuento)}
              </p>
              <p className="text-sm text-amber-600 mt-1">Revisa en Propuesta para descargar el Excel cuando termines.</p>
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 px-6 py-4">
              <p className="text-lg font-semibold text-amber-700">ℹ️ Nuevo pedido — se creará al guardar la primera línea</p>
            </div>
          )
        ) : data?.pendiente ? (
          <div className="rounded-2xl border-2 border-teal-200 bg-teal-50 px-6 py-4 space-y-3">
            <div>
              <p className="text-lg font-semibold text-teal-700">📂 Recuento en curso: #{data.pendiente.id}</p>
              <p className="text-base text-teal-600">
                Fecha: {formatDate(data.pendiente.fechaRecuento)} · {data.pendiente.origen} · {data.pendiente.totalLineas} líneas
              </p>
            </div>
            {(data.faltantesActivosArea ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => void handleIncorporarFaltantes('area')}
                disabled={incorporando}
                className="w-full rounded-xl border-2 border-teal-400 bg-white px-4 py-3 text-base font-bold text-teal-800 hover:bg-teal-100 active:scale-[0.99] disabled:opacity-50"
              >
                {incorporando ? 'Incorporando…' : `➕ Añadir ${data.faltantesActivosArea} activo(s) faltante(s) con stock 0`}
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 px-6 py-4">
            <p className="text-lg font-semibold text-amber-700">ℹ️ Sin recuento activo — se creará al guardar</p>
          </div>
        )}

        <div className="space-y-3">
          <h3 className="text-2xl font-bold text-slate-700">
            {area === 'almacen' ? '¿Qué ubicación vas a pedir?' : '¿Qué ubicación vas a contar?'}
          </h3>
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

  /* ── PASO ALMACÉN: Letra ── */
  if (step === 'letra-almacen') {
    const letras = data?.letrasDisponibles ?? [];
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex flex-col p-6 gap-6">
        <div className="flex items-center gap-4">
          <button onClick={() => setStep('ubicacion')}
            className="rounded-xl border-2 border-slate-300 bg-white px-5 py-3 text-xl font-bold text-slate-600 shadow-sm hover:bg-slate-50 active:scale-95">
            ← Volver
          </button>
          <div>
            <p className="text-base text-amber-600 font-semibold">Pedido Almacén</p>
            <h2 className="text-3xl font-extrabold text-amber-800 truncate">📍 {ubicacion}</h2>
            <p className="text-base text-slate-500">{data?.totalUbicacion ?? 0} medicamentos en esta ubicación</p>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-2xl font-bold text-slate-700">¿Por qué letra empiezas?</h3>
          <p className="text-base text-slate-500">El catálogo está ordenado alfabéticamente por principio activo.</p>
          {loading ? (
            <p className="text-xl text-slate-500 animate-pulse">Cargando letras…</p>
          ) : letras.length === 0 ? (
            <p className="text-xl text-amber-700 rounded-2xl border-2 border-amber-200 bg-amber-50 px-6 py-5">
              No hay medicamentos activos en esta ubicación.
            </p>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
              {letras.map((ltr) => (
                <button key={ltr} onClick={() => void seleccionarLetraAlmacen(ltr)}
                  className="rounded-2xl border-2 border-amber-300 bg-white px-4 py-5 text-2xl font-extrabold text-amber-800 shadow-sm hover:bg-amber-100 active:scale-95 transition-all">
                  {ltr}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── PASO ALMACÉN: Pedido por letra ── */
  if (step === 'pedido-almacen') {
    const medicamentos = medicamentosAlmacenVisibles;
    const almacenHasAnyQty = medicamentos.some((med) => (almacenDraft[med.cn]?.cajasPedidas ?? 0) > 0);
    let presentacionIndex = 0;

    return (
      <div className="min-h-screen bg-amber-50 flex flex-col pb-40" ref={tableRef}>
        <div className="sticky top-0 z-20 bg-white border-b-2 border-amber-200 shadow-sm px-4 py-3 flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setStep(almacenConLetras ? 'letra-almacen' : 'ubicacion')}
            className="rounded-xl border-2 border-slate-300 bg-white px-4 py-2 text-lg font-bold text-slate-600 hover:bg-slate-50 active:scale-95"
          >
            {almacenConLetras ? '← Letra' : '← Ubicaciones'}
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-extrabold text-amber-800 truncate">📦 Pedido Almacén</p>
            <p className="text-base text-slate-500 truncate">
              📍 {ubicacion}
              {almacenConLetras && letra ? ` · Letra ${letra}` : ''}
            </p>
          </div>
          {data?.pedidoPendiente && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800">
              Pedido #{data.pedidoPendiente.id}
            </span>
          )}
        </div>

        <div className="flex-1 px-4 pt-4 space-y-4">
          <p className="text-base text-slate-500 font-semibold">
            {gruposAlmacen.length} principio activo{gruposAlmacen.length !== 1 ? 's' : ''} · {medicamentos.length} presentación{medicamentos.length !== 1 ? 'es' : ''}
          </p>
          {loading ? (
            <p className="text-2xl text-slate-500 animate-pulse text-center py-20">Cargando…</p>
          ) : gruposAlmacen.length === 0 ? (
            <p className="text-2xl font-bold text-amber-700 text-center py-10">
              {almacenConLetras
                ? 'No hay medicamentos para esta letra.'
                : 'No hay medicamentos activos en esta ubicación.'}
            </p>
          ) : (
            gruposAlmacen.map((grupo) => (
              <section
                key={grupo.key}
                className="rounded-2xl border-2 border-amber-200 bg-white shadow-sm overflow-hidden"
              >
                <div className="bg-amber-100 border-b border-amber-200 px-4 py-3">
                  <p className="text-xl font-extrabold text-amber-900 leading-tight">{grupo.principioActivo}</p>
                  <p className="text-sm text-amber-800 mt-0.5">
                    {grupo.medicamentos.length} presentación{grupo.medicamentos.length !== 1 ? 'es' : ''}
                  </p>
                </div>
                <div className="p-3 space-y-3">
                  {grupo.medicamentos.map((med) => {
                    presentacionIndex += 1;
                    const qty = almacenDraft[med.cn]?.cajasPedidas ?? 0;
                    const base = almacenBaseline[med.cn]?.cajasPedidas ?? 0;
                    const changed = qty !== base;
                    const esExtra = extrasAlmacen.some((e) => e.cn === med.cn);
                    return (
                      <div key={med.cn} className="space-y-2">
                        {esExtra && (
                          <p className="text-xs font-semibold text-violet-700 px-1">✨ Nuevo sustituto (añadido ahora)</p>
                        )}
                        <AlmacenMedCard
                          med={med}
                          cantidadCajas={qty}
                          changed={changed}
                          index={presentacionIndex}
                          total={medicamentos.length}
                          onChange={(v) => setAlmacenDraft((prev) => ({ ...prev, [med.cn]: { cajasPedidas: v } }))}
                          onEditar={() => {
                            setSustitucionCnViejo(null);
                            setEdicionCn((cur) => (cur === med.cn ? null : med.cn));
                          }}
                          onSustituir={() => {
                            setEdicionCn(null);
                            setSustitucionCnViejo((cur) => (cur === med.cn ? null : med.cn));
                          }}
                          onToggleActivo={() => void handleMarcarInactivo(med.cn)}
                          inactivando={inactivandoCn === med.cn}
                          edicionAbierta={edicionCn === med.cn}
                          sustitucionAbierta={sustitucionCnViejo === med.cn}
                        />
                        {edicionCn === med.cn && (
                          <EditarPasilloPanel
                            med={med}
                            ubicaciones={data?.ubicaciones ?? []}
                            ubicacionActual={ubicacion ?? ''}
                            busy={editando}
                            onCancelar={() => setEdicionCn(null)}
                            onGuardar={(payload) => void handleGuardarEdicionPasillo(med.cn, payload)}
                          />
                        )}
                        {sustitucionCnViejo === med.cn && (
                          <SustituirPorPanel
                            cnViejo={med.cn}
                            nombreViejo={med.principioActivo ?? med.nombre}
                            busy={sustituyendo}
                            onCancelar={() => setSustitucionCnViejo(null)}
                            onConfirmar={(cnNuevo, cajas) => void handleConfirmarSustitucion(med.cn, cnNuevo, cajas)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        {!loading && (
          <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t-2 border-amber-200 shadow-lg px-4 py-4">
            <div className="max-w-2xl mx-auto flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="flex-1 text-sm text-slate-500">
                {almacenHasChanges ? (
                  <span className="font-semibold text-amber-700">⚠ Cambios sin guardar</span>
                ) : (
                  <span className="text-slate-400">Sin cambios pendientes</span>
                )}
              </div>
              <button
                onClick={() => void handleGuardarAlmacen()}
                disabled={saving || !almacenHasChanges || !almacenHasAnyQty}
                className="rounded-2xl bg-amber-600 px-8 py-4 text-xl font-extrabold text-white shadow-lg hover:bg-amber-700 active:scale-95 transition-all disabled:opacity-40"
              >
                {saving ? 'Guardando…' : '💾 Guardar pedido'}
              </button>
            </div>
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-base text-slate-500 font-semibold">
                  {medicamentos.length} medicamento{medicamentos.length !== 1 ? 's' : ''} activo{medicamentos.length !== 1 ? 's' : ''}
                </p>
                {(data?.faltantesActivosUbicacion ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => void handleIncorporarFaltantes('ubicacion')}
                    disabled={incorporando}
                    className="rounded-xl border-2 border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 active:scale-95 disabled:opacity-50"
                  >
                    {incorporando ? '…' : `➕ ${data?.faltantesActivosUbicacion} faltante(s) → stock 0`}
                  </button>
                )}
              </div>
              {medicamentos.map((med, idx) => {
                const val = draft[med.cn] ?? { cajas: 0, unidadesSueltas: 0 };
                const base = baseline[med.cn] ?? { cajas: 0, unidadesSueltas: 0 };
                const changed = recuentoLineaCambiada(med, val, base, Boolean(editadosCn[med.cn]));
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
    const medicamentos = (data?.medicamentos ?? []).filter((med) => med.activo);
    const repoHasAnyQty = medicamentos.some((med) => (repoDraft[med.cn]?.cantidadCajas ?? 0) > 0);
    const repoOverMaxCount = medicamentos.filter((med) => {
      const qty = repoDraft[med.cn]?.cantidadCajas ?? 0;
      return med.stockMaximo != null && qty > med.stockMaximo;
    }).length;

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
              const overMax = med.stockMaximo != null && qty > med.stockMaximo;
              return (
                <RepoMedCard key={med.cn} med={med} cantidadCajas={qty} changed={changed} overMax={overMax}
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
                {repoOverMaxCount > 0 ? (
                  <span className="font-semibold text-rose-600">
                    ⚠ {repoOverMaxCount} medicamento(s) superan stock máximo
                  </span>
                ) : repoHasChanges ? (
                  <span className="font-semibold text-orange-600">⚠ Cambios sin guardar en esta ubicación</span>
                ) : (
                  <span className="text-slate-400">Sin cambios pendientes</span>
                )}
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
      {med.unidadesPorCaja === 1 ? (
        /* Múltiplo 1: solo cajas, a pantalla completa */
        <div className="space-y-1">
          <label className="block text-sm font-bold text-slate-600 uppercase tracking-wider">📦 Cajas</label>
          <RecuentoCantidadInput
            value={val.cajas}
            onCommit={(cajas) => onChange({ cajas })}
            className="w-full rounded-xl border-2 border-slate-300 px-4 py-4 text-3xl font-bold text-center text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
          />
        </div>
      ) : (
        /* Múltiplo > 1: cajas + unidades sueltas */
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-sm font-bold text-slate-600 uppercase tracking-wider">📦 Cajas</label>
            <RecuentoCantidadInput
              value={val.cajas}
              onCommit={(cajas) => onChange({ cajas })}
              className="w-full rounded-xl border-2 border-slate-300 px-4 py-4 text-3xl font-bold text-center text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-bold text-slate-600 uppercase tracking-wider">💊 Uds. sueltas</label>
            <RecuentoCantidadInput
              value={val.unidadesSueltas}
              onCommit={(unidadesSueltas) => onChange({ unidadesSueltas })}
              className="w-full rounded-xl border-2 border-slate-300 px-4 py-4 text-3xl font-bold text-center text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
            />
            <p className="text-sm text-slate-400 text-center">(1 caja = {med.unidadesPorCaja} udes)</p>
          </div>
        </div>
      )}
      {changed && <p className="mt-3 text-sm font-semibold text-amber-600">✏ Modificado</p>}
    </div>
  );
}

/* ════════════════ Panel editar catálogo — solo almacén ════════════════ */
function EditarPasilloPanel({
  med,
  ubicaciones,
  ubicacionActual,
  busy,
  onCancelar,
  onGuardar,
}: {
  med: MedicamentoManual;
  ubicaciones: string[];
  ubicacionActual: string;
  busy: boolean;
  onCancelar: () => void;
  onGuardar: (payload: EditarPasilloPayload) => void;
}) {
  const [principioActivo, setPrincipioActivo] = useState(med.principioActivo ?? '');
  const [nombre, setNombre] = useState(med.nombre ?? '');
  const [presentacion, setPresentacion] = useState(med.presentacion ?? '');
  const [ubicacion, setUbicacion] = useState(med.ubicacion ?? ubicacionActual);
  const [udsCaja, setUdsCaja] = useState(
    med.unidadesPorCaja > 0 ? String(med.unidadesPorCaja) : ''
  );

  const opcionesUbicacion = useMemo(() => {
    const map = new Map<string, string>();
    for (const ub of ubicaciones) {
      const trimmed = ub.trim();
      if (!trimmed) continue;
      map.set(trimmed.toLocaleLowerCase('es'), trimmed);
    }
    const actual = (med.ubicacion ?? ubicacionActual).trim();
    if (actual) map.set(actual.toLocaleLowerCase('es'), actual);
    return [...map.values()].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }, [ubicaciones, med.ubicacion, ubicacionActual]);

  return (
    <div className="rounded-2xl border-2 border-teal-300 bg-teal-50 px-5 py-4 space-y-4">
      <div>
        <p className="text-sm font-bold text-teal-800 uppercase tracking-wide">✎ Editar en catálogo</p>
        <p className="text-sm text-teal-700 mt-1">
          CN {med.cn} — ajusta nomenclatura o ubicación sin cambiar el código. No consulta CIMA.
        </p>
      </div>
      <div className="space-y-3">
        <label className="block space-y-1">
          <span className="text-xs font-bold text-teal-800 uppercase">Principio activo</span>
          <input
            type="text"
            value={principioActivo}
            onChange={(e) => setPrincipioActivo(e.target.value)}
            className="w-full rounded-xl border-2 border-teal-200 bg-white px-4 py-3 text-base"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-bold text-teal-800 uppercase">Nombre / marca</span>
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="w-full rounded-xl border-2 border-teal-200 bg-white px-4 py-3 text-base"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-bold text-teal-800 uppercase">Presentación</span>
          <input
            type="text"
            value={presentacion}
            onChange={(e) => setPresentacion(e.target.value)}
            className="w-full rounded-xl border-2 border-teal-200 bg-white px-4 py-3 text-base"
          />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-xs font-bold text-teal-800 uppercase">Ubicación</span>
            <select
              value={ubicacion}
              onChange={(e) => setUbicacion(e.target.value)}
              className="w-full rounded-xl border-2 border-teal-200 bg-white px-4 py-3 text-base"
            >
              {opcionesUbicacion.map((ub) => (
                <option key={ub} value={ub}>{ub}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-bold text-teal-800 uppercase">Uds/caja</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={udsCaja}
              placeholder="—"
              onChange={(e) => setUdsCaja(e.target.value.replace(/[^\d]/g, ''))}
              className="w-full rounded-xl border-2 border-teal-200 bg-white px-4 py-3 text-base text-center"
            />
          </label>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 justify-end">
        <button
          type="button"
          onClick={onCancelar}
          disabled={busy}
          className="rounded-xl border-2 border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-600"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => onGuardar({
            principioActivo,
            nombre,
            presentacion,
            ubicacion,
            unidadesPorCaja: parseUdsCajaInput(udsCaja),
          })}
          disabled={busy || !nombre.trim() || !ubicacion.trim()}
          className="rounded-xl bg-teal-700 px-6 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? 'Guardando…' : 'Guardar en catálogo'}
        </button>
      </div>
    </div>
  );
}

/* ════════════════ Panel sustituir por — solo almacén ════════════════ */
function SustituirPorPanel({
  cnViejo,
  nombreViejo,
  busy,
  onCancelar,
  onConfirmar,
}: {
  cnViejo: string;
  nombreViejo: string;
  busy: boolean;
  onCancelar: () => void;
  onConfirmar: (cnNuevo: string, cajasPedidas: number) => void;
}) {
  const [cnNuevo, setCnNuevo] = useState('');
  const [cajas, setCajas] = useState(0);
  const [cima, setCima] = useState<CimaPreview | null>(null);
  const [buscandoCima, setBuscandoCima] = useState(false);

  const consultarCima = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      toast.error('Introduce el CN nuevo.');
      return;
    }
    setBuscandoCima(true);
    setCima(null);
    try {
      const res = await fetch(`/api/catalogo/cima?cn=${encodeURIComponent(trimmed)}`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'CN no encontrado en CIMA');
        return;
      }
      setCnNuevo(data.cn ?? trimmed);
      setCima({
        cn: data.cn,
        nombre: data.nombre,
        principioActivo: data.principioActivo,
        presentacion: data.presentacion,
        unidadesPorCajaInferidas: data.unidadesPorCajaInferidas,
      });
    } catch {
      toast.error('Error al consultar CIMA');
    } finally {
      setBuscandoCima(false);
    }
  };

  return (
    <div className="rounded-2xl border-2 border-violet-300 bg-violet-50 px-5 py-4 space-y-4">
      <div>
        <p className="text-sm font-bold text-violet-800 uppercase tracking-wide">↪ Sustituir por</p>
        <p className="text-sm text-violet-700 mt-1">
          CN {cnViejo} · {nombreViejo} — se dará de baja y se creará/activará el CN nuevo en esta ubicación.
        </p>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="numeric"
          placeholder="CN nuevo o código SAP"
          value={cnNuevo}
          onChange={(e) => { setCnNuevo(e.target.value.trim()); setCima(null); }}
          onBlur={() => { if (cnNuevo.trim()) void consultarCima(cnNuevo); }}
          className="flex-1 rounded-xl border-2 border-violet-200 px-4 py-3 text-lg font-mono focus:border-violet-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void consultarCima(cnNuevo)}
          disabled={buscandoCima || !cnNuevo.trim()}
          className="shrink-0 rounded-xl border-2 border-violet-400 bg-white px-4 py-3 text-sm font-bold text-violet-800 disabled:opacity-50"
        >
          {buscandoCima ? '…' : 'CIMA'}
        </button>
      </div>
      {cima && (
        <div className="rounded-xl bg-white border border-violet-200 px-4 py-3 text-sm space-y-1">
          <p className="font-bold text-slate-800">{cima.principioActivo || cima.nombre}</p>
          <p className="text-slate-500 italic">{cima.nombre}</p>
          {cima.presentacion && <p className="text-slate-600">{cima.presentacion}</p>}
          <p className="font-mono text-violet-700">CN {cima.cn}</p>
          {cima.unidadesPorCajaInferidas != null && (
            <p className="text-slate-500">Uds/caja: {cima.unidadesPorCajaInferidas}</p>
          )}
        </div>
      )}
      <div className="space-y-1">
        <label className="block text-sm font-bold text-violet-800">📦 Cajas a pedir del nuevo CN</label>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={cajas === 0 ? '' : cajas}
          placeholder="0"
          onChange={(e) => setCajas(toIntInput(e.target.value))}
          className="w-full rounded-xl border-2 border-violet-200 px-4 py-3 text-2xl font-bold text-center"
        />
      </div>
      <div className="flex flex-wrap gap-2 justify-end">
        <button
          type="button"
          onClick={onCancelar}
          disabled={busy}
          className="rounded-xl border-2 border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-600"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => onConfirmar(cnNuevo, cajas)}
          disabled={busy || !cima || !cnNuevo.trim()}
          className="rounded-xl bg-violet-700 px-6 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? 'Sustituyendo…' : 'Confirmar sustitución'}
        </button>
      </div>
    </div>
  );
}

/* ════════════════ Tarjeta de medicamento — pedido almacén ════════════════ */
function AlmacenMedCard({
  med, cantidadCajas, changed, index, total, onChange, onEditar, onSustituir, onToggleActivo, inactivando,
  edicionAbierta, sustitucionAbierta,
}: {
  med: MedicamentoManual; cantidadCajas: number; changed: boolean;
  index: number; total: number; onChange: (v: number) => void;
  onEditar?: () => void;
  onSustituir?: () => void;
  onToggleActivo?: () => void;
  inactivando?: boolean;
  edicionAbierta?: boolean;
  sustitucionAbierta?: boolean;
}) {
  const hints: string[] = [];
  if (med.stockMinimo != null) hints.push(`mín ${med.stockMinimo}`);
  if (med.puntoPedido != null) hints.push(`pto ${med.puntoPedido}`);
  if (med.stockMaximo != null) hints.push(`máx ${med.stockMaximo}`);

  const pendientes = med.pedidosPendientes ?? 0;
  const udsPendientes = med.unidadesPendientes ?? 0;

  return (
    <div className={`rounded-2xl border-2 bg-slate-50 px-4 py-4 transition-all ${
      changed ? 'border-amber-400 bg-amber-50/60' : 'border-slate-200'
    }`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold text-slate-800 leading-tight">{med.nombre}</p>
          {med.presentacion && (
            <p className="text-sm text-slate-600 mt-0.5 line-clamp-2">{med.presentacion}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="font-mono text-sm bg-white text-slate-500 rounded-lg px-2 py-1 border border-slate-200">
              CN {med.cn}
            </span>
            <BadgeSuministro alerta={med.alertaSuministro} className="max-w-[9rem]" />
            {onToggleActivo && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wide">Activo</span>
                <button
                  type="button"
                  onClick={onToggleActivo}
                  disabled={inactivando}
                  title="Desliza para marcar inactivo en catálogo"
                  aria-label="Activo"
                  className={cn(
                    'inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
                    med.activo !== false ? 'bg-teal-500' : 'bg-slate-300',
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform',
                      med.activo !== false ? 'translate-x-4' : 'translate-x-1',
                    )}
                  />
                </button>
              </div>
            )}
          </div>
          <span className="text-xs text-slate-400">{index}/{total}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3 text-xs">
        <p className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-emerald-800">
          <span className="font-semibold">Recibido 2 sem:</span>{' '}
          {textoRecibidoAlmacen(med)}
        </p>
        <p className="rounded-lg bg-sky-50 border border-sky-100 px-3 py-2 text-sky-800">
          <span className="font-semibold">En tránsito:</span>{' '}
          {pendientes} pedido{pendientes !== 1 ? 's' : ''}, {formatUnidadesPedido(udsPendientes)} uds
        </p>
      </div>

      {hints.length > 0 && (
        <p className="text-xs text-teal-700 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2 mb-3">
          📊 Referencia de stock (cajas): {hints.join(' · ')}
        </p>
      )}

      <div className="space-y-1">
        <label className="block text-sm font-bold text-amber-700 uppercase tracking-wider">📦 Cajas a pedir</label>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={cantidadCajas === 0 ? '' : cantidadCajas}
          placeholder="0"
          onChange={(e) => onChange(toIntInput(e.target.value))}
          className="w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-2xl font-bold text-center text-slate-800 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200 bg-white"
        />
        {med.unidadesPorCaja > 0 ? (
          <p className="text-sm text-slate-400 text-center">1 caja = {med.unidadesPorCaja} uds</p>
        ) : (
          <p className="text-sm text-slate-400 text-center">Uds/caja sin definir</p>
        )}
      </div>
      {changed && <p className="mt-2 text-sm font-semibold text-amber-600">✏ Modificado</p>}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {onEditar && (
          <button
            type="button"
            onClick={onEditar}
            className={`rounded-xl border-2 px-4 py-3 text-sm font-bold transition-colors ${
              edicionAbierta
                ? 'border-teal-500 bg-teal-100 text-teal-800'
                : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:text-teal-700'
            }`}
          >
            ✎ Editar datos
          </button>
        )}
        {onSustituir && (
          <button
            type="button"
            onClick={onSustituir}
            className={`rounded-xl border-2 px-4 py-3 text-sm font-bold transition-colors ${
              sustitucionAbierta
                ? 'border-violet-500 bg-violet-100 text-violet-800'
                : 'border-slate-200 bg-white text-slate-600 hover:border-violet-300 hover:text-violet-700'
            }`}
          >
            ↪ Sustituir por otro CN
          </button>
        )}
      </div>
    </div>
  );
}

/* ════════════════ Tarjeta de medicamento — reposición ════════════════ */
function RepoMedCard({
  med, cantidadCajas, changed, overMax, index, total, onChange,
}: {
  med: MedicamentoManual; cantidadCajas: number; changed: boolean;
  overMax: boolean;
  index: number; total: number; onChange: (v: number) => void;
}) {
  return (
    <div className={`rounded-2xl border-2 bg-white px-5 py-4 shadow-sm transition-all ${
      overMax ? 'border-rose-400 bg-rose-50' : changed ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200'
    }`}>
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
        <label className={`block text-sm font-bold uppercase tracking-wider ${
          overMax ? 'text-rose-600' : changed ? 'text-emerald-600' : 'text-orange-600'
        }`}>📦 Cajas a pedir</label>
        <input type="number" inputMode="numeric" min={0} step={1}
          value={cantidadCajas === 0 ? '' : cantidadCajas} placeholder="0"
          onChange={(e) => onChange(toIntInput(e.target.value))}
          className={`w-full rounded-xl border-2 px-4 py-4 text-3xl font-bold text-center focus:outline-none focus:ring-2 ${
            overMax
              ? 'border-rose-300 text-rose-700 focus:border-rose-500 focus:ring-rose-200'
              : 'border-slate-300 text-slate-800 focus:border-orange-500 focus:ring-orange-200'
          }`} />
      </div>
      {overMax ? (
        <p className="mt-3 text-sm font-semibold text-rose-600">
          ⚠ Supera stock máximo ({med.stockMaximo} cajas)
        </p>
      ) : changed ? (
        <p className="mt-3 text-sm font-semibold text-emerald-600">✔ Cantidad añadida</p>
      ) : null}
    </div>
  );
}
