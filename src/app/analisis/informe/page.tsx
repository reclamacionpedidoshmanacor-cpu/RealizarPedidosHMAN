'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { GRUPO_COLORS, GRUPO_LABELS } from '@/lib/diagnostico-grupos';
import type { AnalisisDatos, MedicamentoDetalle } from '@/lib/analisis-neon';
import {
  TemporalChart,
  ViaSplitBar,
  VIA_META,
  YoyBadge,
  fmtDate,
  fmtEur,
  fmtQty,
  fmtVariacion,
  getServiceColor,
  type NivelInforme,
} from '../AnalisisOncologiaPage';

/** Ancho útil de A4 con márgenes de 12 mm (186 mm ≈ 703 px) menos el padding de la tarjeta. */
const ANCHO_GRAFICO = 660;
const COMPRAS_REGISTRO_DESDE = '2026-05-05';

const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

type Consulta = { api: string; nivel: NivelInforme; otroNivel: string };

function leerConsulta(): Consulta {
  const q = new URLSearchParams(window.location.search);
  const nivel: NivelInforme = q.get('nivel') === 'completo' ? 'completo' : 'ejecutivo';
  const otro = new URLSearchParams(q);
  otro.set('nivel', nivel === 'completo' ? 'ejecutivo' : 'completo');
  q.delete('nivel');
  q.delete('anio');
  q.set('comparativa', 'periodo-anterior');
  return { api: q.toString(), nivel, otroNivel: otro.toString() };
}

function fmtPct(n: number): string {
  return `${n.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`;
}

function fmtVarTexto(pct: number | null): string {
  if (pct === null) return 'sin base comparable';
  return `${pct < 0 ? '−' : '+'}${fmtVariacion(pct)} %`;
}

function filtrosTexto(datos: AnalisisDatos): string[] {
  const { scope } = datos;
  const partes: string[] = [];
  if (scope.servicio) partes.push(`Servicio: ${scope.servicio}`);
  if (scope.grupo) partes.push(`Tipo tumoral: ${GRUPO_LABELS[scope.grupo as keyof typeof GRUPO_LABELS] ?? scope.grupo}`);
  if (scope.via) partes.push(`Vía: ${VIA_META[scope.via].label}`);
  if (scope.cn) {
    const med = datos.medicamentos.find((m) => m.cn === scope.cn);
    partes.push(`Medicamento: ${med ? med.principioActivo || med.nombre : `CN ${scope.cn}`}`);
  }
  return partes;
}

