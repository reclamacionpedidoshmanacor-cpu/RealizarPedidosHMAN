BEGIN;

CREATE TABLE IF NOT EXISTS public.reposicion_catalogo (
  id                    SERIAL PRIMARY KEY,
  area_destino          TEXT NOT NULL,
  ubicacion_destino     TEXT NOT NULL,
  codigo                TEXT NOT NULL,
  cn                    TEXT,
  tipo                  TEXT NOT NULL DEFAULT 'medicamento',
  area_origen           TEXT,
  principio_activo      TEXT,
  nombre                TEXT NOT NULL,
  unidades_por_caja     INTEGER NOT NULL DEFAULT 1,
  unidad_pedido         TEXT NOT NULL DEFAULT 'cajas',
  stock_maximo          NUMERIC(14,4),
  punto_pedido          NUMERIC(14,4),
  notas                 TEXT,
  activo                BOOLEAN NOT NULL DEFAULT TRUE,
  grupo_intercambio_id  INTEGER,
  creado_en             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (area_destino, ubicacion_destino, codigo)
);

CREATE INDEX IF NOT EXISTS idx_reposicion_catalogo_area
  ON public.reposicion_catalogo (area_destino, activo, ubicacion_destino);

CREATE TABLE IF NOT EXISTS public.cn_intercambio_grupos (
  id              SERIAL PRIMARY KEY,
  cn_vigente      TEXT NOT NULL,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cn_intercambio_miembros (
  grupo_id   INTEGER NOT NULL REFERENCES public.cn_intercambio_grupos(id) ON DELETE CASCADE,
  cn         TEXT NOT NULL,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (grupo_id, cn),
  UNIQUE (cn)
);

CREATE TABLE IF NOT EXISTS public.cn_intercambio_historial (
  id           SERIAL PRIMARY KEY,
  grupo_id     INTEGER NOT NULL REFERENCES public.cn_intercambio_grupos(id) ON DELETE CASCADE,
  area         TEXT NOT NULL,
  ubicacion    TEXT,
  cn_anterior  TEXT NOT NULL,
  cn_nuevo     TEXT NOT NULL,
  origen       TEXT NOT NULL,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cn_intercambio_historial_grupo
  ON public.cn_intercambio_historial (grupo_id, creado_en DESC);

ALTER TABLE public.propuestas_lineas
  ADD COLUMN IF NOT EXISTS requiere_revision_cn BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.pedidos_reposicion_lineas ADD COLUMN IF NOT EXISTS catalogo_id INTEGER;
ALTER TABLE public.pedidos_reposicion_lineas ADD COLUMN IF NOT EXISTS codigo_item TEXT;
ALTER TABLE public.pedidos_reposicion_lineas ADD COLUMN IF NOT EXISTS tipo_item TEXT NOT NULL DEFAULT 'medicamento';
ALTER TABLE public.pedidos_reposicion_lineas ADD COLUMN IF NOT EXISTS area_origen TEXT;
ALTER TABLE public.pedidos_reposicion_lineas ADD COLUMN IF NOT EXISTS unidad_pedido TEXT NOT NULL DEFAULT 'cajas';
ALTER TABLE public.pedidos_reposicion_lineas ADD COLUMN IF NOT EXISTS punto_pedido NUMERIC;
ALTER TABLE public.pedidos_reposicion_lineas ADD COLUMN IF NOT EXISTS notas TEXT;

UPDATE public.pedidos_reposicion_lineas
SET codigo_item = cn
WHERE codigo_item IS NULL;

ALTER TABLE public.pedidos_reposicion_lineas
  DROP CONSTRAINT IF EXISTS pedidos_reposicion_lineas_pedido_id_cn_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_reposicion_linea_pedido_ubicacion_codigo
  ON public.pedidos_reposicion_lineas (pedido_id, ubicacion, codigo_item);

INSERT INTO public.reposicion_catalogo (
  area_destino, ubicacion_destino, codigo, cn, tipo, area_origen,
  principio_activo, nombre, unidades_por_caja, unidad_pedido,
  stock_maximo, punto_pedido
)
SELECT
  'upe', COALESCE(NULLIF(BTRIM(m.ubicacion), ''), 'Sin ubicación'),
  m.cn, m.cn, 'medicamento', m.area, m.principio_activo, m.nombre,
  GREATEST(m.unidades_por_caja, 1), 'cajas', so.stock_maximo, so.punto_pedido
FROM public.medicamentos m
LEFT JOIN public.stock_objetivo so ON so.cn = m.cn
WHERE m.area = 'upe' AND m.activo = TRUE
ON CONFLICT (area_destino, ubicacion_destino, codigo) DO NOTHING;

WITH semillas(ubicacion, cn, stock_maximo, punto_pedido, unidad_pedido, notas) AS (
  VALUES
    ('Nevera NEA', '705605', 14, 8, 'cajas', NULL),
    ('Nevera NEA', '705607', 12, 8, 'cajas', NULL),
    ('Nevera NEA', '731332', 2, 1, 'cajas', NULL),
    ('Nevera NEA', '665973', 12, 6, 'cajas', NULL),
    ('Nevera NEA', '665971', 8, 6, 'cajas', NULL),
    ('Nevera NEA', '714133', 2, 1, 'cajas', NULL),
    ('Nevera NEA', '663010', 2, 1, 'cajas', NULL),
    ('Nevera NEA', '663007', 2, 1, 'cajas', NULL),
    ('Cajonera NEA', '688760', 4, 2, 'cajas', NULL),
    ('Cajonera NEA', '661560', 2, 1, 'cajas', 'Solamente presentación reenvasada'),
    ('Cajonera NEA', '030602', 30, 20, 'unidades', NULL),
    ('Cajonera NEA', '730111', 3, 1, 'cajas', NULL)
)
INSERT INTO public.reposicion_catalogo (
  area_destino, ubicacion_destino, codigo, cn, tipo, area_origen,
  principio_activo, nombre, unidades_por_caja, unidad_pedido,
  stock_maximo, punto_pedido, notas
)
SELECT
  'oncologia', s.ubicacion, m.cn, m.cn, 'medicamento', m.area,
  m.principio_activo, m.nombre, GREATEST(m.unidades_por_caja, 1),
  s.unidad_pedido, s.stock_maximo, s.punto_pedido, s.notas
FROM semillas s
JOIN public.medicamentos m ON m.cn = s.cn
ON CONFLICT (area_destino, ubicacion_destino, codigo) DO NOTHING;

INSERT INTO public.reposicion_catalogo (
  area_destino, ubicacion_destino, codigo, tipo, principio_activo,
  nombre, unidades_por_caja, unidad_pedido, stock_maximo, punto_pedido
)
VALUES (
  'oncologia', 'Cajonera NEA', 'FM-MUCOSITIS', 'formula',
  'Solución de mucositis', 'Solución de mucositis', 1, 'unidades', 3, 2
)
ON CONFLICT (area_destino, ubicacion_destino, codigo) DO NOTHING;

UPDATE public.pedidos_reposicion_lineas l
SET catalogo_id = rc.id,
    codigo_item = rc.codigo,
    tipo_item = rc.tipo,
    area_origen = rc.area_origen,
    unidad_pedido = rc.unidad_pedido,
    punto_pedido = rc.punto_pedido,
    notas = rc.notas
FROM public.pedidos_reposicion p, public.reposicion_catalogo rc
WHERE p.id = l.pedido_id
  AND rc.area_destino = p.area
  AND rc.ubicacion_destino = l.ubicacion
  AND rc.cn = l.cn
  AND l.catalogo_id IS NULL;

COMMIT;
