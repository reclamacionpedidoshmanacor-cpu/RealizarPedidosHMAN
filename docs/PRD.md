# PRD — Farmacia Oncológica: Gestión de Pedidos y Consumo
**Servicio de Farmacia Oncológica · Hospital de Manacor**
**Versión del documento:** 0.1 · Junio 2026
*© 2026 Lucía Rodríguez Cajaraville. Todos los derechos reservados.*

---

## 1. Visión general

### 1.1 Propósito
Farmacia Oncológica — Gestión de Pedidos y Consumo es una herramienta web interna diseñada para el Servicio de Farmacia Oncológica del Hospital de Manacor. Su objetivo es centralizar y optimizar el proceso completo de gestión del stock de medicamentos oncológicos: desde el mantenimiento del catálogo y el seguimiento del inventario, hasta la generación de propuestas de pedido validadas farmacéuticamente y el análisis del consumo por protocolo y paciente.

### 1.2 Problema que resuelve
La Farmacia Oncológica gestiona un catálogo de fármacos de altísimo coste (citostáticos, anticuerpos monoclonales, terapias dirigidas) que requiere una gestión de stock precisa y trazable. Hasta la implantación de esta herramienta:

- No existía una visión centralizada del stock real frente al stock objetivo por medicamento
- Las propuestas de pedido se generaban manualmente, sin base en datos de consumo histórico
- El consumo por protocolo no estaba sistematizado, impidiendo proyecciones de gasto futuro
- Los ajustes de inventario entre SAP y el recuento físico se calculaban manualmente, sin trazabilidad
- No había mecanismo de alerta ante desabastecimientos o desviaciones significativas en el consumo

### 1.3 Alcance
La herramienta cubre:
1. Gestión del catálogo de medicamentos (alta, baja, importación desde Excel)
2. Seguimiento del stock (importación SAP y recuento manual)
3. Comparativa de inventario físico vs. SAP con cálculo de ajustes
4. Generación y validación farmacéutica de propuestas de pedido
5. Registro y análisis del consumo por protocolo, indicación y período
6. Análisis de tendencias, alertas y recomendaciones de ajuste de stock
7. Arquitectura multi-área (Oncología, UPE, Medicamentos IV, Nutrición, Almacén)

### 1.4 Relación con Pedidos Pendientes
Esta herramienta es **complementaria** a la aplicación de Pedidos Pendientes del mismo servicio. En la fase de producción (v1.0), ambas aplicaciones compartirán la misma base de datos PostgreSQL en Neon, permitiendo:
- Consultar el historial real de compras (pedidos recibidos) por CN directamente desde la tabla `orders` de Pedidos Pendientes
- Ver pedidos en tránsito (pendientes de recibir) que afectan al stock disponible proyectado
- Eliminar la necesidad de importar manualmente un histórico de compras

---

## 2. Usuarios y roles

| Rol | Perfil | Uso principal |
|-----|--------|---------------|
| **Farmacéutica responsable** | Responsable del área | Importar stock SAP, generar y validar propuestas de pedido, analizar tendencias |
| **Farmacéutico/a** | Personal farmacéutico | Consulta de catálogo, revisión de alertas, análisis de consumo |
| **Técnico de farmacia** | Personal técnico | Importar recuentos manuales, consulta de stock |
| **Personal de cada área** | Según área activa | Gestión del stock de su servicio (UPE, IV, Nutrición, Almacén) |

Un único acceso protegido por contraseña compartida. El área se selecciona en el login y filtra todos los datos mostrados.

---

## 3. Módulos del producto

### 3.1 Inicio (Dashboard)

**Propósito:** Vista de estado general en un solo vistazo.

**Contenido:**
- KPIs resumen: total medicamentos activos, medicamentos por debajo del stock mínimo, medicamentos en punto de pedido, alertas activas sin resolver, propuestas pendientes de validar
- Panel de alertas activas (desabastecimiento, stock crítico, variación de precio)
- Últimas importaciones de stock (fecha, origen, total líneas)
- Acceso rápido a generar propuesta si hay medicamentos bajo el punto de pedido

---

### 3.2 Catálogo

**Propósito:** Gestión completa del catálogo maestro de medicamentos del área.

