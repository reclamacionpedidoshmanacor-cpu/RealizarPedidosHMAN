import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { requireApiSession } from '@/lib/api-auth';

export const runtime = 'nodejs';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL');
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
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as CimaResponse;
    return data.pactivos?.trim() || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  const sql = getDb();

  // Asegurar que la columna existe
  await sql`ALTER TABLE medicamentos ADD COLUMN IF NOT EXISTS ppio_activo_cima TEXT;`;

  // CNs activos del área que aún no tienen ppio_activo_cima
  const { soloVacios = true } = await req.json().catch(() => ({ soloVacios: true })) as { soloVacios?: boolean };

  const rows = (await sql`
    SELECT cn FROM medicamentos
    WHERE area = ${session.area}
      AND activo = TRUE
      AND (${soloVacios} = FALSE OR ppio_activo_cima IS NULL)
    ORDER BY cn;
  `) as Array<{ cn: string }>;

  if (rows.length === 0) {
    return NextResponse.json({ actualizados: 0, fallidos: 0, total: 0 });
  }

  let actualizados = 0;
  let fallidos = 0;

  // Llamadas en paralelo, lote de 5 para no saturar CIMA
  const BATCH = 5;
  for (let i = 0; i < rows.length; i += BATCH) {
    const lote = rows.slice(i, i + BATCH);
    await Promise.all(lote.map(async ({ cn }) => {
      const pactivos = await fetchCimaCn(cn);
      if (pactivos) {
        await sql`
          UPDATE medicamentos
          SET ppio_activo_cima = ${pactivos}
          WHERE cn = ${cn} AND area = ${session.area};
        `;
        actualizados++;
      } else {
        fallidos++;
      }
    }));
  }

  return NextResponse.json({ actualizados, fallidos, total: rows.length });
}
