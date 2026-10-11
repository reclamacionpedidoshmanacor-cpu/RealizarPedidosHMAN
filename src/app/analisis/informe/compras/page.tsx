'use client';

import { useEffect, useState } from 'react';
import type { ComprasConsumoDatos, TotalesCompraConsumo } from '@/lib/analisis-neon';
import {
  INICIO_SEMANAS_HDD,
  fmtCajasSigno,
  fmtDate,
  fmtEur,
  fmtQty,
} from '../../AnalisisOncologiaPage';
import { GraficoCompraConsumo, filasCompraConsumo, inicioSinConsumoFinal } from '../../ComprasConsumoTab';
import {
  ANCHO_GRAFICO,
  CabeceraInforme,
  EstilosImpresion,
  Kpi,
  Seccion,
  TD,
  TDR,
  TH,
  THR,
  Tabla,
  ViaTag,
} from '../componentes';

type Vista = 'mensual' | 'semanal';
type Consulta = { api: string; desde: string; vista: Vista };

const ALTO_GRAFICO_GENERAL = 220;
const ALTO_GRAFICO_MEDICAMENTO = 170;
/** Diferencias menores no se destacan en el resumen. */
const UMBRAL_CAJAS_RESUMEN = 0.5;

function leerConsulta(): Consulta {
  const q = new URLSearchParams(window.location.search);
  const api = new URLSearchParams();
  api.set('desde', q.get('desde') ?? '');
  api.set('hasta', q.get('hasta') ?? '');
  if (q.get('cns')) api.set('cns', q.get('cns')!);
  return { api: api.toString(), desde: q.get('desde') ?? '', vista: q.get('vista') === 'semanal' ? 'semanal' : 'mensual' };
}

function fmtPct(n: number): string {
  return `${n.toLocaleString('es-ES', { maximumFractionDigits: n >= 100 ? 0 : 1 })} %`;
}

function comparar(t: TotalesCompraConsumo) {
  return {
    difEur: t.comprasGasto - t.consumoComparableGasto,
    difCajas: t.comprasCajas - t.consumoComparableCajas,
    cobertura: t.consumoComparableGasto > 0 ? (t.comprasGasto / t.consumoComparableGasto) * 100 : null,
  };
}

function nombreMed(m: { principioActivo: string; nombre: string }): string {
  return m.principioActivo || m.nombre;
}

