# Changelog — RealizarPedidosHMAN

Historial de cambios del proyecto ordenado del más reciente al más antiguo.

---

## [Unreleased] — 19 jun 2026

### Pestaña Inicio — Panel de control
- **Nueva página `src/app/inicio/page.tsx`** rediseñada por completo:
  - **Bloque operativo** (3 tarjetas KPI): recuentos pendientes de tramitar, propuestas en borrador, medicamentos bajo stock mínimo (con indicador adicional de CNs en o bajo punto de pedido).
  - **Bloque de tendencias de consumo**: detecta automáticamente qué medicamentos han aumentado su consumo >10% comparando los últimos 3 meses de datos disponibles frente a los 3 meses anteriores (ventana equivalente a ~9 semanas / 3 ciclos de 21 días). Muestra principio activo, variación porcentual y barra visual.
  - **Curva de evolución** expandible al hacer clic en cada medicamento: gráfico de líneas (recharts) con consumo mensual (viales) y pedidos recibidos del sistema externo (PedidosPendientes), cruzados por mes.

### Nuevas API routes
- `GET /api/inicio/operativo` — resumen operativo (recuentos, propuestas, alertas de stock).
- `GET /api/inicio/tendencias` — medicamentos con variación >10% en consumo.
- `GET /api/inicio/curva?cn=XXX` — evolución mensual de consumo + pedidos recibidos para un CN.

### Base de datos — consumo_registros
- **Nueva columna `semana_iso`** (SMALLINT, nullable): semana ISO 8601 calculada automáticamente en el momento de la importación cuando el Excel incluye la columna DIA.
- Nuevo índice `idx_consumo_semana` para consultas por semana.
- La migración se aplica automáticamente con `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` al importar el primer archivo de consumo.

### Lib — consumo-parser.ts
- Añadido campo `semanaIso: number | null` a la interfaz `ConsumoRow`.
- Nueva función `calcIsoWeek(anio, mes, dia)` que calcula el número de semana ISO 8601.
- El campo se calcula automáticamente si el Excel incluye columna DIA; si no, queda `null` (datos históricos mensuales).

### Lib — consumo-neon.ts
- Nueva función `getTendenciasConsumo(area)`: detecta medicamentos con crecimiento >10% en una ventana de 3+3 meses relativa a la fecha máxima de los propios datos (no a la fecha actual).
- Nueva función `getCurvaMedicamento(cn, area)`: devuelve evolución mensual completa de viales y pacientes para un CN.
- `insertarImportacionConsumo`: actualizado para guardar `semana_iso` en el bulk insert con `unnest()`.
- `ensureConsumoTables`: añade `ALTER TABLE IF NOT EXISTS ... ADD COLUMN IF NOT EXISTS semana_iso`.

### Lib — stock-propuesta-neon.ts
- Nueva función `getResumenOperativo(area)`: consolida en una sola llamada los contadores de recuentos pendientes, propuestas en borrador, última propuesta tramitada, y alertas de stock (bajo mínimo / bajo punto de pedido).

### Ajustes aplicados después de validación en entorno
- Tendencias: excluidos del análisis `Fungible` y `Fluido`.
- Tendencias: sólo se analizan CN presentes en `medicamentos` del área activa (`m.area = area` y `m.activo = TRUE`).
- Etiqueta de tarjeta: se muestra **principio activo + marca comercial**; se elimina visualización de `tipo_componente`.
- Curva Inicio: ventana visible ajustada a **6 meses**.
- Curva Inicio: pedidos recibidos obtenidos por query directa por CN en `PedidosPendientes` y agregación mensual robusta de cantidades (parseo tolerante a formatos con coma/punto/texto).
- Texto UI actualizado: explica explícitamente ventana visible 6 meses y análisis de tendencia en comparación 3+3 meses.
- Historial de propuestas: nueva opción **Ver/Ocultar** para desplegar el detalle de líneas de cada propuesta sin deshacerla.
- Nueva API `GET /api/propuestas/[id]/detalle` con control de área para consultar propuesta + líneas en modo lectura.
- Propuestas: persistencia de `stock_transito_snap` en `propuestas_lineas` para conservar el valor de tránsito que influyó en el cálculo.
- Historial desplegable: añade columna **En tránsito** en el detalle de líneas para consulta/auditoría tras tramitación.
- Inicio: la ventana temporal de tendencia/curva se calcula contra fecha actual (`CURRENT_DATE`), evitando reutilizar ventanas antiguas del histórico (ej. 2024).
- Inicio: la serie de pedidos en curva pasa a considerar pedidos no anulados (recibidos + pendientes) en los últimos 6 meses.

### Pendiente para retomar (bloqueado por datos)
- Cargar histórico de consumo depurado con datos suficientes para detectar tendencias reales.
- Incorporar `DIA` (y semana en origen si aplica) en próximos ficheros para mejorar granularidad semanal.
- Revalidar en `Inicio` la curva consumo/pedidos con 2-3 CN de control una vez cargado el histórico final.

