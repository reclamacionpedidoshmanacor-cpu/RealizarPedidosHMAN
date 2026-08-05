-- Migración Neon/PostgreSQL: unidades exactas, cajas equivalentes decimales
-- y pedidos en cajas enteras.
-- Ejecutar antes de desplegar el código que elimina los ALTER TABLE en runtime.
-- Es idempotente respecto a columnas y tipos; aborta si detecta propuestas decimales.

BEGIN;

ALTER TABLE propuestas
  ADD COLUMN IF NOT EXISTS observaciones TEXT;

ALTER TABLE propuestas_lineas
  ADD COLUMN IF NOT EXISTS stock_transito_snap NUMERIC(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS proveedor_local BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE propuestas_lineas
SET proveedor_local = FALSE
WHERE proveedor_local IS NULL;

ALTER TABLE propuestas_lineas
  ALTER COLUMN proveedor_local SET DEFAULT FALSE,
  ALTER COLUMN proveedor_local SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM stock_registros
    WHERE stock_unidades <> trunc(stock_unidades)
  ) THEN
    RAISE EXCEPTION
      'Migración abortada: existen unidades de stock fraccionarias. Deben corregirse sin redondear.';
  END IF;
END $$;

ALTER TABLE stock_registros
  ALTER COLUMN stock_unidades TYPE INTEGER
    USING stock_unidades::integer,
  ALTER COLUMN stock_cajas TYPE NUMERIC(14,4)
    USING round(stock_cajas::numeric, 4);

UPDATE stock_registros sr
SET stock_cajas = round(
  sr.stock_unidades::numeric / GREATEST(m.unidades_por_caja, 1),
  4
)
FROM medicamentos m
WHERE m.cn = sr.cn;

ALTER TABLE stock_objetivo
  ALTER COLUMN stock_minimo TYPE NUMERIC(14,4)
    USING round(stock_minimo::numeric, 4),
  ALTER COLUMN punto_pedido TYPE NUMERIC(14,4)
    USING round(punto_pedido::numeric, 4),
  ALTER COLUMN stock_maximo TYPE NUMERIC(14,4)
    USING round(stock_maximo::numeric, 4);

ALTER TABLE propuestas_lineas
  ALTER COLUMN stock_actual TYPE NUMERIC(14,4)
    USING round(stock_actual::numeric, 4),
  ALTER COLUMN stock_transito_snap TYPE NUMERIC(14,4)
    USING round(stock_transito_snap::numeric, 4),
  ALTER COLUMN stock_minimo_snap TYPE NUMERIC(14,4)
    USING round(stock_minimo_snap::numeric, 4),
  ALTER COLUMN punto_pedido_snap TYPE NUMERIC(14,4)
    USING round(punto_pedido_snap::numeric, 4),
  ALTER COLUMN stock_maximo_snap TYPE NUMERIC(14,4)
    USING round(stock_maximo_snap::numeric, 4),
  ALTER COLUMN stock_objetivo_snap TYPE NUMERIC(14,4)
    USING round(stock_objetivo_snap::numeric, 4);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM propuestas_lineas
    WHERE cajas_propuestas <> trunc(cajas_propuestas)
       OR (cajas_validadas IS NOT NULL AND cajas_validadas <> trunc(cajas_validadas))
  ) THEN
    RAISE EXCEPTION
      'Migración abortada: existen propuestas con cajas decimales. Revisarlas antes de continuar.';
  END IF;
END $$;

ALTER TABLE propuestas_lineas
  ALTER COLUMN cajas_propuestas TYPE INTEGER
    USING trunc(cajas_propuestas)::integer,
  ALTER COLUMN cajas_validadas TYPE INTEGER
    USING CASE
      WHEN cajas_validadas IS NULL THEN NULL
      ELSE trunc(cajas_validadas)::integer
    END;

UPDATE propuestas_lineas
SET unidades_final =
  COALESCE(cajas_validadas, cajas_propuestas) * unidades_por_caja;

ALTER TABLE propuestas_lineas
  DROP CONSTRAINT IF EXISTS propuestas_lineas_cajas_propuestas_no_negativas,
  DROP CONSTRAINT IF EXISTS propuestas_lineas_cajas_validadas_no_negativas;

ALTER TABLE propuestas_lineas
  ADD CONSTRAINT propuestas_lineas_cajas_propuestas_no_negativas
    CHECK (cajas_propuestas >= 0),
  ADD CONSTRAINT propuestas_lineas_cajas_validadas_no_negativas
    CHECK (cajas_validadas IS NULL OR cajas_validadas >= 0);

COMMIT;
