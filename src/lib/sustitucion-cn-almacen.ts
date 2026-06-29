import { buscarMedicamentoPorCN } from './cima';
import {
  getMedicamentoByCn,
  getStockObjetivoByCn,
  insertMedicamento,
  updateMedicamentoConsumoMedio,
  updateMedicamento,
  upsertStockObjetivo,
} from './catalogo-neon';
import { isMSE, normalizarCnParaCima } from './utils';

export type DatosNuevoSustitucion = {
  nombre: string;
  principioActivo?: string | null;
  presentacion?: string | null;
  unidadesPorCaja?: number;
};

export type SustitucionCnAlmacenError = {
  status: number;
  error: string;
};

export type SustitucionCnAlmacenResult = {
  cnViejo: string;
  cnNuevo: string;
  nombre: string;
  principioActivo: string;
  presentacion: string;
  unidadesPorCaja: number;
  ubicacion: string;
  stockMinimo: number | null;
  puntoPedido: number | null;
  stockMaximo: number | null;
  consumoMedio: number | null;
};

function resolverDatosNuevo(
  cima: { nombre: string; principioActivo: string; presentacion: string; unidadesPorCaja: number | null },
  datos?: DatosNuevoSustitucion
): { ok: true; datos: { nombre: string; principioActivo: string | null; presentacion: string | null; unidadesPorCaja: number } } | { ok: false; err: SustitucionCnAlmacenError } {
  const nombre = (datos?.nombre ?? cima.nombre).trim();
  if (!nombre) {
    return { ok: false, err: { status: 400, error: 'El nombre del medicamento es obligatorio.' } };
  }
  const principioActivo =
    datos?.principioActivo !== undefined
      ? (String(datos.principioActivo).trim() || null)
      : (cima.principioActivo?.trim() || null);
  const presentacion =
    datos?.presentacion !== undefined
      ? (String(datos.presentacion).trim() || null)
      : (cima.presentacion?.trim() || null);
  const udsRaw = datos?.unidadesPorCaja ?? cima.unidadesPorCaja;
  const unidadesPorCaja = udsRaw != null && Number(udsRaw) > 0 ? Number(udsRaw) : 1;
  return { ok: true, datos: { nombre, principioActivo, presentacion, unidadesPorCaja } };
}

export async function sustituirCnEnCatalogoAlmacen(params: {
  area: string;
  cnViejo: string;
  cnNuevoRaw: string;
  ubicacion: string;
  datosNuevo?: DatosNuevoSustitucion;
}): Promise<{ ok: true; result: SustitucionCnAlmacenResult } | { ok: false; err: SustitucionCnAlmacenError }> {
  const { area, cnViejo, cnNuevoRaw, ubicacion, datosNuevo } = params;

  const cnNuevo = normalizarCnParaCima(cnNuevoRaw);
  if (!cnNuevo) {
    return { ok: false, err: { status: 400, error: 'CN nuevo no válido.' } };
  }
  if (cnViejo === cnNuevo) {
    return { ok: false, err: { status: 400, error: 'El CN nuevo debe ser distinto del anterior.' } };
  }

  const viejo = await getMedicamentoByCn(cnViejo);
  if (!viejo || viejo.area !== area) {
    return { ok: false, err: { status: 404, error: `CN ${cnViejo} no encontrado en el catálogo de Almacén.` } };
  }
  if ((viejo.ubicacion ?? '').trim() !== ubicacion) {
    return { ok: false, err: { status: 400, error: 'El medicamento anterior no pertenece a esta ubicación.' } };
  }

  const cima = await buscarMedicamentoPorCN(cnNuevoRaw);
  if (!cima) {
    return { ok: false, err: { status: 404, error: `CN ${cnNuevo} no encontrado en CIMA (AEMPS).` } };
  }

  const datosResueltos = resolverDatosNuevo(cima, datosNuevo);
  if (!datosResueltos.ok) return datosResueltos;
  const { nombre, principioActivo, presentacion, unidadesPorCaja } = datosResueltos.datos;

  const existenteNuevo = await getMedicamentoByCn(cnNuevo);
  if (existenteNuevo && existenteNuevo.area !== area) {
    return {
      ok: false,
      err: { status: 409, error: `El CN ${cnNuevo} ya existe en el área ${existenteNuevo.area}.` },
    };
  }

  if (!existenteNuevo) {
    await insertMedicamento({
      cn: cnNuevo,
      nombre,
      principioActivo,
      presentacion,
      via: 'OTRO',
      area,
      ubicacion,
      unidadesPorCaja,
      activo: true,
      comprable: true,
      mse: isMSE(cnNuevo),
      tipoMse: null,
      precioUnidad: null,
      precioCaja: null,
    });
  } else {
    await updateMedicamento({
      cn: cnNuevo,
      nombre,
      principioActivo: principioActivo || existenteNuevo.principioActivo,
      presentacion: presentacion || existenteNuevo.presentacion || null,
      via: existenteNuevo.via ?? 'OTRO',
      area,
      ubicacion,
      unidadesPorCaja,
      activo: true,
      comprable: existenteNuevo.comprable,
      mse: isMSE(cnNuevo),
      tipoMse: existenteNuevo.tipoMse,
      precioUnidad: existenteNuevo.precioUnidad,
      precioCaja: existenteNuevo.precioCaja,
      consumoMedio: existenteNuevo.consumoMedio,
    });
  }

  const stockViejo = await getStockObjetivoByCn(cnViejo);
  const stockNuevo = await getStockObjetivoByCn(cnNuevo);
  if (stockViejo && !stockNuevo) {
    await upsertStockObjetivo(
      cnNuevo,
      stockViejo.stockMinimo,
      stockViejo.puntoPedido,
      stockViejo.stockMaximo
    );
  }

  if (viejo.consumoMedio != null) {
    const nuevoActual = await getMedicamentoByCn(cnNuevo);
    if (nuevoActual?.consumoMedio == null) {
      await updateMedicamentoConsumoMedio(cnNuevo, viejo.consumoMedio);
    }
  }

  await updateMedicamento({
    ...viejo,
    activo: false,
  });

  const stockFinal = await getStockObjetivoByCn(cnNuevo);
  const nuevoFinal = await getMedicamentoByCn(cnNuevo);

  return {
    ok: true,
    result: {
      cnViejo,
      cnNuevo,
      nombre,
      principioActivo: principioActivo ?? '',
      presentacion: presentacion ?? '',
      unidadesPorCaja,
      ubicacion,
      stockMinimo: stockFinal?.stockMinimo ?? null,
      puntoPedido: stockFinal?.puntoPedido ?? null,
      stockMaximo: stockFinal?.stockMaximo ?? null,
      consumoMedio: nuevoFinal?.consumoMedio ?? viejo.consumoMedio ?? null,
    },
  };
}
