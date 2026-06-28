'use client';

import { useEffect, useState } from 'react';
import AnalisisOncologiaPage from './AnalisisOncologiaPage';
import AnalisisUpePage from './AnalisisUpePage';

function getAreaFromCookie(): string {
  if (typeof document === 'undefined') return '';
  return document.cookie.split(';').find((c) => c.trim().startsWith('area_session='))?.split('=')[1] ?? '';
}

function AnalisisNoDisponible({ area }: { area: string }) {
  return (
    <div className="px-6 py-16 text-center">
      <h1 className="text-xl font-bold text-slate-800 mb-2">Análisis no disponible</h1>
      <p className="text-sm text-slate-500 max-w-md mx-auto">
        El análisis para el área <strong className="text-slate-700">{area || 'actual'}</strong> aún no está
        configurado. Oncología y Pacientes Externos tienen su propio panel de análisis.
      </p>
    </div>
  );
}

export default function AnalisisPage() {
  const [area, setArea] = useState<string | null>(null);

  useEffect(() => {
    setArea(getAreaFromCookie());
  }, []);

  if (area === null) {
    return <p className="px-6 py-12 text-sm text-slate-500">Cargando análisis…</p>;
  }

  if (area === 'oncologia') return <AnalisisOncologiaPage />;
  if (area === 'upe') return <AnalisisUpePage />;

  return <AnalisisNoDisponible area={area} />;
}
