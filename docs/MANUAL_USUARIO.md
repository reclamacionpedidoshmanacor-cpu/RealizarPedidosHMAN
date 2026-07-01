# Manual de usuario
## Realizar Pedidos HMAN — Gestión de Pedidos y Consumo

**Servicio de Farmacia · Hospital de Manacor**  
**Versión del documento:** 1.0 · Junio 2026  
**Elaborado por:** Lucía Rodríguez Cajaraville  
**URL de acceso (aplicación web):** https://realizar-pedidos-hman.vercel.app  
**URL recuento manual (tablet):** https://realizar-pedidos-hman.vercel.app/recuento-manual

© 2026 Lucía Rodríguez Cajaraville. Todos los derechos reservados.

---

## Índice

1. [A quién va dirigido este manual](#1-a-quién-va-dirigido-este-manual)
2. [Introducción](#2-introducción)
3. [Conceptos básicos](#3-conceptos-básicos)
4. [Acceso a la aplicación web](#4-acceso-a-la-aplicación-web)
5. [Navegación general](#5-navegación-general)
6. [Módulos de la aplicación web (referencia)](#6-módulos-de-la-aplicación-web-referencia)
7. [Guía por área](#7-guía-por-área)
   - [7.1 Oncología](#71-oncología)
   - [7.2 Pacientes Externos (UPE)](#72-pacientes-externos-upe)
   - [7.3 Medicamentos IV](#73-medicamentos-iv)
   - [7.4 Nutrición](#74-nutrición)
   - [7.5 Almacén](#75-almacén)
8. [Anexo A — App de recuento manual](#anexo-a--app-de-recuento-manual)
9. [Anexo B — Glosario](#anexo-b--glosario)
10. [Anexo C — Problemas frecuentes](#anexo-c--problemas-frecuentes)

---

## 1. A quién va dirigido este manual

| Parte del manual | Usuario habitual |
|------------------|------------------|
| **Aplicación web** (login con contraseña) | Farmacéuticos/as y personal con acceso completo |
| **Anexo A — Recuento manual** | Auxiliares de farmacia (tablet, sin contraseña) |
| **Recuento manual en Almacén** | Farmacéutica/o (no auxiliares) |
| **Pestaña Config** | Responsable del servicio / quien gestione emails de reposición UPE |

---

## 2. Introducción

**Realizar Pedidos HMAN** centraliza en una sola herramienta web:

- El **catálogo** de medicamentos por área
- El **stock** (recuentos físicos e importaciones SAP)
- Las **propuestas de pedido** validadas por farmacia
- El **seguimiento de pedidos** (integración con Pedidos Pendientes)
- El **consumo** y **análisis** (según área)
- El **inventario** (cruce recuento manual vs SAP)

Cada usuario trabaja siempre dentro de **un área** elegida al iniciar sesión. Los datos (catálogo, stock, propuestas…) están **separados por área**: Oncología, Pacientes Externos, Medicamentos IV, Nutrición y Almacén.

### Flujo general del ciclo de pedido (áreas clínicas)

Este es el recorrido habitual que la aplicación soporta:

1. Mantener el **catálogo** actualizado (Excel o edición manual).
2. Realizar el **recuento físico** por ubicación (app recuento manual → Anexo A).
3. Revisar el recuento en **Stock** (pestaña web).
4. Generar y validar la **Propuesta** de pedido.
5. **Tramitar** la propuesta y descargar el **Excel** para SAP.
6. Consultar **Pedidos** pendientes/recibidos.

Almacén tiene variaciones importantes (pedido en pasillo, proveedor local, consumo medio) — ver [sección 7.5](#75-almacén).

---

## 3. Conceptos básicos

### Código Nacional (CN)

Identificador de 6 dígitos del medicamento en España. Es la clave principal en catálogo y recuentos.

### Código SAP (Material)

SAP suele usar el formato **14 + CN** (14 dígitos en total). La aplicación convierte automáticamente entre ambos.

### Activo / Inactivo

- **Activo:** entra en propuestas de pedido y recuentos operativos.
- **Inactivo:** puede seguir en catálogo para consulta o recuento de stock residual; **no** se incluye en el pedido automático.

### Cajas y unidades

- **Unidades por caja** (uds/caja): multiplicador del envase. Debe estar bien definido en catálogo.
- **Stock en cajas:** lo que se cuenta en recuento manual.
- **Comprimidos / unidades:** cajas × uds/caja (se muestra en propuesta e informes).

### Ubicación

Lugar físico del medicamento (CIT, Armario NEA, Almacén general, etc.). En Oncología, UPE, IV y Nutrición el recuento y la propuesta se organizan **por ubicación**.

### Recuento pendiente

Snapshot de stock físico aún no cerrado. Mientras esté pendiente se puede editar. Al tramitar todas las propuestas asociadas, el recuento pasa a estado cerrado.

---

## 4. Acceso a la aplicación web


1. Abrir https://realizar-pedidos-hman.vercel.app
2. Elegir el **área** de trabajo (tarjetas: Oncología, Pac. Externos, Medicamentos IV, Nutrición, Almacén).
3. Introducir la **contraseña** compartida del servicio.
4. Pulsar **Entrar**.

El área seleccionada aparece en la barra superior (badge verde). Todos los datos mostrados corresponden solo a esa área.

### Cerrar sesión

Icono de salida en la barra superior, junto al nombre del área.

### Acceso rápido sin contraseña

Desde el login, enlace **«Acceso rápido sin contraseña para recuento manual»** → lleva a `/recuento-manual` (ver Anexo A).

---

## 5. Navegación general

Barra superior fija con las pestañas:

| Pestaña | Ruta | Función resumida |
|---------|------|------------------|
| **Inicio** | `/inicio` | Resumen operativo, alertas, movimientos de consumo |
| **Catálogo** | `/catalogo` | Maestro de medicamentos del área |
| **Stock** | `/stock` | Recuentos importados, edición, historial |
| **Propuesta** | `/propuesta` | Borrador, validación y tramitación del pedido |
| **Pedidos** | `/pedidos` | Estado de pedidos SAP (Pedidos Pendientes) |
| **Inventario** | `/inventario` | Cruce recuento manual vs corte SAP |
| **Consumo** | `/consumo` | Análisis de medicamentos preparados/administrados |
| **Análisis** | `/analisis` | Paneles analíticos avanzados |
| **Config** | `/historico` | Configuración de email (reposición UPE) |


### Disponibilidad por área (resumen)

| Módulo | Onco | UPE | IV | Nutrición | Almacén |
|--------|:----:|:---:|:--:|:---------:|:-------:|
| Inicio | ✓ | ✓ | ✓ | ✓ | ✓ |
| Catálogo | ✓ | ✓ | ✓ | ✓ | ✓* |
| Stock | ✓ | ✓ | ✓ | ✓ | ✓ |
| Propuesta | ✓ | ✓ | ✓ | ✓ | ✓* |
| Pedidos | ✓ | ✓ | ✓ | ✓ | ✓ |
| Inventario | ✓ | ✓ | ✓ | ✓ | ✓ |
| Consumo | ✓ | — | — | — | — |
| Análisis | ✓ | ✓ | — | — | — |
| Config (email) | ✓ | ✓ | ✓ | ✓ | ✓ |

\* Almacén tiene funciones exclusivas en Catálogo y Propuesta (consumo medio, proveedor local, etc.).

---

## 6. Módulos de la aplicación web (referencia)

### 6.1 Inicio


**Propósito:** Vista rápida del estado del área.

**Elementos habituales:**

- **KPIs:** recuentos pendientes, propuestas en borrador, artículos bajo mínimo o punto de pedido.
- **Alertas de compra:** medicamentos que requieren atención (stock bajo respecto a objetivos y consumo).
- **Movimientos de consumo:** principios activos cuyo consumo sube o baja (en Oncología las cantidades se expresan preferentemente en **cajas**).
- Gráficas de evolución semanal (donde aplique).

**Acciones:** principalmente consulta; los enlaces llevan a Stock o Propuesta según el contexto.

---

### 6.2 Catálogo


**Propósito:** Mantener el maestro de medicamentos del área.

#### Barra de herramientas

| Botón | Función |
|-------|---------|
| **Copiar códigos SAP** | Copia al portapapeles los códigos SAP (14+CN) de los artículos **filtrados** (ubicación, activo, búsqueda). Por defecto incluye activos e inactivos. |
| **Enriquecer desde CIMA** | Consulta AEMPS por CN. Solo actualiza flags de consulta CIMA (`ppio_activo_cima`, `cima_consultado`). **No modifica uds/caja** ni otros datos del catálogo. |
| **Nuevo medicamento** | Formulario de alta manual. Al salir del campo CN puede consultar CIMA para rellenar nombre y principio activo. |
| **Importar Excel** | Carga masiva/actualización desde plantilla del área. |
| **Importar consumo medio** | *(Solo Almacén)* Excel SAP con columnas Material y Consumo TOTAL. |

#### Filtros

- **Búsqueda:** CN, nombre o principio activo.
- **Ubicación:** todas o una concreta.
- **Estado:** Todos / Activos / Inactivos.

#### Columnas de la tabla (según área)

Comunes: principio activo, marca, CN, ubicación, uds/caja, activo (toggle), acciones.

**Oncología, UPE, IV:** stock mínimo, punto de pedido, stock máximo, precio/caja (si existe).

**Nutrición:** stocks en cajas (admite decimales, p. ej. 2,5).

**Almacén:** consumo medio, stocks opcionales (orientativos), sustitución de CN, revisión de sustituciones desde pasillo.

#### Edición inline

- Clic en **Editar** en una fila → modificar campos → **Guardar**.
- Toggle **Activo** cambia el estado sin entrar en edición.
- **Eliminar** borra el medicamento (acción irreversible).

#### Importar Excel — formatos

| Área | Formato |
|------|---------|
| IV | Columnas tipo SAP IV (`Title`, `PPIO ACTIVO`, `MARCA`, `UBIC`, `MultiploPedido`, stocks…) |
| ORAL (Onco/UPE según catálogo) | `CODIGO SAP`, mismas columnas; `ARMARIO`→Armario NEA, `NEVERA`→Nevera NEA |
| Nutrición | Código SAP, Producto, Vía, Uds/caja, stocks en cajas o unidades |
| Almacén | Código SAP, denominación, ubicación, principio activo, activo, uds/caja (opcional en columna), flags CIMA opcionales |

**Importante (Almacén):** si reimportas catálogo, las columnas presentes en el Excel **sí pueden actualizar** uds/caja. El botón «Enriquecer desde CIMA» no.

#### Importar consumo medio (solo Almacén)

1. Pulsar **Importar consumo medio**.
2. Seleccionar Excel SAP con **Material** y **Consumo TOTAL** (unidades).
3. Indicar **número de meses** del análisis (ej. 6).
4. Confirmar.

**Cálculo:** `consumo_medio = Consumo TOTAL ÷ meses` (unidades/mes).  
Solo actualiza la columna **consumo medio**; no toca uds/caja ni otros campos.  
Los códigos del Excel que no estén en catálogo Almacén se omiten (informe al finalizar).

---

### 6.3 Stock


**Propósito:** Ver y editar el recuento pendiente; consultar historial.

#### Panel principal

- **Recuento pendiente:** cabecera con ID, fecha, número de líneas.
- **Tabla de líneas:** CN, medicamento, stock en cajas y unidades, valor (si aplica).
- Edición de cajas en línea → **Guardar recuento** (todas las líneas modificadas).

#### Acciones

| Acción | Descripción |
|--------|-------------|
| **Guardar recuento** | Persiste cambios en el recuento pendiente. |
| **Actualizar desde catálogo** | Relee nombre, uds/caja y datos del catálogo; regenera propuesta borrador vinculada si existe. |
| **Eliminar recuento pendiente** | Borra recuento y propuesta borrador asociada. |
| **Ir a recuento manual** | Enlace a la app tablet (UPE reposición tiene enlace específico). |

#### Historial de recuentos

Lista de recuentos cerrados (tramitados). Permite consultar detalle en solo lectura.

#### Reposición UPE

Bloque adicional en UPE para pedidos de reposición a farmacia (ver [7.2](#72-pacientes-externos-upe)).

---

### 6.4 Propuesta


**Propósito:** Revisar cantidades calculadas, ajustar con motivo y tramitar el pedido.

#### Estados

- **Borrador:** editable. Puede guardarse sin tramitar.
- **Tramitada:** solo lectura. Permite descargar Excel.

#### Columnas (varían por área)

**Layout compacto** (Oncología, UPE, IV, Nutrición): punto de pedido, stock actual (cajas), stock máximo, tránsito, calculado, validado (cajas y comprimidos), motivo de ajuste.

**Layout Almacén:** stock objetivo (mín/máx), stock actual en uds y cajas, tránsito, calculado, validado, motivo, **Prov. local**.

#### Reglas de validación

- Si cambias las **cajas validadas** respecto al cálculo automático, debes indicar **motivo de ajuste**.
- Si el motivo es «Otro», texto libre obligatorio.

#### Acciones (borrador)

| Botón | Función |
|-------|---------|
| **Guardar borrador** | Guarda cantidades, motivos y (Almacén) marca proveedor local. |
| **Actualizar desde catálogo** | *(Almacén)* Relee uds/caja del catálogo y recalcula comprimidos sin cambiar cajas. |
| **Tramitar propuesta** | Cierra la propuesta; genera Excel descargable. |

#### Propuesta por ubicación (Onco, UPE, IV, Nutrición)

Varias ubicaciones → varios **bloques** de propuesta (una por ubicación). Debes tramitar cada bloque cuando esté listo. El recuento se cierra cuando **todos** los bloques están tramitados.

#### Propuesta Almacén

- Una propuesta por **ubicación** de almacén.
- **ALMACEN FAR** se subdivide en **grupos de letras:** A · B-C · D-H · I-N · O-S · T-Z.
- Columna **Prov. local:** marca artículos que se compran fuera de SAP.
- Excel tramitado: bloque SAP arriba; bloque **«Comprar a proveedor local»** abajo (solo esos artículos, excluidos del bloque SAP).

#### Historial

Propuestas tramitadas anteriores: consulta, descarga Excel, deshacer a borrador (si procede), eliminar del historial.

#### Artículos inactivos en propuesta

Los inactivos del recuento aparecen en la tabla en **solo lectura** (estilo tenue, etiqueta «Inactivo»). No entran en el pedido.

---

### 6.5 Pedidos


**Propósito:** Consultar pedidos SAP del área (datos de **Pedidos Pendientes**).

- Filtros: pendientes, recibidos, anulados, todos.
- Búsqueda por CN, nombre o documento.
- Opción «solo reclamados».
- Detalle expandible por medicamento: documento, proveedor, cantidades, fechas.

*Nota:* La gestión de reclamaciones se realiza en la aplicación Pedidos Pendientes; aquí es consulta.

---

### 6.6 Inventario


**Propósito:** Comparar stock del **recuento manual** seleccionado con un **corte SAP**.

1. Elegir recuento manual (lista desplegable).
2. Importar archivo SAP de stock.
3. Revisar tabla: stock real, stock SAP, **ajuste** (Real − SAP) en unidades e importe.
4. **Guardar** el inventario calculado.
5. **Exportar Excel** del resultado.

---

### 6.7 Consumo


**Disponible solo en Oncología.**

**Propósito:** Analizar medicamentos preparados en farmacia y administrados (datos importados desde informes de consumo).

- Importación de Excel (formatos IV u oral según configuración).
- Resumen por medicamento con desglose por diagnóstico / indicación / protocolo.
- Filtros temporales y por tipo de componente.
- Evolución de pacientes, preparaciones y medicamentos por mes.

---

### 6.8 Análisis


| Área | Contenido |
|------|-----------|
| **Oncología** | Panel analítico de compras y consumo oncológico |
| **UPE** | Panel analítico con gráficas de compras |
| **IV, Nutrición, Almacén** | Mensaje «Análisis no disponible» |

---

### 6.9 Config


**Propósito:** Configurar el servidor SMTP y plantillas de email para **reposición UPE** (pedidos desde unidad a farmacia).

Campos: host, puerto, usuario, contraseña, remitente, destinatarios, asunto y cuerpo del mensaje (con variables `{pedido_id}`, `{fecha}`, `{lineas}`).

Uso restringido al responsable que gestione estos envíos.

---

## 7. Guía por área

### 7.1 Oncología

**Perfil:** Farmacia oncológica — citostáticos, anticuerpos, terapias orales e IV del servicio.

#### Catálogo

- Formatos de importación **IV** y **ORAL** según vía del medicamento.
- Ubicaciones típicas: CIT, Armario NEA, Nevera NEA, etc.
- Badge **MSE** automático si CN empieza por `02`.
- Consulta CIMA al crear medicamentos nuevos.

#### Stock y recuento

- Recuento **por ubicación** vía app manual → [Anexo A](#anexo-a--app-de-recuento-manual).
- Un solo recuento pendiente por área; líneas por ubicación contada.
- Artículos **inactivos** visibles en recuento (junto al activo del mismo principio, orden alfabético).

#### Propuesta

- Layout **compacto** (punto de pedido, stock mínimo como referencia visual).
- Una propuesta borrador **por ubicación**; tramitar cada una.
- Excel tramitado: código SAP, unidades, descripción, principio activo.

#### Módulos destacados

- **Inicio:** alertas y movimientos de consumo en **cajas**.
- **Consumo:** importación y análisis de preparaciones (exclusivo Oncología).
- **Análisis:** panel oncológico completo.
- **Inventario:** cierre mensual/trimestral vs SAP.

#### Flujo recomendado (genérico)

1. Actualizar catálogo si hay altas/bajas.
2. Recuento manual por ubicación (auxiliares + supervisión farmacéutica).
3. Revisar Stock → Propuesta por ubicación.
4. Tramitar y descargar Excel para SAP.
5. Importar consumo oncológico periódicamente (pestaña Consumo).
6. Revisar Inicio y Análisis para ajustar stocks objetivo.

---

### 7.2 Pacientes Externos (UPE)

**Perfil:** Medicación de pacientes externos en consultas y tratamientos ambulatorios.

#### Similitudes con Oncología

- Catálogo con stocks mínimo / punto de pedido / máximo obligatorios.
- Recuento por ubicación → [Anexo A](#anexo-a--app-de-recuento-manual).
- Propuesta por ubicación, layout compacto.

#### Específico UPE

**Reposición a farmacia** (desde Stock o recuento manual):

- Modo **reposición** en app manual (`/recuento-manual?area=upe&modo=reposicion`).
- El personal de UPE solicita medicación a farmacia por ubicación.
- Farmacia recibe email configurable (pestaña **Config**).
- Seguimiento del borrador de reposición en Stock.

#### Análisis

- Panel **Análisis UPE** con gráficas de evolución de compras.

#### Flujo recomendado (genérico)

1. Catálogo al día.
2. Recuento periódico por ubicación (auxiliares).
3. Propuesta y tramitación por ubicación.
4. Reposiciones puntuales vía modo reposición cuando la unidad necesite material antes del ciclo habitual.

---

### 7.3 Medicamentos IV

**Perfil:** Medicación intravenosa general del hospital (fuera del circuito oncológico estricto).

#### Catálogo

- Importación formato **IV** (columna `Title` = SAP).
- Stocks objetivo en cajas enteras.

#### Stock y propuesta

- Igual que UPE/Onco: recuento por ubicación, propuesta compacta por ubicación.
- Sin módulo Consumo ni Análisis específico.

#### Flujo recomendado (genérico)

1. Importar/actualizar catálogo IV.
2. Recuento manual por ubicación.
3. Validar propuesta y tramitar.
4. Inventario periódico vs SAP.

---

### 7.4 Nutrición

**Perfil:** Nutriciones enterales, suplementos y dietética.

#### Particularidades

- Stocks y cajas admiten **un decimal** (ej. 2,5 cajas).
- Importación catálogo: columnas SAP, Producto, Vía, Uds/caja, stocks en cajas o unidades.
- Visualización de stock en cajas con 1 decimal en toda la app.

#### Stock y propuesta

- Recuento manual por ubicación (ubicación por defecto «Nutrición» en importaciones).
- Propuesta compacta; cantidades validadas respetan decimales.

#### Flujo recomendado (genérico)

1. Catálogo con uds/caja correctas (crítico para unidades).
2. Recuento con decimales cuando haya medias cajas.
3. Propuesta y tramitación.
4. Sin Consumo ni Análisis en esta versión.

---

### 7.5 Almacén

**Perfil:** Almacén general de farmacia — mayor volumen de referencias, pedido en pasillo, consumo medio.

#### Ubicaciones fijas

Orden de recorrido habitual:

1. Almacen general  
2. Fuera de Guía  
3. Pomadas/Cremas  
4. Nutricion  
5. Sueros  
6. Nevera  
7. **ALMACEN FAR** (subdividido por **letras:** A · B-C · D-H · I-N · O-S · T-Z)

#### Catálogo — funciones exclusivas

| Función | Descripción |
|---------|-------------|
| **Consumo medio** | Columna editable; importación masiva desde SAP (Material + Consumo TOTAL). |
| **Stocks opcionales** | Mín / punto / máx orientativos en pasillo (no bloquean propuesta). |
| **Sustituir CN** | Cambio de código nacional con consulta CIMA y datos editables antes de confirmar. |
| **Pendiente de revisar** | Sustituciones hechas en pasillo pendientes de validar en catálogo. |
| **Copiar códigos SAP** | Respeta filtros (ubicación, activo/inactivo). |
| **Enriquecer CIMA** | Solo flags; **no toca uds/caja**. |

#### Dos herramientas de trabajo en pasillo

1. **Pedido almacén** (app recuento manual, modo pedido) — farmacéutica/o registra **cajas a pedir** mientras recorre el pasillo. Ver [Anexo A.5](#a5-almacén--pedido-en-pasillo-solo-farmacéutica).
2. **Recuento de stock** — en la app web Stock o recuento manual según procedimiento del servicio.

#### Propuesta Almacén

- Un borrador por ubicación (y por grupo de letras en ALMACEN FAR).
- **Prov. local:** checkbox por línea; persiste en borrador; en Excel va solo al bloque inferior.
- **Actualizar desde catálogo:** tras corregir uds/caja en catálogo, recalcula comprimidos sin cambiar cajas pedidas.
- Tramitar cada bloque independientemente.

#### Pedidos y alertas

- Integración con pedidos recibidos/pendientes (14 días) visible en pasillo.
- Alertas CIMA suministro y otras alertas en tarjetas del pedido almacén.

#### Flujo recomendado (genérico)

1. Importar/actualizar catálogo; revisar uds/caja manualmente.
2. Importar **consumo medio** desde SAP (periodo en meses acordado).
3. Pedido en pasillo (app) → generar/revisar propuesta por ubicación.
4. Marcar **proveedor local** si aplica.
5. Tramitar y descargar Excel (bloques SAP + local).
6. Revisar sustituciones CN pendientes en catálogo.

---

## Anexo A — App de recuento manual

**URL:** https://realizar-pedidos-hman.vercel.app/recuento-manual  
**Acceso:** sin contraseña (también desde enlace en login).  
**Dispositivo recomendado:** tablet en pasillo / sala.


### A.1 Selección de área

Pantalla inicial con tarjetas de color por área. Elegir el área correcta antes de continuar.

### A.2 Selección de ubicación

Lista de ubicaciones con medicamentos en catálogo. Elegir la que se va a contar o pedir.

### A.3 Recuento de stock (Oncología, UPE, IV, Nutrición)

**Dirigido a:** auxiliares de farmacia (supervisión farmacéutica).


#### Pantalla de recuento

- Tarjetas grandes por medicamento (principio activo, marca, CN).
- Campos **Cajas** y, si uds/caja > 1, **Unidades sueltas**.
- Contador de activos e inactivos.
- Botón **➕ faltantes** incorpora activos del catálogo de esa ubicación que aún no están en el recuento (stock 0).

#### Inactivos

- Se muestran **en orden alfabético** junto al activo del mismo principio (no al final de la lista).
- Estilo tenue; etiqueta «Inactivo — solo recuento de stock».
- Permiten registrar stock residual; no entran en propuesta de pedido.

#### Guardar

- Barra inferior: **Guardar recuento** (solo si hay cambios).
- Los datos pasan al recuento **pendiente** visible en la app web (Stock).

### A.4 Reposición UPE

**Modo:** `reposicion` (acceso desde Stock UPE o URL con parámetro).

- Selección de ubicación UPE.
- Indicar **cajas** a solicitar a farmacia.
- Guardar genera/actualiza borrador de reposición y puede disparar email (Config).

### A.5 Almacén — Pedido en pasillo (solo farmacéutica)

**No usar auxiliares** para este modo en Almacén.


#### Flujo

1. Área **Almacén** → ubicación → (si ALMACEN FAR) **letra/grupo**.
2. Tarjetas con: stock orientativo, consumo medio, pedidos recibidos/pendientes, alertas.
3. Campo **Cajas pedidas** por medicamento.
4. Acciones por artículo: **editar catálogo**, **sustituir CN** (consulta CIMA), **marcar inactivo**.
5. **Guardar pedido** → alimenta la propuesta borrador del área/ubicación.

#### ALMACEN FAR y letras

Al elegir ubicación ALMACEN FAR, paso intermedio de **grupo de letras** (A, B-C, …) para no cargar toda la estantería a la vez.

### A.6 Volver al acceso principal

Enlace en la parte superior para volver a la pantalla de áreas o al login web.

---

## Anexo B — Glosario

| Término | Significado |
|---------|-------------|
| **CN** | Código Nacional (6 dígitos) |
| **SAP / Material** | Código 14+CN en el ERP |
| **Uds/caja** | Unidades por caja (multiplicador) |
| **Stock objetivo** | Mínimo, punto de pedido y máximo de referencia |
| **Recuento pendiente** | Snapshot de stock físico abierto |
| **Propuesta borrador** | Pedido calculado aún no tramitado |
| **Tramitar** | Cerrar propuesta y generar Excel |
| **Tránsito** | Unidades en pedidos pendientes de recibir |
| **MSE** | Medicamento de especialidad (CN 02…) |
| **CIMA** | Base de datos AEMPS de medicamentos |
| **Prov. local** | Compra fuera del circuito SAP (solo Almacén) |
| **Consumo medio** | Unidades/mes de referencia (Almacén) |

---

## Anexo C — Problemas frecuentes

### No puedo entrar / contraseña incorrecta

Verificar área seleccionada y contraseña actual del servicio. Cerrar sesión y volver a entrar.

### El medicamento no aparece en recuento manual

- ¿Está **activo**? (los inactivos sí aparecen si tienen ubicación).
- ¿Tiene **ubicación** asignada en catálogo?
- ¿Es la **ubicación** correcta la seleccionada?
- Usar **➕ faltantes** para activos no incorporados al recuento.

### La propuesta está vacía

- Debe existir un **recuento pendiente** con líneas.
- En modo por ubicación, abrir el **bloque** de la ubicación correspondiente.
- Solo entran medicamentos **activos** con stock bajo objetivo (según reglas de cálculo).

### Excel de propuesta no descarga

Solo propuestas **tramitadas** generan Excel. Tramitar primero desde Propuesta.

### «Enriquecer CIMA» cambió mis uds/caja

No debería. Ese botón solo actualiza flags CIMA. Si cambiaron, revisar si hubo **importación de catálogo** Excel posterior.

### Importar consumo medio no actualiza un artículo

El Material del Excel debe corresponder a un CN existente en catálogo **Almacén**. Códigos omitidos aparecen en el informe post-importación.

### Consumo (pestaña) no carga en mi área

Normal fuera de **Oncología**; el módulo no está habilitado para otras áreas en esta versión.

---

## Control de versiones del documento

| Versión | Fecha | Cambios |
|---------|-------|---------|
| 1.0 | Junio 2026 | Versión inicial. Referencia completa por área + anexo recuento manual. |

---

*Documento elaborado por Lucía Rodríguez Cajaraville para el Servicio de Farmacia del Hospital de Manacor.*

© 2026 Lucía Rodríguez Cajaraville. Todos los derechos reservados.