function construirResumen(datos: AnalisisDatos): string[] {
  const frases: string[] = [];
  const { kpis, scope } = datos;

  frases.push(
    kpis.variacionYoy === null
      ? `El gasto valorizado del período es de ${fmtEur(kpis.totalGasto)}, sin base comparable en el período anterior.`
      : `El gasto valorizado del período es de ${fmtEur(kpis.totalGasto)}, un ${fmtVarTexto(kpis.variacionYoy)} frente al período anterior.`,
  );

  const servicios = [...datos.servicios].sort((a, b) => b.totalGasto - a.totalGasto);
  const servicioSel = scope.servicio ? servicios.find((s) => s.servicio === scope.servicio) : undefined;
  if (servicioSel) {
    frases.push(
      `El servicio ${servicioSel.servicio} supone el ${fmtPct(servicioSel.pctGasto)} del gasto entre servicios (${fmtEur(servicioSel.totalGasto)}, ${fmtVarTexto(servicioSel.variacionYoy)}).`,
    );
  } else if (servicios[0]) {
    frases.push(
      `El servicio con mayor gasto es ${servicios[0].servicio}, con el ${fmtPct(servicios[0].pctGasto)} (${fmtEur(servicios[0].totalGasto)}).`,
    );
  }

  const iv = datos.vias.find((v) => v.via === 'IV');
  const oral = datos.vias.find((v) => v.via === 'ORAL');
  if (iv && oral && (iv.totalGasto === 0 || oral.totalGasto === 0) && iv.totalGasto + oral.totalGasto > 0) {
    frases.push(`Todo el gasto corresponde a medicamentos ${iv.totalGasto > 0 ? 'IV' : 'orales'}.`);
  } else if (iv && oral && iv.totalGasto + oral.totalGasto > 0) {
    frases.push(
      `Por vía, el gasto IV es de ${fmtEur(iv.totalGasto)} (${fmtPct(iv.pctGasto)}, ${fmtVarTexto(iv.variacionYoy)}) y el oral de ${fmtEur(oral.totalGasto)} (${fmtPct(oral.pctGasto)}, ${fmtVarTexto(oral.variacionYoy)}).`,
    );
  }

  const grupos = [...datos.grupos].filter((g) => g.totalGasto > 0).sort((a, b) => b.totalGasto - a.totalGasto);
  const grupoSel = scope.grupo ? grupos.find((g) => g.grupo === scope.grupo) : undefined;
  if (grupoSel) {
    frases.push(
      `El tipo tumoral ${grupoSel.label} representa el ${fmtPct(grupoSel.pctGasto)} del gasto (${fmtEur(grupoSel.totalGasto)}, ${fmtVarTexto(grupoSel.variacionYoy)}).`,
    );
  } else if (grupos[0]) {
    frases.push(
      `El tipo tumoral con mayor gasto es ${grupos[0].label} (${fmtPct(grupos[0].pctGasto)}, ${fmtVarTexto(grupos[0].variacionYoy)}).`,
    );
  }

  const incrementos = datos.medicamentos
    .filter((m) => m.variacionYoy !== null && m.variacionYoy > 0)
    .map((m) => ({ nombre: m.principioActivo || m.nombre, inc: m.totalGasto - m.totalGasto / (1 + (m.variacionYoy ?? 0) / 100) }))
    .sort((a, b) => b.inc - a.inc)
    .slice(0, 3);
  if (incrementos.length > 0 && !scope.cn) {
    const lista = incrementos.map((i) => `${i.nombre} (+${fmtEur(i.inc)})`);
    const texto = lista.length > 1 ? `${lista.slice(0, -1).join(', ')} y ${lista.at(-1)}` : lista[0];
    frases.push(`Los mayores incrementos de gasto corresponden a ${texto}.`);
  }

  const med = datos.medicamentoDetalle;
  if (med) {
    frases.push(
      `${med.principioActivo || med.nombre}: consumo de ${fmtEur(med.consumo.totalGasto)} (${fmtQty(med.consumo.totalViales)} cajas, ${fmtVarTexto(med.consumo.variacionYoy)}) y compras recibidas de ${fmtEur(med.compras.totalGasto)} en ${med.compras.nPedidosRecibidos} pedidos.`,
    );
  }

  return frases;
}

