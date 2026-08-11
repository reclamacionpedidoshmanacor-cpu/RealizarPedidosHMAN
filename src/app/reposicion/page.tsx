'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

type Cabecera = {
  id: number;
  estado: 'borrador' | 'finalizado';
  fechaCreacion: string;
  fechaFinalizado: string | null;
  totalLineas: number;
};

type Linea = {
  id: number;
  catalogoId: number | null;
  ubicacion: string;
  codigo: string;
  cn: string;
  principioActivo: string | null;
  nombre: string;
  cantidadCajas: number;
  unidadPedido: 'cajas' | 'unidades';
  notas: string | null;
  ubicacionOrigen: string | null;
};

type Item = {
  id: number;
  areaDestino: string;
  ubicacionDestino: string;
  codigo: string;
  cn: string | null;
  tipo: 'medicamento' | 'formula';
  areaOrigen: string | null;
  ubicacionOrigen: string | null;
  principioActivo: string | null;
  nombre: string;
  unidadesPorCaja: number;
  unidadPedido: 'cajas' | 'unidades';
  stockMaximo: number | null;
  puntoPedido: number | null;
  notas: string | null;
  activo: boolean;
};

type ResultadoMed = {
  cn: string;
  nombre: string;
  principioActivo: string | null;
  area: string;
  unidadesPorCaja: number;
};

const EMPTY_FORM = {
  id: undefined as number | undefined,
  tipo: 'medicamento' as 'medicamento' | 'formula',
  cn: '',
  codigo: '',
  nombre: '',
  principioActivo: '',
  ubicacionDestino: '',
  unidadPedido: 'cajas' as 'cajas' | 'unidades',
  stockMaximo: '',
  puntoPedido: '',
  notas: '',
  activo: true,
};

