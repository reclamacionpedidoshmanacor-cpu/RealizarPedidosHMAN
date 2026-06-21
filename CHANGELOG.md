# Changelog — RealizarPedidosHMAN

Historial de cambios del proyecto ordenado del más reciente al más antiguo.

---

## [Unreleased] — 21 jun 2026

### Pestaña Análisis — Mejoras visuales y usabilidad (round 2)

#### Correcciones
- **Fix split histórico/semanal**: el gráfico semanal reciente mostraba erróneamente
  datos de diciembre 2025 (semana ISO 1/2026 empieza el 29 dic) porque la lógica
  usaba `anio*100+mes` en vez de la fecha real. Ahora se usa `MIN(cr.fecha)` de
  cada fila agregada como `fecha_min`, eliminando la ambigüedad.
- **Títulos de gráficos**: actualizados para reflejar exactamente qué período muestran
  ("antes del período reciente" / "últimas semanas").
- **Acordeones por niveles**: al abrir un diagnóstico se ven las **indicaciones cerradas**;
  hay que hacer clic en cada indicación para ver sus protocolos, y en cada protocolo
  para ver los medicamentos. Ya no se despliega todo a la vez.

#### Nuevas funcionalidades
- **Gráfico anual dinámico por servicio**: al seleccionar "Oncología sólida" o
  "Hematología" el gráfico de barras anuales muestra solo el gasto de ese servicio
  (calculado desde las tarjetas de grupo). Sin selección de servicio muestra el total.
- **Indicador año en curso**: la barra del año actual aparece en gris con nota
  "(año en curso)" y aviso en tooltip de que el YoY no es comparable con año completo.
- **Top 10 medicamentos expandibles con dos pestañas**:
  - *Por diagnóstico / indicación*: tabla con diagnóstico, indicación, preparaciones
    y gasto, con color de grupo tumoral.
  - *Evolución semanal*: gráfico de barras del gasto semanal.
- **Badges de período rápido**: 3 meses, 6 meses, Año actual, Año anterior, 2 años
  con indicador visual del preset activo (el selector de fechas manual sigue disponible).
- **`DxBreakdown`**: nuevo tipo en `analisis-neon.ts`; el campo `desgloseByDx`
  de `TopMed` devuelve el desglose por diagnóstico+indicación ordenado por gasto.

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
- Consumo: se elimina selector de importaciones; el análisis pasa a ser acumulado por área sobre todo el histórico cargado.
- Consumo: desglose por medicamento ordenado alfabéticamente por diagnóstico > indicación > protocolo, mostrando solo viales (sin pacientes por línea).
- Consumo: evolución temporal enfocada en pacientes reportados, preparaciones y medicamentos distintos por mes.
- Consumo: mantiene visibilidad/filtrado por `tipo_componente` (incluido Fluido).
- Consumo: `num_pacientes` se interpreta como valor reportado por línea (no deduplicable entre líneas por protección de datos); por eso se mantiene en vista temporal agregada y se elimina del desglose clínico.
- Consumo: esta implementación se limita a **Oncología**; en otras áreas se muestra aviso de configuración pendiente.
- Consumo: filtrado estricto por CN del catálogo del área (`INNER JOIN medicamentos ... m.area = area`) para evitar medicamentos ajenos al catálogo activo.
- Consumo: en el listado principal se muestra **principio activo** (estilo principal) y marca comercial en línea secundaria.
- Consumo: se elimina la vista de evolución temporal de esta pestaña para Oncología.
- Consumo: importación temporal simplificada a **Año + Semana manuales** (eliminado el uso de año+mes+día para evitar confusiones).

### Pendiente para retomar (bloqueado por datos)
- Cargar histórico de consumo depurado con datos suficientes para detectar tendencias reales.
- Incorporar `DIA` (y semana en origen si aplica) en próximos ficheros para mejorar granularidad semanal.
- Revalidar en `Inicio` la curva consumo/pedidos con 2-3 CN de control una vez cargado el histórico final.
- Consumo (Oncología) — mejoras de visualización pendientes al cargar datos reales:
  - Mantener cada diagnóstico en su **caja/rectángulo** con columnas alineadas.
  - Orden por defecto:
    - `PPIO/Marca`: A→Z
    - `Diagnóstico`: mayor→menor (por viales)
  - Añadir controles para invertir orden (`PPIO/Marca` A↔Z y `Diagnóstico` mayor↔menor/A→Z).
  - Cabecera de diagnóstico con **colores suaves corporativos** por grupo tumoral.
  - Asignación de grupos por **diccionario de palabras clave** (editable):
    - mama, pulmón, digestivo, ginecológico, urológico, piel, cabeza y cuello, SNC, y `otros`.

---

## [v0.9] — 19 jun 2026

