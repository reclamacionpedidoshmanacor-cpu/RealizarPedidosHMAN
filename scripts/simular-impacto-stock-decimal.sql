-- Simulación de solo lectura previa al despliegue.
-- Compara las propuestas históricas con la regla homogénea usando unidades
-- como fuente del stock y sin modificar ninguna tabla.

WITH simulacion AS (
  SELECT
    p.area,
    p.id AS propuesta_id,
    pl.cn,
    pl.cajas_propuestas AS propuesta_historica,
    round(
      sr.stock_unidades::numeric / GREATEST(pl.unidades_por_caja, 1),
      4
    ) AS stock_exacto,
    pl.stock_transito_snap AS transito,
    pl.punto_pedido_snap AS punto_pedido,
    pl.stock_maximo_snap AS stock_maximo,
    CASE
      WHEN (
        round(sr.stock_unidades::numeric / GREATEST(pl.unidades_por_caja, 1), 4)
        + pl.stock_transito_snap
      ) > pl.punto_pedido_snap
        THEN 0
      ELSE ROUND(GREATEST(
        pl.stock_maximo_snap
        - round(sr.stock_unidades::numeric / GREATEST(pl.unidades_por_caja, 1), 4)
        - pl.stock_transito_snap,
        0
      ))
    END AS propuesta_homogenea
  FROM public.propuestas AS p
  JOIN public.propuestas_lineas AS pl
    ON pl.propuesta_id = p.id
  JOIN public.stock_registros AS sr
    ON sr.importacion_id = p.importacion_stock_id
   AND sr.cn = pl.cn
  WHERE p.area <> 'almacen'
)
SELECT
  area,
  COUNT(*)::int AS lineas_comparadas,
  COUNT(*) FILTER (
    WHERE propuesta_historica IS DISTINCT FROM propuesta_homogenea
  )::int AS cantidades_que_cambiarian,
  COUNT(*) FILTER (
    WHERE (propuesta_historica = 0) <> (propuesta_homogenea = 0)
  )::int AS decisiones_pedir_no_pedir_que_cambiarian,
  SUM(ABS(propuesta_historica - propuesta_homogenea)) FILTER (
    WHERE propuesta_historica IS DISTINCT FROM propuesta_homogenea
  ) AS diferencia_total_cajas
FROM simulacion
GROUP BY area
ORDER BY area;

-- Detalle revisable de las líneas afectadas.
WITH simulacion AS (
  SELECT
    p.area,
    p.id AS propuesta_id,
    pl.cn,
    pl.cajas_propuestas AS propuesta_historica,
    round(
      sr.stock_unidades::numeric / GREATEST(pl.unidades_por_caja, 1),
      4
    ) AS stock_exacto,
    pl.stock_transito_snap AS transito,
    pl.punto_pedido_snap AS punto_pedido,
    pl.stock_maximo_snap AS stock_maximo,
    CASE
      WHEN (
        round(sr.stock_unidades::numeric / GREATEST(pl.unidades_por_caja, 1), 4)
        + pl.stock_transito_snap
      ) > pl.punto_pedido_snap
        THEN 0
      ELSE ROUND(GREATEST(
        pl.stock_maximo_snap
        - round(sr.stock_unidades::numeric / GREATEST(pl.unidades_por_caja, 1), 4)
        - pl.stock_transito_snap,
        0
      ))
    END AS propuesta_homogenea
  FROM public.propuestas AS p
  JOIN public.propuestas_lineas AS pl
    ON pl.propuesta_id = p.id
  JOIN public.stock_registros AS sr
    ON sr.importacion_id = p.importacion_stock_id
   AND sr.cn = pl.cn
  WHERE p.area <> 'almacen'
)
SELECT *
FROM simulacion
WHERE propuesta_historica IS DISTINCT FROM propuesta_homogenea
ORDER BY propuesta_id DESC, area, cn;
