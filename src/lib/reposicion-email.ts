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

export async function sendReposicionEmail(
  pedidoIdOrIds: number | number[],
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await ensureTablesReposicion();

    const pedidoIds = [...new Set(Array.isArray(pedidoIdOrIds) ? pedidoIdOrIds : [pedidoIdOrIds])];
    if (pedidoIds.length === 0) {
      return { success: false, error: 'Selecciona al menos un pedido para enviar.' };
    }

    const pedidos = [];
    for (const id of pedidoIds) {
      const pedido = await getPedidoConLineas(id);
      if (!pedido) return { success: false, error: `Pedido #${id} no encontrado.` };
      if (pedido.lineas.length === 0) {
        return { success: false, error: `El pedido #${id} no tiene líneas.` };
      }
      pedidos.push(pedido);
    }

    pedidos.sort((a, b) => a.cabecera.id - b.cabecera.id);
    const pedido = pedidos[0];

    if (pedidos.some((p) => p.cabecera.area !== pedido.cabecera.area)) {
      return { success: false, error: 'Todos los pedidos deben pertenecer a la misma área.' };
    }

    const settings = await getSettings();
    const area = pedido.cabecera.area === 'oncologia' ? 'oncologia' : 'upe';
    const to = splitEmails(
      settings[`repo_email_to_${area}`] || (area === 'upe' ? settings.repo_email_to : ''),
    );
    const cc = splitEmails(
      settings[`repo_email_cc_${area}`] || (area === 'upe' ? settings.repo_email_cc : ''),
    );
    const replyTo = splitEmails(settings.smtp_reply_to);

    if (to.length === 0) {
      return { success: false, error: 'No hay destinatarios configurados en Config (campo Destinatarios).' };
    }

    const transporter = await getTransporter(settings);
    const from = settings.smtp_from || settings.smtp_user || process.env.SMTP_FROM || process.env.SMTP_USER || '';
    if (!from) return { success: false, error: 'Falta remitente SMTP (smtp_from / SMTP_FROM).' };

    const areaLabel = area === 'oncologia' ? 'Oncologia' : 'UPE';
    const subjectTemplate =
      settings[`repo_email_subject_${area}`] ||
      (area === 'upe' ? settings.repo_email_subject : '') ||
      `Pedido de reposicion ${areaLabel} #{pedido_id} - {consulta} - {fecha}`;
    const bodyTemplate =
      settings[`repo_email_body_${area}`] ||
      (area === 'upe' ? settings.repo_email_body : '') ||
      'Adjuntamos albaran de reposicion para preparacion en Farmacia.\n\nPedido: #{pedido_id}\nConsulta destino: {consulta}\nFecha: {fecha}\nLineas: {lineas}\n\nGracias.';

    const fecha = new Date(pedido.cabecera.fechaCreacion).toLocaleDateString('es-ES');
    const consultas = pedidos
      .map((p) => p.cabecera.consultaDestino?.trim())
      .filter((c): c is string => Boolean(c));
    const replacements: Record<string, string> = {
      '{pedido_id}': pedidos.map((p) => p.cabecera.id).join(', '),
      '{fecha}': fecha,
      '{lineas}': String(pedidos.reduce((total, p) => total + p.cabecera.totalLineas, 0)),
      '{consulta}': consultas.length > 0 ? [...new Set(consultas)].join(', ') : 'sin consulta',
    };

    const replaceVars = (input: string) =>
      Object.entries(replacements).reduce((acc, [k, v]) => acc.replaceAll(k, v), input);

    const detalleConsultas = pedidos
      .map(
        (p) =>
          `- Pedido #${p.cabecera.id} · ${p.cabecera.consultaDestino ?? 'sin consulta'} · ${p.cabecera.totalLineas} lineas`,
      )
      .join('\n');

    const subject = replaceVars(subjectTemplate);
    const cuerpoBase = replaceVars(bodyTemplate);
    const textBody =
      pedidos.length > 1 ? `${cuerpoBase}\n\nAlbaranes adjuntos:\n${detalleConsultas}` : cuerpoBase;
    const htmlBody = textBody
      .split('\n')
      .map((line) => (line.trim() ? `<p style="margin:0 0 8px;color:#334155;font-size:14px;">${line}</p>` : '<br/>'))
      .join('');

    const attachments = [];
    for (const p of pedidos) {
      const pdfBytes = await buildReposicionPdf(
        p.cabecera.id,
        p.cabecera.fechaCreacion,
        p.cabecera.fechaFinalizado,
        p.lineas,
        p.cabecera.area,
        p.cabecera.consultaDestino,
      );
      attachments.push({
        filename: buildReposicionPdfFilename(
          p.cabecera.id,
          p.cabecera.fechaCreacion,
          p.cabecera.consultaDestino,
        ),
        content: Buffer.from(pdfBytes),
        contentType: 'application/pdf',
      });
    }
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
      attachments,
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error enviando email';
    return { success: false, error: message };
  }
}