**Funcionalidades:**
- **Tabla completa** con columnas: CN, Principio Activo, Nombre/Marca, Vía (badge IV/ORAL), Ubicación, Unidades/caja, Stock Mínimo, Punto de Pedido, Stock Máximo, Precio/caja, Activo (toggle)
- **Importar Excel**: soporta dos formatos predefinidos:
  - Formato IV: columna `Title` (SAP), `PPIO ACTIVO`, `MARCA`, `ACTIVO`, `UBIC`, `MultiploPedido`, `Stock Minimo`, `PuntoPedido`, `Stock Maximo`
  - Formato ORAL: columna `CODIGO SAP`, mismas columnas, `UBIC` mapea `ARMARIO`→`Armario NEA` / `NEVERA`→`Nevera NEA`
  - Upsert: si el CN ya existe actualiza datos; si es nuevo lo crea
- **Crear medicamento** manualmente: formulario con lookup CIMA por CN (auto-rellena nombre, principio activo, presentación)
- **Editar medicamento**: edición inline en tabla (todos los campos excepto CN)
- **Activar/desactivar**: toggle visible en tabla sin salir de la vista
- **Filtros**: búsqueda libre (CN, nombre, principio activo), filtro por vía, filtro por estado activo/inactivo, filtro por MSE
- **Badge MSE**: detección automática si `CN.startsWith("02")`. Subtipo (UC/Extranjero) editable manualmente

**Reglas de negocio:**
- `CN = SAP_code.slice(2)` (el código SAP es siempre "14" + CN)
- `mse = CN.startsWith("02")` — automático, no editable
- `unidades_por_caja` es obligatorio; SAP no lo proporciona, se introduce manualmente o viene del Excel de catálogo
- `precio_caja = precio_unidad × unidades_por_caja` — se actualiza en cada importación SAP si el precio varía; se guarda historial en `precios_historial`
- Solo medicamentos `activo=true` y `comprable=true` entran en las propuestas de pedido

---

### 3.3 Stock

**Propósito:** Importar y visualizar el estado actual del stock frente al objetivo.

**Funcionalidades:**
- **Importar stock SAP**: carga Excel exportado de SAP con columnas `Material`, `Stock de cierre`, `Valor final`
  - El parser extrae CN de Material (quita prefijo "14")
  - Calcula `cajas = Stock_cierre ÷ Unidades_por_caja` (puede ser decimal)
  - Calcula `precio_unidad = Valor_final ÷ Stock_cierre` y actualiza si varía (con historial)
  - Medicamentos no reconocidos en el catálogo → marcados como "sin vincular" para revisión
- **Importar recuento manual**: carga Excel con columnas `CN`, `Nombre`, `Cantidad_Cajas`
  - Se descarga plantilla desde la app
  - Cada carga crea un nuevo registro histórico (snapshot con fecha declarada del recuento)
- **Tabla estado actual**: para cada medicamento activo del área:
  - Stock actual en cajas (de la última importación)
  - Stock objetivo: mínimo / punto de pedido / máximo
  - Semáforo: 🔴 < mínimo | 🟠 ≤ punto de pedido | 🟢 > punto de pedido
  - Valor económico del stock (precio_caja × stock_cajas)
- **Selector de importación**: puede ver el stock de cualquier importación histórica (no solo la última)
- Cada importación queda trazada en `importaciones_stock` con fecha, origen y nombre del fichero

**Reglas de negocio:**
- Los recuentos no sobreescriben nunca el histórico. Cada importación es un snapshot nuevo.
- El stock "actual" que usa el módulo de Propuesta es siempre el de la importación más reciente para cada origen.
- Si hay una importación SAP y una manual del mismo día, se muestra la manual como prioritaria para la propuesta (más precisa).

---

### 3.4 Inventario *(Nuevo módulo)*

**Propósito:** Comparar el recuento físico real con el stock registrado en SAP, identificar discrepancias y generar el listado de ajustes a realizar en SAP.

**Funcionalidades:**

**Selección de fuentes:**
- Desplegable "Recuento Real": selecciona entre todos los recuentos manuales importados, mostrando fecha y total de líneas. Por defecto, el último.
- Desplegable "Stock SAP": selecciona entre todas las importaciones SAP. Por defecto, la más reciente.
- Botón "Comparar" genera la tabla.

**Tabla de comparativa:**

| Columna | Descripción |
|---------|-------------|
| CN | Código Nacional |
| Principio Activo | Nombre genérico |
| Nombre/Marca | Nombre comercial |
| Vía | IV / ORAL |
| Ubicación | Armario NEA, Nevera NEA, CIT... |
| Uds/caja | Unidades por caja |
| **Stock Real (cajas)** | Del recuento manual seleccionado. `—` si no está en ese recuento |
| **Stock SAP (cajas)** | De la importación SAP seleccionada. `—` si no está en ese export |
| **Ajuste (cajas)** | `Real − SAP`. Positivo: entrada en SAP. Negativo: salida en SAP |
| **Ajuste (unidades)** | `Ajuste_cajas × Unidades_por_caja` — magnitud real para SAP |

