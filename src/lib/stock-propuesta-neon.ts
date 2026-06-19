import { neon } from '@neondatabase/serverless';
import { calcularCajasPropuestas } from '@/lib/propuesta';

function getDb() {
  const url = process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Falta REALIZAR_PEDIDOS_DATABASE_URL para conectar a Neon.');
  return neon(url);
}

function num(v: unknown): number { return Number(v ?? 0); }
function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// TIPOS
// ---------------------------------------------------------------------------
export type RecuentoCabecera = {
  id: number;
  area: string;
  estado: string;
  origen: string;
  fechaRecuento: string;
  importadoEn: string;
  totalLineas: number;
  propuestaId: number | null;
};

export type RecuentoLinea = {
  cn: string;
  nombre: string;
  stockCajas: number;
  stockUnidades: number;
  valorTotal: number | null;
};

export type PropuestaCabecera = {
  id: number;
  area: string;
  estado: string;
  fechaGeneracion: string;
  tramitadaEn: string | null;
};

export type PropuestaLinea = {
  id: number;
  cn: string;
  nombreMedicamento: string | null;
  unidadesPorCaja: number;
  stockActual: number;
  stockMinimoSnap: number;
  puntoPedidoSnap: number;
  stockMaximoSnap: number;
  cajasPropuestas: number;
  cajasValidadas: number | null;
  motivoAjuste: string | null;
  motivoAjusteOtro: string | null;
  ajustado: boolean;
};

// ---------------------------------------------------------------------------
// RECUENTOS
// ---------------------------------------------------------------------------
export async function getRecuentosByArea(area: string): Promise<{
  pendiente: RecuentoCabecera | null;
  historico: RecuentoCabecera[];
}> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, area, estado, origen, fecha_recuento::text, importado_en::text, total_lineas, propuesta_id
    FROM importaciones_stock
    WHERE area = ${area}
    ORDER BY id DESC;
  `) as Array<{
    id: number; area: string; estado: string; origen: string;
    fecha_recuento: string; importado_en: string; total_lineas: number; propuesta_id: number | null;
  }>;

  const mapped: RecuentoCabecera[] = rows.map((r) => ({
    id: num(r.id), area: r.area, estado: r.estado, origen: r.origen,
    fechaRecuento: r.fecha_recuento, importadoEn: r.importado_en,
    totalLineas: num(r.total_lineas), propuestaId: r.propuesta_id ? num(r.propuesta_id) : null,
  }));

  return {
    pendiente: mapped.find((r) => r.estado === 'pendiente') ?? null,
    historico: mapped.filter((r) => r.estado !== 'pendiente'),
  };
}

export async function getLineasRecuento(importacionId: number): Promise<RecuentoLinea[]> {
  const sql = getDb();
  const rows = (await sql`
    SELECT sr.cn, m.nombre, sr.stock_cajas, sr.stock_unidades, sr.valor_total
    FROM stock_registros sr
    INNER JOIN medicamentos m ON m.cn = sr.cn
    WHERE sr.importacion_id = ${importacionId}
    ORDER BY m.principio_activo ASC NULLS LAST, m.nombre ASC;
  `) as Array<{
    cn: string; nombre: string;
    stock_cajas: string; stock_unidades: string; valor_total: string | null;
  }>;

  return rows.map((r) => ({
    cn: r.cn, nombre: r.nombre,
    stockCajas: num(r.stock_cajas), stockUnidades: num(r.stock_unidades),
    valorTotal: numOrNull(r.valor_total),
  }));
}

export async function getPendienteRecuento(area: string): Promise<RecuentoCabecera | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, area, estado, origen, fecha_recuento::text, importado_en::text, total_lineas, propuesta_id
    FROM importaciones_stock
    WHERE area = ${area} AND estado = 'pendiente'
    ORDER BY id DESC LIMIT 1;
  `) as Array<{
    id: number; area: string; estado: string; origen: string;
    fecha_recuento: string; importado_en: string; total_lineas: number; propuesta_id: number | null;
  }>;

  const r = rows[0];
  if (!r) return null;
  return {
    id: num(r.id), area: r.area, estado: r.estado, origen: r.origen,
    fechaRecuento: r.fecha_recuento, importadoEn: r.importado_en,
    totalLineas: num(r.total_lineas), propuestaId: r.propuesta_id ? num(r.propuesta_id) : null,
  };
}