### APP Recuento Manual — mejoras de UX

- **Campo "Unidades sueltas" condicional**: cuando `unidadesPorCaja = 1` se oculta el apartado de unidades sueltas y el campo "Cajas" ocupa el ancho completo. Para artículos con múltiplo > 1 se mantiene la cuadrícula de dos columnas habitual.
- **Botón "← Volver a acceso"**: al pulsarlo envía `DELETE /api/auth` para limpiar la sesión por cookie antes de redirigir a `/login`, garantizando que el formulario de contraseña funciona correctamente al volver.
- **Inicialización de cantidades**: en recuentos manuales de origen SAP o sin recuento previo los campos arrancan en cero; si el recuento pendiente es de origen manual se mantienen las cantidades guardadas.

### Pedidos de Reposición (área Pacientes Externos) — funcionalidad completa

#### Nuevo circuito de reposición en APP Recuento Manual
- Botón **"Pedido a Farmacia"** visible únicamente en el área UPE.
- Flujo de 3 pasos: seleccionar ubicación → indicar cajas → guardar ubicación o finalizar pedido.
- Solo se muestran artículos **activos** en el listado de reposición.
- Visualización del **stock máximo** de referencia junto a cada medicamento.
- Alerta visual al superar el stock máximo: borde y texto del campo en **rojo**, mensaje "⚠ Supera stock máximo".
- Cantidad guardada: borde en **verde** y mensaje "✔ Cantidad añadida" cuando el valor es válido.
- Cantidades de borradores guardados se **precargan** al volver a entrar en una ubicación.

#### Pestaña Stock — sección "Pedidos de Reposición"
- Nueva sección visible solo para UPE con pedido borrador activo e historial de pedidos finalizados.
- Botón **"Editar pedido"** en el borrador activo: redirige a la APP de recuento directamente al flujo de reposición con el pedido cargado.
- Botones **"Descargar PDF"** y **"Enviar email"** para pedido borrador e historial.

#### PDF — albarán de reposición
- Generación con `pdf-lib` (compatible con Vercel serverless; sustituye a `pdfkit` que requería archivos de fuente en disco).
- Función `safe()` para filtrar caracteres fuera de WinAnsi (emojis, símbolos especiales).
- Cabecera: **"Servicio de Farmacia Hospitalaria - Hospital de Manacor - Pacientes Externos"**.
- Pie: **"Documento generado automáticamente - Pacientes Externos"**.
- Tabla con columnas: CN · Principio activo · Medicamento · Ubicación · Cajas pedidas.
- Filas con altura adecuada para evitar solapamiento con cabeceras.

#### Email — envío de albaranes
- Servicio `reposicion-email.ts` con `nodemailer`: adjunta el PDF generado dinámicamente.
- Tabla `app_settings` (Neon) para almacenar configuración SMTP y de email de forma persistente.
- API `GET /api/settings` y `PATCH /api/settings` para lectura/escritura de ajustes.
- API `POST /api/reposicion/[id]/email` que genera el PDF y lo envía.

#### Pestaña Config (antes "Histórico")
- Formulario editable con los siguientes campos:
  - **SMTP**: host, puerto, usuario, contraseña (toggle mostrar/ocultar), TLS.
  - **Email de reposición**: destinatarios (separados por coma), asunto y cuerpo del mensaje.
- Botón **"Guardar configuración"** con feedback de éxito/error.

### Pestaña Stock — eliminación de recuento pendiente
- Botón **"Eliminar recuento pendiente"** para poder cargar un nuevo archivo cuando ya hay uno sin tramitar.
- API `DELETE /api/stock/recuentos/[id]` que verifica el estado `pendiente` antes de borrar.

### Importación SAP — mejoras de robustez y avisos
- Parser tolerante a variaciones de nombre de columna (alias múltiples, match parcial, case-insensitive).
- `parseExcelNumber` admite formatos españoles (coma decimal, punto de miles).
- Función `cnFromSapMaterial` mejorada en `utils.ts` para extraer CN desde código SAP de 14 dígitos.
- Advertencias más detalladas: indican el tipo de problema y el medicamento afectado, y son copiables al portapapeles.
- Cuando el archivo incluye columna **"Valor final"** se actualiza automáticamente `precioUnidad` y `precioCaja` en el catálogo.

### Pestaña Propuesta — cantidad en tránsito
- Nueva columna **"En tránsito"** entre "Stock actual" y "Calculado".
- El cálculo de propuesta descuenta la cantidad en tránsito (pedidos pendientes no recibidos, columna `por_entregar_cantidad`, excluidos los anulados).
- `calcularCajasPropuestas` acepta `stockTransito` como parámetro.
- API `/api/propuestas/actual` obtiene y aplica el tránsito antes de calcular.

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
