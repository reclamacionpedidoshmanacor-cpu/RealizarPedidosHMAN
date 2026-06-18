export default function InicioPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Panel de control</h1>
      <p className="text-sm text-slate-500 mb-6">Resumen del estado actual de la Farmacia Oncológica</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Medicamentos activos', value: '—', color: 'text-teal-600' },
          { label: 'Stock por debajo del mínimo', value: '—', color: 'text-red-500' },
          { label: 'Propuesta pendiente de validar', value: '—', color: 'text-amber-500' },
          { label: 'Alertas activas', value: '—', color: 'text-orange-500' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{card.label}</p>
            <p className={`text-3xl font-bold mt-2 ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