export async function crearRecuento(params: {
  area: string; origen: string; fechaRecuento: string;
  ficheroNombre: string; totalLineas: number;
}): Promise<number> {
  const sql = getDb();
  const rows = (await sql`
    INSERT INTO importaciones_stock (area, origen, estado, fecha_recuento, fichero_nombre, total_lineas)
    VALUES (${params.area}, ${params.origen}, 'pendiente', ${params.fechaRecuento}, ${params.ficheroNombre}, ${params.totalLineas})
    RETURNING id;
  `) as Array<{ id: number }>;
  return num(rows[0]?.id);
}

export async function insertarLineasRecuento(
  importacionId: number,
  lineas: Array<{ cn: string; stockUnidades: number; stockCajas: number; valorTotal: number | null }>
): Promise<void> {
  const sql = getDb();
  for (const l of lineas) {
    await sql`
      INSERT INTO stock_registros (importacion_id, cn, stock_unidades, stock_cajas, valor_total)
      VALUES (${importacionId}, ${l.cn}, ${l.stockUnidades}, ${l.stockCajas}, ${l.valorTotal});
    `;
  }
}

export async function getMedicamentosParaRecuento(
  area: string, cns: string[]
): Promise<Array<{ cn: string; nombre: string; unidadesPorCaja: number }>> {
  if (cns.length === 0) return [];
  const sql = getDb();
  const rows = (await sql`
    SELECT cn, nombre, unidades_por_caja
    FROM medicamentos
    WHERE area = ${area} AND cn = ANY(${cns});
  `) as Array<{ cn: string; nombre: string; unidades_por_caja: number }>;
  return rows.map((r) => ({ cn: r.cn, nombre: r.nombre, unidadesPorCaja: num(r.unidades_por_caja) }));
}

export async function getRecuentoById(id: number): Promise<{ id: number; area: string; estado: string } | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, area, estado FROM importaciones_stock WHERE id = ${id} LIMIT 1;
  `) as Array<{ id: number; area: string; estado: string }>;
  const r = rows[0];
  return r ? { id: num(r.id), area: r.area, estado: r.estado } : null;
}

export async function actualizarLineaRecuento(
  importacionId: number, cn: string, stockCajas: number, stockUnidades: number
): Promise<boolean> {
  const sql = getDb();
  const rows = (await sql`
    UPDATE stock_registros
    SET stock_cajas = ${stockCajas}, stock_unidades = ${stockUnidades}
    WHERE importacion_id = ${importacionId} AND cn = ${cn}
    RETURNING id;
  `) as Array<{ id: number }>;
  return rows.length > 0;
}

export async function getMedicamentoByCnArea(
  cn: string, area: string
): Promise<{ cn: string; unidadesPorCaja: number } | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT cn, unidades_por_caja FROM medicamentos WHERE cn = ${cn} AND area = ${area} LIMIT 1;
  `) as Array<{ cn: string; unidades_por_caja: number }>;
  const r = rows[0];
  return r ? { cn: r.cn, unidadesPorCaja: num(r.unidades_por_caja) } : null;
}

