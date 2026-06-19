import nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';
import {
  ensureAppSettingsTable,
  getAllSettings,
} from '@/lib/app-settings-neon';
import {
  ensureTablesReposicion,
  getPedidoConLineas,
} from '@/lib/reposicion-neon';
import {
  buildReposicionPdf,
  buildReposicionPdfFilename,
} from '@/lib/reposicion-pdf';

type SettingsMap = Record<string, string>;

function splitEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

async function getSettings(): Promise<SettingsMap> {
  await ensureAppSettingsTable();
  const settings = await getAllSettings();
  return settings;
}

async function getTransporter(settings: SettingsMap) {
  const host = settings.smtp_host || process.env.SMTP_HOST;
  const port = Number(settings.smtp_port || process.env.SMTP_PORT || '587');
  const secure = (settings.smtp_secure || process.env.SMTP_SECURE || 'false') === 'true';
  const user = settings.smtp_user || process.env.SMTP_USER;
  const pass = settings.smtp_pass || process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP no configurado. Revisa la pestaña Config.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  } as nodemailer.TransportOptions);
}

export async function sendReposicionEmail(pedidoId: number): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await ensureTablesReposicion();
    const pedido = await getPedidoConLineas(pedidoId);
    if (!pedido) return { success: false, error: 'Pedido no encontrado.' };
    if (pedido.lineas.length === 0) return { success: false, error: 'El pedido no tiene líneas.' };

    const settings = await getSettings();
    const to = splitEmails(settings.repo_email_to);
    const cc = splitEmails(settings.repo_email_cc);
    const replyTo = splitEmails(settings.smtp_reply_to);

    if (to.length === 0) {
      return { success: false, error: 'No hay destinatarios configurados en Config (campo Destinatarios).' };
    }

    const transporter = await getTransporter(settings);
    const from = settings.smtp_from || settings.smtp_user || process.env.SMTP_FROM || process.env.SMTP_USER || '';
    if (!from) return { success: false, error: 'Falta remitente SMTP (smtp_from / SMTP_FROM).' };

    const subjectTemplate = settings.repo_email_subject || 'Pedido de reposicion UPE #{pedido_id} - {fecha}';
    const bodyTemplate =
      settings.repo_email_body ||
      'Adjuntamos albaran de reposicion para preparacion en Farmacia.\n\nPedido: #{pedido_id}\nFecha: {fecha}\nLineas: {lineas}\n\nGracias.';

    const fecha = new Date(pedido.cabecera.fechaCreacion).toLocaleDateString('es-ES');
    const replacements: Record<string, string> = {
      '{pedido_id}': String(pedido.cabecera.id),
      '{fecha}': fecha,
      '{lineas}': String(pedido.cabecera.totalLineas),
    };

    const replaceVars = (input: string) =>
      Object.entries(replacements).reduce((acc, [k, v]) => acc.replaceAll(k, v), input);

    const subject = replaceVars(subjectTemplate);
    const textBody = replaceVars(bodyTemplate);
    const htmlBody = textBody
      .split('\n')
      .map((line) => (line.trim() ? `<p style="margin:0 0 8px;color:#334155;font-size:14px;">${line}</p>` : '<br/>'))
      .join('');

    const pdfBytes = await buildReposicionPdf(
      pedido.cabecera.id,
      pedido.cabecera.fechaCreacion,
      pedido.cabecera.fechaFinalizado,
      pedido.lineas
    );
    const filename = buildReposicionPdfFilename(pedido.cabecera.id, pedido.cabecera.fechaCreacion);
    const domain = from.split('@')[1] || 'hospital.local';

    await transporter.sendMail({
      from: `"Servicio de Farmacia - H. Manacor" <${from}>`,
      to: to.join(', '),
      ...(cc.length > 0 ? { cc: cc.join(', ') } : {}),
      ...(replyTo.length > 0 ? { replyTo: replyTo.join(', ') } : {}),
      subject,
      text: textBody,
      html: htmlBody,
      messageId: `<${randomUUID()}@${domain}>`,
      attachments: [
        {
          filename,
          content: Buffer.from(pdfBytes),
          contentType: 'application/pdf',
        },
      ],
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error enviando email';
    return { success: false, error: message };
  }
}
