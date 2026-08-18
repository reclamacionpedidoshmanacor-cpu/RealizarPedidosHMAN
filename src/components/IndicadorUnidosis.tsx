type IndicadorUnidosisProps = {
  estado: boolean | null | undefined;
  className?: string;
};

export function IndicadorUnidosis({
  estado,
  className = 'h-4 w-4',
}: IndicadorUnidosisProps) {
  if (estado == null) return null;

  const titulo = estado
    ? 'Formato unidosis: cada dosis viene identificada'
    : 'Sin formato unidosis: requiere reenvasado';

  return (
    <span
      className={`relative inline-flex shrink-0 ${className} ${
        estado ? 'text-emerald-500' : 'text-red-500'
      }`}
      title={titulo}
      role="img"
      aria-label={titulo}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-full w-full">
        <g fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2.5" y="2.5" width="7" height="7" rx="0.5" />
          <rect x="14.5" y="2.5" width="7" height="7" rx="0.5" />
          <rect x="2.5" y="14.5" width="7" height="7" rx="0.5" />
        </g>
        <g fill="currentColor">
          <rect x="5" y="5" width="2" height="2" />
          <rect x="17" y="5" width="2" height="2" />
          <rect x="5" y="17" width="2" height="2" />
          <rect x="12" y="11" width="3" height="3" />
          <rect x="17" y="11" width="2" height="3" />
          <rect x="20" y="12" width="2" height="2" />
          <rect x="11" y="16" width="2" height="2" />
          <rect x="14" y="15" width="3" height="2" />
          <rect x="18" y="16" width="4" height="2" />
          <rect x="12" y="20" width="3" height="2" />
          <rect x="17" y="19" width="2" height="3" />
          <rect x="20" y="20" width="2" height="2" />
        </g>
      </svg>
      {!estado && (
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full text-red-700"
        >
          <path
            d="M3 3 21 21M21 3 3 21"
            fill="none"
            stroke="white"
            strokeLinecap="round"
            strokeWidth="4"
          />
          <path
            d="M3 3 21 21M21 3 3 21"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2.25"
          />
        </svg>
      )}
    </span>
  );
}