**Semáforo en columna Ajuste:**
- 🟢 Verde: ajuste = 0 (sin discrepancia)
- 🔵 Azul: ajuste > 0 (entrada / ajuste de inventario al alza en SAP)
- 🔴 Rojo: ajuste < 0 (salida / ajuste a la baja en SAP)
- ⚪ Gris: solo en SAP o solo en recuento (sin correspondencia)

**Filtros:**
- Mostrar solo discrepancias (ajuste ≠ 0)
- Filtrar por vía (IV/ORAL)
- Filtrar por ubicación

**Resumen estadístico:**
- Total medicamentos comparados
- Nº con discrepancia positiva / negativa / sin discrepancia
- Valor económico estimado del ajuste total (positivo y negativo)

**Exportación Excel:**
- Botón "Exportar a Excel" genera un archivo `.xlsx` con:
  - **Hoja 1 — Inventario completo**: toda la tabla con formato
  - **Hoja 2 — Solo ajustes**: filtrado a filas con ajuste ≠ 0, ordenado por |Ajuste| descendente
  - Encabezado con: fecha del recuento real, fecha del export SAP, área, fecha de generación
  - Columna Ajuste coloreada: rojo (negativo) / azul/verde (positivo)
  - Fila de totales al final
- Nombre del archivo: `Inventario_YYYYMMDD_[area].xlsx`

**Interpretación del ajuste para el usuario:**
> - **Positivo (+)**: hay más stock físico que en SAP → hacer **ajuste de inventario al alza en SAP**
> - **Negativo (−)**: hay menos stock físico que en SAP → registrar **salidas en SAP** (consumos no registrados, mermas, roturas...)
> - **Cero (0)**: sin discrepancia, SAP y físico coinciden

---

### 3.5 Propuesta de Pedido

**Propósito:** Generar, validar farmacéuticamente y emitir propuestas de pedido.

**Flujo de estados:**
```
borrador → validada → emitida
```
Solo las propuestas en estado `emitida` se consideran pedidos lanzados y quedan en el histórico permanente.

**Funcionalidades:**

**Generar propuesta (borrador):**
- La app usa el stock actual más reciente (SAP o manual, el más reciente disponible)
- Para cada medicamento `activo=true` y `comprable=true` del área:
  - Si `stock_actual ≤ punto_pedido` → incluir en propuesta
  - Cantidad propuesta = `stock_optimo_objetivo − stock_actual` (expresada en cajas, siempre entero positivo)
  - Ajuste por tendencia si hay datos de consumo: si el consumo medio de las últimas 4 semanas > consumo histórico, se incrementa proporcionalmente
- Se puede generar nueva propuesta aunque haya un borrador previo (el anterior pasa a "archivado")

**Validación farmacéutica:**
- Tabla editable con todas las líneas: farmacéutico puede:
  - Modificar la cantidad de cajas propuesta → columna `cajas_validadas` (diferente de `cajas_propuestas`)
  - Excluir una línea (checkbox "No pedir")
  - Añadir observaciones por línea
- Columna calculada en tiempo real: `unidades_final = cajas_validadas × unidades_por_caja`
- Columna `importe_estimado = cajas_validadas × precio_caja`
- Total estimado visible al pie de la tabla
- Botón "Validar propuesta" → estado pasa a `validada`

**Emisión:**
- Solo propuestas en estado `validada` pueden emitirse
- Botón "Emitir pedido y descargar Excel" → estado pasa a `emitida`
- Genera archivo Excel descargable:
  - Columnas: CN | Principio Activo | Nombre/Marca | Vía | Cajas | Unidades | Precio unitario | Importe estimado | Observaciones
  - Hoja de resumen: total medicamentos, total unidades, importe total estimado, fecha de emisión, área
- El Excel es el documento de trabajo para tramitar el pedido
- La propuesta emitida queda guardada permanentemente en `propuestas` + `propuestas_lineas`

**Reglas de negocio:**
- Stock mínimo → alerta urgente, punto de pedido → alerta normal
- El sistema nunca actualiza automáticamente los stocks objetivo; solo propone cambios
- Una propuesta emitida no es editable (histórico inmutable)
- Los precios en la propuesta son snapshot del momento de generación

