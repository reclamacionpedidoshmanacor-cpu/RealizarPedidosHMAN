'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';

const AREAS = [
  {
    id: 'oncologia',
    label: 'Oncología',
    desc: 'Farmacia Oncológica',
    color: 'border-teal-400 bg-teal-50 text-teal-800',
    activeColor: 'border-teal-600 bg-teal-100 ring-2 ring-teal-500',
    icon: (
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
      </svg>
    ),
  },
  {
    id: 'upe',
    label: 'Pac. Externos',
    desc: 'Unidad de Pacientes Externos',
    color: 'border-violet-400 bg-violet-50 text-violet-800',
    activeColor: 'border-violet-600 bg-violet-100 ring-2 ring-violet-500',
    icon: (
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
  },
  {
    id: 'iv',
    label: 'Medicamentos IV',
    desc: 'Medicación intravenosa general',
    color: 'border-blue-400 bg-blue-50 text-blue-800',
    activeColor: 'border-blue-600 bg-blue-100 ring-2 ring-blue-500',
    icon: (
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    id: 'nutricion',
    label: 'Nutrición',
    desc: 'Nutriciones y dietética',
    color: 'border-amber-400 bg-amber-50 text-amber-800',
    activeColor: 'border-amber-600 bg-amber-100 ring-2 ring-amber-500',
    icon: (
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
      </svg>
    ),
  },
  {
    id: 'almacen',
    label: 'Almacén',
    desc: 'Almacén general de farmacia',
    color: 'border-slate-400 bg-slate-50 text-slate-800',
    activeColor: 'border-slate-600 bg-slate-100 ring-2 ring-slate-500',
    icon: (
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
      </svg>
    ),
  },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const [selectedArea, setSelectedArea] = useState<string>('oncologia');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, area: selectedArea }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Error de autenticación.');
        return;
      }
      router.push('/inicio');
    } catch {
      setError('Error de conexión.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-xl">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <Image
            src="/Logo-Hospital-neg-MANACOR.jpg"
            alt="Hospital de Manacor"
            width={373} height={66}
            className="h-10 w-auto mb-3"
            priority
          />
          <p className="text-sm font-medium text-slate-500 tracking-wide">
            Farmacia — Gestión de Pedidos y Consumo
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Selecciona tu área</h2>
          <p className="text-sm text-slate-500 mb-5">Elige el servicio que vas a gestionar en esta sesión.</p>

          {/* Selector de área */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-7">
            {AREAS.map(area => (
              <button
                key={area.id}
                type="button"
                onClick={() => setSelectedArea(area.id)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all duration-150 cursor-pointer',
                  selectedArea === area.id ? area.activeColor : area.color,
                  'hover:opacity-90'
                )}
              >
                {area.icon}
                <span className="text-xs font-semibold leading-tight">{area.label}</span>
              </button>
            ))}
          </div>

          {/* Contraseña */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Introduce la contraseña"
              className="w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              required
              autoFocus
            />
          </div>

          {error && (
            <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Accediendo…' : `Acceder a ${AREAS.find(a => a.id === selectedArea)?.label ?? ''}`}
          </button>

          <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-center">
            <p className="text-xs text-sky-700 mb-1.5">
              Acceso rápido sin contraseña para recuento manual
            </p>
            <Link
              href="/recuento-manual"
              className="inline-flex rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
            >
              Abrir APP Recuento manual
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
