'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { cn, formatEuro } from '@/lib/utils';

interface Medicamento {
  cn: string; nombre: string; principioActivo: string | null;
  via: string | null; area: string; ubicacion: string | null;
  unidadesPorCaja: number; activo: boolean; comprable: boolean;
  mse: boolean; tipoMse: string | null;
  precioUnidad: number | null; precioCaja: number | null;
  stockMinimo: number | null; puntoPedido: number | null; stockMaximo: number | null;
}

const VIA_BADGE: Record<string, string> = {
  IV:   'bg-blue-100 text-blue-700',
  ORAL: 'bg-teal-100 text-teal-700',
  OTRO: 'bg-slate-100 text-slate-600',
};

export default function CatalogoPage() {
  const [meds, setMeds] = useState<Medicamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterVia, setFilterVia] = useState('');
  const [filterActivo, setFilterActivo] = useState('');
  const [importing, setImporting] = useState(false);
  const [editingCn, setEditingCn] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Medicamento>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const getArea = () => {
    if (typeof document === 'undefined') return 'oncologia';
    return document.cookie.split(';').find(c => c.trim().startsWith('area_session='))?.split('=')[1] ?? 'oncologia';
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

  useEffect(() => { fetchMeds(); }, [fetchMeds]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('area', getArea());
      const res = await fetch('/api/catalogo/importar', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Error al importar'); return; }
      toast.success(`Importado: ${data.insertados} nuevos, ${data.actualizados} actualizados (${data.via})`);
      if (data.errores?.length) toast.warning(`${data.errores.length} advertencias — revisa la consola`);
      fetchMeds();
    } catch { toast.error('Error de conexión'); }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = ''; }
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
      ubicacion: med.ubicacion ?? '',
      unidadesPorCaja: med.unidadesPorCaja,
      comprable: med.comprable,
      tipoMse: med.tipoMse ?? '',
      stockMinimo: med.stockMinimo ?? 0,
      puntoPedido: med.puntoPedido ?? 0,
      stockMaximo: med.stockMaximo ?? undefined,
    });
  };

  const saveEdit = async () => {
    if (!editingCn) return;
    const res = await fetch(`/api/medicamentos/${editingCn}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editData),
    });
    if (res.ok) { toast.success('Guardado'); setEditingCn(null); fetchMeds(); }
    else { toast.error('Error al guardar'); }
  };

  const filtered = meds.filter(m => {
    const q = search.toLowerCase();
    const matchSearch = !q || m.principioActivo?.toLowerCase().includes(q) || m.nombre.toLowerCase().includes(q) || m.cn.includes(q);
    const matchVia = !filterVia || m.via === filterVia;
    const matchActivo = !filterActivo || (filterActivo === 'si' ? m.activo : !m.activo);
    return matchSearch && matchVia && matchActivo;
  });

  const activos = meds.filter(m => m.activo).length;
  const mseCount = meds.filter(m => m.mse).length;

  return (
    <div>
      {/* Cabecera */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Catálogo de medicamentos</h1>
          <p className="text-sm text-slate-500">
            {meds.length} medicamentos · {activos} activos · {mseCount} MSE
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
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

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre, principio activo o CN…"
          className="flex-1 min-w-[220px] rounded-lg border border-slate-200 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <select value={filterVia} onChange={e => setFilterVia(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white">
          <option value="">Todas las vías</option>
          <option value="IV">IV</option>
          <option value="ORAL">ORAL</option>
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
              <tr className="border-b border-slate-100 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3 text-left">CN</th>
                <th className="px-4 py-3 text-left">Principio activo</th>
                <th className="px-4 py-3 text-left">Nombre / Marca</th>
                <th className="px-4 py-3 text-left">Vía</th>
                <th className="px-4 py-3 text-left">Ubicación</th>
                <th className="px-4 py-3 text-center">Uds/caja</th>
                <th className="px-4 py-3 text-center">Mín</th>
                <th className="px-4 py-3 text-center">Pto.Ped</th>
                <th className="px-4 py-3 text-center">Máx</th>
                <th className="px-4 py-3 text-center">Precio/caja</th>
                <th className="px-4 py-3 text-center">Activo</th>
                <th className="px-4 py-3 text-center">Acciones</th>
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
                      <input className="w-full rounded border border-slate-300 px-2 py-1 text-xs" value={editData.ubicacion ?? ''} onChange={e => setEditData(p => ({ ...p, ubicacion: e.target.value }))} />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input type="number" className="w-16 rounded border border-slate-300 px-2 py-1 text-xs text-center" value={editData.unidadesPorCaja ?? ''} onChange={e => setEditData(p => ({ ...p, unidadesPorCaja: Number(e.target.value) }))} />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input type="number" className="w-14 rounded border border-slate-300 px-2 py-1 text-xs text-center" value={editData.stockMinimo ?? ''} onChange={e => setEditData(p => ({ ...p, stockMinimo: Number(e.target.value) }))} />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input type="number" className="w-14 rounded border border-slate-300 px-2 py-1 text-xs text-center" value={editData.puntoPedido ?? ''} onChange={e => setEditData(p => ({ ...p, puntoPedido: Number(e.target.value) }))} />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input type="number" className="w-14 rounded border border-slate-300 px-2 py-1 text-xs text-center" value={editData.stockMaximo ?? ''} onChange={e => setEditData(p => ({ ...p, stockMaximo: Number(e.target.value) }))} />
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
                      {med.cn}
                      {med.mse && (
                        <span className="ml-1.5 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">
                          {med.tipoMse ?? 'MSE'}
                        </span>
                      )}
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
                    <td className="px-4 py-3 text-center text-sm font-mono">{med.unidadesPorCaja}</td>
                    <td className="px-4 py-3 text-center text-sm font-mono text-slate-600">{med.stockMinimo ?? '—'}</td>
                    <td className="px-4 py-3 text-center text-sm font-mono text-amber-700 font-semibold">{med.puntoPedido ?? '—'}</td>
                    <td className="px-4 py-3 text-center text-sm font-mono text-slate-600">{med.stockMaximo ?? '—'}</td>
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
                      <button
                        onClick={() => startEdit(med)}
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:text-teal-700 hover:border-teal-300 transition-colors"
                        title="Editar"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pie con totales */}
      {filtered.length > 0 && (
        <p className="mt-3 text-xs text-slate-400 text-right">
          Mostrando {filtered.length} de {meds.length} medicamentos
        </p>
      )}
    </div>
  );
}
