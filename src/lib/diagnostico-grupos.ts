// Clasificación de diagnósticos en grupos tumorales.
// Archivo compartido entre servidor (analisis-neon.ts) y cliente (pages).

export type DiagnosticoGrupo =
  | 'mama'
  | 'pulmon'
  | 'digestivo'
  | 'ginecologico'
  | 'urologico'
  | 'piel'
  | 'cabeza-cuello'
  | 'snc'
  | 'linfoma'
  | 'leucemia'
  | 'mieloma'
  | 'mielofibrosis'
  | 'pti'
  | 'otros-hemato'
  | 'otros';

export type Servicio = 'oncologia-solida' | 'hematologia';

export const GRUPOS_ONCOLOGIA: DiagnosticoGrupo[] = [
  'mama', 'pulmon', 'digestivo', 'ginecologico',
  'urologico', 'piel', 'cabeza-cuello', 'snc', 'otros',
];

export const GRUPOS_HEMATOLOGIA: DiagnosticoGrupo[] = [
  'linfoma', 'leucemia', 'mieloma', 'mielofibrosis', 'pti', 'otros-hemato',
];

export const GRUPO_ORDER: DiagnosticoGrupo[] = [
  ...GRUPOS_ONCOLOGIA,
  ...GRUPOS_HEMATOLOGIA,
];

export const GRUPO_LABELS: Record<DiagnosticoGrupo, string> = {
  mama:          'Mama',
  pulmon:        'Pulmón',
  digestivo:     'Digestivo',
  ginecologico:  'Ginecológico',
  urologico:     'Urológico',
  piel:          'Piel',
  'cabeza-cuello': 'Cabeza y cuello',
  snc:           'SNC',
  linfoma:       'Linfoma',
  leucemia:      'Leucemia',
  mieloma:       'Mieloma',
  mielofibrosis: 'Mielofibrosis',
  pti:           'PTI',
  'otros-hemato': 'Otros hematológicos',
  otros:         'Otros',
};

export const GRUPO_COLORS: Record<DiagnosticoGrupo, { bg: string; text: string; ring: string; chart: string }> = {
  mama:          { bg: 'bg-rose-50',    text: 'text-rose-700',    ring: 'ring-rose-200',    chart: '#f43f5e' },
  pulmon:        { bg: 'bg-sky-50',     text: 'text-sky-700',     ring: 'ring-sky-200',     chart: '#0ea5e9' },
  digestivo:     { bg: 'bg-amber-50',   text: 'text-amber-700',   ring: 'ring-amber-200',   chart: '#f59e0b' },
  ginecologico:  { bg: 'bg-violet-50',  text: 'text-violet-700',  ring: 'ring-violet-200',  chart: '#7c3aed' },
  urologico:     { bg: 'bg-cyan-50',    text: 'text-cyan-700',    ring: 'ring-cyan-200',    chart: '#06b6d4' },
  piel:          { bg: 'bg-orange-50',  text: 'text-orange-700',  ring: 'ring-orange-200',  chart: '#f97316' },
  'cabeza-cuello': { bg: 'bg-teal-50',  text: 'text-teal-700',    ring: 'ring-teal-200',    chart: '#14b8a6' },
  snc:           { bg: 'bg-indigo-50',  text: 'text-indigo-700',  ring: 'ring-indigo-200',  chart: '#6366f1' },
  linfoma:       { bg: 'bg-fuchsia-50', text: 'text-fuchsia-700', ring: 'ring-fuchsia-200', chart: '#d946ef' },
  leucemia:      { bg: 'bg-pink-50',    text: 'text-pink-700',    ring: 'ring-pink-200',    chart: '#ec4899' },
  mieloma:       { bg: 'bg-purple-50',  text: 'text-purple-700',  ring: 'ring-purple-200',  chart: '#a855f7' },
  mielofibrosis: { bg: 'bg-red-50',     text: 'text-red-700',     ring: 'ring-red-200',     chart: '#ef4444' },
  pti:           { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200', chart: '#10b981' },
  'otros-hemato':{ bg: 'bg-slate-100',  text: 'text-slate-600',   ring: 'ring-slate-200',   chart: '#94a3b8' },
  otros:         { bg: 'bg-gray-100',   text: 'text-gray-600',    ring: 'ring-gray-200',    chart: '#9ca3af' },
};

function norm(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function classifyDiagnostico(text: string): DiagnosticoGrupo {
  const dx = norm(text ?? '');
  if (!dx || dx === '—') return 'otros';
  const has = (kw: string[]) => kw.some(k => dx.includes(k));

  if (has(['mama', 'mamario', 'breast'])) return 'mama';
  if (has(['colon', 'recto', 'colorrectal', 'gastric', 'gastrico', 'estomago', 'pancreas',
            'hepato', 'higado', 'esofag', 'biliar', 'colangio'])) return 'digestivo';
  if (has(['pulmon', 'pulmonar', 'bronco', 'nsclc', 'sclc', 'microcitico', 'adenocarcinoma'])) return 'pulmon';
  if (has(['ovario', 'endometrio', 'utero', 'cervix', 'cervical', 'vulva'])) return 'ginecologico';
  if (has(['prostata', 'vejiga', 'renal', 'rinon', 'urotelial', 'testiculo'])) return 'urologico';
  if (has(['melanoma', 'piel', 'cutaneo'])) return 'piel';
  if (has(['cabeza', 'cuello', 'orofaring', 'laringe', 'hipofaring', 'nasofaring'])) return 'cabeza-cuello';
  if (has(['glioblastoma', 'glioma', 'snc', 'cerebral', 'meningioma'])) return 'snc';
  // Hematología — sub-grupos
  if (has(['linfoma', 'hodgkin'])) return 'linfoma';
  if (has(['leucemia'])) return 'leucemia';
  if (has(['mieloma'])) return 'mieloma';
  if (has(['mielofibrosis'])) return 'mielofibrosis';
  if (has(['pti', 'purpura trombocitopenica', 'trombocitopenia inmune'])) return 'pti';
  if (has(['anemia'])) return 'otros-hemato';
  return 'otros';
}

export function getServicioFromGrupo(grupo: DiagnosticoGrupo): Servicio {
  return GRUPOS_HEMATOLOGIA.includes(grupo) ? 'hematologia' : 'oncologia-solida';
}

export function gruposParaServicio(servicio: Servicio): DiagnosticoGrupo[] {
  return servicio === 'hematologia' ? GRUPOS_HEMATOLOGIA : GRUPOS_ONCOLOGIA;
}
