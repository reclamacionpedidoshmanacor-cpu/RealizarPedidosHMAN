import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { requireApiSession } from '@/lib/api-auth';

export const runtime = 'nodejs';

function getDb() {
  const url = process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Falta REALIZAR_PEDIDOS_DATABASE_URL (o DATABASE_URL)');
  return neon(url);
}

type CimaResponse = {
  nregistro?: string;
  nombre?: string;
  pactivos?: string;
  labtitular?: string;
};

async function fetchCimaCn(cn6: string): Promise<string | null> {
  try {
    const res = await fetch(`https://cima.aemps.es/cima/rest/medicamento?cn=${cn6}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; FarmaciaHMAN/1.0)',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as CimaResponse;
    return data.pactivos?.trim() || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = requireApiSession(req);
    if (!session.ok) return session.response;

    const sql = getDb();

    // Asegurar que las dos columnas existen
    await sql`ALTER TABLE medicamentos ADD COLUMN IF NOT EXISTS ppio_activo_cima TEXT;`;
    await sql`ALTER TABLE medicamentos ADD COLUMN IF NOT EXISTS cima_consultado BOOLEAN NOT NULL DEFAULT FALSE;`;

    const { soloVacios = true } = await req.json().catch(() => ({ soloVacios: true })) as { soloVacios?: boolean };

    const rows = (await sql`
      SELECT cn FROM medicamentos
      WHERE area = ${session.area}
        AND (${soloVacios} = FALSE OR ppio_activo_cima IS NULL)
      ORDER BY cn;
    `) as Array<{ cn: string }>;

    if (rows.length === 0) {
      return NextResponse.json({ actualizados: 0, fallidos: 0, total: 0 });
    }

    let actualizados = 0;
    let fallidos = 0;

    const BATCH = 3;
    for (let i = 0; i < rows.length; i += BATCH) {
      const lote = rows.slice(i, i + BATCH);
      await Promise.all(lote.map(async ({ cn }) => {
        const pactivos = await fetchCimaCn(cn);
        if (pactivos) {
          await sql`
            UPDATE medicamentos
            SET ppio_activo_cima = ${pactivos},
                cima_consultado  = TRUE
            WHERE cn = ${cn} AND area = ${session.area};
          `;
          actualizados++;
        } else {
          await sql`
            UPDATE medicamentos
            SET cima_consultado = TRUE
            WHERE cn = ${cn} AND area = ${session.area};
          `;
          fallidos++;
        }
      }));
    }

    return NextResponse.json({ actualizados, fallidos, total: rows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