---

### 3.6 Consumo

**Propósito:** Registrar y analizar el consumo de medicamentos oncológicos por paciente, protocolo e indicación.

**Formato del Excel de consumo** (definido y mantenido por la farmacéutica):

| Columna | Obligatoria | Descripción |
|---------|-------------|-------------|
| Fecha | ✅ | Fecha de administración (dd/mm/yyyy o yyyy-mm-dd) |
| CN | ✅ | Código Nacional del medicamento |
| Viales | ✅ | Número de viales/unidades consumidas |
| HC | — | Código de historia clínica (anonimizado) |
| Indicacion | — | Indicación clínica (ej: Ca mama HER2+) |
| Protocolo | — | Protocolo de tratamiento (ej: FOLFOX, AC-T, R-CHOP) |

**Funcionalidades:**
- Importar Excel de consumo con selector de período (fecha inicio / fin que se detectan automáticamente del fichero)
- Cada importación crea cabecera en `importaciones_consumo` + líneas en `consumo_registros`
- Vista por medicamento: gráfico de barras de viales consumidos por semana/mes
- Vista por protocolo: top protocolos por consumo de viales y valor económico
- Vista comparativa: consumo del período actual vs. período anterior
- Tabla detalle: filtrable por CN, protocolo, indicación, período

**Protección de datos:**
- `paciente_id` almacena solo el código HC (número, sin nombre ni datos identificativos)
- Los datos de consumo son agregables sin revelar información personal

---

### 3.7 Análisis

**Propósito:** Inteligencia sobre la gestión del stock y el consumo para apoyar la toma de decisiones.

**Bloques del módulo:**

**1. Tendencias de consumo**
- Consumo mensual de los últimos 12 meses por medicamento (gráfico de línea)
- Detección de cambios de patrón: alerta si el consumo del último mes supera la media + 1σ
- Proyección de consumo para las próximas 4 semanas basada en tendencia

**2. Cruce compras vs. consumo**
- Para cada medicamento: `Stock inicial + Compras entrantes − Consumo registrado = Stock teórico`
- `Stock teórico − Stock real (último recuento) = Merma/Discrepancia`
- Este dato es clave para detectar consumo no registrado o mermas de vial

**3. Alertas de desabastecimiento**
- Si el consumo proyectado supera el stock actual + punto de pedido sin que haya pedido en tránsito → alerta roja
- Integración con CIMA: si un medicamento con bajo stock tiene problema de suministro activo en CIMA → alerta crítica
- Las alertas se guardan en tabla `alertas` y aparecen en el Inicio

**4. Recomendaciones de stock objetivo**
- Si el consumo medio de las últimas 8 semanas es sustancialmente diferente del stock objetivo definido → el sistema genera una "Propuesta de recálculo de stock":
  - Nuevo stock mínimo recomendado = consumo_medio_semanal × 1.5
  - Nuevo punto de pedido recomendado = consumo_medio_semanal × 3
  - Nuevo stock máximo recomendado = consumo_medio_semanal × 5
- El farmacéutico revisa y acepta o rechaza cada recomendación (nunca se aplica automáticamente)

**5. Evolución de precios**
- Gráfico de evolución del precio por caja para medicamentos seleccionados (histórico de `precios_historial`)
- Detección de variaciones superiores al 10% entre importaciones SAP consecutivas

---

### 3.8 Histórico

**Propósito:** Archivo inmutable de todas las operaciones realizadas. Solo lectura.

**Contenido:**
- **Recuentos importados**: listado de todas las importaciones de stock (SAP y Manual) con fecha, origen, total líneas, fichero. Desplegable para ver el detalle de líneas de cada importación.
- **Propuestas de pedido emitidas**: listado de todas las propuestas con estado `emitida`, con fecha, total medicamentos, total unidades, importe estimado. Desplegable para ver las líneas. Botón para re-descargar el Excel original.
- **Importaciones de consumo**: listado de todos los Excel de consumo importados, con período, total líneas.
- **Cambios de precios**: registro de cada vez que el precio de un medicamento ha variado en un import SAP.

---

## 4. Módulo multi-área

La herramienta está diseñada para gestionar 5 áreas independientes de la farmacia hospitalaria, cada una con su propio catálogo, stock objetivo y propuestas:

