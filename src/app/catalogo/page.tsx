'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { cn, formatCajas, formatEuro, formatMseLabel, isMSE, parseCajasInput, roundCajas } from '@/lib/utils';
import { toSapCode } from '@/lib/propuesta';
import { ALMACEN_UBICACIONES } from '@/lib/almacen';

interface Medicamento {
  cn: string; nombre: string; principioActivo: string | null;
  presentacion?: string | null;
  via: string | null; area: string; ubicacion: string | null;
  unidadesPorCaja: number; activo: boolean; comprable: boolean;
  mse: boolean; tipoMse: string | null;
  precioUnidad: number | null; precioCaja: number | null;
  stockMinimo: number | null; puntoPedido: number | null; stockMaximo: number | null;
  ppioActivoCima: string | null; cimaConsultado: boolean;
}

type SortKey = 'principioActivo' | 'nombre' | 'cn' | 'ubicacion' | 'puntoPedido';
type SortDir = 'asc' | 'desc';

type RevisionPendiente = {
  id: number;
  cn: string;
  cnAnterior: string | null;
  origen: string;
  ubicacion: string | null;
  nombreCima: string | null;
  principioActivoCima: string | null;
  presentacionCima: string | null;
  unidadesPorCaja: number | null;
  creadoEn: string;
};

type EditForm = Omit<Partial<Medicamento>, 'stockMinimo' | 'puntoPedido' | 'stockMaximo'> & {
  stockMinimo?: number | '' | null;
  puntoPedido?: number | '' | null;
  stockMaximo?: number | '' | null;
  clearStockObjetivo?: boolean;
};

const VIA_BADGE: Record<string, string> = {
  IV:   'bg-blue-100 text-blue-700',
  ORAL: 'bg-teal-100 text-teal-700',
  OTRO: 'bg-slate-100 text-slate-600',
};

const NUEVO_EMPTY = {
  cn: '', nombre: '', principioActivo: '', presentacion: '', via: 'IV' as string,
  ubicacion: '', unidadesPorCaja: 1, comprable: true,
  stockMinimo: '' as number | '', puntoPedido: '' as number | '', stockMaximo: '' as number | '',
};

const NUEVO_ALMACEN_EMPTY = {
  ...NUEVO_EMPTY,
  via: 'OTRO',
  stockMinimo: '' as number | '',
  puntoPedido: '' as number | '',
  stockMaximo: '' as number | '',
};