// ---------------------------------------------------------------------------
// PROPUESTAS
// ---------------------------------------------------------------------------
export async function getBorradorPropuesta(
  area: string, importacionStockId: number
): Promise<PropuestaCabecera | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, area, estado, fecha_generacion::text, tramitada_en::text
    FROM propuestas
    WHERE area = ${area} AND importacion_stock_id = ${importacionStockId} AND estado = 'borrador'
    ORDER BY id DESC LIMIT 1;
  `) as Array<{
    id: number; area: string; estado: string;
    fecha_generacion: string; tramitada_en: string | null;
  }>;
  const r = rows[0];
  if (!r) return null;
  return { id: num(r.id), area: r.area, estado: r.estado, fechaGeneracion: r.fecha_generacion, tramitadaEn: r.tramitada_en };
}

export async function crearPropuesta(area: string, importacionStockId: number): Promise<PropuestaCabecera> {
  const sql = getDb();
  const rows = (await sql`
    INSERT INTO propuestas (area, estado, importacion_stock_id, fecha_generacion)
    VALUES (${area}, 'borrador', ${importacionStockId}, now())
    RETURNING id, area, estado, fecha_generacion::text, tramitada_en::text;
  `) as Array<{
    id: number; area: string; estado: string;
    fecha_generacion: string; tramitada_en: string | null;
  }>;
  const r = rows[0]!;
  return { id: num(r.id), area: r.area, estado: r.estado, fechaGeneracion: r.fecha_generacion, tramitadaEn: r.tramitada_en };
}

export async function getLineasPropuesta(propuestaId: number): Promise<PropuestaLinea[]> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, cn, nombre_medicamento, unidades_por_caja,
           stock_actual, stock_minimo_snap, punto_pedido_snap, stock_maximo_snap,
           cajas_propuestas, cajas_validadas, motivo_ajuste, motivo_ajuste_otro, ajustado
    FROM propuestas_lineas
    WHERE propuesta_id = ${propuestaId}
    ORDER BY nombre_medicamento ASC NULLS LAST;
  `) as Array<{
    id: number; cn: string; nombre_medicamento: string | null; unidades_por_caja: number;
    stock_actual: string; stock_minimo_snap: number; punto_pedido_snap: number; stock_maximo_snap: number;
    cajas_propuestas: number; cajas_validadas: number | null;
    motivo_ajuste: string | null; motivo_ajuste_otro: string | null; ajustado: boolean;
  }>;

  return rows.map((r) => ({
    id: num(r.id), cn: r.cn, nombreMedicamento: r.nombre_medicamento,
    unidadesPorCaja: num(r.unidades_por_caja), stockActual: num(r.stock_actual),
    stockMinimoSnap: num(r.stock_minimo_snap), puntoPedidoSnap: num(r.punto_pedido_snap),
    stockMaximoSnap: num(r.stock_maximo_snap), cajasPropuestas: num(r.cajas_propuestas),
    cajasValidadas: r.cajas_validadas != null ? num(r.cajas_validadas) : null,
    motivoAjuste: r.motivo_ajuste, motivoAjusteOtro: r.motivo_ajuste_otro, ajustado: r.ajustado,
  }));
}

export async function getRecuentoConStockParaPropuesta(importacionId: number, area: string) {
  const sql = getDb();
  return (await sql`
    SELECT
      sr.cn, sr.stock_cajas,
      m.nombre, m.unidades_por_caja,
      so.stock_minimo, so.punto_pedido, so.stock_maximo
    FROM stock_registros sr
    INNER JOIN medicamentos m ON m.cn = sr.cn AND m.area = ${area} AND m.activo = true
    LEFT JOIN stock_objetivo so ON so.cn = sr.cn
    WHERE sr.importacion_id = ${importacionId};
  `) as Array<{
    cn: string; stock_cajas: string;
    nombre: string; unidades_por_caja: number;
    stock_minimo: number | null; punto_pedido: number | null; stock_maximo: number | null;
  }>;
}