| Área (id) | Descripción | Tipo principal de medicamentos |
|-----------|-------------|-------------------------------|
| `oncologia` | Farmacia Oncológica | IV (citostáticos, anticuerpos monoclonales) + ORAL (terapias dirigidas) |
| `upe` | Unidad de Pacientes Externos | Medicamentos de dispensación ambulatoria |
| `iv` | Medicamentos IV general | Antibióticos, fluidos, analgésicos IV |
| `nutricion` | Nutrición clínica | Nutriciones parenterales y enterales |
| `almacen` | Almacén general | Stock general del Servicio de Farmacia |

- El selector de área aparece en la pantalla de login
- La cookie `area_session` persiste el área durante 12 horas
- Todos los datos (medicamentos, stock, propuestas, consumo) están segmentados por `area`
- Un mismo medicamento (mismo CN) puede existir en múltiples áreas con stock objetivos diferentes

---

## 5. Reglas de negocio críticas

| Regla | Descripción |
|-------|-------------|
| CN desde SAP | `CN = SAP_material.slice(2)` (quita prefijo "14"). SAP usa formato `14XXXXXX` |
| MSE automático | Si `CN.startsWith("02")` → `mse=true`. El subtipo (UC/Extranjero) se especifica manualmente |
| Unidades por caja | Campo obligatorio. No lo proporciona SAP. Solo viene del Excel de catálogo o entrada manual |
| Stock en cajas | `cajas = Stock_cierre ÷ Unidades_por_caja`. Puede ser decimal (ej: 1.5 cajas) |
| Precio | `precio_unidad = Valor_final ÷ Stock_cierre`. Se actualiza en import SAP solo si varía; historial en `precios_historial` |
| Snapshots de stock | Cada importación es inmutable. Se acumulan como snapshots. Nunca se sobreescriben |
| Ajuste inventario | `Ajuste = Stock_Real − Stock_SAP`. Positivo = alta en SAP. Negativo = baja en SAP |
| Propuesta | Sistema propone; farmacéutico valida. Nunca se auto-aplican cambios |
| Stock objetivo | Solo el farmacéutico lo modifica, nunca el sistema automáticamente |
| Datos paciente | Solo se almacena código HC numérico. Sin nombre, sin datos identificativos |

---

## 6. Modelo de datos

### Tablas principales

```
medicamentos           — Catálogo maestro (CN como clave primaria)
stock_objetivo         — Stock min/punto_pedido/max por medicamento
precios_historial      — Histórico de precios desde imports SAP

importaciones_stock    — Cabecera de cada carga de stock (SAP o Manual)
stock_registros        — Líneas de cada carga (snapshots por medicamento)

propuestas             — Cabecera de propuestas de pedido
propuestas_lineas      — Líneas de cada propuesta (snapshot de valores)

importaciones_consumo  — Cabecera de cada importación de consumo
consumo_registros      — Líneas de consumo (por medicamento, fecha, protocolo)

alertas                — Alertas generadas por el sistema
```

### Campos clave de `medicamentos`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| cn | TEXT PK | Código Nacional AEMPS |
| nombre | TEXT | Nombre comercial (MARCA del catálogo) |
| principio_activo | TEXT | PPIO ACTIVO del catálogo |
| via | TEXT | 'IV' \| 'ORAL' \| 'OTRO' |
| area | TEXT | 'oncologia' \| 'upe' \| 'iv' \| 'nutricion' \| 'almacen' |
| ubicacion | TEXT | 'CIT' \| 'Armario NEA' \| 'Nevera NEA' \| ... |
| unidades_por_caja | INTEGER | MultiploPedido. Obligatorio |
| activo | BOOLEAN | Si aparece en el stock y propuestas |
| comprable | BOOLEAN | Si entra en propuestas de pedido |
| mse | BOOLEAN | Auto: CN empieza por "02" |
| tipo_mse | TEXT | 'UC' \| 'Extranjero' \| null |
| precio_unidad | REAL | Último conocido desde SAP |
| precio_caja | REAL | precio_unidad × unidades_por_caja |

---

## 7. Formatos de archivo aceptados

### Stock SAP (columnas mínimas requeridas)
| Columna SAP | Campo interno |
|-------------|---------------|
| Material | `codigo_sap` → CN (quitar prefijo "14") |
| Stock de cierre | `stock_unidades` |
| Valor final | `valor_total` → precio_unidad |

### Catálogo IV (primera columna: `Title`)
`Title` · `PPIO ACTIVO` · `MARCA` · `ACTIVO` · `UBIC` · `MultiploPedido` · `Stock Minimo` · `PuntoPedido` · `Stock Maximo`

