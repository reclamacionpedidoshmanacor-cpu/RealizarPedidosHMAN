import { neon } from '@neondatabase/serverless';

function getDb() {
  const url = process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Falta REALIZAR_PEDIDOS_DATABASE_URL para conectar a Neon.');
  return neon(url);
}

export async function ensureAppSettingsTable() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const sql = getDb();
  const rows = await sql`SELECT key, value FROM app_settings`;
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[String(row.key)] = String(row.value ?? '');
  }
  return map;
}

export async function getSetting(key: string): Promise<string | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT value
    FROM app_settings
    WHERE key = ${key}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return String(rows[0].value ?? '');
}

export async function setSetting(key: string, value: string) {
  const sql = getDb();
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

export async function setSettingsBulk(settings: Record<string, string>) {
  const entries = Object.entries(settings);
  for (const [key, value] of entries) {
    await setSetting(key, value);
  }
}