function Seccion({
  titulo,
  subtitulo,
  children,
  partible = false,
}: {
  titulo: string;
  subtitulo?: string;
  children: ReactNode;
  /** Tablas largas: se permite el salto de página dentro de la sección. */
  partible?: boolean;
}) {
  return (
    <section className={`mt-6 ${partible ? '' : 'break-inside-avoid'}`}>
      <h2 className="border-b border-slate-300 pb-1 text-[13px] font-bold uppercase tracking-wide text-[#1e3a5f] break-after-avoid">
        {titulo}
      </h2>
      {subtitulo && <p className="mt-1 text-[10px] text-slate-500">{subtitulo}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Kpi({ label, value, sub, pct }: { label: string; value: string; sub?: string; pct?: number | null }) {
  return (
    <div className="break-inside-avoid rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-0.5 text-[17px] font-bold tabular-nums text-slate-900">{value}</p>
      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-500">
        {pct !== undefined && <YoyBadge pct={pct} />}
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

const TH = 'px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-wide text-slate-500';
const THR = `${TH} text-right`;
const TD = 'px-2 py-1 align-top';
const TDR = `${TD} text-right tabular-nums`;

function Tabla({ cabecera, children }: { cabecera: ReactNode; children: ReactNode }) {
  return (
    <table className="w-full border-collapse text-[10px] text-slate-700">
      <thead className="bg-slate-100">{cabecera}</thead>
      <tbody className="[&>tr]:break-inside-avoid [&>tr]:border-b [&>tr]:border-slate-100">{children}</tbody>
    </table>
  );
}

function ViaTag({ via }: { via: keyof typeof VIA_META }) {
  return (
    <span
      className="rounded px-1 py-px text-[8px] font-bold text-white"
      style={{ backgroundColor: VIA_META[via].color }}
    >
      {VIA_META[via].label}
    </span>
  );
}

function ServiciosBarras({ datos }: { datos: AnalisisDatos }) {
  const servicios = [...datos.servicios].sort((a, b) => b.totalGasto - a.totalGasto);
  const max = Math.max(1, ...servicios.map((s) => s.totalGasto));
  const hayFoco = !!datos.scope.servicio;
  return (
    <div className="space-y-1.5">
      {servicios.map((s) => {
        const sel = s.servicio === datos.scope.servicio;
        const color = hayFoco && !sel ? '#cbd5e1' : getServiceColor(s.servicioKey);
        return (
          <div
            key={s.servicioKey}
            className={`grid grid-cols-[140px_1fr_78px_44px_100px] items-center gap-2 text-[10px] ${hayFoco && !sel ? 'text-slate-400' : 'text-slate-800'}`}
          >
            <span className={`truncate ${sel ? 'font-bold' : 'font-medium'}`}>{s.servicio}</span>
            <div className="h-3 rounded-sm bg-slate-100">
              <div className="h-3 rounded-sm" style={{ width: `${(s.totalGasto / max) * 100}%`, backgroundColor: color }} />
            </div>
            <span className="text-right font-semibold tabular-nums">{fmtEur(s.totalGasto)}</span>
            <span className="text-right tabular-nums">{fmtPct(s.pctGasto)}</span>
            <span className="text-right"><YoyBadge pct={s.variacionYoy} /></span>
          </div>
        );
      })}
      {servicios.length === 0 && <p className="text-[10px] text-slate-400">Sin servicios con consumo.</p>}
    </div>
  );
}

function GruposTabla({ datos }: { datos: AnalisisDatos }) {
  const grupos = [...datos.grupos].filter((g) => g.totalGasto > 0).sort((a, b) => b.totalGasto - a.totalGasto);
  const mostrarVia = !datos.scope.via;
  return (
    <Tabla
      cabecera={
        <tr>
          <th className={TH}>Tipo tumoral</th>
          <th className={THR}>Gasto</th>
          <th className={THR}>%</th>
          <th className={THR}>Variación</th>
          <th className={THR}>Medicamentos</th>
          {mostrarVia && <th className={TH}>Reparto IV / Oral</th>}
        </tr>
      }
    >
      {grupos.map((g) => {
        const sel = g.grupo === datos.scope.grupo;
        return (
          <tr key={g.grupo} className={sel ? 'bg-amber-50 font-semibold' : ''}>
            <td className={TD}>
              <span className="mr-1.5 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: GRUPO_COLORS[g.grupo].chart }} />
              {g.label}
            </td>
            <td className={TDR}>{fmtEur(g.totalGasto)}</td>
            <td className={TDR}>{fmtPct(g.pctGasto)}</td>
            <td className={TDR}><YoyBadge pct={g.variacionYoy} /></td>
            <td className={TDR}>{g.medicamentosDistintos}</td>
            {mostrarVia && <td className={`${TD} w-40 [&>div]:mt-0`}><ViaSplitBar porVia={g.gastoPorVia} /></td>}
          </tr>
        );
      })}
    </Tabla>
  );
}

function MedicamentosTop({ datos }: { datos: AnalisisDatos }) {
  const top = [...datos.medicamentos].sort((a, b) => b.totalGasto - a.totalGasto).slice(0, 10);
  return (
    <Tabla
      cabecera={
        <tr>
          <th className={THR}>#</th>
          <th className={TH}>Medicamento</th>
          <th className={TH}>Vía</th>
          <th className={TH}>Tipo tumoral</th>
          <th className={THR}>Gasto</th>
          <th className={THR}>Cajas eq.</th>
          <th className={THR}>Variación</th>
        </tr>
      }
    >
      {top.map((m, i) => (
        <tr key={m.cn} className={m.cn === datos.scope.cn ? 'bg-amber-50 font-semibold' : ''}>
          <td className={TDR}>{i + 1}</td>
          <td className={TD}>
            <span className="font-medium text-slate-900">{m.principioActivo || m.nombre}</span>
            <span className="block text-[9px] text-slate-500">CN {m.cn} · {m.nombre}</span>
          </td>
          <td className={TD}><ViaTag via={m.via} /></td>
          <td className={TD}>{GRUPO_LABELS[m.grupo]}</td>
          <td className={TDR}>{fmtEur(m.totalGasto)}</td>
          <td className={TDR}>{fmtQty(m.totalViales)}</td>
          <td className={TDR}><YoyBadge pct={m.variacionYoy} /></td>
        </tr>
      ))}
    </Tabla>
  );
}

function protocolosConNombre(datos: AnalisisDatos) {
  return datos.topProtocolos.filter((p) => p.protocolo && p.protocolo !== '—');
}

function ProtocolosTop({ datos }: { datos: AnalisisDatos }) {
  return (
    <Tabla
      cabecera={
        <tr>
          <th className={TH}>Protocolo</th>
          <th className={THR}>Gasto</th>
          <th className={THR}>Preparaciones</th>
          <th className={THR}>€ / preparación</th>
          <th className={THR}>Medicamentos</th>
        </tr>
      }
    >
      {protocolosConNombre(datos).slice(0, 10).map((p) => (
        <tr key={p.protocolo}>
          <td className={TD}>{p.protocolo}</td>
          <td className={TDR}>{fmtEur(p.totalGasto)}</td>
          <td className={TDR}>{fmtQty(p.totalPreparaciones, 0)}</td>
          <td className={TDR}>{fmtEur(p.costePorPreparacion)}</td>
          <td className={TDR}>{p.medicamentosDistintos}</td>
        </tr>
      ))}
    </Tabla>
  );
}

function DesgloseDiagnostico({ datos }: { datos: AnalisisDatos }) {
  const detalle = datos.grupoDetalle;
  if (!detalle) return null;
  const total = detalle.kpis.totalGasto || 1;
  return (
    <Tabla
      cabecera={
        <tr>
          <th className={TH}>Diagnóstico / indicación</th>
          <th className={TH}>Principales protocolos</th>
          <th className={THR}>Gasto</th>
          <th className={THR}>% grupo</th>
          <th className={THR}>Prep. / disp.</th>
        </tr>
      }
    >
      {detalle.diagnosticos.flatMap((dx) => [
        <tr key={`dx-${dx.diagnostico}`} className="bg-slate-50 font-semibold text-slate-900">
          <td className={TD} colSpan={2}>{dx.diagnostico || 'Sin diagnóstico'}</td>
          <td className={TDR}>{fmtEur(dx.totalGasto)}</td>
          <td className={TDR}>{fmtPct((dx.totalGasto / total) * 100)}</td>
          <td className={TDR}>{fmtQty(dx.totalPreparaciones, 0)}</td>
        </tr>,
        ...dx.indicaciones.map((ind) => (
          <tr key={`ind-${dx.diagnostico}-${ind.indicacion}`}>
            <td className={`${TD} pl-5`}>{ind.indicacion || 'Sin indicación'}</td>
            <td className={`${TD} text-[9px] text-slate-500`}>
              {ind.protocolos.slice(0, 3).map((p) => p.protocolo).filter(Boolean).join(' · ') || '—'}
            </td>
            <td className={TDR}>{fmtEur(ind.totalGasto)}</td>
            <td className={TDR}>{fmtPct((ind.totalGasto / total) * 100)}</td>
            <td className={TDR}>{fmtQty(ind.totalPreparaciones, 0)}</td>
          </tr>
        )),
      ])}
    </Tabla>
  );
}

function ParetoTabla({ datos }: { datos: AnalisisDatos }) {
  const colorClase = { A: 'bg-rose-100 text-rose-800', B: 'bg-amber-100 text-amber-800', C: 'bg-slate-100 text-slate-600' } as const;
  return (
    <Tabla
      cabecera={
        <tr>
          <th className={THR}>#</th>
          <th className={TH}>Medicamento</th>
          <th className={THR}>Gasto</th>
          <th className={THR}>% del total</th>
          <th className={THR}>% acumulado</th>
          <th className={TH}>Clase</th>
        </tr>
      }
    >
      {datos.pareto.map((p, i) => (
        <tr key={p.cn}>
          <td className={TDR}>{i + 1}</td>
          <td className={TD}>
            {p.principioActivo || p.nombre}
            <span className="ml-1 text-[9px] text-slate-400">CN {p.cn}</span>
          </td>
          <td className={TDR}>{fmtEur(p.gasto)}</td>
          <td className={TDR}>{fmtPct(p.pctTotal)}</td>
          <td className={TDR}>{fmtPct(p.pctAcumulado)}</td>
          <td className={TD}>
            <span className={`rounded px-1.5 py-px text-[9px] font-bold ${colorClase[p.clase]}`}>{p.clase}</span>
          </td>
        </tr>
      ))}
    </Tabla>
  );
}

function OutliersTabla({ datos }: { datos: AnalisisDatos }) {
  return (
    <Tabla
      cabecera={
        <tr>
          <th className={TH}>Semana</th>
          <th className={TH}>Medicamento</th>
          <th className={TH}>Protocolo</th>
          <th className={THR}>Gasto semana</th>
          <th className={THR}>Media semanal</th>
          <th className={THR}>Ratio</th>
        </tr>
      }
    >
      {datos.outliers.map((o) => (
        <tr key={`${o.cn}-${o.semanaLabel}-${o.protocolo}`}>
          <td className={TD}>{o.semanaLabel}</td>
          <td className={TD}>{o.principioActivo}</td>
          <td className={TD}>{o.protocolo}</td>
          <td className={TDR}>{fmtEur(o.gastoSemana)}</td>
          <td className={TDR}>{fmtEur(o.mediaSemanal)}</td>
          <td className={TDR}>×{o.ratio.toLocaleString('es-ES', { maximumFractionDigits: 1 })}</td>
        </tr>
      ))}
    </Tabla>
  );
}

function FichaMedicamento({ med }: { med: MedicamentoDetalle }) {
  const meses = med.temporalMensual.filter((p) => p.consumoCajas > 0 || p.comprasCajas > 0);
  return (
    <div className="space-y-3">
      <div className="break-inside-avoid space-y-3">
        <div>
          <p className="text-[13px] font-bold text-slate-900">{med.principioActivo || med.nombre}</p>
          <p className="text-[10px] text-slate-500">
            CN {med.cn} · {med.nombre} · {GRUPO_LABELS[med.grupo]} · {fmtQty(med.unidadesPorCaja, 0)} uds/caja · {fmtEur(med.precioUnidad)} / ud
          </p>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <Kpi label="Consumo valorizado" value={fmtEur(med.consumo.totalGasto)} pct={med.consumo.variacionYoy} />
          <Kpi label="Consumo cajas eq." value={fmtQty(med.consumo.totalViales)} sub={`${fmtQty(med.consumo.totalPreparaciones, 0)} prep./disp.`} />
          <Kpi label="Compras recibidas" value={fmtEur(med.compras.totalGasto)} sub={`${med.compras.nPedidosRecibidos} pedidos`} />
          <Kpi label="Compras cajas" value={fmtQty(med.compras.totalViales)} sub={`${fmtQty(med.compras.totalUnidades, 0)} uds`} />
        </div>
      </div>
      {meses.length > 0 && (
        <Tabla
          cabecera={
            <tr>
              <th className={TH}>Mes</th>
              <th className={THR}>Consumo cajas</th>
              <th className={THR}>Compras cajas</th>
              <th className={THR}>Consumo €</th>
              <th className={THR}>Compras €</th>
            </tr>
          }
        >
          {meses.map((p) => (
            <tr key={`${p.anio}-${p.mes}`}>
              <td className={TD}>{MESES_CORTOS[p.mes - 1]} {p.anio}</td>
              <td className={TDR}>{fmtQty(p.consumoCajas)}</td>
              <td className={TDR}>{fmtQty(p.comprasCajas)}</td>
              <td className={TDR}>{fmtEur(p.consumoGasto)}</td>
              <td className={TDR}>{fmtEur(p.comprasGasto)}</td>
            </tr>
          ))}
        </Tabla>
      )}
      <p className="text-[9px] text-slate-500">
        Las compras corresponden al área completa (no se filtran por servicio, tipo tumoral ni vía) y solo existen
        registros desde el {fmtDate(COMPRAS_REGISTRO_DESDE)}: los meses anteriores aparecen sin compras.
      </p>
    </div>
  );
}

function Informe({ datos, nivel }: { datos: AnalisisDatos; nivel: NivelInforme }) {
  const filtros = filtrosTexto(datos);
  const resumen = construirResumen(datos);
  const completo = nivel === 'completo';
  const via = datos.scope.via;
  const generado = new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <article className="mx-auto w-[186mm] max-w-full bg-white text-slate-800">
      <header className="flex items-start justify-between gap-4 border-b-2 border-[#1e3a5f] pb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Servicio de Farmacia · Hospital de Manacor
          </p>
          <h1 className="mt-0.5 text-[20px] font-bold leading-tight text-[#1e3a5f]">
            Informe de análisis de Oncología
            <span className="ml-2 align-middle text-[11px] font-semibold text-slate-500">
              {completo ? 'Completo' : 'Ejecutivo'}
            </span>
          </h1>
          <p className="mt-1 text-[11px] text-slate-700">
            Período <strong>{fmtDate(datos.periodo.desde)} – {fmtDate(datos.periodo.hasta)}</strong>
            {' · '}Comparativa: {datos.comparativa.etiqueta}
          </p>
          <p className="text-[11px] text-slate-700">
            {filtros.length > 0 ? filtros.join(' · ') : 'Vista global del área de Oncología'}
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/Logo-Hospital-neg-MANACOR.jpg" alt="Hospital de Manacor" className="h-12 w-auto flex-shrink-0 rounded" />
      </header>

      <Seccion titulo="Indicadores clave">
        <div className="grid grid-cols-4 gap-2">
          <Kpi label="Gasto valorizado" value={fmtEur(datos.kpis.totalGasto)} pct={datos.kpis.variacionYoy} />
          <Kpi label="Consumo cajas eq." value={fmtQty(datos.kpis.totalViales)} />
          <Kpi label="Prep. / dispensaciones" value={fmtQty(datos.kpis.totalPreparaciones, 0)} />
          <Kpi label="Medicamentos" value={String(datos.kpis.medicamentosDistintos)} sub={`${datos.kpis.serviciosActivos} servicios`} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {datos.vias.map((v) => {
            const atenuado = !!via && via !== v.via;
            return (
              <div
                key={v.via}
                className={`rounded-lg border-l-4 border border-slate-200 px-3 py-2 ${atenuado ? 'opacity-50' : ''}`}
                style={{ borderLeftColor: VIA_META[v.via].color }}
              >
                <div className="flex items-baseline justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: VIA_META[v.via].color }}>
                    Medicamentos {v.label}
                  </p>
                  <YoyBadge pct={v.variacionYoy} />
                </div>
                <p className="mt-0.5 text-[16px] font-bold tabular-nums text-slate-900">
                  {fmtEur(v.totalGasto)}
                  <span className="ml-1.5 text-[10px] font-medium text-slate-500">{fmtPct(v.pctGasto)} del gasto</span>
                </p>
                <p className="text-[10px] text-slate-500">
                  {v.medicamentosDistintos} medicamentos · {fmtQty(v.totalPreparaciones, 0)} {VIA_META[v.via].actividad}
                  {v.via === 'IV' && ` · ${v.protocolosActivos} protocolos`}
                </p>
              </div>
            );
          })}
        </div>
      </Seccion>

      <Seccion titulo="Resumen">
        <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-slate-800">
          {resumen.map((f) => <li key={f}>{f}</li>)}
        </ul>
      </Seccion>

      <Seccion titulo="Evolución mensual" subtitulo="Barras de consumo coloreadas por año; gasto apilado por tipo tumoral. El mes en curso está incompleto.">
        <TemporalChart
          data={datos.temporalHistorico}
          title="Evolución mensual del alcance"
          emptyHint="Sin consumo mensual para el rango seleccionado."
          showGrupoBreakdown
          showMediaMovil
          anchoFijo={ANCHO_GRAFICO}
        />
      </Seccion>

      {completo && datos.temporalReciente.length > 0 && (
        <Seccion titulo="Detalle semanal">
          <TemporalChart
            data={datos.temporalReciente}
            title="Detalle semanal del alcance"
            emptyHint="Sin consumo semanal."
            anchoFijo={ANCHO_GRAFICO}
          />
        </Seccion>
      )}

      <Seccion
        titulo="Gasto por servicio"
        subtitulo={datos.scope.servicio ? `Destacado: ${datos.scope.servicio}. Calculado sobre el tipo tumoral y la vía seleccionados.` : undefined}
      >
        <ServiciosBarras datos={datos} />
      </Seccion>

      <Seccion titulo="Gasto por tipo tumoral" partible>
        <GruposTabla datos={datos} />
      </Seccion>

      <Seccion titulo="Principales medicamentos" subtitulo="Los 10 de mayor gasto en el alcance." partible>
        <MedicamentosTop datos={datos} />
      </Seccion>

      {via !== 'ORAL' && protocolosConNombre(datos).length > 0 && (
        <Seccion titulo="Principales protocolos" subtitulo="Solo consumo con protocolo asignado." partible>
          <ProtocolosTop datos={datos} />
        </Seccion>
      )}

      {completo && datos.grupoDetalle && (
        <Seccion titulo={`Desglose diagnóstico · ${datos.grupoDetalle.label}`} partible>
          <DesgloseDiagnostico datos={datos} />
        </Seccion>
      )}

      {completo && datos.pareto.length > 0 && (
        <Seccion titulo="Concentración del gasto (Pareto ABC)" subtitulo="A: hasta el 80 % acumulado · B: hasta el 95 % · C: resto." partible>
          <ParetoTabla datos={datos} />
        </Seccion>
      )}

      {completo && datos.outliers.length > 0 && (
        <Seccion titulo="Semanas atípicas" subtitulo="Semanas con gasto superior a la media más dos desviaciones típicas del medicamento." partible>
          <OutliersTabla datos={datos} />
        </Seccion>
      )}

      {completo && datos.medicamentoDetalle && (
        <Seccion titulo="Ficha del medicamento: consumo y compras" partible>
          <FichaMedicamento med={datos.medicamentoDetalle} />
        </Seccion>
      )}

      <Seccion titulo="Nota metodológica">
        <ul className="list-disc space-y-0.5 pl-4 text-[9px] leading-snug text-slate-500">
          <li>Gasto valorizado: consumo registrado por el precio unitario del catálogo. Cajas equivalentes: unidades consumidas entre unidades por caja.</li>
          <li>Variaciones frente al período anterior equivalente: {datos.comparativa.etiqueta}.</li>
          <li>Vía oral: medicamentos con vía oral en catálogo o terapia oral; el resto se agrupa como IV.</li>
          <li>Media móvil de 3 meses: no se calcula en ventanas que incluyen el mes en curso.</li>
          <li>Generado el {generado} desde HMAN-Pedidos.</li>
        </ul>
      </Seccion>
    </article>
  );
}

export default function InformeAnalisisPage() {
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [datos, setDatos] = useState<AnalisisDatos | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConsulta(leerConsulta());
  }, []);

  useEffect(() => {
    if (!consulta) return;
    let cancelled = false;
    fetch(`/api/analisis/datos?${consulta.api}`)
      .then((res) => res.ok ? res.json() : res.json().then((p) => Promise.reject(p?.error ?? 'Error al cargar el análisis')))
      .then((payload: AnalisisDatos) => { if (!cancelled) setDatos(payload); })
      .catch((err) => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [consulta]);

  useEffect(() => {
    if (!datos) return;
    document.title = `Informe Oncología ${datos.periodo.desde} a ${datos.periodo.hasta}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activo = true;
    document.fonts.ready.then(() => {
      if (activo) timer = setTimeout(() => window.print(), 600);
    });
    return () => {
      activo = false;
      if (timer) clearTimeout(timer);
    };
  }, [datos]);

  return (
    <div className="bg-slate-100 print:bg-white">
      <style>{`
        @page {
          size: A4;
          margin: 12mm 12mm 14mm;
          @bottom-left { content: "Farmacia · Hospital de Manacor"; font-size: 8pt; color: #64748b; }
          @bottom-right { content: "Página " counter(page) " de " counter(pages); font-size: 8pt; color: #64748b; }
        }
        @media print {
          html, body { background: #fff !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 shadow-sm print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!datos}
          className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-40"
        >
          Imprimir / Guardar como PDF
        </button>
        {consulta && (
          <a
            href={`/analisis/informe?${consulta.otroNivel}`}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Ver informe {consulta.nivel === 'completo' ? 'ejecutivo' : 'completo'}
          </a>
        )}
        <button
          type="button"
          onClick={() => window.close()}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Cerrar
        </button>
        <span className="text-[11px] text-slate-500">
          En el diálogo de impresión elige «Guardar como PDF» como destino.
        </span>
      </div>

      {error && <p className="mx-auto w-[186mm] rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      {!datos && !error && <p className="py-16 text-center text-sm text-slate-500">Preparando informe…</p>}
      {datos && consulta && (
        <div className="py-6 print:py-0">
          <div className="mx-auto w-[calc(186mm+48px)] max-w-full rounded-lg bg-white p-6 shadow print:w-auto print:p-0 print:shadow-none">
            <Informe datos={datos} nivel={consulta.nivel} />
          </div>
        </div>
      )}
    </div>
  );
}
