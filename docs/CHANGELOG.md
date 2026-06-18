# CHANGELOG — Farmacia Oncológica: Gestión de Pedidos y Consumo
**Servicio de Farmacia Oncológica · Hospital de Manacor**
*© 2026 Lucía Rodríguez Cajaraville. Todos los derechos reservados.*

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/).

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
