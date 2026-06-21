# CHANGELOG — Farmacia Oncológica: Gestión de Pedidos y Consumo
**Servicio de Farmacia Oncológica · Hospital de Manacor**
*© 2026 Lucía Rodríguez Cajaraville. Todos los derechos reservados.*

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/).

---

## [0.3.5] — 21 jun 2026 *(Análisis — YoY coherente, semanas, Pareto)*

### Corregido
- Tarjeta YoY alineada con gráfico anual (mismo periodo año en curso vs anterior, vía `anio`/`mes`).
- Gráfico semanal vacío: query dedicada últimas 6 semanas + corte por columnas `anio`/`mes`.
- Presets de fecha calculados al pulsar (no fechas congeladas al cargar la página).

### Añadido
- Ordenación de tarjetas de grupo: por gasto o por variación YoY.
- Pareto/ABC, coste paciente-ciclo, detección de outliers semanales.

---

## [0.3.4] — 21 jun 2026 *(Análisis — YoY no solapado y series mensual/semanal)*

### Corregido
- **YoY inflado por solapamiento**: con períodos de varios años la variación "vs año
  anterior" comparaba ventanas que se solapaban (ej. +78,6%). Ahora todos los YoY usan
  **últimos 12 meses vs 12 meses anteriores** (`getYoyRolling`), por grupo y por CN.
- **Histórico mensual fiable + reciente semanal real**: nueva constante `SEMANA_REAL_DESDE`
  (2026-06-01). Antes → mensual; después → semanal real. La evolución de cada medicamento
  pasa a ser mensual (fiable en todo el histórico).

### Backend
- `getYoyRolling(area)` y helpers `yoyDeGrupos`/`yoyMapByCn`.
- Se elimina la query de "mismo período año anterior" en `getAnalisisDatos`.
- `buildTopMeds` → `temporalMensual`; `computeGrupoDetalle` recibe YoY ya calculado.

---

## [0.3.3] — 21 jun 2026 *(Análisis — alcance Total, YoY mismo-período)*

### Corregido
- YoY del año en curso comparado contra el **mismo período** del año anterior
  (no contra el año completo), vía `getGastoAnualPorServicio`.
- Top 10 medicamentos: columna "Grupo" solo al desplegar (la fila condensada es un total).

### Añadido/Mejorado
- **Alcance "Total"** (Onco + Hemato) como nueva opción y por defecto.
- Etiquetas de gasto total sobre cada barra del gráfico anual (k€/M€).
- Gráfico de evolución de medicamento: barras atenuadas + línea evolutiva, año en el eje X.
- KPI "Gasto período" referido al alcance seleccionado, con % sobre total del área.
- `weekLabel` con año; exportación acepta parámetro `servicio`.

---

## [0.3.2] — 21 jun 2026 *(Análisis — coherencia de servicio y gráfico apilado)*

### Corregido
- Top 10 protocolos/medicamentos y evolución temporal ahora se filtran por servicio;
  en Hematología el top es 100% hematológico (sin oncología mezclada).
- "Otros hematológicos" → "Otros" para alinear la cuadrícula.

### Añadido/Mejorado
- **Gráfico anual apilado**: el total del área siempre visible; porción del servicio
  activo resaltada en color propio (teal / violeta).
- **KPI "Gasto período (total)"**: sub-etiqueta con importe y % del servicio activo.
- Botones de servicio coloreados y títulos de gráficos contextualizados.
- Fetch reactivo con cancelación de peticiones obsoletas.
- `getAnalisisDatos` acepta `servicioFiltro`; importa `Servicio` y `gruposParaServicio`.

---

## [0.3.1] — 21 jun 2026 *(Análisis farmaoeconómico — mejoras round 2)*

### Corregido
- **Bug split histórico/semanal**: la semana ISO 1/2026 (lunes = 29 dic 2025) aparecía
  en el gráfico semanal reciente en lugar de en el histórico mensual porque la lógica
  de corte usaba `anio*100+mes`. Ahora `getAnalisisRaw` recupera `MIN(cr.fecha)` por
  grupo (`fecha_min`) y `splitRows` lo usa para el corte, eliminando la ambigüedad
  de semanas ISO que cruzan año.
- Acordeones `DiagnosticoAccordion`: indicaciones empiezan cerradas; cada nivel
  (indicación → protocolo → medicamentos) requiere clic explícito.

### Añadido
- **Gráfico anual dinámico** (`GastoAnualChart`): se filtra por servicio activo
  (Oncología sólida / Hematología). Sin servicio, muestra el total global.
- **Indicador año en curso**: barra gris con nota en título y tooltip para que el YoY
  parcial no induzca a error.
- **Top 10 medicamentos con tabs**: pestaña "Por diagnóstico/indicación" con
  desglose de gasto+preparaciones y colores por grupo tumoral; pestaña "Evolución
  semanal" con gráfico de barras.
