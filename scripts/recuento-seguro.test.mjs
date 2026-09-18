import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  cantidadDesdeEntrada,
  limpiarEntradaCantidad,
} from '../src/lib/recuento-input.ts';

test('un toque sin entrada no registra cero', () => {
  assert.equal(cantidadDesdeEntrada(''), null);
});

test('cero escrito mediante teclado es explícito', () => {
  assert.equal(cantidadDesdeEntrada('0'), 0);
});

test('solo admite dígitos y enteros no negativos', () => {
  assert.equal(limpiarEntradaCantidad('1a,2-'), '');
  assert.equal(cantidadDesdeEntrada('-5'), null);
  assert.equal(cantidadDesdeEntrada('1,5'), null);
  assert.equal(cantidadDesdeEntrada('27'), 27);
  assert.equal(cantidadDesdeEntrada('0', 1), 1);
});

test('los campos operativos no usan input number', async () => {
  const source = await readFile(
    new URL('../src/app/recuento-manual/page.tsx', import.meta.url),
    'utf8',
  );
  const almacen = source.slice(
    source.indexOf('function AlmacenMedCard'),
    source.indexOf('function RepoMedCard'),
  );
  const reposicion = source.slice(source.indexOf('function RepoMedCard'));
  assert.match(almacen, /<CantidadEnteraInput/);
  assert.doesNotMatch(almacen, /type="number"/);
  assert.match(reposicion, /<CantidadEnteraInput/);
  assert.doesNotMatch(reposicion, /type="number"/);
});

test('protege navegación y edición durante el guardado', async () => {
  const source = await readFile(
    new URL('../src/app/recuento-manual/page.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /addEventListener\('beforeunload'/);
  assert.match(source, /confirmarSalidaConCambios/);
  assert.match(source, /disabled=\{saving\}/);
});

test('completar no pone a cero las ubicaciones no iniciadas', async () => {
  const source = await readFile(
    new URL('../src/lib/stock-propuesta-neon.ts', import.meta.url),
    'utf8',
  );
  const page = await readFile(
    new URL('../src/app/recuento-manual/page.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /ubicaciones_iniciadas/);
  assert.match(source, /getCierreRecuentoManual/);
  assert.match(source, /FROM ubicaciones_iniciadas ui WHERE ui\.ubi_key = cp\.ubi_key/);
  assert.match(source, /cabecera AS MATERIALIZED/);
  assert.match(page, /Ubicaciones no contadas/);
  assert.match(page, /ubicaciones ya contadas/);
});

test('tramitar todas las ubicaciones cierra el recuento en Stock', async () => {
  const source = await readFile(
    new URL('../src/lib/stock-propuesta-neon.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /AND estado IN \('pendiente', 'procesando-stock', 'validado'\)/);
  assert.match(source, /recuentoTieneTodosLosBloquesTramitados/);
  assert.match(source, /marcarRecuentoComoGenerado/);
});

test('la persistencia serializa y detecta concurrencia', async () => {
  const source = await readFile(
    new URL('../src/lib/stock-propuesta-neon.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /uq_stock_registros_importacion_cn/);
  assert.match(source, /revision_manual = \$\{params\.revisionEsperada\}/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /CONFLICTO_REVISION_RECUENTO/);
  assert.match(source, /estado = 'procesando-stock'/);
  assert.match(source, /manual_completado_en IS NOT NULL/);
});
