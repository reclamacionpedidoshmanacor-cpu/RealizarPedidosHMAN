import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calcularPedidoCajas,
  calcularStockUnidadesContadas,
  isPedidoCajasEnteras,
  normalizePedidoCajas,
  normalizeStockCajas,
  normalizeStockUnidades,
  stockCajasDesdeUnidades,
  stockUnidadesDesdeCajas,
} from '../src/lib/cantidades.ts';

test('conserva cajas abiertas sin redondearlas a enteros', () => {
  assert.equal(normalizeStockCajas(2.23456), 2.2346);
  assert.equal(stockCajasDesdeUnidades(1, 56), 0.0179);
  assert.equal(stockCajasDesdeUnidades(567, 56), 10.125);
});

test('calcula unidades exactas desde cajas enteras y unidades sueltas', () => {
  const unidades = calcularStockUnidadesContadas({
    cajasEnteras: 2,
    unidadesSueltas: 11,
    unidadesPorCaja: 20,
  });
  assert.equal(unidades, 51);
  assert.equal(stockCajasDesdeUnidades(unidades, 20), 2.55);
});

test('rechaza unidades fraccionarias y no reconstruye recuentos desde cajas equivalentes', () => {
  assert.throws(() => normalizeStockUnidades(50.2), /unidades totales/);
  assert.throws(() => stockUnidadesDesdeCajas(2.5, 20), /cajas enteras/);
  assert.equal(stockUnidadesDesdeCajas(3, 20), 60);
});

test('no pide si el stock decimal está por encima del punto de pedido', () => {
  assert.equal(calcularPedidoCajas({
    stockActual: 2.2,
    puntoPedido: 2,
    stockMaximo: 3,
  }), 0);
});

test('redondea el faltante al entero más próximo', () => {
  assert.equal(calcularPedidoCajas({
    stockActual: 0.5,
    puntoPedido: 1,
    stockMaximo: 1,
  }), 1);
  assert.equal(calcularPedidoCajas({
    stockActual: 2.8,
    puntoPedido: 4,
    stockMaximo: 5,
  }), 2);
  assert.equal(calcularPedidoCajas({
    stockActual: 2.5,
    puntoPedido: 4,
    stockMaximo: 5,
  }), 3);
});

test('incluye el tránsito decimal antes de decidir', () => {
  assert.equal(calcularPedidoCajas({
    stockActual: 1.25,
    stockTransito: 0.8,
    puntoPedido: 2,
    stockMaximo: 4,
  }), 0);
  assert.equal(calcularPedidoCajas({
    stockActual: 1.25,
    stockTransito: 0.5,
    puntoPedido: 2,
    stockMaximo: 4,
  }), 2);
});

test('rechaza cantidades de pedido decimales', () => {
  assert.equal(isPedidoCajasEnteras(3), true);
  assert.equal(isPedidoCajasEnteras(2.5), false);
  assert.throws(() => normalizePedidoCajas(2.5), /entero de cajas/);
});