export async function insertarLineasPropuesta(
  propuestaId: number,
  rows: Array<{
    cn: string; nombre: string; unidadesPorCaja: number; stockCajas: number;
    stockMinimo: number; puntoPedido: number; stockMaximo: number;
  }>
): Promise<void> {
  const sql = getDb();
  for (const r of rows) {
    const cajasPropuestas = calcularCajasPropuestas(r.stockCajas, r.puntoPedido, r.stockMaximo);
    await sql`
      INSERT INTO propuestas_lineas (
        propuesta_id, cn, nombre_medicamento, unidades_por_caja,
        stock_actual, stock_minimo_snap, punto_pedido_snap, stock_maximo_snap, stock_objetivo_snap,
        cajas_propuestas, cajas_validadas, ajustado
      ) VALUES (
        ${propuestaId}, ${r.cn}, ${r.nombre}, ${r.unidadesPorCaja},
        ${r.stockCajas}, ${r.stockMinimo}, ${r.puntoPedido}, ${r.stockMaximo}, ${r.stockMaximo},
        ${cajasPropuestas}, ${cajasPropuestas}, false
      );
    `;
  }
}

export async function getLineaConPropuesta(lineaId: number): Promise<{
  id: number; cajasPropuestas: number; propuestaId: number;
  estadoPropuesta: string; areaPropuesta: string; unidadesPorCaja: number;
} | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT pl.id, pl.cajas_propuestas, pl.propuesta_id, pl.unidades_por_caja,
           p.estado AS estado_propuesta, p.area AS area_propuesta
    FROM propuestas_lineas pl
    INNER JOIN propuestas p ON p.id = pl.propuesta_id
    WHERE pl.id = ${lineaId}
    LIMIT 1;
  `) as Array<{
    id: number; cajas_propuestas: number; propuesta_id: number;
    unidades_por_caja: number; estado_propuesta: string; area_propuesta: string;
  }>;
  const r = rows[0];
  if (!r) return null;
  return {
    id: num(r.id), cajasPropuestas: num(r.cajas_propuestas),
    propuestaId: num(r.propuesta_id), unidadesPorCaja: num(r.unidades_por_caja),
    estadoPropuesta: r.estado_propuesta, areaPropuesta: r.area_propuesta,
  };
}

export async function actualizarLineaPropuesta(
  lineaId: number, propuestaId: number,
  cajasValidadas: number, unidadesFinal: number,
  motivoAjuste: string | null, motivoAjusteOtro: string | null, ajustado: boolean
): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE propuestas_lineas
    SET cajas_validadas = ${cajasValidadas},
        motivo_ajuste = ${motivoAjuste},
        motivo_ajuste_otro = ${motivoAjusteOtro},
        ajustado = ${ajustado},
        unidades_final = ${unidadesFinal}
    WHERE id = ${lineaId} AND propuesta_id = ${propuestaId};
  `;
}

export async function getPropuestaById(propuestaId: number): Promise<{
  id: number; area: string; estado: string;
  importacionStockId: number | null; fechaGeneracion: string;
} | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, area, estado, importacion_stock_id, fecha_generacion::text
    FROM propuestas WHERE id = ${propuestaId} LIMIT 1;
  `) as Array<{
    id: number; area: string; estado: string;
    importacion_stock_id: number | null; fecha_generacion: string;
  }>;
  const r = rows[0];
  if (!r) return null;
  return {
    id: num(r.id), area: r.area, estado: r.estado,
    importacionStockId: r.importacion_stock_id ? num(r.importacion_stock_id) : null,
    fechaGeneracion: r.fecha_generacion,
  };
}

export async function tramitarPropuesta(propuestaId: number, importacionStockId: number): Promise<void> {
  const sql = getDb();

  const lineas = (await sql`
    SELECT id, cajas_propuestas, cajas_validadas, unidades_por_caja
    FROM propuestas_lineas WHERE propuesta_id = ${propuestaId};
  `) as Array<{
    id: number; cajas_propuestas: number;
    cajas_validadas: number | null; unidades_por_caja: number;
  }>;

  for (const l of lineas) {
    const cajasFinales = l.cajas_validadas ?? l.cajas_propuestas;
    await sql`
      UPDATE propuestas_lineas
      SET cajas_validadas = ${cajasFinales},
          unidades_final = ${Math.round(cajasFinales * num(l.unidades_por_caja))}
      WHERE id = ${num(l.id)} AND propuesta_id = ${propuestaId};
    `;
  }

  await sql`
    UPDATE propuestas
    SET estado = 'tramitada', tramitada_en = now(), validada_en = now()
    WHERE id = ${propuestaId};
  `;

  await sql`
    UPDATE importaciones_stock
    SET estado = 'generado', generado_en = now(), propuesta_id = ${propuestaId}
    WHERE id = ${importacionStockId};
  `;
}

export async function deshacerPropuesta(propuestaId: number, importacionStockId: number): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE propuestas
    SET estado = 'borrador', tramitada_en = null, validada_en = null
    WHERE id = ${propuestaId};
  `;
  await sql`
    UPDATE importaciones_stock
    SET estado = 'pendiente', generado_en = null, propuesta_id = null
    WHERE id = ${importacionStockId};
  `;
}

