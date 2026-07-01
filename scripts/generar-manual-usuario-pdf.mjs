/**
 * Genera docs/MANUAL_USUARIO.pdf desde docs/MANUAL_USUARIO.md
 * Página 1: portada con logo · Página 2: índice · Página 3+: contenido
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import puppeteer from 'puppeteer';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MD_PATH = path.join(ROOT, 'docs', 'MANUAL_USUARIO.md');
const LOGO_PATH = path.join(ROOT, 'public', 'Logo-Hospital-neg-MANACOR.jpg');
const OUT_PATH = path.join(ROOT, 'docs', 'MANUAL_USUARIO.pdf');

function extractSections(md) {
  const indexHeading = '## Índice';
  const contentHeading = '## 1. A quién va dirigido este manual';

  const indexStart = md.indexOf(indexHeading);
  const contentStart = md.indexOf(contentHeading);
  if (indexStart === -1 || contentStart === -1) {
    throw new Error('No se encontró el índice o el inicio del contenido en MANUAL_USUARIO.md');
  }

  const tocRaw = md
    .slice(indexStart + indexHeading.length, contentStart)
    .replace(/^[\s\-]+/m, '')
    .trim();

  const bodyMd = md.slice(contentStart).trim();
  return { tocRaw, bodyMd };
}

function tocMarkdownToHtml(tocRaw) {
  const lines = tocRaw.split('\n').filter((l) => l.trim());
  const items = lines
    .map((line) => {
      const linkMatch = line.match(/^\d+\.\s+\[([^\]]+)\]/);
      if (linkMatch) return `<li>${linkMatch[1]}</li>`;
      const subMatch = line.match(/^\s*-\s+\[([^\]]+)\]/);
      if (subMatch) return `<li class="sub">${subMatch[1]}</li>`;
      const plain = line.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
      if (plain) return `<li>${plain}</li>`;
      return '';
    })
    .filter(Boolean);
  return `<ol class="toc-list">${items.join('')}</ol>`;
}

function buildHtml({ logoDataUrl, tocHtml, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Manual de usuario — Realizar Pedidos HMAN</title>
  <style>
    @page { size: A4; margin: 18mm 16mm 20mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 10.5pt;
      line-height: 1.45;
      color: #1e293b;
      margin: 0;
    }
    .cover {
      page-break-after: always;
      min-height: 250mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 24mm 12mm;
    }
    .cover img {
      width: 72%;
      max-width: 420px;
      height: auto;
      margin-bottom: 28px;
    }
    .cover h1 {
      font-size: 22pt;
      font-weight: 700;
      color: #0f766e;
      margin: 0 0 8px;
      line-height: 1.2;
    }
    .cover h2 {
      font-size: 13pt;
      font-weight: 500;
      color: #475569;
      margin: 0 0 32px;
    }
    .cover .meta {
      font-size: 10pt;
      color: #64748b;
      line-height: 1.7;
      max-width: 90%;
    }
    .cover .meta strong { color: #334155; }
    .toc-page {
      page-break-after: always;
    }
    .toc-page h2 {
      font-size: 16pt;
      color: #0f766e;
      border-bottom: 2px solid #99f6e4;
      padding-bottom: 6px;
      margin: 0 0 16px;
    }
    .toc-list {
      margin: 0;
      padding-left: 1.2em;
    }
    .toc-list li {
      margin: 0.35em 0;
      font-size: 11pt;
    }
    .toc-list li.sub {
      list-style: disc;
      margin-left: 1.2em;
      font-size: 10pt;
      color: #475569;
    }
    .content h2 {
      font-size: 14pt;
      color: #0f766e;
      margin-top: 1.4em;
      margin-bottom: 0.5em;
      page-break-after: avoid;
    }
    .content h3 {
      font-size: 11.5pt;
      color: #134e4a;
      margin-top: 1.1em;
      page-break-after: avoid;
    }
    .content h4 {
      font-size: 10.5pt;
      margin-top: 0.9em;
      page-break-after: avoid;
    }
    .content p { margin: 0.45em 0; }
    .content ul, .content ol { margin: 0.4em 0 0.6em; padding-left: 1.4em; }
    .content li { margin: 0.2em 0; }
    .content table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9pt;
      margin: 0.6em 0 1em;
    }
    .content th, .content td {
      border: 1px solid #cbd5e1;
      padding: 5px 7px;
      vertical-align: top;
    }
    .content th {
      background: #f1f5f9;
      font-weight: 600;
    }
    .content code {
      font-family: ui-monospace, monospace;
      font-size: 9pt;
      background: #f8fafc;
      padding: 1px 4px;
      border-radius: 3px;
    }
    .content hr {
      border: none;
      border-top: 1px solid #e2e8f0;
      margin: 1.2em 0;
    }
    .content blockquote {
      margin: 0.6em 0;
      padding-left: 12px;
      border-left: 3px solid #cbd5e1;
      color: #64748b;
      font-size: 9.5pt;
    }
    .content a { color: #0f766e; text-decoration: none; }
  </style>
</head>
<body>
  <section class="cover">
    <img src="${logoDataUrl}" alt="Hospital de Manacor" />
    <h1>Manual de usuario</h1>
    <h2>Realizar Pedidos HMAN — Gestión de Pedidos y Consumo</h2>
    <div class="meta">
      <strong>Servicio de Farmacia · Hospital de Manacor</strong><br />
      Versión 1.0 · Junio 2026<br />
      Elaborado por: Lucía Rodríguez Cajaraville<br /><br />
      © 2026 Lucía Rodríguez Cajaraville. Todos los derechos reservados.
    </div>
  </section>

  <section class="toc-page">
    <h2>Índice</h2>
    ${tocHtml}
  </section>

  <section class="content">
    ${bodyHtml}
  </section>
</body>
</html>`;
}

async function main() {
  const [md, logoBytes] = await Promise.all([
    readFile(MD_PATH, 'utf8'),
    readFile(LOGO_PATH),
  ]);

  const { tocRaw, bodyMd } = extractSections(md);
  const logoDataUrl = `data:image/jpeg;base64,${logoBytes.toString('base64')}`;
  const tocHtml = tocMarkdownToHtml(tocRaw);
  const bodyHtml = await marked.parse(bodyMd);
  const html = buildHtml({ logoDataUrl, tocHtml, bodyHtml });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: OUT_PATH,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '18mm', right: '16mm', bottom: '20mm', left: '16mm' },
    });
    console.log(`PDF generado: ${OUT_PATH}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
