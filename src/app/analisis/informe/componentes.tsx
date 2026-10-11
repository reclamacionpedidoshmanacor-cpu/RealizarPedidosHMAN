'use client';

import type { ReactNode } from 'react';
import { VIA_META, YoyBadge } from '../AnalisisOncologiaPage';

/** Ancho útil de A4 con márgenes de 12 mm (186 mm ≈ 703 px) menos el padding de la tarjeta. */
export const ANCHO_GRAFICO = 660;

export function Seccion({
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

export function Kpi({ label, value, sub, pct }: { label: string; value: string; sub?: ReactNode; pct?: number | null }) {
  return (
    <div className="break-inside-avoid rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-0.5 text-[17px] font-bold tabular-nums text-slate-900">{value}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] leading-tight text-slate-500">
        {pct !== undefined && <YoyBadge pct={pct} />}
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

export const TH = 'px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-wide text-slate-500';
export const THR = `${TH} text-right`;
export const TD = 'px-2 py-1 align-top';
export const TDR = `${TD} text-right tabular-nums`;

export function Tabla({ cabecera, children }: { cabecera: ReactNode; children: ReactNode }) {
  return (
    <table className="w-full border-collapse text-[10px] text-slate-700">
      <thead className="bg-slate-100">{cabecera}</thead>
      <tbody className="[&>tr]:break-inside-avoid [&>tr]:border-b [&>tr]:border-slate-100">{children}</tbody>
    </table>
  );
}

export function ViaTag({ via }: { via: keyof typeof VIA_META }) {
  return (
    <span
      className="rounded px-1 py-px text-[8px] font-bold text-white"
      style={{ backgroundColor: VIA_META[via].texto }}
    >
      {VIA_META[via].label}
    </span>
  );
}

export function EstilosImpresion() {
  return (
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
  );
}

export function CabeceraInforme({ titulo, etiqueta, lineas }: { titulo: string; etiqueta?: string; lineas: ReactNode[] }) {
  return (
    <header className="flex items-start justify-between gap-4 border-b-2 border-[#1e3a5f] pb-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          Servicio de Farmacia · Hospital de Manacor
        </p>
        <h1 className="mt-0.5 text-[20px] font-bold leading-tight text-[#1e3a5f]">
          {titulo}
          {etiqueta && <span className="ml-2 align-middle text-[11px] font-semibold text-slate-500">{etiqueta}</span>}
        </h1>
        {lineas.map((l, i) => (
          <p key={i} className={`${i === 0 ? 'mt-1 ' : ''}text-[11px] text-slate-700`}>{l}</p>
        ))}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/Logo-Hospital-neg-MANACOR.jpg" alt="Hospital de Manacor" className="h-12 w-auto flex-shrink-0 rounded" />
    </header>
  );
}
