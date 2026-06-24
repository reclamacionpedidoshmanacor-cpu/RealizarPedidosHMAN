import { neon } from '@neondatabase/serverless';
import { checkCNenCIMA } from '@/lib/cima';
import {
  type AlertaSuministroCn,
  cnClavePedidos,
} from '@/lib/pedidos-pendientes';

function getCatalogoClient() {
  const connectionString = process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Falta REALIZAR_PEDIDOS_DATABASE_URL (o DATABASE_URL) para alertas CIMA.');
  }
  return neon(connectionString);
}

let ensureSchemaPromise: Promise<void> | null = null;

export async function ensureCimaSuministroSchema(): Promise<void> {
  if (!ensureSchemaPromise) {
    const sql = getCatalogoClient();
    ensureSchemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS public.cima_suministro_alertas (
          cn TEXT PRIMARY KEY,
          nregistro TEXT,
          nombre TEXT,
          descripcion TEXT,
          cima_url TEXT,
          activo BOOLEAN NOT NULL DEFAULT FALSE,
          consultado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          resuelto_en TIMESTAMPTZ
        );
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_cima_suministro_alertas_activo
          ON public.cima_suministro_alertas (activo)
          WHERE activo = true;
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS public.cima_suministro_cron_estado (
          id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          ultimo_cn TEXT NOT NULL DEFAULT '',
          ciclo_iniciado_en TIMESTAMPTZ,
          actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `;
      await sql`
        INSERT INTO public.cima_suministro_cron_estado (id, ultimo_cn)
        VALUES (1, '')
        ON CONFLICT (id) DO NOTHING;
      `;
    })().catch((err) => {
      ensureSchemaPromise = null;
      throw err;
    });
  }
  await ensureSchemaPromise;
}

/** CNs activos con principio activo CIMA — universo del chequeo diario. */
export async function listCnsConPpioActivoCima(): Promise<string[]> {
  await ensureCimaSuministroSchema();
  const sql = getCatalogoClient();
  const rows = (await sql`
    SELECT cn
    FROM public.medicamentos
    WHERE activo = true
      AND ppio_activo_cima = TRUE
    ORDER BY cn;
  `) as Array<{ cn: string }>;
  return rows.map((r) => r.cn);
}

export async function countCnsConPpioActivoCima(): Promise<number> {
  await ensureCimaSuministroSchema();
  const sql = getCatalogoClient();
  const rows = (await sql`
    SELECT COUNT(*)::int AS total
    FROM public.medicamentos
    WHERE activo = true
      AND ppio_activo_cima = TRUE;
  `) as Array<{ total: number }>;
  return rows[0]?.total ?? 0;
}

async function countCnsPendientesDespuesDe(afterCn: string): Promise<number> {
  await ensureCimaSuministroSchema();
  const sql = getCatalogoClient();
  if (!afterCn) return countCnsConPpioActivoCima();
  const rows = (await sql`
    SELECT COUNT(*)::int AS total
    FROM public.medicamentos
    WHERE activo = true
      AND ppio_activo_cima = TRUE
      AND cn > ${afterCn};
  `) as Array<{ total: number }>;
  return rows[0]?.total ?? 0;
}

async function listCnsConPpioActivoCimaLote(
  afterCn: string,
  limit: number,
): Promise<string[]> {
  await ensureCimaSuministroSchema();
  const sql = getCatalogoClient();
  const rows = (afterCn
    ? await sql`
        SELECT cn
        FROM public.medicamentos
        WHERE activo = true
          AND ppio_activo_cima = TRUE
          AND cn > ${afterCn}
        ORDER BY cn
        LIMIT ${limit};
      `
    : await sql`
        SELECT cn
        FROM public.medicamentos
        WHERE activo = true
          AND ppio_activo_cima = TRUE
        ORDER BY cn
        LIMIT ${limit};
      `) as Array<{ cn: string }>;
  return rows.map((r) => r.cn);
}

type CronEstado = {
  ultimoCn: string;
  cicloIniciadoEn: string | null;
};

async function leerCronEstado(): Promise<CronEstado> {
  await ensureCimaSuministroSchema();
  const sql = getCatalogoClient();
  const rows = (await sql`
    SELECT ultimo_cn, ciclo_iniciado_en::text AS ciclo_iniciado_en
    FROM public.cima_suministro_cron_estado
    WHERE id = 1;
  `) as Array<{ ultimo_cn: string; ciclo_iniciado_en: string | null }>;
  const row = rows[0];
  return {
    ultimoCn: row?.ultimo_cn ?? '',
    cicloIniciadoEn: row?.ciclo_iniciado_en ?? null,
  };
}

async function guardarCronEstado(
  ultimoCn: string,
  cicloIniciadoEn?: string | null,
): Promise<void> {
  await ensureCimaSuministroSchema();
  const sql = getCatalogoClient();
  if (cicloIniciadoEn === null) {
    await sql`
      UPDATE public.cima_suministro_cron_estado
      SET ultimo_cn = ${ultimoCn}, ciclo_iniciado_en = NULL, actualizado_en = now()
      WHERE id = 1;
    `;
    return;
  }
  await sql`
    UPDATE public.cima_suministro_cron_estado
    SET
      ultimo_cn = ${ultimoCn},
      ciclo_iniciado_en = COALESCE(${cicloIniciadoEn ?? null}, ciclo_iniciado_en, now()),
      actualizado_en = now()
    WHERE id = 1;
  `;
}

export async function reiniciarCronCimaSuministro(): Promise<void> {
  await ensureCimaSuministroSchema();
  const sql = getCatalogoClient();
  await sql`
    UPDATE public.cima_suministro_cron_estado
    SET ultimo_cn = '', ciclo_iniciado_en = NULL, actualizado_en = now()
    WHERE id = 1;
  `;
}

export async function upsertCimaSuministroActivo(data: {
  cn: string;
  nregistro: string;
  nombre: string;
  descripcion: string | null;
  cimaUrl: string;
}): Promise<void> {
  await ensureCimaSuministroSchema();
  const sql = getCatalogoClient();
  await sql`
    INSERT INTO public.cima_suministro_alertas (
      cn, nregistro, nombre, descripcion, cima_url, activo, consultado_en, updated_at, resuelto_en
    ) VALUES (
      ${data.cn},
      ${data.nregistro},
      ${data.nombre},
      ${data.descripcion},
      ${data.cimaUrl},
      true,
      now(),
      now(),
      NULL
    )
    ON CONFLICT (cn) DO UPDATE SET
      nregistro = EXCLUDED.nregistro,
      nombre = EXCLUDED.nombre,
      descripcion = EXCLUDED.descripcion,
      cima_url = EXCLUDED.cima_url,
      activo = true,
      consultado_en = now(),
      updated_at = now(),
      resuelto_en = NULL;
  `;
}

export async function marcarCimaSuministroSinProblema(cn: string): Promise<void> {
  await ensureCimaSuministroSchema();
  const sql = getCatalogoClient();
  await sql`
    INSERT INTO public.cima_suministro_alertas (
      cn, activo, consultado_en, updated_at, resuelto_en
    ) VALUES (
      ${cn}, false, now(), now(), now()
    )
    ON CONFLICT (cn) DO UPDATE SET
      activo = false,
      consultado_en = now(),
      updated_at = now(),
      resuelto_en = now();
  `;
}

export async function checkCimaSuministroParaCn(cn: string): Promise<boolean> {
  const problema = await checkCNenCIMA(cn);
  if (problema) {
    await upsertCimaSuministroActivo({
      cn,
      nregistro: problema.nregistro,
      nombre: problema.nombre,
      descripcion: problema.descripcion,
      cimaUrl: problema.cimaUrl,
    });
    return true;
  }
  await marcarCimaSuministroSinProblema(cn);
  return false;
}

const CIMA_DELAY_MS = 150;

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/** Segundos máx. por llamada (cron externo p. ej. cron-job.org suele cortar ~30 s). */
const CIMA_LOTE_TIEMPO_MS = envInt('CIMA_LOTE_TIEMPO_MS', 25_000);
/** CNs máx. por llamada. */
const CIMA_LOTE_MAX_CN = envInt('CIMA_LOTE_MAX_CN', 18);
const CIMA_LOTE_FETCH = 40;

export function getCimaLoteConfig() {
  return {
    loteTiempoMs: CIMA_LOTE_TIEMPO_MS,
    loteMaxCn: CIMA_LOTE_MAX_CN,
    delayMs: CIMA_DELAY_MS,
  };
}

export type ChequeoCimaSuministroLoteResult = {
  comprobados: number;
  problemasActivos: number;
  totalUniverso: number;
  pendientesTrasLote: number;
  ultimoCn: string;
  cicloCompleto: boolean;
  continua: boolean;
};

export async function runChequeoCimaSuministroCatalogoLote(options?: {
  reiniciar?: boolean;
}): Promise<ChequeoCimaSuministroLoteResult> {
  if (options?.reiniciar) {
    await reiniciarCronCimaSuministro();
  }

  const totalUniverso = await countCnsConPpioActivoCima();
  if (totalUniverso === 0) {
    return {
      comprobados: 0,
      problemasActivos: 0,
      totalUniverso: 0,
      pendientesTrasLote: 0,
      ultimoCn: '',
      cicloCompleto: true,
      continua: false,
    };
  }

  const estadoInicial = await leerCronEstado();
  let ultimoCn = estadoInicial.ultimoCn;
  const cicloIniciadoEn = estadoInicial.cicloIniciadoEn ?? new Date().toISOString();
  if (!estadoInicial.cicloIniciadoEn) {
    await guardarCronEstado(ultimoCn, cicloIniciadoEn);
  }

  const deadline = Date.now() + CIMA_LOTE_TIEMPO_MS;
  let comprobados = 0;
  let problemasActivos = 0;
  let cicloCompleto = false;

  while (Date.now() < deadline && comprobados < CIMA_LOTE_MAX_CN) {
    const lote = await listCnsConPpioActivoCimaLote(ultimoCn, CIMA_LOTE_FETCH);
    if (lote.length === 0) {
      cicloCompleto = true;
      ultimoCn = '';
      await guardarCronEstado('', null);
      break;
    }

    for (const cn of lote) {
      if (Date.now() >= deadline || comprobados >= CIMA_LOTE_MAX_CN) break;

      const tieneProblema = await checkCimaSuministroParaCn(cn);
      if (tieneProblema) problemasActivos += 1;
      comprobados += 1;
      ultimoCn = cn;
      await guardarCronEstado(ultimoCn, cicloIniciadoEn);
      await new Promise((r) => setTimeout(r, CIMA_DELAY_MS));
    }

    if (lote.length < CIMA_LOTE_FETCH) {
      cicloCompleto = true;
      ultimoCn = '';
      await guardarCronEstado('', null);
      break;
    }
  }

  const pendientesTrasLote = cicloCompleto ? 0 : await countCnsPendientesDespuesDe(ultimoCn);

  return {
    comprobados,
    problemasActivos,
    totalUniverso,
    pendientesTrasLote,
    ultimoCn,
    cicloCompleto,
    continua: !cicloCompleto && pendientesTrasLote > 0,
  };
}

/** @deprecated Usar runChequeoCimaSuministroCatalogoLote (catálogo grande). */
export async function runChequeoCimaSuministroCatalogo(): Promise<{
  comprobados: number;
  problemasActivos: number;
}> {
  const result = await runChequeoCimaSuministroCatalogoLote();
  return {
    comprobados: result.comprobados,
    problemasActivos: result.problemasActivos,
  };
}

export async function loadAlertasCimaPorCns(
  cns: string[],
): Promise<Record<string, AlertaSuministroCn | null>> {
  const out: Record<string, AlertaSuministroCn | null> = {};
  const uniqueCns = [...new Set(cns.map((cn) => cn.trim()).filter(Boolean))];
  for (const cn of uniqueCns) {
    const key = cnClavePedidos(cn);
    if (key) out[key] = null;
  }
  if (uniqueCns.length === 0) return out;

  await ensureCimaSuministroSchema();
  const sql = getCatalogoClient();
  const rows = (await sql`
    SELECT cn, nombre, descripcion, updated_at::text AS updated_at
    FROM public.cima_suministro_alertas
    WHERE activo = true
      AND cn = ANY(${uniqueCns});
  `) as Array<{
    cn: string;
    nombre: string | null;
    descripcion: string | null;
    updated_at: string;
  }>;

  for (const row of rows) {
    const key = cnClavePedidos(row.cn);
    if (!key) continue;
    out[key] = {
      tipo: 'cima',
      etiqueta: 'CIMA — problema suministro',
      detalle: row.descripcion?.trim() || row.nombre?.trim() || null,
      fecha: row.updated_at,
    };
  }

  return out;
}

export async function loadAlertasCimaPorCnsSafe(
  cns: string[],
): Promise<Record<string, AlertaSuministroCn | null>> {
  try {
    return await loadAlertasCimaPorCns(cns);
  } catch {
    const fallback: Record<string, AlertaSuministroCn | null> = {};
    for (const cn of cns) {
      const key = cnClavePedidos(cn);
      if (key) fallback[key] = null;
    }
    return fallback;
  }
}