---

## [v0.8] — 19 jun 2026

### Pestaña Inventario
- Selección de recuento manual, carga de archivo SAP, cálculo de ajuste en unidades.
- Columnas de importe calculadas desde `precio_caja` / `precio_unidad` del catálogo.
- Exportación a Excel: primera columna "Codigo SAP (14+CN)" en lugar de CN.

---

## [v0.7] — 19 jun 2026

### Pestaña Consumo
- Importación de Excel con columnas: AÑO, MES, DIA, SERVICIO, UH, INDICACION, DIAGNOSTICO, PROTOCOLO, Nº CICLO, TIPO DE TERAPIA, TIPO DE COMPONENTE, COMPONENTE (principio activo), CN, MEDICAMENTO, VIALES DISPENSADOS, Nº DE PACIENTES.
- Vista "Por medicamento" con desglose por diagnóstico, indicación y protocolo.
- Vista "Evolución temporal" con gráfico mensual global.
- Filtros por fecha (fechaDesde / fechaHasta).
- Prioridad visual invertida: Medicamento en negrita, Tipo de componente en gris.
- Bulk insert con `unnest()` para importaciones grandes (evita timeout).
- Límite de payload aumentado a 20 MB en `next.config.ts`.
- Parser flexible: aliases múltiples para columnas, match exacto/prefijo/parcial.

---

## [v0.6] — 19 jun 2026

### Pestaña Propuesta — mejoras visuales y funcionales
- KPI cards actualizadas con ID y fecha del recuento, origen y estado.
- Eliminados botones de guardar por fila; reemplazados por "Guardar borrador" y "Tramitar propuesta" globales.
- Filtro: sólo artículos activos (`activo = TRUE`) se incluyen en la propuesta.
- Tabla rediseñada: CN badge, Principio Activo en negrita, marca en gris/cursiva.
- Stock actual en rojo cuando `stockActual <= puntoPedido`.
- Columna Validado: flechas con color verde (aumento) / rojo (reducción).
- Botón "Deshacer tramitación" para revertir propuesta tramitada a borrador.
- Historial de propuestas con paginación (equivalente al historial de recuentos).
- Excel generado con columnas: Codigo SAP · Cantidades · Descripcion · Principio Activo (en ese orden).
- Principio Activo añadido a la tabla de propuesta y al Excel.

### Pestaña Stock
- Vista de recuentos con columnas: CN badge · Principio Activo bold · Medicamento/Marca (gris, cursiva) · Stock Cajas · Stock Unidades.

---

## [v0.5] — 18-19 jun 2026

### Catálogo — mejoras
- Columnas ordenables (click en cabecera).
- Dropdown `UbicacionSelect` para edición del campo ubicación.
- Botón "Nuevo medicamento" con modal de creación.
- Botón de papelera (eliminar) en cada fila.
- Layout ajustado para usar todo el ancho de la ventana.
- Importación con gestión de CNs duplicados: se omiten los conflictivos y se muestra panel persistente con la lista de omitidos.

---

## [v0.4] — 18 jun 2026

### Navbar rediseñada
- Subtítulo cambiado a "Servicio de Farmacia".
- Pestañas a ancho completo, sin recuadro contenedor.
- Badge de área y botón de logout desplazados cerca del logo.
- `useEffect` con dependencia `[pathname]` para actualizar el badge al cambiar de área.

---

## [v0.3] — 18 jun 2026

### Integración Neon + autenticación
- Base de datos migrada de SQLite local a PostgreSQL en Neon (`@neondatabase/serverless`).
- Tablas principales: `medicamentos`, `stock_objetivo`, `importaciones_stock`, `stock_registros`, `propuestas`, `propuestas_lineas`.
- Conexión de solo lectura a la base de datos externa `PedidosPendientes`.
- Sistema de autenticación por cookies (`auth_session`, `area_session`).
- Middleware `requireApiSession` para protección de API routes.

---

## [v0.2] — 18 jun 2026

### Configuración de infraestructura
- Repositorio GitHub: `git@github.com:reclamacionpedidoshmanacor-cpu/RealizarPedidosHMAN.git`.
- Proyecto Neon: `FarmaciaHMAN` (base de datos `realizarpedidoshman`).
- Despliegue en Vercel con variables de entorno configuradas.
- `.gitignore` actualizado: excluye `.env`, `.env.local`, `*.db`, `*.tsbuildinfo`, `.claude/`.

---

## [v0.1] — 18 jun 2026

### Proyecto inicial
- Next.js 15 + React 19 + TypeScript + Tailwind CSS v4.
- Estructura de pestañas: Inicio, Catálogo, Stock, Propuesta, Consumo, Inventario, Pedidos Pendientes.
- Layout con Navbar y autenticación por área.
