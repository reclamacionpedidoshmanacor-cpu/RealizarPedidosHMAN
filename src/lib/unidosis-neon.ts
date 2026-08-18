import { neon } from '@neondatabase/serverless';

export type DatosUnidosis = {
  cn: string;
  unidosis: boolean | null;
  unidadesEnvase: number | null;
  fuente: string | null;
};

function getDb() {
  const connectionString =
    process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'Falta REALIZAR_PEDIDOS_DATABASE_URL (o DATABASE_URL) para unidosis en Neon.',
    );
  }
  return neon(connectionString);
}

let ensureSchemaPromise: Promise<void> | null = null;

export async function ensureUnidosisSchema(): Promise<void> {
  if (!ensureSchemaPromise) {
    const sql = getDb();
    ensureSchemaPromise = sql`
      CREATE TABLE IF NOT EXISTS public.cn_unidosis (
        cn                TEXT PRIMARY KEY,
        unidosis          BOOLEAN,
        unidades_envase   INTEGER,
        fuente            TEXT,
        actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT ck_cn_unidosis_cn
          CHECK (cn ~ '^[0-9]{6}$'),
        CONSTRAINT ck_cn_unidosis_unidades
          CHECK (unidades_envase IS NULL OR unidades_envase > 0)
      );
    `.then(() => undefined).catch((error) => {
      ensureSchemaPromise = null;
      throw error;
    });
  }
  await ensureSchemaPromise;
}

export async function getDatosUnidosisByCn(cn: string): Promise<DatosUnidosis | null> {
  await ensureUnidosisSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT cn, unidosis, unidades_envase, fuente
    FROM public.cn_unidosis
    WHERE cn = ${cn}
    LIMIT 1;
  ` as Array<{
    cn: string;
    unidosis: boolean | null;
    unidades_envase: number | null;
    fuente: string | null;
  }>;
  const row = rows[0];
  if (!row) return null;
  return {
    cn: row.cn,
    unidosis: row.unidosis,
    unidadesEnvase:
      row.unidades_envase == null ? null : Number(row.unidades_envase),
    fuente: row.fuente,
  };
}

export async function setFormatoUnidosis(
  cn: string,
  unidosis: boolean | null,
): Promise<void> {
  await ensureUnidosisSchema();
  const sql = getDb();
  await sql`
    INSERT INTO public.cn_unidosis (
      cn, unidosis, unidades_envase, fuente, actualizado_en
    )
    VALUES (${cn}, ${unidosis}, NULL, 'manual', NOW())
    ON CONFLICT (cn) DO UPDATE SET
      unidosis = EXCLUDED.unidosis,
      fuente = 'manual',
      actualizado_en = NOW();
  `;
}