- **Tipo `DxBreakdown`** en `analisis-neon.ts`; campo `desgloseByDx: DxBreakdown[]`
  en `TopMed`, calculado en `buildTopMeds`.
- **Badges de período rápido**: 3 meses, 6 meses, Año actual, Año anterior, 2 años.
  El badge activo se resalta; el selector de fechas manual convive con ellos.

---

## [0.2.0] — Junio 2026 *(flujo Stock → Propuesta → Tramitada)*

### Añadido

#### Pestaña Pedidos y nueva pestaña Propuesta
- La vista anterior de `Propuesta` se mueve a nueva pestaña `Pedidos` (consulta de PedidosPendientes)
- Nueva pestaña `Propuesta` basada en catálogo + recuento pendiente
- Cálculo automático de cajas propuestas usando `stockActual <= puntoPedido` y reposición hasta `stockMaximo`
- Edición manual de cantidad propuesta con motivo obligatorio cuando hay ajuste
- Motivos soportados: Previsión aumento de consumo, Rotura proveedor, Caducidad < 6 meses, Exceso de stock, Sustitución y Otro (texto libre)

#### Gestión de recuentos en Stock
- API `GET/POST /api/stock/recuentos` para crear y listar recuentos por área
- API `PATCH /api/stock/recuentos/[id]` para editar líneas del recuento pendiente
- Soporte de importación Excel desde origen `SAP` y `Manual`
- Restricción de un único recuento `pendiente` por área para evitar errores operativos

#### Tramitación y exportación de propuesta
- API `GET /api/propuestas/actual` para crear o recuperar borrador ligado al recuento pendiente
- API `PATCH /api/propuestas/lineas/[id]` para guardar ajustes y motivos
- API `POST /api/propuestas/tramitar` para cerrar propuesta y marcar recuento como `generado`
- API `GET /api/propuestas/[id]/excel` para exportar Excel descargable con:
  - Código SAP (`14 + CN`)
  - Descripción de medicamento
  - Cantidad en unidades (`cajas * unidades_por_caja`)

### Cambiado

#### Modelo de datos reutilizando tablas existentes
- Se mantienen las tablas actuales (sin crear nuevas), ampliando campos para estados y trazabilidad:
  - `importaciones_stock`: `area`, `estado`, `generado_en`, `propuesta_id`
  - `propuestas`: `area`, `tramitada_en`, `excel_generado_en`
  - `propuestas_lineas`: snapshots de stock min/punto/max, `unidades_por_caja`, `motivo_ajuste`, `motivo_ajuste_otro`, `nombre_medicamento`

---

## [0.1.1] — Junio 2026 *(hardening de integridad y seguridad API)*

### Añadido

#### Seguridad y validación de sesión en backend
- Nuevo helper `src/lib/api-auth.ts` para exigir sesión válida en API (`auth_session` + `area_session`)
- Validación de área de sesión frente a catálogo permitido (`oncologia`, `upe`, `iv`, `nutricion`, `almacen`)
- Restricción de acceso por área de sesión en:
  - `GET /api/medicamentos`
  - `POST /api/medicamentos`
  - `PATCH /api/medicamentos/[cn]`
  - `DELETE /api/medicamentos/[cn]`
  - `POST /api/catalogo/importar`
- Respuestas de autorización explícitas:
  - `401` sesión inválida
  - `403` intento de operar sobre área distinta

#### Integridad de datos CN ↔ área
- Nuevo helper `src/lib/areas.ts` como fuente única de áreas válidas
- `POST /api/medicamentos` ahora:
  - bloquea alta de CN duplicado en la misma área (`409`)
  - bloquea CN existente en otra área con mensaje de conflicto (`409`)
- `PATCH /api/medicamentos/[cn]` ahora bloquea la reasignación de un CN a otra área (`409`)
- `POST /api/catalogo/importar` ahora:
  - valida que el área de importación coincida con la sesión activa
  - cancela la importación completa si detecta CN existentes en otra área (`409`)
  - devuelve detalle de conflictos detectados

### Cambiado

#### Login y normalización de área
- `POST /api/auth` valida el área recibida y solo persiste un valor permitido en `area_session` (fallback a `oncologia` si no es válida)

---

## [0.1.0] — Junio 2026 *(implantación inicial local)*

### Añadido

#### Infraestructura y proyecto
- Proyecto Next.js 16 (App Router) + TypeScript + Tailwind CSS v4
- Base de datos SQLite local (`farmacia.db`) con Drizzle ORM (`better-sqlite3`)
- Schema completo con 10 tablas: `medicamentos`, `stock_objetivo`, `precios_historial`, `importaciones_stock`, `stock_registros`, `propuestas`, `propuestas_lineas`, `importaciones_consumo`, `consumo_registros`, `alertas`
- Configuración `drizzle.config.ts` para SQLite local
- Configuración `next.config.ts` con `serverExternalPackages: ['better-sqlite3']`
- Archivo `.env.local` con variable `APP_PASSWORD`
- Proxy de autenticación (`src/proxy.ts`, convenio Next.js 16)
- Fichero `CLAUDE.md` con contexto completo del proyecto para asistentes IA
- Estructura `docs/` con PRD y CHANGELOG