function SortIcon({ dir }: { dir: SortDir | null }) {
  if (!dir) return (
    <svg className="h-3 w-3 ml-1 text-slate-300" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4M16 15l-4 4-4-4" />
    </svg>
  );
  return dir === 'asc' ? (
    <svg className="h-3 w-3 ml-1 text-teal-600" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
    </svg>
  ) : (
    <svg className="h-3 w-3 ml-1 text-teal-600" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

export default function CatalogoPage() {
  const [meds, setMeds] = useState<Medicamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterUbicacion, setFilterUbicacion] = useState('');
  const [filterActivo, setFilterActivo] = useState('');
  const [importing, setImporting] = useState(false);
  const [cimaEnriqueciendo, setCimaEnriqueciendo] = useState(false);
  const [cimaResultado, setCimaResultado] = useState<{ actualizados: number; fallidos: number; total: number } | null>(null);
  const [editingCn, setEditingCn] = useState<string | null>(null);
  const [editData, setEditData] = useState<EditForm>({});
  const [sortKey, setSortKey] = useState<SortKey>('principioActivo');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [showNuevo, setShowNuevo] = useState(false);
  const [omitidos, setOmitidos] = useState<Array<{ cn: string; nombre: string; areaExistente: string }>>([]);
  const [importErrores, setImportErrores] = useState<string[]>([]);
  const importingRef = useRef(false);
  const [movingCn, setMovingCn] = useState<string | null>(null);
  const [nuevoData, setNuevoData] = useState({ ...NUEVO_EMPTY });
  const [savingNuevo, setSavingNuevo] = useState(false);
  const [cimaBuscando, setCimaBuscando] = useState(false);
  const [revisionPendiente, setRevisionPendiente] = useState<RevisionPendiente[]>([]);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [marcandoRevisionId, setMarcandoRevisionId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const getArea = () => {
    if (typeof document === 'undefined') return 'oncologia';
    return document.cookie.split(';').find(c => c.trim().startsWith('area_session='))?.split('=')[1] ?? 'oncologia';
  };

  const esAlmacen = getArea() === 'almacen';
  const esNutricion = getArea() === 'nutricion';

  const formatStockCell = (value: number | null | undefined) => {
    if (value == null) return '—';
    return esNutricion ? formatCajas(value) : String(value);
  };

  const parseStockField = (value: string): number | '' => {
    if (value === '') return '';
    if (esNutricion) return parseCajasInput(value) ?? '';
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : '';
  };

  const normalizeStockNumber = (value: number | '' | null | undefined): number | null => {
    if (value === '' || value == null) return null;
    return esNutricion ? roundCajas(Number(value)) : Math.round(Number(value));
  };

  const fetchMeds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/medicamentos?area=${getArea()}`);
      setMeds(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRevisionPendiente = useCallback(async () => {
    if (getArea() !== 'almacen') {
      setRevisionPendiente([]);
      return;
    }
    setRevisionLoading(true);
    try {
      const res = await fetch('/api/catalogo/revision-pendiente', { cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo cargar revisiones pendientes.');
      setRevisionPendiente(Array.isArray(payload.items) ? payload.items : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setRevisionLoading(false);
    }
  }, []);

  const marcarRevisionRevisada = async (id: number) => {
    setMarcandoRevisionId(id);
    try {
      const res = await fetch('/api/catalogo/revision-pendiente', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo marcar como revisado.');
      toast.success('Sustitución revisada y confirmada en catálogo.');
      setRevisionPendiente((prev) => prev.filter((it) => it.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setMarcandoRevisionId(null);
    }
  };

  const localizarCnEnCatalogo = (cn: string) => {
    setSearch(cn);
    setFilterActivo('');
    setFilterUbicacion('');
    toast.message(`Filtrado por CN ${cn}. Comprueba los datos en la tabla.`);
  };

  useEffect(() => { void fetchMeds(); void loadRevisionPendiente(); }, [fetchMeds, loadRevisionPendiente]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const q = (params.get('q') ?? '').trim();
    if (q) setSearch(q);
  }, []);

  const ubicacionesUnicas = useMemo(() => {
    if (esAlmacen) return [...ALMACEN_UBICACIONES];
    return Array.from(new Set(meds.map(m => m.ubicacion).filter(Boolean) as string[])).sort();
  }, [meds, esAlmacen]);

  const buscarCimaPorCn = async (cn: string) => {
    const trimmed = cn.trim();
    if (!trimmed) {
      toast.error('Introduce un CN o código SAP.');
      return;
    }
    setCimaBuscando(true);
    try {
      const res = await fetch(`/api/catalogo/cima?cn=${encodeURIComponent(trimmed)}`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'CN no encontrado en CIMA');
        return;
      }
      setNuevoData((prev) => ({
        ...prev,
        cn: data.cn || trimmed,
        nombre: data.nombre || prev.nombre,
        principioActivo: data.principioActivo || prev.principioActivo,
        presentacion: data.presentacion || prev.presentacion,
        unidadesPorCaja: data.unidadesPorCajaInferidas ?? prev.unidadesPorCaja,
      }));
      toast.success(`Datos cargados desde CIMA (CN ${data.cn})`);
    } catch {
      toast.error('Error al consultar CIMA');
    } finally {
      setCimaBuscando(false);
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const cerrarInformeImportacion = () => {
    setOmitidos([]);
    setImportErrores([]);
  };

  const copiarErroresImportacion = async () => {
    if (importErrores.length === 0) return;
    try {
      await navigator.clipboard.writeText(importErrores.join('\n'));
      toast.success('Errores copiados al portapapeles.');
    } catch {
      toast.error('No se pudieron copiar los errores.');
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || importingRef.current) return;
    importingRef.current = true;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('area', getArea());
      const res = await fetch('/api/catalogo/importar', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Error al importar');
        if (Array.isArray(data.errores) && data.errores.length > 0) {
          setImportErrores(data.errores.map((msg: unknown) => String(msg)));
        }
        return;
      }
      const errores = Array.isArray(data.errores) ? data.errores.map((msg: unknown) => String(msg)) : [];
      const omitidosImport = Array.isArray(data.omitidos) ? data.omitidos : [];
      setImportErrores(errores);
      setOmitidos(omitidosImport);
      toast.success(`Importado: ${data.insertados} nuevos, ${data.actualizados} actualizados (${data.via})`);
      if (errores.length > 0) {
        toast.warning(`${errores.length} fila(s) no importadas — revisa el informe debajo del encabezado.`);
      }
      if (omitidosImport.length > 0) {
        toast.message(`${omitidosImport.length} CN en otra área — resuélvelos en el panel de conflictos.`);
      }
      await fetchMeds();
    } catch { toast.error('Error de conexión'); }
    finally {
      importingRef.current = false;
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const moverConflictoAAreaActual = async (item: { cn: string; nombre: string; areaExistente: string }) => {
    const ok = confirm(
      `El CN ${item.cn} está en el área "${item.areaExistente}".\n\n¿Quieres moverlo al área activa (${getArea()})?`
    );
    if (!ok) return;

    setMovingCn(item.cn);
    try {
      const res = await fetch('/api/catalogo/conflictos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cn: item.cn, accion: 'mover-a-area-actual' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'No se pudo mover el CN.');

      setOmitidos((prev) => prev.filter((o) => o.cn !== item.cn));
      toast.success(
        `CN ${item.cn} movido de ${item.areaExistente} a ${getArea()}. Vuelve a importar el Excel para actualizar sus datos en esta área.`
      );
      await fetchMeds();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setMovingCn(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const base = meds.filter(m => {
      const matchSearch = !q || m.principioActivo?.toLowerCase().includes(q) || m.nombre.toLowerCase().includes(q) || m.cn.includes(q);
      const matchUbicacion = !filterUbicacion || (m.ubicacion ?? '') === filterUbicacion;
      const matchActivo = !filterActivo || (filterActivo === 'si' ? m.activo : !m.activo);
      return matchSearch && matchUbicacion && matchActivo;
    });

    return [...base].sort((a, b) => {
      let av: string | number | null = null;
      let bv: string | number | null = null;
      if (sortKey === 'principioActivo') { av = a.principioActivo ?? ''; bv = b.principioActivo ?? ''; }
      else if (sortKey === 'nombre') { av = a.nombre; bv = b.nombre; }
      else if (sortKey === 'cn') { av = a.cn; bv = b.cn; }
      else if (sortKey === 'ubicacion') { av = a.ubicacion ?? ''; bv = b.ubicacion ?? ''; }
      else if (sortKey === 'puntoPedido') { av = a.puntoPedido ?? 0; bv = b.puntoPedido ?? 0; }

      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv), 'es', { sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [meds, search, filterUbicacion, filterActivo, sortKey, sortDir]);

  const handleEnriquecerCima = async (soloVacios = true) => {
    setCimaEnriqueciendo(true);
    setCimaResultado(null);
    try {
      const res = await fetch('/api/catalogo/enriquecer-cima', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ soloVacios }),
      });
      const data = await res.json() as { actualizados: number; fallidos: number; total: number; error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Error en el servidor al consultar CIMA'); return; }
      setCimaResultado(data);
      if (data.actualizados > 0) {
        toast.success(`CIMA: ${data.actualizados} medicamentos enriquecidos`);
        fetchMeds();
      } else if (data.fallidos > 0) {
        toast.info(`CIMA consultado: ${data.fallidos} CNs no encontrados en la base de datos de AEMPS`);
        fetchMeds();
      } else {
        toast.info('CIMA: ningún medicamento nuevo encontrado');
      }
    } catch {
      toast.error('Error de red — el servidor no ha podido completar la consulta a CIMA (puede ser un timeout)');
    } finally {
      setCimaEnriqueciendo(false);
    }
  };

  const handleCopiarCodigosSap = async () => {
    const source = filtered;
    const cns = [...new Set(
      source
        .map((m) => m.cn?.trim())
        .filter((cn): cn is string => Boolean(cn))
    )].sort((a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }));

    if (cns.length === 0) {
      toast.warning('No hay códigos en catálogo para copiar.');
      return;
    }

    const texto = cns.map((cn) => toSapCode(cn)).join('\n');

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = texto;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!ok) throw new Error('No se pudo copiar');
      }

      toast.success(`Copiados ${cns.length} códigos SAP ${source.length === meds.length ? '(todos)' : '(filtrados)'}.`);
    } catch {
      toast.error('No se pudieron copiar los códigos SAP.');
    }
  };

  const handleToggleActivo = async (med: Medicamento) => {
    const res = await fetch(`/api/medicamentos/${med.cn}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo: !med.activo }),
    });
    if (res.ok) {
      setMeds(prev => prev.map(m => m.cn === med.cn ? { ...m, activo: !m.activo } : m));
    } else { toast.error('Error al actualizar'); }
  };

  const startEdit = (med: Medicamento) => {
    setEditingCn(med.cn);
    setEditData({
      nombre: med.nombre,
      principioActivo: med.principioActivo ?? '',
      presentacion: med.presentacion ?? '',
      ubicacion: med.ubicacion ?? '',
      unidadesPorCaja: med.unidadesPorCaja,
      comprable: med.comprable,
      tipoMse: med.tipoMse ?? '',
      stockMinimo: med.stockMinimo ?? (esAlmacen ? '' : 0),
      puntoPedido: med.puntoPedido ?? (esAlmacen ? '' : 0),
      stockMaximo: med.stockMaximo != null ? med.stockMaximo : (esAlmacen ? '' : undefined),
      clearStockObjetivo: false,
    });
  };

  const handleDelete = async (med: Medicamento) => {
    if (!confirm(`¿Eliminar "${med.principioActivo ?? med.nombre}" (CN: ${med.cn})?\nEsta acción no se puede deshacer.`)) return;
    const res = await fetch(`/api/medicamentos/${med.cn}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Medicamento eliminado.');
      setMeds(prev => prev.filter(m => m.cn !== med.cn));
    } else {
      toast.error('Error al eliminar.');
    }
  };

  const saveEdit = async () => {
    if (!editingCn) return;
    const payload: Record<string, unknown> = { ...editData };
    if (esAlmacen) {
      const sinStock =
        (payload.stockMinimo === '' || payload.stockMinimo == null) &&
        (payload.puntoPedido === '' || payload.puntoPedido == null) &&
        (payload.stockMaximo === '' || payload.stockMaximo == null);
      if (sinStock) {
        payload.clearStockObjetivo = true;
        delete payload.stockMinimo;
        delete payload.puntoPedido;
        delete payload.stockMaximo;
      } else {
        if (payload.stockMinimo === '') payload.stockMinimo = 0;
        if (payload.puntoPedido === '') payload.puntoPedido = 0;
        if (payload.stockMaximo === '') payload.stockMaximo = null;
      }
    } else if (esNutricion) {
      if (payload.stockMinimo !== '' && payload.stockMinimo != null) {
        payload.stockMinimo = normalizeStockNumber(payload.stockMinimo as number);
      }
      if (payload.puntoPedido !== '' && payload.puntoPedido != null) {
        payload.puntoPedido = normalizeStockNumber(payload.puntoPedido as number);
      }
      if (payload.stockMaximo !== '' && payload.stockMaximo != null) {
        payload.stockMaximo = normalizeStockNumber(payload.stockMaximo as number);
      }
    }
    const res = await fetch(`/api/medicamentos/${editingCn}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) { toast.success('Guardado'); setEditingCn(null); fetchMeds(); }
    else { toast.error('Error al guardar'); }
  };

  const buildStockPayload = (data: typeof nuevoData) => {
    if (!esAlmacen) {
      return {
        stockMinimo: data.stockMinimo === '' ? 0 : (normalizeStockNumber(data.stockMinimo) ?? 0),
        puntoPedido: data.puntoPedido === '' ? 0 : (normalizeStockNumber(data.puntoPedido) ?? 0),
        stockMaximo: data.stockMaximo === '' ? null : normalizeStockNumber(data.stockMaximo),
      };
    }
    const tieneAlguno =
      data.stockMinimo !== '' || data.puntoPedido !== '' || data.stockMaximo !== '';
    if (!tieneAlguno) return {};
    return {
      stockMinimo: data.stockMinimo === '' ? 0 : Number(data.stockMinimo),
      puntoPedido: data.puntoPedido === '' ? 0 : Number(data.puntoPedido),
      stockMaximo: data.stockMaximo === '' ? null : Number(data.stockMaximo),
    };
  };

  const handleNuevoSubmit = async () => {
    if (!nuevoData.cn.trim() || !nuevoData.nombre.trim()) {
      toast.error('CN y Nombre son obligatorios.');
      return;
    }
    setSavingNuevo(true);
    try {
      const res = await fetch('/api/medicamentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...nuevoData,
          area: getArea(),
          ...buildStockPayload(nuevoData),
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Error al crear medicamento'); return; }
      toast.success('Medicamento creado correctamente.');
      setShowNuevo(false);
      setNuevoData(esAlmacen ? { ...NUEVO_ALMACEN_EMPTY } : { ...NUEVO_EMPTY });
      fetchMeds();
    } catch { toast.error('Error de conexión'); }
    finally { setSavingNuevo(false); }
  };

  const activos = meds.filter(m => m.activo).length;
  const mseCount = meds.filter(m => isMSE(m.cn)).length;

  const thSort = (key: SortKey, label: string, align: 'left' | 'center' = 'left') => (
    <th
      className={`px-4 py-3 text-${align} cursor-pointer select-none group`}
      onClick={() => handleSort(key)}
    >
      <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-slate-500 uppercase tracking-wide group-hover:text-teal-700 transition-colors">
        {label}
        <SortIcon dir={sortKey === key ? sortDir : null} />
      </span>
    </th>
  );

  return (
    <div>
      {/* Cabecera */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Catálogo de medicamentos</h1>
          <p className="text-sm text-slate-500">
            {meds.length} medicamentos · {activos} activos · {mseCount} MSE
            {esAlmacen && ' · Stocks opcionales (orientativos en pedido)'}
            {esNutricion && ' · Importación: SAP, Producto, Vía, Uds/caja, stock mín/máx (cajas o udes) · visualización en cajas con 1 decimal'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
          <button
            onClick={handleCopiarCodigosSap}
            disabled={loading || meds.length === 0}
            className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Copia todos los códigos SAP (14+CN) del catálogo del área"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75A1.125 1.125 0 013.75 20.625V7.5c0-.621.504-1.125 1.125-1.125H8.25m7.5-3.375h4.5c.621 0 1.125.504 1.125 1.125v13.125c0 .621-.504 1.125-1.125 1.125h-9.75A1.125 1.125 0 019.375 17.25V4.125c0-.621.504-1.125 1.125-1.125h5.25z" />
            </svg>
            Copiar códigos SAP
          </button>
          <button
            onClick={() => handleEnriquecerCima()}
            disabled={cimaEnriqueciendo || loading || meds.length === 0}
            className="flex items-center gap-2 rounded-lg border border-violet-300 px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Consulta la API de CIMA (AEMPS) para obtener el principio activo oficial de cada CN"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
            {cimaEnriqueciendo ? 'Consultando CIMA…' : 'Enriquecer desde CIMA'}
          </button>
          <button
            onClick={() => { setNuevoData(esAlmacen ? { ...NUEVO_ALMACEN_EMPTY } : { ...NUEVO_EMPTY }); setShowNuevo(true); }}
            className="flex items-center gap-2 rounded-lg border border-teal-600 px-4 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nuevo medicamento
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            {importing ? 'Importando…' : 'Importar Excel'}
          </button>
        </div>
      </div>

      {(importErrores.length > 0 || omitidos.length > 0) && (
        <div className="mb-4 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-900">Informe de la última importación</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Permanece visible hasta que pulses «Cerrar informe». Puedes tramitar los conflictos de área desde aquí.
              </p>
            </div>
            <button
              type="button"
              onClick={cerrarInformeImportacion}
              className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
            >
              Cerrar informe
            </button>
          </div>

          {importErrores.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-white p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-amber-800">
                  Filas no importadas ({importErrores.length})
                </p>
                <button
                  type="button"
                  onClick={() => void copiarErroresImportacion()}
                  className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                >
                  Copiar listado
                </button>
              </div>
              <textarea
                readOnly
                value={importErrores.join('\n')}
                className="h-40 w-full rounded border border-amber-200 bg-amber-50/50 p-2 text-xs text-slate-700 font-mono"
              />
            </div>
          )}

          {omitidos.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-white p-3">
              <p className="text-sm font-semibold text-amber-800 mb-2">
                {omitidos.length} medicamento{omitidos.length > 1 ? 's' : ''} en otra área
              </p>
              <ul className="space-y-2 max-h-72 overflow-y-auto">
                {omitidos.map((o) => (
                  <li key={o.cn} className="text-xs text-amber-900 bg-amber-50 rounded px-3 py-2 border border-amber-100">
                    <div className="font-mono">
                      <span className="font-semibold">{o.cn}</span>
                      {' — '}
                      <span>{o.nombre}</span>
                      <span className="ml-2 text-amber-700">(área: {o.areaExistente})</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.preventDefault();
                          ev.stopPropagation();
                          void moverConflictoAAreaActual(o);
                        }}
                        disabled={movingCn === o.cn}
                        className="rounded border border-teal-300 bg-white px-2 py-1 text-[11px] font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50"
                      >
                        {movingCn === o.cn ? 'Moviendo…' : 'Mover a esta área'}
                      </button>
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.preventDefault();
                          ev.stopPropagation();
                          setOmitidos((prev) => prev.filter((x) => x.cn !== o.cn));
                        }}
                        disabled={movingCn === o.cn}
                        className="rounded border border-amber-300 bg-white px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                      >
                        Dejar en área actual
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Resultado CIMA */}
      {cimaResultado && (
        <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm text-violet-800 flex items-center justify-between gap-4">
          <span>
            CIMA: <span className="font-semibold">{cimaResultado.actualizados}</span> principios activos actualizados
            {cimaResultado.fallidos > 0 && <span className="text-violet-600"> · {cimaResultado.fallidos} no encontrados</span>}
            {' '}de {cimaResultado.total} CNs consultados.
          </span>
          <button onClick={() => setCimaResultado(null)} className="text-violet-400 hover:text-violet-700">✕</button>
        </div>
      )}

      {esAlmacen ? (
        <section className="mb-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Pendiente de revisar</h2>
              <p className="text-xs text-slate-500">
                Sustituciones hechas en el pasillo con datos de CIMA. Comprueba que el catálogo coincide y marca como revisado.
              </p>
            </div>
            {revisionPendiente.length > 0 ? (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                {revisionPendiente.length} pendiente{revisionPendiente.length === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>

          <div className="rounded-xl border border-amber-200 bg-white overflow-x-auto shadow-sm">
            {revisionLoading ? (
              <p className="px-4 py-6 text-sm text-slate-500">Cargando revisiones pendientes…</p>
            ) : revisionPendiente.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500 text-center">
                No hay sustituciones pendientes de revisar.
              </p>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-amber-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Fecha</th>
                    <th className="px-3 py-2 text-left">CN nuevo</th>
                    <th className="px-3 py-2 text-left">Sustituye a</th>
                    <th className="px-3 py-2 text-left">Ubicación</th>
                    <th className="px-3 py-2 text-left">Datos CIMA</th>
                    <th className="px-3 py-2 text-left">En catálogo</th>
                    <th className="px-3 py-2 text-right">Uds/caja</th>
                    <th className="px-3 py-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {revisionPendiente.map((it) => {
                    const enCatalogo = meds.find((m) => m.cn === it.cn);
                    return (
                      <tr key={it.id} className="border-t border-slate-100 hover:bg-slate-50 align-top">
                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                          {new Date(it.creadoEn).toLocaleString('es-ES', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="px-3 py-2 font-mono font-semibold text-slate-800">{it.cn}</td>
                        <td className="px-3 py-2 font-mono text-slate-600">{it.cnAnterior ?? '—'}</td>
                        <td className="px-3 py-2 text-slate-700">{it.ubicacion ?? '—'}</td>
                        <td className="px-3 py-2 text-slate-700 max-w-xs">
                          <p className="font-medium">{it.nombreCima ?? '—'}</p>
                          {it.principioActivoCima ? (
                            <p className="text-xs text-slate-500">{it.principioActivoCima}</p>
                          ) : null}
                          {it.presentacionCima ? (
                            <p className="text-xs text-slate-500">{it.presentacionCima}</p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-slate-700 max-w-xs">
                          {enCatalogo ? (
                            <>
                              <p className="font-medium">{enCatalogo.nombre}</p>
                              <p className="text-xs text-slate-500">{enCatalogo.principioActivo ?? '—'}</p>
                              <p className="text-xs text-slate-500">{enCatalogo.presentacion ?? '—'}</p>
                              {!enCatalogo.activo ? (
                                <p className="text-xs font-semibold text-red-600 mt-1">CN inactivo en catálogo</p>
                              ) : null}
                            </>
                          ) : (
                            <p className="text-xs font-semibold text-red-600">No encontrado en catálogo</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700">
                          {it.unidadesPorCaja ?? '—'}
                          {enCatalogo && it.unidadesPorCaja != null && enCatalogo.unidadesPorCaja !== it.unidadesPorCaja ? (
                            <p className="text-xs text-amber-700">Cat.: {enCatalogo.unidadesPorCaja}</p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => localizarCnEnCatalogo(it.cn)}
                              className="rounded-lg border border-teal-300 px-2 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-50"
                            >
                              Localizar
                            </button>
                            <button
                              type="button"
                              onClick={() => marcarRevisionRevisada(it.id)}
                              disabled={marcandoRevisionId === it.id}
                              className="rounded-lg border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                            >
                              {marcandoRevisionId === it.id ? 'Guardando…' : 'Marcar revisado'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      ) : null}

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre, principio activo o CN…"
          className="flex-1 min-w-[220px] rounded-lg border border-slate-200 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <select value={filterUbicacion} onChange={e => setFilterUbicacion(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white">
          <option value="">Todas las ubicaciones</option>
          {ubicacionesUnicas.map((ubic) => (
            <option key={ubic} value={ubic}>
              {ubic}
            </option>
          ))}
        </select>
        <select value={filterActivo} onChange={e => setFilterActivo(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white">
          <option value="">Todos</option>
          <option value="si">Activos</option>
          <option value="no">Inactivos</option>
        </select>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm">Cargando catálogo…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <svg className="h-10 w-10 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth="1" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
            <p className="font-medium">Sin resultados</p>
            <p className="text-xs mt-1">Importa un catálogo Excel o ajusta los filtros</p>
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {thSort('cn', 'CN')}
                {thSort('principioActivo', 'Principio activo')}
                {thSort('nombre', 'Nombre / Marca')}
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Vía</th>
                {thSort('ubicacion', 'Ubicación')}
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Uds/caja</th>
                {esAlmacen && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Presentación</th>
                )}
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Mín{esAlmacen ? ' (opt.)' : ''}
                </th>
                {thSort('puntoPedido', esAlmacen ? 'Pto.Ped (opt.)' : 'Pto.Ped', 'center')}
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Máx{esAlmacen ? ' (opt.)' : ''}
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Precio/caja</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Activo</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(med => (
                editingCn === med.cn ? (
                  <tr key={med.cn} className="bg-teal-50">
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{med.cn}</td>
                    <td className="px-4 py-2">
                      <input className="w-full rounded border border-slate-300 px-2 py-1 text-xs" value={editData.principioActivo ?? ''} onChange={e => setEditData(p => ({ ...p, principioActivo: e.target.value }))} />
                    </td>
                    <td className="px-4 py-2">
                      <input className="w-full rounded border border-slate-300 px-2 py-1 text-xs" value={editData.nombre ?? ''} onChange={e => setEditData(p => ({ ...p, nombre: e.target.value }))} />
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{med.via}</td>
                    <td className="px-4 py-2">
                      <UbicacionSelect
                        value={editData.ubicacion ?? ''}
                        onChange={v => setEditData(p => ({ ...p, ubicacion: v }))}
                        opciones={ubicacionesUnicas}
                      />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input type="number" className="w-16 rounded border border-slate-300 px-2 py-1 text-xs text-center" value={editData.unidadesPorCaja ?? ''} onChange={e => setEditData(p => ({ ...p, unidadesPorCaja: Number(e.target.value) }))} />
                    </td>
                    {esAlmacen && (
                      <td className="px-4 py-2">
                        <input className="w-full rounded border border-slate-300 px-2 py-1 text-xs" value={String(editData.presentacion ?? '')} onChange={e => setEditData(p => ({ ...p, presentacion: e.target.value }))} />
                      </td>
                    )}
                    <td className="px-4 py-2 text-center">
                      <input type="number" step={esNutricion ? 0.1 : 1} min={0} className="w-16 rounded border border-slate-300 px-2 py-1 text-xs text-center" placeholder={esAlmacen ? '—' : undefined} value={editData.stockMinimo === '' ? '' : (editData.stockMinimo ?? '')} onChange={e => setEditData(p => ({ ...p, stockMinimo: parseStockField(e.target.value) }))} />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input type="number" step={esNutricion ? 0.1 : 1} min={0} className="w-14 rounded border border-slate-300 px-2 py-1 text-xs text-center" placeholder={esAlmacen ? '—' : undefined} value={editData.puntoPedido === '' ? '' : (editData.puntoPedido ?? '')} onChange={e => setEditData(p => ({ ...p, puntoPedido: parseStockField(e.target.value) }))} />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input type="number" step={esNutricion ? 0.1 : 1} min={0} className="w-14 rounded border border-slate-300 px-2 py-1 text-xs text-center" placeholder={esAlmacen ? '—' : undefined} value={editData.stockMaximo === '' ? '' : (editData.stockMaximo ?? '')} onChange={e => setEditData(p => ({ ...p, stockMaximo: parseStockField(e.target.value) }))} />
                    </td>
                    <td className="px-4 py-2 text-center text-xs text-slate-400">{formatEuro(med.precioCaja)}</td>
                    <td className="px-4 py-2 text-center text-xs text-slate-400">{med.activo ? 'Sí' : 'No'}</td>
                    <td className="px-4 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={saveEdit} className="rounded bg-teal-600 px-2 py-1 text-xs font-medium text-white hover:bg-teal-700">Guardar</button>
                        <button onClick={() => setEditingCn(null)} className="rounded bg-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-300">Cancelar</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={med.cn} className={cn('hover:bg-slate-50 transition-colors', !med.activo && 'opacity-50')}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1.5 flex-wrap">
                        {med.cn}
                        {med.cimaConsultado && (
                          med.ppioActivoCima
                            ? <span title={`CIMA: ${med.ppioActivoCima}`} className="inline-block w-2 h-2 rounded-full bg-green-500 shrink-0" />
                            : <span title="CIMA consultado: principio activo no encontrado" className="inline-block w-2 h-2 rounded-full bg-red-400 shrink-0" />
                        )}
                        {isMSE(med.cn) && (
                          <span className="shrink-0 whitespace-nowrap rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">
                            {formatMseLabel(med.tipoMse)}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800 max-w-[200px] truncate" title={med.principioActivo ?? ''}>
                      {med.principioActivo ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 max-w-[180px] truncate" title={med.nombre}>
                      {med.nombre}
                    </td>
                    <td className="px-4 py-3">
                      {med.via && (
                        <span className={cn('rounded px-2 py-0.5 text-xs font-semibold', VIA_BADGE[med.via] ?? VIA_BADGE.OTRO)}>
                          {med.via}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{med.ubicacion ?? '—'}</td>
                    <td className="px-4 py-3 text-center text-sm font-mono">
                      {esAlmacen && med.unidadesPorCaja <= 0 ? '—' : med.unidadesPorCaja}
                    </td>
                    {esAlmacen && (
                      <td className="px-4 py-3 text-xs text-slate-500 max-w-[180px] truncate" title={med.presentacion ?? ''}>
                        {med.presentacion ?? '—'}
                      </td>
                    )}
                    <td className="px-4 py-3 text-center text-sm font-mono text-slate-600">{formatStockCell(med.stockMinimo)}</td>
                    <td className="px-4 py-3 text-center text-sm font-mono text-amber-700 font-semibold">{formatStockCell(med.puntoPedido)}</td>
                    <td className="px-4 py-3 text-center text-sm font-mono text-slate-600">{formatStockCell(med.stockMaximo)}</td>
                    <td className="px-4 py-3 text-center text-xs text-slate-500">{formatEuro(med.precioCaja)}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleToggleActivo(med)}
                        className={cn(
                          'inline-flex h-5 w-9 items-center rounded-full transition-colors',
                          med.activo ? 'bg-teal-500' : 'bg-slate-300'
                        )}
                      >
                        <span className={cn(
                          'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform',
                          med.activo ? 'translate-x-4' : 'translate-x-1'
                        )} />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => startEdit(med)}
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:text-teal-700 hover:border-teal-300 transition-colors"
                          title="Editar"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(med)}
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:text-red-600 hover:border-red-300 transition-colors"
                          title="Eliminar"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pie */}
      {filtered.length > 0 && (
        <p className="mt-3 text-xs text-slate-400 text-right">
          Mostrando {filtered.length} de {meds.length} medicamentos
        </p>
      )}

      {/* Modal Nuevo medicamento */}
      {showNuevo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-800">Nuevo medicamento</h2>
              <button onClick={() => setShowNuevo(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="CN *">
                  <div className="flex gap-2">
                    <input
                      className="field-input flex-1"
                      placeholder="Código Nacional"
                      value={nuevoData.cn}
                      onChange={e => setNuevoData(p => ({ ...p, cn: e.target.value.trim() }))}
                      onBlur={() => { if (esAlmacen && nuevoData.cn.trim()) void buscarCimaPorCn(nuevoData.cn); }}
                    />
                    <button
                      type="button"
                      onClick={() => void buscarCimaPorCn(nuevoData.cn)}
                      disabled={cimaBuscando || !nuevoData.cn.trim()}
                      className="shrink-0 rounded-lg border border-violet-300 px-3 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                      title="Consultar CIMA (AEMPS)"
                    >
                      {cimaBuscando ? '…' : 'CIMA'}
                    </button>
                  </div>
                </Field>
                <Field label="Vía">
                  <select
                    className="field-input bg-white"
                    value={nuevoData.via}
                    onChange={e => setNuevoData(p => ({ ...p, via: e.target.value }))}
                  >
                    <option value="IV">IV</option>
                    <option value="ORAL">ORAL</option>
                    <option value="OTRO">OTRO</option>
                  </select>
                </Field>
              </div>
              {esAlmacen && (
                <p className="text-xs text-violet-600 -mt-1">
                  Acepta CN de 6 dígitos o código SAP (14+CN). Al salir del campo o pulsar CIMA se consulta AEMPS.
                </p>
              )}
              <Field label="Nombre / Marca *">
                <input
                  className="field-input"
                  placeholder="Nombre comercial"
                  value={nuevoData.nombre}
                  onChange={e => setNuevoData(p => ({ ...p, nombre: e.target.value }))}
                />
              </Field>
              <Field label="Principio activo">
                <input
                  className="field-input"
                  placeholder="Principio activo"
                  value={nuevoData.principioActivo}
                  onChange={e => setNuevoData(p => ({ ...p, principioActivo: e.target.value }))}
                />
              </Field>
              {esAlmacen && (
                <Field label="Presentación (CIMA)">
                  <input
                    className="field-input text-sm"
                    placeholder="Presentación del envase"
                    value={nuevoData.presentacion}
                    onChange={e => setNuevoData(p => ({ ...p, presentacion: e.target.value }))}
                  />
                </Field>
              )}
              <Field label="Ubicación">
                <UbicacionSelect
                  value={nuevoData.ubicacion}
                  onChange={v => setNuevoData(p => ({ ...p, ubicacion: v }))}
                  opciones={ubicacionesUnicas}
                />
              </Field>
              <div className="grid grid-cols-4 gap-3">
                <Field label="Uds/caja">
                  <input type="number" min={1} className="field-input text-center" value={nuevoData.unidadesPorCaja} onChange={e => setNuevoData(p => ({ ...p, unidadesPorCaja: Number(e.target.value) }))} />
                </Field>
                <Field label={esAlmacen ? 'Stock mín. (opt.)' : esNutricion ? 'Stock mín. (cajas)' : 'Stock mín.'}>
                  <input type="number" min={0} step={esNutricion ? 0.1 : 1} className="field-input text-center" placeholder={esAlmacen ? '—' : undefined} value={nuevoData.stockMinimo} onChange={e => setNuevoData(p => ({ ...p, stockMinimo: parseStockField(e.target.value) }))} />
                </Field>
                <Field label={esAlmacen ? 'Pto. pedido (opt.)' : esNutricion ? 'Pto. pedido (cajas)' : 'Pto. pedido'}>
                  <input type="number" min={0} step={esNutricion ? 0.1 : 1} className="field-input text-center" placeholder={esAlmacen ? '—' : undefined} value={nuevoData.puntoPedido} onChange={e => setNuevoData(p => ({ ...p, puntoPedido: parseStockField(e.target.value) }))} />
                </Field>
                <Field label={esAlmacen ? 'Stock máx. (opt.)' : esNutricion ? 'Stock máx. (cajas)' : 'Stock máx.'}>
                  <input type="number" min={0} step={esNutricion ? 0.1 : 1} className="field-input text-center" placeholder={esAlmacen ? '—' : undefined} value={nuevoData.stockMaximo} onChange={e => setNuevoData(p => ({ ...p, stockMaximo: parseStockField(e.target.value) }))} />
                </Field>
              </div>
              {esAlmacen && (
                <p className="text-xs text-slate-500">
                  Si defines stocks, aparecerán como referencia orientativa al hacer el pedido por pasillo.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
              <button
                onClick={() => { setShowNuevo(false); setNuevoData({ ...NUEVO_EMPTY }); }}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleNuevoSubmit}
                disabled={savingNuevo}
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50 transition-colors"
              >
                {savingNuevo ? 'Guardando…' : 'Crear medicamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .field-input {
          width: 100%;
          border-radius: 0.375rem;
          border: 1px solid #cbd5e1;
          padding: 0.375rem 0.5rem;
          font-size: 0.8125rem;
          outline: none;
        }
        .field-input:focus {
          ring: 2px solid #14b8a6;
          border-color: #14b8a6;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

function UbicacionSelect({
  value, onChange, opciones,
}: {
  value: string;
  onChange: (v: string) => void;
  opciones: string[];
}) {
  const [modo, setModo] = useState<'select' | 'input'>('select');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (modo === 'input') inputRef.current?.focus();
  }, [modo]);

  if (modo === 'input' || opciones.length === 0) {
    return (
      <div className="flex gap-1">
        <input
          ref={inputRef}
          className="field-input flex-1"
          placeholder="Nueva ubicación…"
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        {opciones.length > 0 && (
          <button
            type="button"
            onClick={() => setModo('select')}
            className="rounded border border-slate-300 px-2 text-xs text-slate-500 hover:bg-slate-100"
            title="Ver existentes"
          >↩</button>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-1">
      <select
        className="field-input flex-1 bg-white"
        value={opciones.includes(value) ? value : ''}
        onChange={e => {
          if (e.target.value === '__nueva__') { setModo('input'); onChange(''); }
          else onChange(e.target.value);
        }}
      >
        <option value="">— sin ubicación —</option>
        {opciones.map(o => <option key={o} value={o}>{o}</option>)}
        <option value="__nueva__">✏ Nueva ubicación…</option>
      </select>
    </div>
  );
}