### Catálogo ORAL (primera columna: `CODIGO SAP`)
`CODIGO SAP` · `PPIO ACTIVO` · `MARCA` · `ACTIVO` · `MultiploPedido` · `Stock Minimo` · `PuntoPedido` · `Stock Maximo` · `UBIC`

Mapeo UBIC en ORAL: `ARMARIO` → `Armario NEA` · `NEVERA` → `Nevera NEA`

### Recuento Manual
Plantilla descargable desde la app. Columnas: `CN` · `Nombre` · `Cantidad_Cajas` · `Observaciones`

### Consumo
Formato fijo mantenido por la farmacéutica. Columnas obligatorias: `Fecha` · `CN` · `Viales`. Opcionales: `HC` · `Indicacion` · `Protocolo`

---

## 8. Requisitos no funcionales

### 8.1 Acceso y autenticación
- Contraseña única compartida por área (`APP_PASSWORD`)
- Selector de área en login; la sesión persiste 12 horas
- Sin gestión de usuarios individuales (diseño intencionado para uso interno hospitalario)

### 8.2 Privacidad (LOPD / RGPD)
- Consumo de pacientes: solo se almacena código HC numérico (no nombre, no DNI, no diagnóstico completo)
- Sin datos de paciente = apto para hosting en nube pública (Vercel + Neon)
- Si en el futuro se añaden datos identificativos, consultar con el DPO del hospital antes de subir a nube

### 8.3 Entorno
- **Desarrollo local**: SQLite (`farmacia.db`) + `npm run dev` + `localhost:3000`
- **Producción**: PostgreSQL en Neon + Vercel (ver Sección 9)
- No se requiere infraestructura adicional

### 8.4 Rendimiento
- Carga del catálogo completo (300+ medicamentos) < 2 segundos
- Generación de propuesta de pedido < 5 segundos
- Exportación Excel inventario < 10 segundos

---

## 9. Despliegue en producción (Neon + Vercel + GitHub)

> Ver `CLAUDE.md` sección "Guía de despliegue en producción" para instrucciones paso a paso.

### 9.1 Resumen del stack de producción
| Servicio | Plan | Coste | Uso |
|----------|------|-------|-----|
| GitHub | Free | 0 € | Repositorio de código |
| Neon | Free Tier | 0 € | PostgreSQL serverless (500 MB) |
| Vercel | Hobby | 0 € | Hosting Next.js |

### 9.2 Cambios de código para producción
1. `better-sqlite3` → `@neondatabase/serverless` en `package.json`
2. `src/db/index.ts`: conexión Neon con `DATABASE_URL` de `.env`
3. `drizzle.config.ts`: `dialect: 'sqlite'` → `dialect: 'postgresql'`
4. `src/db/schema.ts`: `sqliteTable` → `pgTable`, tipos SQLite → tipos PostgreSQL
5. `npx drizzle-kit push` contra la BD de Neon

### 9.3 Integración con Pedidos Pendientes
En producción, ambas apps comparten la misma base de datos Neon. El módulo de Análisis consultará la tabla `orders` de Pedidos Pendientes (solo lectura) cruzando por el campo `n_mate_prov` (CN):
```sql
SELECT fecha_documento, cantidad_recibida, proveedor_nombre
FROM orders
WHERE n_mate_prov = $cn
  AND recibido = true
ORDER BY recibido_at DESC
```

---

## 10. Roadmap

| Versión | Módulo principal | Estado |
|---------|-----------------|--------|
| v0.1.0 | Catálogo + Login multi-área | ✅ Completo |
| v0.2.0 | Stock + Inventario (con export Excel ajustes) | 🔲 Pendiente |
| v0.3.0 | Propuesta de pedido (generar → validar → emitir) | 🔲 Pendiente |
| v0.4.0 | Consumo (importar + visualizar) | 🔲 Pendiente |
| v0.5.0 | Análisis (tendencias + alertas + recomendaciones) | 🔲 Pendiente |
| v0.6.0 | Histórico (archivo inmutable) | 🔲 Pendiente |
| v0.7.0 | Dashboard Inicio con KPIs reales | 🔲 Pendiente |
| v1.0.0 | Producción: Neon + Vercel + recuento web tablet | 🔲 Pendiente |
| v1.1.0 | Integración Pedidos Pendientes (compras cruzadas) | 🔲 Pendiente |

---

*© 2026 Lucía Rodríguez Cajaraville. Todos los derechos reservados.*