#### Autenticación y selector de área
- Página de login (`/login`) con selector visual de 5 áreas: Oncología, Pac. Externos, Medicamentos IV, Nutrición, Almacén
- Tarjetas de área con iconos y colores diferenciados
- Autenticación por contraseña única compartida (`APP_PASSWORD`)
- Cookie `auth_session` (httpOnly, 12h) y cookie `area_session` (lectura cliente, 12h)
- API `POST /api/auth` (login) y `DELETE /api/auth` (logout)
- Navbar con indicador de área activa y botón de logout

#### Navegación y estructura
- Navbar fija con 7 pestañas: Inicio, Catálogo, Stock, Propuesta, Consumo, Análisis, Histórico
- Logo Hospital de Manacor en la navbar
- Color de marca teal (diferenciado del azul de Pedidos Pendientes)
- Toasts de notificación con `sonner`
- Redirección `/` → `/inicio`
- Páginas stub para todos los módulos

#### Catálogo de medicamentos
- Página `/catalogo` con tabla completa de medicamentos
- API `GET /api/medicamentos?area=X` — lista con join a stock_objetivo
- API `POST /api/medicamentos` — crear medicamento
- API `PATCH /api/medicamentos/[cn]` — editar campos y stock objetivo
- API `DELETE /api/medicamentos/[cn]` — eliminar (con cascade a stock_objetivo)
- API `POST /api/catalogo/importar` — importar Excel IV u ORAL
- Parser `src/lib/catalogo-parser.ts`:
  - Auto-detecta formato IV (`Title`) u ORAL (`CODIGO SAP`)
  - Extrae CN a partir de código SAP: `CN = SAP.slice(2)` (quita prefijo "14")
  - Detecta MSE automáticamente si `CN.startsWith("02")`
  - Mapea ubicaciones ORAL: `ARMARIO` → `Armario NEA`, `NEVERA` → `Nevera NEA`
  - Upsert de medicamentos y stock_objetivo en una sola operación
- Importación catálogo Oncología:
  - IV: 124 medicamentos (sin errores)
  - ORAL: 155 medicamentos (sin errores, 2 CNs presentes en ambos catálogos)
  - **Total: 277 medicamentos oncológicos en base de datos**
- Toggle activo/inactivo por fila (inline, sin recarga)
- Edición inline al hacer clic en el lápiz (campos: nombre, principio activo, ubicación, unidades/caja, stocks objetivo)
- Filtros: búsqueda libre, filtro por vía (IV/ORAL), filtro por estado (activo/inactivo)
- Badge MSE naranja en medicamentos con CN empezando por "02"
- Precio por caja visible (columna, actualizable desde imports SAP)

#### Integración CIMA / AEMPS
- `src/lib/cima.ts`: función `buscarMedicamentoPorCN(cn)` para lookup de nombre, principio activo, presentación
- `checkDesabastecimiento(cn)` para detección de problemas de suministro activos

#### Parsers de importación
- `src/lib/sap-parser.ts`: parser Excel SAP con columnas `Material`, `Stock de cierre`, `Valor final`
- `src/lib/consumo-parser.ts`: parser Excel consumo con columnas `Fecha`, `CN`, `Viales` (opcionales: `HC`, `Indicacion`, `Protocolo`)
- `src/lib/utils.ts`: `cnFromSapMaterial()`, `isMSE()`, `formatEuro()`, `formatNumber()`

---

## [Pendiente] — Próximas versiones

### v0.2.0 — Módulo Stock + Inventario
- Importar stock SAP (parser SAP ya implementado)
- Importar recuento manual (Excel)
- Vista estado actual vs. stock objetivo con semáforo
- **Pestaña Inventario**: cruce recuento manual vs. SAP, columna ajuste (Real − SAP), exportación Excel

### v0.3.0 — Módulo Propuesta de Pedido
- Generación automática de propuesta desde estado de stock
- Módulo de validación farmacéutica (borrador → validada → emitida)
- Exportación Excel de propuesta con unidades (cajas × unidades_por_caja)

### v0.4.0 — Módulo Consumo
- Importación Excel de consumo (paciente, protocolo, CN, viales)
- Visualización por medicamento, protocolo y período

### v0.5.0 — Módulo Análisis
- Tendencias de consumo
- Cruce compras (Pedidos Pendientes) vs. consumo
- Alertas de desabastecimiento
- Recomendaciones de recálculo de stock objetivo

### v1.0.0 — Producción (Vercel + Neon + GitHub)
- Migración SQLite → PostgreSQL (Neon)
- Despliegue en Vercel
- Recuento web desde tablet (`/recuento`)
- Cruce con datos de Pedidos Pendientes (misma BD Neon)