export default function ReposicionPage() {
  const [area, setArea] = useState('');
  const [tab, setTab] = useState<'pedidos' | 'catalogo'>('pedidos');
  const [borrador, setBorrador] = useState<Cabecera | null>(null);
  const [historial, setHistorial] = useState<Cabecera[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [detalle, setDetalle] = useState<{ cabecera: Cabecera; lineas: Linea[] } | null>(null);
  const [cantidades, setCantidades] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [resultados, setResultados] = useState<ResultadoMed[]>([]);
  const [filtroUbicacion, setFiltroUbicacion] = useState('');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroActivo, setFiltroActivo] = useState<'' | 'si' | 'no'>('');

  const enabled = area === 'upe' || area === 'oncologia';

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const [pedRes, catRes] = await Promise.all([
        fetch('/api/reposicion', { cache: 'no-store' }),
        fetch('/api/reposicion/catalogo', { cache: 'no-store' }),
      ]);
      const [ped, cat] = await Promise.all([pedRes.json(), catRes.json()]);
      if (!pedRes.ok) throw new Error(ped?.error ?? 'No se pudieron cargar los pedidos.');
      if (!catRes.ok) throw new Error(cat?.error ?? 'No se pudo cargar el catálogo.');
      setBorrador(ped.borrador ?? null);
      setHistorial(ped.historial ?? []);
      setItems(cat.items ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    const current = document.cookie
      .split(';')
      .find((cookie) => cookie.trim().startsWith('area_session='))
      ?.split('=')[1] ?? '';
    setArea(current);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openPedido = async (id: number) => {
    try {
      const res = await fetch(`/api/reposicion/${id}`, { cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo cargar el pedido.');
      setDetalle(payload);
      setCantidades(Object.fromEntries(payload.lineas.map((linea: Linea) => [linea.id, linea.cantidadCajas])));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error inesperado');
    }
  };

  const saveDraft = async () => {
    if (!detalle || detalle.cabecera.estado !== 'borrador') return;
    const grupos = new Map<string, Array<{ catalogoId: number; cantidadCajas: number }>>();
    for (const linea of detalle.lineas) {
      if (!linea.catalogoId) continue;
      if (!grupos.has(linea.ubicacion)) grupos.set(linea.ubicacion, []);
      grupos.get(linea.ubicacion)!.push({
        catalogoId: linea.catalogoId,
        cantidadCajas: cantidades[linea.id] ?? 0,
      });
    }
    setBusy(true);
    try {
      for (const [ubicacion, lineas] of grupos) {
        const res = await fetch('/api/reposicion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ubicacion, lineas }),
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error ?? 'No se pudo guardar el borrador.');
      }
      toast.success('Borrador actualizado.');
      await load();
      await openPedido(detalle.cabecera.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  };

  const finalizar = async (id: number) => {
    if (!confirm('¿Validar y finalizar este pedido? Después no se podrán cambiar las cantidades.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/reposicion/${id}/finalizar`, { method: 'POST' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo finalizar.');
      toast.success('Pedido validado y finalizado.');
      setDetalle(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  };

  const enviar = async (id: number) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/reposicion/${id}/email`, { method: 'POST' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo enviar.');
      toast.success('Albarán enviado por email.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  };

  const buscar = async () => {
    if (!search.trim()) return;
    try {
      const res = await fetch(`/api/reposicion/catalogo?search=${encodeURIComponent(search)}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo buscar.');
      setResultados(payload.resultados ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error inesperado');
    }
  };

  const saveItem = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/reposicion/catalogo', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          stockMaximo: form.stockMaximo === '' ? null : Number(form.stockMaximo),
          puntoPedido: form.puntoPedido === '' ? null : Number(form.puntoPedido),
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo guardar.');
      toast.success('Artículo de reposición guardado.');
      setForm(EMPTY_FORM);
      setResultados([]);
      setSearch('');
      setFormOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  };

  const edit = (item: Item) => {
    setForm({
      id: item.id,
      tipo: item.tipo,
      cn: item.cn ?? '',
      codigo: item.codigo,
      nombre: item.nombre,
      principioActivo: item.principioActivo ?? '',
      ubicacionDestino: item.ubicacionDestino,
      unidadPedido: item.unidadPedido,
      stockMaximo: item.stockMaximo == null ? '' : String(item.stockMaximo),
      puntoPedido: item.puntoPedido == null ? '' : String(item.puntoPedido),
      notas: item.notas ?? '',
      activo: item.activo,
    });
    setSearch('');
    setResultados([]);
    setTab('catalogo');
    setFormOpen(true);
  };

  const nuevo = () => {
    setForm({ ...EMPTY_FORM, ubicacionDestino: filtroUbicacion });
    setSearch('');
    setResultados([]);
    setFormOpen(true);
  };

  const ubicaciones = useMemo(
    () => [...new Set(items.map((item) => item.ubicacionDestino))].sort((a, b) => a.localeCompare(b, 'es')),
    [items],
  );

  const itemsFiltrados = useMemo(() => {
    const texto = filtroTexto.trim().toLowerCase();
    return items.filter((item) => {
      if (filtroUbicacion && item.ubicacionDestino !== filtroUbicacion) return false;
      if (filtroActivo === 'si' && !item.activo) return false;
      if (filtroActivo === 'no' && item.activo) return false;
      if (!texto) return true;
      return [item.cn, item.codigo, item.nombre, item.principioActivo]
        .some((campo) => campo?.toLowerCase().includes(texto));
    });
  }, [items, filtroUbicacion, filtroActivo, filtroTexto]);

  const porUbicacion = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of itemsFiltrados) {
      if (!map.has(item.ubicacionDestino)) map.set(item.ubicacionDestino, []);
      map.get(item.ubicacionDestino)!.push(item);
    }
    return map;
  }, [itemsFiltrados]);

  if (!area) return <p className="text-sm text-slate-500">Cargando área…</p>;
  if (!enabled) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        La reposición interna está disponible para UPE y Oncología.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Reposición</h1>
          <p className="text-sm text-slate-500">Pedidos internos a Farmacia y catálogo por ubicación destino.</p>
        </div>
        <a
          href={`/recuento-manual?area=${area}&modo=reposicion`}
          className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
        >
          Abrir APP de pedido
        </a>
      </div>

      <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {(['pedidos', 'catalogo'] as const).map((value) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              tab === value ? 'bg-teal-50 text-teal-700' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            {value === 'pedidos' ? 'Pedidos' : 'Catálogo de reposición'}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : tab === 'pedidos' ? (
        <div className="space-y-4">
          {borrador ? (
            <section className="rounded-xl border border-teal-200 bg-teal-50/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-800">Borrador #{borrador.id}</h2>
                  <p className="text-sm text-slate-500">{borrador.totalLineas} líneas · {formatDate(borrador.fechaCreacion)}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openPedido(borrador.id)} className="rounded-lg border border-teal-300 bg-white px-3 py-2 text-sm font-semibold text-teal-700">
                    Revisar
                  </button>
                  <button disabled={busy} onClick={() => finalizar(borrador.id)} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    Validar
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              No hay borrador. Créalo desde la APP de pedido.
            </div>
          )}

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <h2 className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-800">Historial</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr><th className="px-4 py-2">Pedido</th><th>Fecha</th><th>Líneas</th><th>Estado</th><th className="px-4 text-right">Acciones</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {historial.map((pedido) => (
                    <tr key={pedido.id}>
                      <td className="px-4 py-3 font-medium">#{pedido.id}</td>
                      <td>{formatDate(pedido.fechaCreacion)}</td>
                      <td>{pedido.totalLineas}</td>
                      <td>{pedido.estado}</td>
                      <td className="px-4 text-right">
                        <button onClick={() => openPedido(pedido.id)} className="mr-3 text-teal-700 hover:underline">Ver</button>
                        <a href={`/api/reposicion/${pedido.id}/pdf`} className="mr-3 text-slate-600 hover:underline">PDF</a>
                        {pedido.estado === 'finalizado' && <button disabled={busy} onClick={() => enviar(pedido.id)} className="text-teal-700 hover:underline">Enviar</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={filtroTexto}
              onChange={(e) => setFiltroTexto(e.target.value)}
              placeholder="Buscar por CN, marca o principio activo…"
              className="min-w-[240px] flex-1 rounded-lg border border-slate-200 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <select
              value={filtroUbicacion}
              onChange={(e) => setFiltroUbicacion(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="">Todas las ubicaciones destino</option>
              {ubicaciones.map((ubicacion) => (
                <option key={ubicacion} value={ubicacion}>{ubicacion}</option>
              ))}
            </select>
            <select
              value={filtroActivo}
              onChange={(e) => setFiltroActivo(e.target.value as '' | 'si' | 'no')}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="">Todos</option>
              <option value="si">Activos</option>
              <option value="no">Inactivos</option>
            </select>
            <button
              onClick={nuevo}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
            >
              + Añadir artículo
            </button>
          </div>

          <p className="text-xs text-slate-500">
            {itemsFiltrados.length} artículo{itemsFiltrados.length === 1 ? '' : 's'} en {porUbicacion.size} ubicación
            {porUbicacion.size === 1 ? '' : 'es'} destino.
          </p>

          {porUbicacion.size === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
              No hay artículos que coincidan con los filtros.
            </div>
          )}

          {[...porUbicacion].map(([ubicacion, rows]) => (
            <section key={ubicacion} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
                <h3 className="font-semibold text-slate-800">{ubicacion}</h3>
                <span className="text-xs text-slate-500">{rows.length} artículos</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="w-[90px] px-4 py-2.5">CN</th>
                      <th className="px-3 py-2.5">Principio activo</th>
                      <th className="px-3 py-2.5">Marca</th>
                      <th className="px-3 py-2.5">Ubicación origen</th>
                      <th className="w-[90px] px-3 py-2.5 text-center">Unidad</th>
                      <th className="w-[70px] px-3 py-2.5 text-center">Máx.</th>
                      <th className="w-[80px] px-3 py-2.5 text-center">Pto. ped.</th>
                      <th className="w-[70px] px-3 py-2.5 text-center">Activo</th>
                      <th className="w-[90px] px-4 py-2.5 text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((item) => (
                      <tr key={item.id} className={`hover:bg-slate-50/70 ${item.activo ? '' : 'bg-slate-50/60 text-slate-400'}`}>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                          {item.tipo === 'formula' ? (
                            <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                              FÓRMULA
                            </span>
                          ) : (
                            item.cn
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-medium text-slate-800">
                          {item.principioActivo ?? item.nombre}
                          {item.notas && (
                            <span className="mt-0.5 block text-[11px] font-normal text-amber-700">Nota: {item.notas}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{item.nombre}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-500">
                          {item.ubicacionOrigen ?? (item.tipo === 'formula' ? 'Elaboración propia' : '—')}
                          {item.areaOrigen && (
                            <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                              {item.areaOrigen}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center text-xs text-slate-500">{item.unidadPedido}</td>
                        <td className="px-3 py-2.5 text-center">{item.stockMaximo ?? '—'}</td>
                        <td className="px-3 py-2.5 text-center">{item.puntoPedido ?? '—'}</td>
                        <td className="px-3 py-2.5 text-center">
                          {item.activo ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Sí</span>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">No</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <button
                            onClick={() => edit(item)}
                            className="rounded-lg border border-teal-300 px-2.5 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-50"
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-900/40 p-4">
          <div className="my-8 w-full max-w-3xl space-y-3 rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-800">{form.id ? 'Editar artículo de reposición' : 'Añadir artículo de reposición'}</h2>
                <p className="text-sm text-slate-500">
                  Define dónde se repone, en qué unidad se solicita y los parámetros de stock.
                </p>
              </div>
              <button
                onClick={() => { setFormOpen(false); setForm(EMPTY_FORM); setResultados([]); setSearch(''); }}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                Cerrar
              </button>
            </div>
            <fieldset className="space-y-3 rounded-xl border border-slate-200 p-4">
              <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-500">1. Qué se repone</legend>
              <div className="flex flex-wrap gap-2">
                {(['medicamento', 'formula'] as const).map((tipo) => (
                  <button
                    key={tipo}
                    type="button"
                    onClick={() => setForm({ ...form, tipo })}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
                      form.tipo === tipo
                        ? 'border-teal-500 bg-teal-50 text-teal-700'
                        : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {tipo === 'medicamento' ? 'Medicamento con CN' : 'Fórmula interna (sin CN)'}
                  </button>
                ))}
              </div>
              {form.tipo === 'medicamento' ? (
                <div>
                  <div className="flex gap-2">
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void buscar()}
                      placeholder="Buscar por CN, marca o principio activo en todas las áreas"
                      className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                    <button onClick={buscar} className="rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                      Buscar
                    </button>
                  </div>
                  {resultados.length > 0 && (
                    <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-slate-200">
                      {resultados.map((med) => (
                        <button
                          key={med.cn}
                          onClick={() => {
                            setForm({ ...form, cn: med.cn, nombre: med.nombre, principioActivo: med.principioActivo ?? '' });
                            setResultados([]);
                            setSearch('');
                          }}
                          className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-teal-50"
                        >
                          <span className="font-mono text-xs text-slate-500">{med.cn}</span>{' '}
                          <span className="font-semibold text-slate-800">{med.principioActivo ?? med.nombre}</span>
                          <span className="text-slate-500"> · {med.nombre}</span>
                          <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">{med.area}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {form.cn && (
                    <div className="mt-2 flex items-center justify-between rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm">
                      <span>
                        <span className="font-mono text-xs text-teal-800">{form.cn}</span>{' '}
                        <span className="font-semibold text-teal-800">{form.principioActivo || form.nombre}</span>
                        <span className="text-teal-700"> · {form.nombre}</span>
                      </span>
                      <button onClick={() => setForm({ ...form, cn: '', nombre: '', principioActivo: '' })} className="text-xs font-semibold text-teal-700 hover:underline">
                        Cambiar
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-xs font-semibold text-slate-500">Código interno
                    <input placeholder="Ej. FM-MUCOSITIS" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  </label>
                  <label className="text-xs font-semibold text-slate-500">Nombre de la fórmula
                    <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  </label>
                </div>
              )}
            </fieldset>

            <fieldset className="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-2">
              <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-500">2. Dónde y cómo se pide</legend>
              <label className="text-xs font-semibold text-slate-500">Ubicación destino
                <input
                  list="reposicion-ubicaciones"
                  value={form.ubicacionDestino}
                  onChange={(e) => setForm({ ...form, ubicacionDestino: e.target.value })}
                  placeholder="Ej. Nevera NEA"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <datalist id="reposicion-ubicaciones">
                  {ubicaciones.map((ubicacion) => <option key={ubicacion} value={ubicacion} />)}
                </datalist>
              </label>
              <label className="text-xs font-semibold text-slate-500">Unidad de solicitud
                <select value={form.unidadPedido} onChange={(e) => setForm({ ...form, unidadPedido: e.target.value as 'cajas' | 'unidades' })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value="cajas">Cajas</option>
                  <option value="unidades">Unidades</option>
                </select>
              </label>
            </fieldset>

            <fieldset className="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-2">
              <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-500">3. Parámetros de stock</legend>
              <label className="text-xs font-semibold text-slate-500">Stock máximo ({form.unidadPedido})
                <input type="number" min="0" step="any" value={form.stockMaximo} onChange={(e) => setForm({ ...form, stockMaximo: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-slate-500">Punto de pedido ({form.unidadPedido})
                <input type="number" min="0" step="any" value={form.puntoPedido} onChange={(e) => setForm({ ...form, puntoPedido: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-slate-500 md:col-span-2">Notas de preparación (se imprimen en el albarán)
                <input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} placeholder="Ej. Solamente presentación reenvasada" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
                <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
                Activo (aparece en la APP de pedido)
              </label>
            </fieldset>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                onClick={() => { setFormOpen(false); setForm(EMPTY_FORM); setResultados([]); setSearch(''); }}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button disabled={busy} onClick={saveItem} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
                {form.id ? 'Guardar cambios' : 'Añadir artículo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {detalle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">Pedido #{detalle.cabecera.id}</h2>
              <button onClick={() => setDetalle(null)} className="text-slate-500">Cerrar</button>
            </div>
            <div className="space-y-2">
              {detalle.lineas.map((linea) => (
                <div key={linea.id} className="grid grid-cols-[1fr_110px] items-center gap-3 rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      <span className="font-mono text-xs text-slate-500">{linea.codigo}</span> {linea.principioActivo ?? linea.nombre}
                    </p>
                    <p className="text-xs text-slate-500">
                      {linea.nombre} · destino {linea.ubicacion} · origen {linea.ubicacionOrigen ?? '—'}
                    </p>
                    {linea.notas && <p className="text-xs text-amber-700">Nota: {linea.notas}</p>}
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    disabled={detalle.cabecera.estado !== 'borrador'}
                    value={cantidades[linea.id] ?? linea.cantidadCajas}
                    onChange={(e) => setCantidades({ ...cantidades, [linea.id]: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
                    className="rounded-lg border p-2 text-right"
                    aria-label={`Cantidad en ${linea.unidadPedido}`}
                  />
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <a href={`/api/reposicion/${detalle.cabecera.id}/pdf`} className="rounded-lg border px-3 py-2 text-sm font-semibold">Descargar PDF</a>
              {detalle.cabecera.estado === 'borrador' && <button disabled={busy} onClick={saveDraft} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Guardar cambios</button>}
              {detalle.cabecera.estado === 'finalizado' && <button disabled={busy} onClick={() => enviar(detalle.cabecera.id)} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Enviar email</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('es-ES');
}