function enumerar(items: string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items.at(-1)}` : items[0] ?? '';
}

function construirResumen(datos: ComprasConsumoDatos): string[] {
  const t = datos.totales;
  const c = comparar(t);
  const frases: string[] = [];
  const desde = datos.comparableDesde;
  if (!desde) {
    frases.push('El período termina antes del inicio del registro de compras: no hay compras que comparar.');
  } else {
    frases.push(
      `Desde el ${fmtDate(desde)}, la compra valorizada ${datos.medicamentos.length > 1 ? 'de la selección ' : ''}es de ${fmtEur(t.comprasGasto)} ` +
      `(${fmtQty(t.comprasCajas)} cajas en ${t.pedidosRecibidos} pedidos) frente a un consumo valorizado de ${fmtEur(t.consumoComparableGasto)} ` +
      `(${fmtQty(t.consumoComparableCajas)} cajas)${c.cobertura == null ? '' : `: cobertura del ${fmtPct(c.cobertura)}`}.`,
    );
    frases.push(
      `La diferencia compra − consumo es de ${fmtEur(c.difEur)} y ${fmtCajasSigno(c.difCajas)} cajas` +
      `${c.difCajas > UMBRAL_CAJAS_RESUMEN ? ' (se ha comprado más de lo consumido)' : c.difCajas < -UMBRAL_CAJAS_RESUMEN ? ' (se ha consumido más de lo comprado)' : ''}.`,
    );
  }
  if (t.consumoGasto - t.consumoComparableGasto > 0.5) {
    frases.push(
      `El consumo de todo el período (${fmtDate(datos.periodo.desde)} – ${fmtDate(datos.periodo.hasta)}) es de ${fmtEur(t.consumoGasto)} · ${fmtQty(t.consumoCajas)} cajas.`,
    );
  }
  if (desde && datos.medicamentos.length > 1) {
    const difs = datos.medicamentos.map((m) => ({ m, dif: comparar(m).difCajas }));
    const exceso = difs.filter((d) => d.dif > UMBRAL_CAJAS_RESUMEN).sort((a, b) => b.dif - a.dif)[0];
    const deficit = difs.filter((d) => d.dif < -UMBRAL_CAJAS_RESUMEN).sort((a, b) => a.dif - b.dif)[0];
    if (exceso) frases.push(`Mayor exceso de compra: ${nombreMed(exceso.m)} (${fmtCajasSigno(exceso.dif)} cajas).`);
    if (deficit) frases.push(`Mayor consumo por encima de la compra: ${nombreMed(deficit.m)} (${fmtCajasSigno(deficit.dif)} cajas).`);
  }
  if (datos.serviciosConsumo.length) {
    frases.push(
      `El consumo corresponde a ${datos.serviciosConsumo.length > 1 ? 'los servicios' : 'el servicio'} ` +
      `${enumerar(datos.serviciosConsumo.map((s) => `${s.servicio} (${fmtPct(s.pct)})`))}.`,
    );
  }
  return frases;
}

function TablaMedicamentos({ datos }: { datos: ComprasConsumoDatos }) {
  const filas = [...datos.medicamentos.map((m) => ({ clave: m.cn, m, total: false })),
    ...(datos.medicamentos.length > 1 ? [{ clave: 'total', m: null, total: true }] : [])];
  return (
    <Tabla
      cabecera={
        <tr>
          <th className={TH}>Medicamento</th>
          <th className={THR}>Consumo €</th>
          <th className={THR}>Compra €</th>
          <th className={THR}>Dif. €</th>
          <th className={THR}>Cajas cons.</th>
          <th className={THR}>Cajas comp.</th>
          <th className={THR}>Dif. cajas</th>
          <th className={THR}>Cobertura</th>
          <th className={THR}>Pedidos</th>
        </tr>
      }
    >
      {filas.map(({ clave, m, total }) => {
        const t = m ?? datos.totales;
        const c = comparar(t);
        return (
          <tr key={clave} className={total ? 'bg-slate-50 font-semibold' : ''}>
            <td className={TD}>
              {m ? (
                <>
                  <span className="flex items-center gap-1">
                    <ViaTag via={m.via} />
                    <span className="font-medium text-slate-900">{nombreMed(m)}</span>
                  </span>
                  <span className="block text-[9px] text-slate-500">
                    CN {m.cn} · {fmtEur(m.precioUnidad)}/ud · {fmtQty(m.unidadesPorCaja, 0)} uds/caja
                  </span>
                </>
              ) : 'Total selección'}
            </td>
            <td className={TDR}>{fmtEur(t.consumoComparableGasto)}</td>
            <td className={TDR}>{fmtEur(t.comprasGasto)}</td>
            <td className={`${TDR} font-semibold`}>{fmtEur(c.difEur)}</td>
            <td className={TDR}>{fmtQty(t.consumoComparableCajas)}</td>
            <td className={TDR}>{fmtQty(t.comprasCajas)}</td>
            <td className={`${TDR} font-semibold`}>{fmtCajasSigno(c.difCajas)}</td>
            <td className={TDR}>{c.cobertura == null ? '—' : fmtPct(c.cobertura)}</td>
            <td className={TDR}>{t.pedidosRecibidos}</td>
          </tr>
        );
      })}
    </Tabla>
  );
}

function TablaPeriodos({ filas, vista }: { filas: ReturnType<typeof filasCompraConsumo>; vista: Vista }) {
  return (
    <Tabla
      cabecera={
        <tr>
          <th className={TH}>{vista === 'semanal' ? 'Semana' : 'Mes'}</th>
          <th className={THR}>Consumo €</th>
          <th className={THR}>Compra €</th>
          <th className={THR}>Cajas consumidas</th>
          <th className={THR}>Cajas compradas</th>
          <th className={THR}>Acumulado (cajas)</th>
        </tr>
      }
    >
      {filas.map((p) => (
        <tr key={p.lunesRef ?? `${p.anio}-${p.mes}`} className={p.sinRegistro ? 'text-slate-400' : ''}>
          <td className={TD}>{p.label}</td>
          <td className={TDR}>{fmtEur(p.consumoGasto)}</td>
          <td className={TDR}>{p.sinRegistro ? 'sin registro' : fmtEur(p.comprasGasto)}</td>
          <td className={TDR}>{fmtQty(p.consumoCajas)}</td>
          <td className={TDR}>{p.sinRegistro ? '—' : fmtQty(p.comprasCajas)}</td>
          <td className={`${TDR} font-semibold`}>{p.acumulado == null ? '—' : fmtCajasSigno(p.acumulado)}</td>
        </tr>
      ))}
    </Tabla>
  );
}

function Informe({ datos, vista, desde }: { datos: ComprasConsumoDatos; vista: Vista; desde: string }) {
  const t = datos.totales;
  const c = comparar(t);
  const varios = datos.medicamentos.length > 1;
  const serie = vista === 'semanal' ? datos.temporalSemanal : datos.temporalMensual;
  const filas = filasCompraConsumo(serie, datos.comprasRegistroDesde);
  const etiquetaVista = vista === 'semanal' ? 'por semanas' : 'por meses';
  const hayHdd = datos.medicamentos.some((m) => m.via === 'IV');
  const resumen = construirResumen(datos);
  const sinConsumoDesde = inicioSinConsumoFinal(filas);

  return (
    <article className="mx-auto w-[186mm] max-w-full bg-white text-slate-800">
      <CabeceraInforme
        titulo="Informe de compras y consumo"
        lineas={[
          <>Período <strong>{fmtDate(datos.periodo.desde)} – {fmtDate(datos.periodo.hasta)}</strong>{' · '}Vista {etiquetaVista}</>,
          `${varios ? `${datos.medicamentos.length} medicamentos` : 'Medicamento'}: ${datos.medicamentos.map(nombreMed).join(' · ')}`,
          datos.comprasRegistroDesde ? `Compras registradas desde el ${fmtDate(datos.comprasRegistroDesde)}` : 'Sin registro de compras',
        ]}
      />

      <Seccion
        titulo="Indicadores clave"
        subtitulo={datos.comparableDesde && datos.comparableDesde > datos.periodo.desde
          ? `Comparación desde el ${fmtDate(datos.comparableDesde)}, inicio del registro de compras.`
          : undefined}
      >
        <div className="grid grid-cols-4 gap-2">
          <Kpi label="Consumo valorizado" value={fmtEur(t.consumoComparableGasto)} sub={`${fmtQty(t.consumoComparableCajas)} cajas`} />
          <Kpi label="Compra valorizada" value={fmtEur(t.comprasGasto)} sub={`${fmtQty(t.comprasCajas)} cajas · ${t.pedidosRecibidos} pedidos`} />
          <Kpi label="Compra − consumo" value={fmtEur(c.difEur)} sub={`${fmtCajasSigno(c.difCajas)} cajas`} />
          <Kpi label="Cobertura" value={c.cobertura == null ? '—' : fmtPct(c.cobertura)} sub="Compra / consumo en euros" />
        </div>
      </Seccion>

      <Seccion titulo="Resumen">
        <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-slate-800">
          {resumen.map((f) => <li key={f}>{f}</li>)}
        </ul>
      </Seccion>

      <Seccion
        titulo="Consumo y compra en euros"
        subtitulo={vista === 'semanal' && hayHdd && desde < INICIO_SEMANAS_HDD
          ? `Hospital de Día solo tiene datos semanales desde el ${fmtDate(INICIO_SEMANAS_HDD)}.`
          : undefined}
      >
        <GraficoCompraConsumo
          filas={filas}
          unidad="eur"
          titulo={`Consumo y compra en euros · ${etiquetaVista}`}
          anchoFijo={ANCHO_GRAFICO}
          altoFijo={ALTO_GRAFICO_GENERAL}
        />
      </Seccion>

      <Seccion titulo="Consumo y compra en cajas" subtitulo="La línea discontinua acumula compra − consumo en cajas desde el inicio del registro de compras.">
        <GraficoCompraConsumo
          filas={filas}
          unidad="cajas"
          titulo={`Consumo y compra en cajas · ${etiquetaVista}`}
          anchoFijo={ANCHO_GRAFICO}
          altoFijo={ALTO_GRAFICO_GENERAL}
        />
      </Seccion>

      <Seccion titulo="Comparación por medicamento" partible>
        <TablaMedicamentos datos={datos} />
      </Seccion>

      <Seccion titulo={`Detalle ${etiquetaVista}`} subtitulo={varios ? 'Suma de los medicamentos seleccionados.' : undefined} partible>
        <TablaPeriodos filas={filas} vista={vista} />
      </Seccion>

      {varios && (
        <Seccion titulo="Detalle por medicamento" subtitulo="Cajas consumidas y compradas de cada medicamento." partible>
          <div className="space-y-4">
            {datos.medicamentos.map((m) => {
              const cm = comparar(m);
              const filasMed = filasCompraConsumo(vista === 'semanal' ? m.temporalSemanal : m.temporalMensual, datos.comprasRegistroDesde);
              return (
                <div key={m.cn} className="break-inside-avoid">
                  <div className="mb-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[10px] text-slate-600">
                    <span className="flex items-center gap-1 text-[11px] font-bold text-slate-900">
                      <ViaTag via={m.via} />
                      {nombreMed(m)}
                    </span>
                    <span>CN {m.cn}</span>
                    <span>Consumo {fmtEur(m.consumoComparableGasto)} · {fmtQty(m.consumoComparableCajas)} cajas</span>
                    <span>Compra {fmtEur(m.comprasGasto)} · {fmtQty(m.comprasCajas)} cajas</span>
                    <span className="font-semibold">Dif. {fmtCajasSigno(cm.difCajas)} cajas</span>
                    <span>Cobertura {cm.cobertura == null ? '—' : fmtPct(cm.cobertura)}</span>
                  </div>
                  <GraficoCompraConsumo
                    filas={filasMed}
                    unidad="cajas"
                    titulo={`${nombreMed(m)} · cajas ${etiquetaVista}`}
                    anchoFijo={ANCHO_GRAFICO}
                    altoFijo={ALTO_GRAFICO_MEDICAMENTO}
                  />
                </div>
              );
            })}
          </div>
        </Seccion>
      )}

      <Seccion titulo="Notas">
        <ul className="list-disc space-y-1 pl-4 text-[10px] leading-relaxed text-slate-600">
          <li>
            Compras: pedidos recibidos de todo el hospital para estos medicamentos, sin desglose por servicio
            {datos.comprasRegistroDesde ? `; registradas desde el ${fmtDate(datos.comprasRegistroDesde)}` : ''}.
          </li>
          <li>
            Consumo: incluye {datos.serviciosConsumo.length > 1 ? 'los servicios' : 'el servicio'}{' '}
            {datos.serviciosConsumo.length
              ? enumerar(datos.serviciosConsumo.map((s) => `${s.servicio} (${fmtPct(s.pct)})`))
              : 'sin consumo en el período'}
            . Si un medicamento también se usa fuera de estos servicios, la compra puede quedar por encima del consumo.
          </li>
          <li>Valoración: consumo y compra en euros con el precio por unidad del catálogo (unidades × precio unidad); las cajas, con las unidades por caja del catálogo.</li>
          {varios && <li>Con varios medicamentos, las cajas se suman aunque las presentaciones sean distintas; el detalle por medicamento muestra cada presentación por separado.</li>}
          <li>Los periodos marcados «sin registro» son anteriores al inicio del registro de compras y no cuentan en el acumulado.</li>
          {sinConsumoDesde && (
            <li>
              Sin consumo cargado desde {vista === 'semanal' ? 'la semana del ' : ''}{sinConsumoDesde}: en esos periodos el acumulado solo suma
              las compras recibidas.
            </li>
          )}
        </ul>
      </Seccion>
    </article>
  );
}

export default function InformeComprasConsumoPage() {
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [datos, setDatos] = useState<ComprasConsumoDatos | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConsulta(leerConsulta());
  }, []);

  useEffect(() => {
    if (!consulta) return;
    let cancelled = false;
    fetch(`/api/analisis/compras-consumo?${consulta.api}`)
      .then((res) => res.ok ? res.json() : res.json().then((p) => Promise.reject(p?.error ?? 'Error al cargar la comparación')))
      .then((payload: ComprasConsumoDatos) => {
        if (cancelled) return;
        if (!payload.medicamentos.length) setError('No hay medicamentos seleccionados con datos en el catálogo del área.');
        else setDatos(payload);
      })
      .catch((err) => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [consulta]);

  useEffect(() => {
    if (!datos) return;
    document.title = `Compras y consumo ${datos.periodo.desde} a ${datos.periodo.hasta}`;
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

  const vista: Vista = consulta?.vista === 'semanal' && (datos?.temporalSemanal.length ?? 0) > 0 ? 'semanal' : 'mensual';

  return (
    <div className="bg-slate-100 print:bg-white">
      <EstilosImpresion />

      <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 shadow-sm print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!datos}
          className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-40"
        >
          Imprimir / Guardar como PDF
        </button>
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
            <Informe datos={datos} vista={vista} desde={consulta.desde} />
          </div>
        </div>
      )}
    </div>
  );
}
