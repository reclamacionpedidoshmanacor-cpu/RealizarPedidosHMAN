'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

type RecuentoManualResumen = {
  id: number;
  estado: string;
  fechaRecuento: string;
  importadoEn: string;
  totalLineas: number;
};

type InventarioRow = {
  cn: string;
  principioActivo: string | null;
  medicamento: string;
  unidadesPorCaja: number;
  manualUnidades: number;
  manualCajas: number;
  sapUnidades: number;
  sapCajas: number;
  ajusteUnidades: number;
  ajusteCajas: number;
  materialSap: string | null;
};

type InventarioResultado = {
  manualRecuento: {
    id: number;
    fechaRecuento: string;
    estado: string;
    totalLineas: number;
  };
  sapFileName: string;
  warnings: string[];
  resumen: {
    totalLineas: number;
    totalManualUnidades: number;
    totalSapUnidades: number;
    totalAjusteUnidades: number;
    totalManualCajas: number;
    totalSapCajas: number;
    totalAjusteCajas: number;
  };
  rows: InventarioRow[];
};

function fmtDate(v: string) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('es-ES');
}

function fmtNum(v: number, digits = 2) {
  return v.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export default function InventarioPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [recuentos, setRecuentos] = useState<RecuentoManualResumen[]>([]);
  const [selectedManualId, setSelectedManualId] = useState<number | null>(null);
  const [sapFile, setSapFile] = useState<File | null>(null);
  const [loadingRecuentos, setLoadingRecuentos] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [resultado, setResultado] = useState<InventarioResultado | null>(null);
  const [search, setSearch] = useState('');

  const loadRecuentos = async () => {
    setLoadingRecuentos(true);
    try {
      const res = await fetch('/api/inventario/recuentos-manuales', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'No se pudieron cargar los recuentos manuales.');
      const items = (data.recuentos ?? []) as RecuentoManualResumen[];
      setRecuentos(items);
      if (items.length > 0) setSelectedManualId((prev) => prev ?? items[0].id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoadingRecuentos(false);
    }
  };

  useEffect(() => {
    void loadRecuentos();
  }, []);

  const handleComparar = async () => {
    if (!selectedManualId) {
      toast.error('Selecciona un recuento manual.');
      return;
    }
    if (!sapFile) {
      toast.error('Sube el archivo SAP para comparar.');
      return;
    }

    setComparing(true);
    try {
      const form = new FormData();
      form.append('manualRecuentoId', String(selectedManualId));
      form.append('file', sapFile);

      const res = await fetch('/api/inventario/comparar', { method: 'POST', body: form });
      const text = await res.text();
      let data: InventarioResultado & { error?: string };
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Respuesta no válida del servidor: ${text.slice(0, 300)}`);
      }
      if (!res.ok) throw new Error(data?.error ?? 'No se pudo calcular la comparativa.');

      setResultado(data);
      toast.success(`Comparativa calculada (${data.rows.length} líneas).`);
      if (data.warnings.length > 0) {
        toast.warning(`Se detectaron ${data.warnings.length} advertencias.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setComparing(false);
    }
  };

  const handleExportar = async () => {
    if (!resultado) return;
    setExporting(true);
    try {
      const res = await fetch('/api/inventario/exportar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manualRecuentoId: resultado.manualRecuento.id,
          sapFileName: resultado.sapFileName,
          rows: resultado.rows,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'No se pudo exportar.' }));
        throw new Error(data?.error ?? 'No se pudo exportar.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inventario-ajustes-${resultado.manualRecuento.id}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Excel exportado.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setExporting(false);
    }
  };

  const filteredRows = useMemo(() => {
    const rows = resultado?.rows ?? [];
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      r.cn.includes(search) ||
      (r.principioActivo ?? '').toLowerCase().includes(q) ||
      (r.medicamento ?? '').toLowerCase().includes(q),
    );
  }, [resultado, search]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Inventario</h1>
        <p className="text-sm text-slate-500">
          Selecciona un recuento manual, importa el corte SAP y calcula el ajuste por medicamento (Real − SAP).
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Recuento manual</label>
            {loadingRecuentos ? (
              <p className="text-sm text-slate-400">Cargando recuentos…</p>
            ) : recuentos.length === 0 ? (
              <p className="text-sm text-amber-700">No hay recuentos manuales disponibles.</p>
            ) : (
              <select
                value={selectedManualId ?? ''}
                onChange={(e) => setSelectedManualId(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {recuentos.map((r) => (
                  <option key={r.id} value={r.id}>
                    #{r.id} · {fmtDate(r.fechaRecuento)} · {r.totalLineas} líneas · {r.estado}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Fichero SAP</label>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => setSapFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              {sapFile ? `📎 ${sapFile.name}` : 'Seleccionar archivo SAP'}
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleComparar}
              disabled={comparing || loadingRecuentos || recuentos.length === 0}
              className="flex-1 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {comparing ? 'Calculando…' : 'Calcular comparativa'}
            </button>
            <button
              onClick={handleExportar}
              disabled={!resultado || exporting}
              className="rounded-lg border border-teal-300 px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50"
            >
              {exporting ? 'Exportando…' : 'Excel'}
            </button>
          </div>
        </div>
      </div>

      {resultado && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <Kpi label="Líneas" value={String(resultado.resumen.totalLineas)} />
            <Kpi label="Manual (ud)" value={fmtNum(resultado.resumen.totalManualUnidades)} />
            <Kpi label="SAP (ud)" value={fmtNum(resultado.resumen.totalSapUnidades)} />
            <Kpi label="Ajuste (ud)" value={fmtNum(resultado.resumen.totalAjusteUnidades)} />
            <Kpi label="Manual (cajas)" value={fmtNum(resultado.resumen.totalManualCajas)} />
            <Kpi label="SAP (cajas)" value={fmtNum(resultado.resumen.totalSapCajas)} />
            <Kpi label="Ajuste (cajas)" value={fmtNum(resultado.resumen.totalAjusteCajas)} />
          </div>

          {resultado.warnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-800 mb-1">
                Advertencias ({resultado.warnings.length})
              </p>
              <ul className="text-xs text-amber-700 space-y-0.5 max-h-36 overflow-auto pr-2">
                {resultado.warnings.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <input
              type="text"
              placeholder="Buscar por CN, principio activo o medicamento…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <p className="text-xs text-slate-500">
              Recuento manual #{resultado.manualRecuento.id} · SAP: {resultado.sapFileName}
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Medicamento</th>
                  <th className="px-3 py-2 text-center">UPC</th>
                  <th className="px-3 py-2 text-right">Manual (ud)</th>
                  <th className="px-3 py-2 text-right">SAP (ud)</th>
                  <th className="px-3 py-2 text-right">Ajuste (ud)</th>
                  <th className="px-3 py-2 text-right">Manual (cajas)</th>
                  <th className="px-3 py-2 text-right">SAP (cajas)</th>
                  <th className="px-3 py-2 text-right">Ajuste (cajas)</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.cn} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <span className="inline-block rounded bg-slate-100 px-1.5 py-px font-mono text-[11px] text-slate-500">
                        {row.cn}
                      </span>
                      <p className="font-semibold text-slate-800">{row.principioActivo ?? '—'}</p>
                      <p className="text-[11px] italic text-slate-400">{row.medicamento}</p>
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-slate-600">{fmtNum(row.unidadesPorCaja, 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(row.manualUnidades)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(row.sapUnidades)}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums font-semibold ${
                        row.ajusteUnidades > 0
                          ? 'text-emerald-700'
                          : row.ajusteUnidades < 0
                            ? 'text-rose-700'
                            : 'text-slate-600'
                      }`}
                    >
                      {fmtNum(row.ajusteUnidades)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(row.manualCajas)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(row.sapCajas)}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums font-semibold ${
                        row.ajusteCajas > 0
                          ? 'text-emerald-700'
                          : row.ajusteCajas < 0
                            ? 'text-rose-700'
                            : 'text-slate-600'
                      }`}
                    >
                      {fmtNum(row.ajusteCajas)}
                    </td>
                  </tr>
                ))}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                      No hay filas para mostrar con el filtro actual.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-800 tabular-nums">{value}</p>
    </div>
  );
}
