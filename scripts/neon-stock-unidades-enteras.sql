-- Las unidades totales son la fuente de verdad del stock.
-- Esta migración no redondea: aborta si existe cualquier unidad fraccionaria.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.stock_registros
    WHERE stock_unidades <> trunc(stock_unidades)
  ) THEN
    RAISE EXCEPTION
      'Migración abortada: existen recuentos con unidades fraccionarias que deben revisarse manualmente.';
  END IF;
END $$;

ALTER TABLE public.stock_registros
  ALTER COLUMN stock_unidades TYPE INTEGER
    USING stock_unidades::integer;

UPDATE public.stock_registros AS sr
SET stock_cajas = round(
  sr.stock_unidades::numeric / GREATEST(m.unidades_por_caja, 1),
  4
)
FROM public.medicamentos AS m
WHERE m.cn = sr.cn;

ALTER TABLE public.stock_registros
  DROP CONSTRAINT IF EXISTS stock_registros_unidades_no_negativas;

ALTER TABLE public.stock_registros
  ADD CONSTRAINT stock_registros_unidades_no_negativas
    CHECK (stock_unidades >= 0);

COMMIT;
