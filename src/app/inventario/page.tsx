export default function InventarioPage() {
  return (
    <main className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Inventario</h1>
        <p className="mt-1 text-sm text-slate-500">
          Comparativa entre recuento manual y stock SAP · Cálculo de ajustes (Real − SAP)
        </p>
      </div>

      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-teal-100">
          <svg className="h-6 w-6 text-teal-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-slate-700">Módulo en desarrollo — v0.2.0</h2>
        <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
          Selecciona un recuento manual y un corte de SAP para generar la tabla comparativa
          con el ajuste por medicamento (Real − SAP) y exportarla a Excel.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3 max-w-lg mx-auto text-left">
          {[
            { label: 'Seleccionar recuento manual', icon: '📋' },
            { label: 'Cargar stock SAP', icon: '📊' },
            { label: 'Exportar ajustes a Excel', icon: '📥' },
          ].map(step => (
            <div key={step.label} className="rounded-lg bg-white border border-slate-200 px-4 py-3">
              <span className="text-lg">{step.icon}</span>
              <p className="mt-1 text-xs font-medium text-slate-600">{step.label}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
