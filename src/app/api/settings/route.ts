import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiSession } from '@/lib/api-auth';
import {
  ensureAppSettingsTable,
  getAllSettings,
  setSetting,
  setSettingsBulk,
} from '@/lib/app-settings-neon';

const ALLOWED_KEYS = [
  'smtp_host',
  'smtp_port',
  'smtp_secure',
  'smtp_user',
  'smtp_pass',
  'smtp_from',
  'smtp_reply_to',
  'repo_email_to',
  'repo_email_cc',
  'repo_email_subject',
  'repo_email_body',
] as const;

const updateSchema = z.object({
  key: z.enum(ALLOWED_KEYS),
  value: z.string(),
});

const bulkUpdateSchema = z.object({
  settings: z.record(z.enum(ALLOWED_KEYS), z.string()),
});

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    await ensureAppSettingsTable();
    const settings = await getAllSettings();

    const envFallbacks: Record<string, string | undefined> = {
      smtp_host: process.env.SMTP_HOST,
      smtp_port: process.env.SMTP_PORT,
      smtp_secure: process.env.SMTP_SECURE,
      smtp_user: process.env.SMTP_USER,
      smtp_pass: process.env.SMTP_PASS,
      smtp_from: process.env.SMTP_FROM,
      smtp_reply_to: process.env.SMTP_REPLY_TO,
    };

    for (const [key, value] of Object.entries(envFallbacks)) {
      if (!settings[key] && value) settings[key] = value;
    }

    return NextResponse.json(settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error obteniendo configuracion';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    await ensureAppSettingsTable();
    const body = await req.json();

    if (body?.settings) {
      const { settings } = bulkUpdateSchema.parse(body);
      await setSettingsBulk(settings);
      return NextResponse.json({ success: true, updated: Object.keys(settings).length });
    }

    const { key, value } = updateSchema.parse(body);
    await setSetting(key, value);
    return NextResponse.json({ success: true, key, value });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Error actualizando configuracion';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