export async function getLineasParaExcel(propuestaId: number): Promise<Array<{
  cn: string; nombreMedicamento: string | null;
  cajasPropuestas: number; cajasValidadas: number | null; unidadesPorCaja: number;
}>> {
  const sql = getDb();
  const rows = (await sql`
    SELECT cn, nombre_medicamento, cajas_propuestas, cajas_validadas, unidades_por_caja
    FROM propuestas_lineas WHERE propuesta_id = ${propuestaId};
  `) as Array<{
    cn: string; nombre_medicamento: string | null;
    cajas_propuestas: number; cajas_validadas: number | null; unidades_por_caja: number;
  }>;
  return rows.map((r) => ({
    cn: r.cn, nombreMedicamento: r.nombre_medicamento,
    cajasPropuestas: num(r.cajas_propuestas),
    cajasValidadas: r.cajas_validadas != null ? num(r.cajas_validadas) : null,
    unidadesPorCaja: num(r.unidades_por_caja),
  }));
}

export type PropuestaResumen = {
  id: number;
  estado: string;
  fechaGeneracion: string;
  tramitadaEn: string | null;
  totalLineas: number;
  recuentoId: number | null;
  recuentoFecha: string | null;
  recuentoOrigen: string | null;
  excelGeneradoEn: string | null;
};

export async function listPropuestasByArea(area: string): Promise<PropuestaResumen[]> {
  const sql = getDb();
  const rows = (await sql`
    SELECT
      p.id,
      p.estado,
      p.fecha_generacion::text   AS fecha_generacion,
      p.tramitada_en::text       AS tramitada_en,
      p.excel_generado_en::text  AS excel_generado_en,
      p.importacion_stock_id     AS recuento_id,
      i.fecha_recuento::text     AS recuento_fecha,
      i.origen                   AS recuento_origen,
      COUNT(pl.id)::int          AS total_lineas
    FROM propuestas p
    LEFT JOIN importaciones_stock i ON i.id = p.importacion_stock_id
    LEFT JOIN propuestas_lineas pl ON pl.propuesta_id = p.id
    WHERE p.area = ${area}
    GROUP BY p.id, i.fecha_recuento, i.origen
    ORDER BY p.id DESC
    LIMIT 50;
  `) as Array<{
    id: number; estado: string; fecha_generacion: string;
    tramitada_en: string | null; excel_generado_en: string | null;
    recuento_id: number | null; recuento_fecha: string | null;
    recuento_origen: string | null; total_lineas: number;
  }>;
  return rows.map(r => ({
    id: num(r.id),
    estado: r.estado,
    fechaGeneracion: r.fecha_generacion,
    tramitadaEn: r.tramitada_en,
    excelGeneradoEn: r.excel_generado_en,
    recuentoId: r.recuento_id ? num(r.recuento_id) : null,
    recuentoFecha: r.recuento_fecha,
    recuentoOrigen: r.recuento_origen,
    totalLineas: num(r.total_lineas),
  }));
}

export async function marcarExcelGenerado(propuestaId: number, area: string): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE propuestas SET excel_generado_en = now()
    WHERE id = ${propuestaId} AND area = ${area};
  `;
}
