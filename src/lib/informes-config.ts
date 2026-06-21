import type { DiagnosticoGrupo, Servicio } from '@/lib/diagnostico-grupos';
import { getSetting, setSetting } from '@/lib/app-settings-neon';

/** Período fijo de los informes PDF (12 meses móviles). */
export const INFORME_PERIOD_MESES = 12;

export type InformeTipo = 'servicio' | 'grupo';

export type DestinatarioInforme = {
  id: string;
  nombre: string;
  email: string;
  activo: boolean;
};

/** Destinatarios por informe — vacío de momento; configurable en el futuro. */
export type InformeDestinatariosConfig = {
  servicios: Record<Servicio, DestinatarioInforme[]>;
  grupos: Partial<Record<DiagnosticoGrupo, DestinatarioInforme[]>>;
};

export const INFORME_DESTINATARIOS_DEFAULT: InformeDestinatariosConfig = {
  servicios: {
    'oncologia-solida': [],
    'hematologia': [],
  },
  grupos: {},
};

/** Clave en app_settings para persistir destinatarios (envío automático futuro). */
export const INFORME_SETTINGS_KEY = 'informe_analisis_destinatarios';

export function periodoInforme12Meses(): { desde: string; hasta: string } {
  const hasta = new Date();
  const desde = new Date();
  desde.setMonth(desde.getMonth() - INFORME_PERIOD_MESES);
  return {
    desde: desde.toISOString().slice(0, 10),
    hasta: hasta.toISOString().slice(0, 10),
  };
}

export async function loadInformeDestinatarios(): Promise<InformeDestinatariosConfig> {
  try {
    const raw = await getSetting(INFORME_SETTINGS_KEY);
    if (!raw) return INFORME_DESTINATARIOS_DEFAULT;
    const parsed = JSON.parse(raw) as InformeDestinatariosConfig;
    return {
      servicios: {
        'oncologia-solida': parsed.servicios?.['oncologia-solida'] ?? [],
        'hematologia': parsed.servicios?.['hematologia'] ?? [],
      },
      grupos: parsed.grupos ?? {},
    };
  } catch {
    return INFORME_DESTINATARIOS_DEFAULT;
  }
}

export async function saveInformeDestinatarios(config: InformeDestinatariosConfig): Promise<void> {
  await setSetting(INFORME_SETTINGS_KEY, JSON.stringify(config));
}

export function destinatariosActivos(list: DestinatarioInforme[] | undefined): DestinatarioInforme[] {
  return (list ?? []).filter(d => d.activo && d.email.trim());
}
