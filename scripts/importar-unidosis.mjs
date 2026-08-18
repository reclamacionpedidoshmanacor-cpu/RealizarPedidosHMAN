import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { neon } from '@neondatabase/serverless';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_XLSX = path.join(ROOT, 'docs', 'UNIDOSIS.xlsx');
const BATCH_SIZE = 750;

function loadLocalEnv() {
  for (const filename of ['.env.local', '.env']) {
    const envPath = path.join(ROOT, filename);
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      let value = match[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  }
}

function parseUnidosis(value, rowNumber) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === 'SI' || normalized === 'SÍ' || normalized === '1') return true;
  if (normalized === '0' || normalized === 'NO') return false;
  throw new Error(`Fila ${rowNumber}: valor de unidosis no reconocido ("${value}").`);
}

function parseUnidades(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function readRows(xlsxPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('El Excel no contiene hojas.');

  const headers = {
    cn: worksheet.getCell(1, 1).text.trim(),
    unidosis: worksheet.getCell(1, 20).text.trim().toLowerCase(),
    cantidad: worksheet.getCell(1, 21).text.trim().toLowerCase(),
  };
  if (!headers.cn || headers.unidosis !== 'unidosis' || headers.cantidad !== 'cantidad') {
    throw new Error(
      'Formato no reconocido: se esperaban CN en A, "unidosis" en T y "cantidad" en U.',
    );
  }

  const byCn = new Map();
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const cn = worksheet.getCell(rowNumber, 1).text.trim();
    if (!cn) continue;
    if (!/^\d{6}$/.test(cn)) {
      throw new Error(`Fila ${rowNumber}: CN no válido ("${cn}").`);
    }
    const row = {
      cn,
      unidosis: parseUnidosis(worksheet.getCell(rowNumber, 20).value, rowNumber),
      unidades_envase: parseUnidades(worksheet.getCell(rowNumber, 21).value),
    };
    const previous = byCn.get(cn);
    if (
      previous &&
      (previous.unidosis !== row.unidosis ||
        previous.unidades_envase !== row.unidades_envase)
    ) {
      throw new Error(`El CN ${cn} aparece duplicado con datos contradictorios.`);
    }
    byCn.set(cn, row);
  }
  return [...byCn.values()];
}

async function main() {
  loadLocalEnv();
  const connectionString =
    process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Falta REALIZAR_PEDIDOS_DATABASE_URL o DATABASE_URL.');
  }

  const xlsxPath = path.resolve(process.argv[2] ?? DEFAULT_XLSX);
  const rows = await readRows(xlsxPath);
  const sql = neon(connectionString);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS public.cn_unidosis (
      cn TEXT PRIMARY KEY,
      unidosis BOOLEAN,
      unidades_envase INTEGER,
      fuente TEXT,
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ck_cn_unidosis_cn CHECK (cn ~ '^[0-9]{6}$'),
      CONSTRAINT ck_cn_unidosis_unidades
        CHECK (unidades_envase IS NULL OR unidades_envase > 0)
    )
  `);

  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    await sql.query(
      `
        INSERT INTO public.cn_unidosis (
          cn, unidosis, unidades_envase, fuente, actualizado_en
        )
        SELECT
          item.cn,
          item.unidosis,
          item.unidades_envase,
          'UNIDOSIS.xlsx',
          NOW()
        FROM jsonb_to_recordset($1::jsonb) AS item(
          cn TEXT,
          unidosis BOOLEAN,
          unidades_envase INTEGER
        )
        ON CONFLICT (cn) DO UPDATE SET
          unidosis = CASE
            WHEN public.cn_unidosis.fuente = 'manual'
              THEN public.cn_unidosis.unidosis
            ELSE EXCLUDED.unidosis
          END,
          unidades_envase = EXCLUDED.unidades_envase,
          fuente = CASE
            WHEN public.cn_unidosis.fuente = 'manual'
              THEN public.cn_unidosis.fuente
            ELSE EXCLUDED.fuente
          END,
          actualizado_en = NOW()
      `,
      [JSON.stringify(batch)],
    );
  }

  const updated = await sql.query(`
    UPDATE public.medicamentos AS medicamento
    SET
      unidades_por_caja = referencia.unidades_envase,
      actualizado_en = NOW()
    FROM public.cn_unidosis AS referencia
    WHERE medicamento.cn = referencia.cn
      AND referencia.unidades_envase IS NOT NULL
      AND medicamento.unidades_por_caja IS DISTINCT FROM referencia.unidades_envase
    RETURNING medicamento.cn
  `);

  const counts = rows.reduce(
    (acc, row) => {
      if (row.unidosis === true) acc.unidosis += 1;
      else if (row.unidosis === false) acc.reenvasado += 1;
      else acc.desconocido += 1;
      return acc;
    },
    { unidosis: 0, reenvasado: 0, desconocido: 0 },
  );

  console.log(
    JSON.stringify(
      {
        archivo: xlsxPath,
        importados: rows.length,
        ...counts,
        medicamentosConUnidadesActualizadas: updated.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
