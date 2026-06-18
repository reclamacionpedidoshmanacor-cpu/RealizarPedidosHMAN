import {
  sqliteTable, text, integer, real, index, unique,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// CATÁLOGO DE MEDICAMENTOS
// ---------------------------------------------------------------------------
export const medicamentos = sqliteTable('medicamentos', {
  cn:               text('cn').primaryKey(),                         // Código Nacional AEMPS
  nombre:           text('nombre').notNull(),                        // nombre comercial / MARCA
  principioActivo:  text('principio_activo'),                        // PPIO ACTIVO
  presentacion:     text('presentacion'),                            // de CIMA (opcional)
  via:              text('via'),                                     // 'IV' | 'ORAL' | 'OTRO'
  area:             text('area').notNull().default('oncologia'),     // 'oncologia'|'upe'|'iv'|'nutricion'|'almacen'
  ubicacion:        text('ubicacion'),                               // CIT, Armario NEA, Nevera NEA...
  unidadesPorCaja:  integer('unidades_por_caja').notNull(),          // MultiploPedido
  activo:           integer('activo', { mode: 'boolean' }).notNull().default(true),
  comprable:        integer('comprable', { mode: 'boolean' }).notNull().default(true),
  mse:              integer('mse', { mode: 'boolean' }).notNull().default(false), // auto: CN empieza por "02"
  tipoMse:          text('tipo_mse'),                                // 'UC' | 'Extranjero' | null
  precioUnidad:     real('precio_unidad'),                           // último precio SAP
  precioCaja:       real('precio_caja'),                             // precio_unidad × unidades_por_caja
  creadoEn:         text('creado_en').notNull().default(sql`(datetime('now'))`),
  actualizadoEn:    text('actualizado_en').notNull().default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// STOCK OBJETIVO POR MEDICAMENTO
// ---------------------------------------------------------------------------
export const stockObjetivo = sqliteTable('stock_objetivo', {
  id:              integer('id').primaryKey({ autoIncrement: true }),
  cn:              text('cn').notNull().references(() => medicamentos.cn),
  stockMinimo:     integer('stock_minimo').notNull().default(0),     // en cajas
  puntoPedido:     integer('punto_pedido').notNull().default(0),     // en cajas — nivel que dispara el pedido
  stockMaximo:     integer('stock_maximo'),                          // en cajas, opcional
  actualizadoEn:   text('actualizado_en').notNull().default(sql`(datetime('now'))`),
}, (t) => [unique('uq_stock_objetivo_cn').on(t.cn)]);

// ---------------------------------------------------------------------------
// HISTORIAL DE PRECIOS (de importaciones SAP)
// ---------------------------------------------------------------------------
export const preciosHistorial = sqliteTable('precios_historial', {
  id:               integer('id').primaryKey({ autoIncrement: true }),
  cn:               text('cn').notNull().references(() => medicamentos.cn),
  precioUnidad:     real('precio_unidad').notNull(),
  precioCaja:       real('precio_caja').notNull(),
  variacionPct:     real('variacion_pct'),                           // % vs precio anterior
  fechaImportacion: text('fecha_importacion').notNull(),
}, (t) => [index('idx_precios_cn').on(t.cn)]);

// ---------------------------------------------------------------------------
// IMPORTACIONES DE STOCK (cabecera de cada carga)
// ---------------------------------------------------------------------------
export const importacionesStock = sqliteTable('importaciones_stock', {
  id:             integer('id').primaryKey({ autoIncrement: true }),
  area:           text('area').notNull().default('oncologia'),
  origen:         text('origen').notNull(),                          // 'SAP' | 'Manual'
  estado:         text('estado').notNull().default('pendiente'),     // 'pendiente' | 'validado' | 'generado'
  fechaRecuento:  text('fecha_recuento').notNull(),                  // fecha declarada del stock
  importadoEn:    text('importado_en').notNull().default(sql`(datetime('now'))`),
  generadoEn:     text('generado_en'),
  propuestaId:    integer('propuesta_id'),
  ficheroNombre:  text('fichero_nombre'),
  totalLineas:    integer('total_lineas').notNull().default(0),
  observaciones:  text('observaciones'),
});

// ---------------------------------------------------------------------------
// REGISTROS DE STOCK (líneas de cada importación — snapshots históricos)
// ---------------------------------------------------------------------------
export const stockRegistros = sqliteTable('stock_registros', {
  id:              integer('id').primaryKey({ autoIncrement: true }),
  importacionId:   integer('importacion_id').notNull().references(() => importacionesStock.id),
  cn:              text('cn').notNull().references(() => medicamentos.cn),
  stockUnidades:   real('stock_unidades').notNull(),                 // unidades totales de SAP
  stockCajas:      real('stock_cajas').notNull(),                    // stock_unidades ÷ unidades_por_caja
  valorTotal:      real('valor_total'),                              // Valor final SAP
}, (t) => [
  index('idx_stock_importacion').on(t.importacionId),
  index('idx_stock_cn').on(t.cn),
]);

// ---------------------------------------------------------------------------
// PROPUESTAS DE PEDIDO (cabecera)
// ---------------------------------------------------------------------------
export const propuestas = sqliteTable('propuestas', {
  id:                integer('id').primaryKey({ autoIncrement: true }),
  area:              text('area').notNull().default('oncologia'),
  fechaGeneracion:   text('fecha_generacion').notNull().default(sql`(datetime('now'))`),
  estado:            text('estado').notNull().default('borrador'),   // 'borrador' | 'tramitada'
  validadaEn:        text('validada_en'),
  tramitadaEn:       text('tramitada_en'),
  emitidaEn:         text('emitida_en'),
  excelGeneradoEn:   text('excel_generado_en'),
  importacionStockId: integer('importacion_stock_id').references(() => importacionesStock.id),
  observaciones:     text('observaciones'),
});

// ---------------------------------------------------------------------------
// LÍNEAS DE PROPUESTA
// ---------------------------------------------------------------------------
export const propuestasLineas = sqliteTable('propuestas_lineas', {
  id:                integer('id').primaryKey({ autoIncrement: true }),
  propuestaId:       integer('propuesta_id').notNull().references(() => propuestas.id),
  cn:                text('cn').notNull().references(() => medicamentos.cn),
  nombreMedicamento: text('nombre_medicamento'),
  unidadesPorCaja:   integer('unidades_por_caja').notNull().default(1),
  stockActual:       real('stock_actual').notNull(),                 // cajas en el momento de generar
  stockMinimoSnap:   integer('stock_minimo_snap').notNull().default(0),
  puntoPedidoSnap:   integer('punto_pedido_snap').notNull().default(0),
  stockMaximoSnap:   integer('stock_maximo_snap').notNull().default(0),
  stockObjetivoSnap: integer('stock_objetivo_snap').notNull(),       // stock óptimo snapshot
  cajasPropuestas:   integer('cajas_propuestas').notNull(),          // calculado por sistema
  cajasValidadas:    integer('cajas_validadas'),                     // modificado por farmacéutico
  motivoAjuste:      text('motivo_ajuste'),
  motivoAjusteOtro:  text('motivo_ajuste_otro'),
  unidadesFinal:     integer('unidades_final'),                      // cajas_validadas × unidades_por_caja
  precioRefCaja:     real('precio_ref_caja'),                        // precio snapshot
  importeEstimado:   real('importe_estimado'),
  ajustado:          integer('ajustado', { mode: 'boolean' }).notNull().default(false),
  excluido:          integer('excluido', { mode: 'boolean' }).notNull().default(false),
  observaciones:     text('observaciones'),
}, (t) => [index('idx_lineas_propuesta').on(t.propuestaId)]);

// ---------------------------------------------------------------------------
// IMPORTACIONES DE CONSUMO (cabecera)
// ---------------------------------------------------------------------------
export const importacionesConsumo = sqliteTable('importaciones_consumo', {
  id:              integer('id').primaryKey({ autoIncrement: true }),
  periodoInicio:   text('periodo_inicio').notNull(),
  periodoFin:      text('periodo_fin').notNull(),
  importadoEn:     text('importado_en').notNull().default(sql`(datetime('now'))`),
  ficheroNombre:   text('fichero_nombre'),
  totalLineas:     integer('total_lineas').notNull().default(0),
});

// ---------------------------------------------------------------------------
// REGISTROS DE CONSUMO
// ---------------------------------------------------------------------------
export const consumoRegistros = sqliteTable('consumo_registros', {
  id:              integer('id').primaryKey({ autoIncrement: true }),
  importacionId:   integer('importacion_id').notNull().references(() => importacionesConsumo.id),
  cn:              text('cn').notNull().references(() => medicamentos.cn),
  fecha:           text('fecha').notNull(),
  pacienteId:      text('paciente_id'),                              // código HC anonimizado
  indicacion:      text('indicacion'),
  protocolo:       text('protocolo'),
  vialesConsum:    real('viales_consumidos').notNull(),
}, (t) => [
  index('idx_consumo_importacion').on(t.importacionId),
  index('idx_consumo_cn').on(t.cn),
  index('idx_consumo_fecha').on(t.fecha),
]);

// ---------------------------------------------------------------------------
// ALERTAS DEL SISTEMA
// ---------------------------------------------------------------------------
export const alertas = sqliteTable('alertas', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  tipo:         text('tipo').notNull(),   // 'stock_bajo' | 'desabastecimiento' | 'recalculo_sugerido' | 'precio_variacion'
  cn:           text('cn').references(() => medicamentos.cn),
  mensaje:      text('mensaje').notNull(),
  generadaEn:   text('generada_en').notNull().default(sql`(datetime('now'))`),
  resuelta:     integer('resuelta', { mode: 'boolean' }).notNull().default(false),
  resueltaEn:   text('resuelta_en'),
}, (t) => [index('idx_alertas_resuelta').on(t.resuelta)]);
