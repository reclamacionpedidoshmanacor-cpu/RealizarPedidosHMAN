import { cn } from '@/lib/utils';
import type { AlertaSuministroCn } from '@/lib/pedidos-pendientes';

const ESTILOS: Record<AlertaSuministroCn['tipo'], string> = {
  cima: 'bg-red-100 text-red-800 ring-red-200',
  en_falta: 'bg-orange-100 text-orange-800 ring-orange-200',
  sin_existencias: 'bg-orange-100 text-orange-800 ring-orange-200',
  problema_suministro: 'bg-red-100 text-red-800 ring-red-200',
  situacion_especial: 'bg-purple-100 text-purple-800 ring-purple-200',
};

function formatFechaAlerta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

export function badgeSuministroTitle(alerta: AlertaSuministroCn): string {
  const partes = [alerta.etiqueta];
  if (alerta.detalle) partes.push(alerta.detalle);
  if (alerta.fecha) partes.push(formatFechaAlerta(alerta.fecha));
  return partes.join(' · ');
}

export function BadgeSuministro({
  alerta,
  className,
}: {
  alerta: AlertaSuministroCn | null | undefined;
  className?: string;
}) {
  if (!alerta) return null;
  return (
    <span
      title={badgeSuministroTitle(alerta)}
      className={cn(
        'inline-flex max-w-[11rem] truncate rounded-full px-2 py-px text-[10px] font-semibold ring-1 ring-inset',
        ESTILOS[alerta.tipo],
        className,
      )}
    >
      {alerta.etiqueta}
    </span>
  );
}
