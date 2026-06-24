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

export async function runChequeoCimaSuministroCatalogo(): Promise<{
  comprobados: number;
  problemasActivos: number;
}> {
  const cns = await listCnsConPpioActivoCima();
  let problemasActivos = 0;

  for (const cn of cns) {
    const tieneProblema = await checkCimaSuministroParaCn(cn);
    if (tieneProblema) problemasActivos += 1;
    await new Promise((r) => setTimeout(r, CIMA_DELAY_MS));
  }

  return { comprobados: cns.length, problemasActivos };
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
