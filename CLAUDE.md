# CLAUDE.md — Farmacia Oncológica: Gestión de Pedidos y Consumo
**Servicio de Farmacia Oncológica · Hospital de Manacor**
*Lee este archivo COMPLETO antes de hacer cualquier cambio.*

---

## ¿Qué es esta aplicación?

Herramienta web interna para el Servicio de Farmacia Oncológica del Hospital de Manacor. Optimiza la gestión de stock de medicamentos oncológicos de alto coste (citostáticos, anticuerpos monoclonales, terapias dirigidas).

**Funciones principales:**
1. Catálogo de medicamentos (importable desde Excel SAP, con datos de CIMA/AEMPS)
2. Seguimiento de stock (importación SAP + recuento manual)
3. Comparativa de inventario real vs. SAP con cálculo de ajustes (módulo Inventario)
4. Propuestas de pedido con validación farmacéutica y emisión en Excel
5. Registro y análisis de consumo por protocolo y período
6. Análisis de tendencias, alertas de desabastecimiento, recomendaciones de stock

**Es complementaria a `pedidos-pendientes-hmanacor`** (misma BD Neon en producción).

---

## Stack tecnológico

| Capa | Dev local | Producción |
|------|-----------|------------|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript | Igual |
| Estilos | Tailwind CSS v4 | Igual |
| ORM | Drizzle ORM | Igual |
| Base de datos | SQLite (`farmacia.db`, `better-sqlite3`) | PostgreSQL en Neon (`@neondatabase/serverless`) |
| Hosting | `localhost:3000` | Vercel |
| Excel | `xlsx` (lectura) + `exceljs` (generación) | Igual |
| Charts | Recharts | Igual |
| Notificaciones | Sonner | Igual |

---

## Comandos

```bash
npm run dev       # servidor de desarrollo en localhost:3000
npm run build     # build de producción
npm run start     # servir el build
npm run lint      # eslint
npm run db:push   # aplicar cambios de schema a la BD (SQLite local o Neon)
npm run db:studio # Drizzle Studio — interfaz visual de la BD
```

---

## Estructura de archivos

```
src/
├── app/
│   ├── layout.tsx               — Layout raíz con Navbar + Toaster
│   ├── page.tsx                 — Redirige a /inicio
│   ├── globals.css              — Tailwind v4 + CSS variables (color teal)
│   ├── login/page.tsx           — Login con selector de área + contraseña
│   ├── inicio/page.tsx          — Dashboard (KPIs, alertas)
│   ├── catalogo/page.tsx        — Catálogo completo con importación
│   ├── stock/page.tsx           — Stock actual vs. objetivo (stub)
│   ├── inventario/page.tsx      — Comparativa real vs. SAP (pendiente)
│   ├── propuesta/page.tsx       — Propuesta de pedido (stub)
│   ├── consumo/page.tsx         — Consumo por protocolo (stub)
│   ├── analisis/page.tsx        — Tendencias y alertas (stub)
│   ├── historico/page.tsx       — Archivo inmutable (stub)
│   └── api/
│       ├── auth/route.ts        — POST (login) + DELETE (logout)
│       ├── medicamentos/
│       │   ├── route.ts         — GET (lista) + POST (crear)
│       │   └── [cn]/route.ts    — PATCH (editar) + DELETE
│       └── catalogo/
│           └── importar/route.ts — POST multipart: importar Excel IV/ORAL
├── components/
│   └── Navbar.tsx               — Navbar fija con 8 tabs + área activa + logout
├── db/
│   ├── schema.ts                — Todas las tablas Drizzle
│   └── index.ts                 — Conexión SQLite (better-sqlite3) + instancia Drizzle
├── lib/
│   ├── cima.ts                  — API CIMA: lookup por CN, check desabastecimiento
│   ├── sap-parser.ts            — Parser Excel SAP (Material→CN, stock, precio)
│   ├── catalogo-parser.ts       — Parser Excel catálogo IV y ORAL
│   ├── consumo-parser.ts        — Parser Excel consumo (Fecha, CN, Viales...)
│   └── utils.ts                 — cnFromSapMaterial(), isMSE(), formatEuro()
└── proxy.ts                     — Auth proxy (Next.js 16: proxy.ts, no middleware.ts)

docs/
├── PRD.md                       — Requisitos completos del producto
└── CHANGELOG.md                 — Historial de versiones

drizzle/                         — Migraciones generadas por drizzle-kit
farmacia.db                      — Base de datos SQLite local (NO versionar)
drizzle.config.ts                — Config Drizzle (SQLite dev, PostgreSQL prod)
.env.local                       — Variables locales (NO versionar)
.gitignore                       — Excluye node_modules, .next, *.db, .env.local
```

---

## Autenticación

- Proxy en `src/proxy.ts` (Next.js 16 usa `proxy.ts`, no `middleware.ts`)
- Rutas públicas: `/login`, `/api/auth`
- Cookie `auth_session=authenticated` (httpOnly, 12h)
- Cookie `area_session=oncologia|upe|iv|nutricion|almacen` (lectura cliente, 12h)
- Contraseña única en `APP_PASSWORD` (`.env.local` o Vercel env vars)
- Sin sistema de usuarios individuales (diseño intencionado)

---

## Navegación (pestañas en Navbar)

| Ruta | Pestaña | Estado |
|------|---------|--------|
| `/inicio` | Inicio | Stub con cards |
| `/catalogo` | Catálogo | ✅ Completo |
| `/stock` | Stock | Stub |
| `/inventario` | Inventario | Pendiente |
| `/propuesta` | Propuesta | Stub |
| `/consumo` | Consumo | Stub |
| `/analisis` | Análisis | Stub |
| `/historico` | Histórico | Stub |

**Nota:** La pestaña `Inventario` está en la Navbar pero su página está pendiente de implementar.

---

## Modelo de datos (SQLite dev → PostgreSQL prod)

### `medicamentos`
```
cn TEXT PK            — Código Nacional AEMPS
nombre TEXT           — Nombre comercial / MARCA
principio_activo TEXT — PPIO ACTIVO (del Excel o CIMA)
presentacion TEXT     — De CIMA (opcional)
via TEXT              — 'IV' | 'ORAL' | 'OTRO'
area TEXT             — 'oncologia'|'upe'|'iv'|'nutricion'|'almacen'
ubicacion TEXT        — 'CIT'|'Armario NEA'|'Nevera NEA'|...
unidades_por_caja INT — OBLIGATORIO. No viene de SAP
activo BOOL           — En stock y propuestas si true
comprable BOOL        — En propuestas de pedido si true
mse BOOL              — Auto: CN.startsWith("02")
tipo_mse TEXT         — 'UC'|'Extranjero'|null
precio_unidad REAL    — Último desde SAP
precio_caja REAL      — precio_unidad × unidades_por_caja
```

### `stock_objetivo`
```
cn TEXT FK → medicamentos
stock_minimo INT      — Cajas. Alerta urgente si stock_actual < stock_minimo
punto_pedido INT      — Cajas. Trigger normal de pedido
stock_maximo INT|null — Cajas. Techo de stock
```

### `importaciones_stock` + `stock_registros`
- `importaciones_stock`: cabecera (fecha, origen='SAP'|'Manual', fichero)
- `stock_registros`: líneas (cn, stock_unidades, stock_cajas, valor_total)
- **NUNCA se sobrescriben. Cada importación es un snapshot histórico.**

### `propuestas` + `propuestas_lineas`
- Estados: `'borrador'` → `'validada'` → `'emitida'`
- Las líneas guardan snapshot de stock_actual, stock_objetivo, cajas propuestas, cajas validadas (si el farmacéutico las cambió), unidades_final, precio_ref

### `importaciones_consumo` + `consumo_registros`
- Consumo por medicamento, fecha, paciente (HC anonimizado), protocolo, indicación

### `precios_historial`
- Registra cada vez que el precio de un medicamento cambia en un import SAP
- Campos: cn, precio_unidad, precio_caja, variacion_pct, fecha_importacion

### `alertas`
- Tipos: `'stock_bajo'` | `'desabastecimiento'` | `'recalculo_sugerido'` | `'precio_variacion'`

---

## Reglas de negocio críticas

```
CN = SAP_material.slice(2)           // SAP = "14" + CN siempre
mse = CN.startsWith("02")            // MSE automático, no editable
cajas = stock_unidades ÷ unidades_por_caja  // puede ser decimal
precio_unidad = valor_final ÷ stock_unidades
precio_caja = precio_unidad × unidades_por_caja

// Módulo Inventario:
ajuste_cajas = stock_real_cajas - stock_sap_cajas
ajuste_unidades = ajuste_cajas × unidades_por_caja
// Positivo (+) = entrada/ajuste al alza en SAP
// Negativo (−) = salida/ajuste a la baja en SAP

// Propuesta:
if stock_actual ≤ punto_pedido → incluir en propuesta
cajas_propuestas = punto_pedido_objetivo - stock_actual  // entero positivo
unidades_final = cajas_validadas × unidades_por_caja     // en el Excel de emisión
```

---

## Formatos Excel de entrada

### SAP Stock — columnas requeridas (case-insensitive, se buscan por nombre):
- `Material` → CN (quitar "14" del inicio)
- `Stock de cierre` → stock_unidades
- `Valor final` → valor_total (para precio)

### Catálogo IV — primera columna `Title`:
`Title` · `PPIO ACTIVO` · `MARCA` · `ACTIVO` (SI/NO) · `UBIC` · `MultiploPedido` · `Stock Minimo` · `PuntoPedido` · `Stock Maximo`

### Catálogo ORAL — primera columna `CODIGO SAP`:
`CODIGO SAP` · `PPIO ACTIVO` · `MARCA` · `ACTIVO` · `MultiploPedido` · `Stock Minimo` · `PuntoPedido` · `Stock Maximo` · `UBIC`
Mapeo UBIC: `ARMARIO` → `Armario NEA` / `NEVERA` → `Nevera NEA`

### Recuento Manual (plantilla):
`CN` · `Nombre` · `Cantidad_Cajas` · `Observaciones`

### Consumo:
Obligatorias: `Fecha` · `CN` · `Viales` — Opcionales: `HC` · `Indicacion` · `Protocolo`
Fechas aceptadas: `dd/mm/yyyy` o `yyyy-mm-dd`

---

## Variables de entorno

### Desarrollo local (`.env.local`)
```
APP_PASSWORD=farmacia2024
```

### Producción (Vercel Dashboard → Settings → Environment Variables)
```
APP_PASSWORD=contraseña-segura-elegida
DATABASE_URL=postgresql://usuario:password@ep-xxx.region.aws.neon.tech/nombre_db?sslmode=require
```

---

## Guía de despliegue en producción (Neon + Vercel + GitHub)

> Usa la misma cuenta de GitHub y Vercel que el proyecto `pedidos-pendientes-hmanacor`.

### Paso 1 — Crear repositorio en GitHub

1. Ve a [github.com](https://github.com) e inicia sesión con la cuenta del hospital
2. Clic en **New repository**
3. Nombre: `farmacia-oncologica-hmanacor` (o similar)
4. Visibilidad: **Private** (datos hospitalarios internos)
5. NO inicialices con README (el proyecto ya tiene archivos)
6. Clic en **Create repository**
7. En la terminal local, desde la carpeta `farmacia-oncologica/`:
   ```bash
   git init
   git add .
   git commit -m "feat: initial project setup — local SQLite dev"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/farmacia-oncologica-hmanacor.git
   git push -u origin main
   ```
8. Añade al `.gitignore` antes del push: `farmacia.db`, `*.db-*`, `.env.local`, `node_modules/`, `.next/`

### Paso 2 — Crear base de datos en Neon

> Usa la cuenta de Neon donde está también la BD de Pedidos Pendientes.

**Opción A — Nueva base de datos independiente (recomendada para empezar):**
1. Ve a [console.neon.tech](https://console.neon.tech)
2. Clic en **New project**
3. Nombre del proyecto: `farmacia-oncologica`
4. Región: la más cercana (Europe West si disponible)
5. Clic en **Create project**
6. En el dashboard del proyecto, copia la **Connection string** (formato: `postgresql://usuario:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`)
7. Guarda esta URL — la necesitarás en el Paso 4

**Opción B — Compartir BD con Pedidos Pendientes (para fase de integración):**
1. Entra al proyecto Neon de Pedidos Pendientes
2. Usa el mismo `DATABASE_URL`
3. Los schemas son diferentes (no hay conflicto de tablas)
4. La app de Farmacia Oncológica podrá leer la tabla `orders` de Pedidos Pendientes

### Paso 3 — Migrar el código de SQLite a PostgreSQL

En el proyecto local, realiza los siguientes cambios antes de desplegar:

**3.1 Actualizar `package.json`:**
```json
// ELIMINAR:
"better-sqlite3": "...",

// AÑADIR en dependencies:
"@neondatabase/serverless": "^1.0.2",

// ELIMINAR de devDependencies:
"@types/better-sqlite3": "...",
```

**3.2 Actualizar `src/db/index.ts`:**
```typescript
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });
export type DB = typeof db;
```

**3.3 Actualizar `drizzle.config.ts`:**
```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

**3.4 Actualizar `src/db/schema.ts`:**
Reemplazar los imports de SQLite por los de PostgreSQL:
```typescript
// ANTES (SQLite):
import { sqliteTable, text, integer, real, index, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// DESPUÉS (PostgreSQL):
import { pgTable, text, integer, real, boolean, timestamp, index, unique, serial } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
```

Cambios por tabla:
- `sqliteTable` → `pgTable`
- `integer('id').primaryKey({ autoIncrement: true })` → `serial('id').primaryKey()`
- `integer('campo', { mode: 'boolean' })` → `boolean('campo')`
- `text('campo').default(sql\`(datetime('now'))\`)` → `timestamp('campo').defaultNow()`
- `real('campo')` → `real('campo')` (igual en PostgreSQL)

**3.5 Actualizar `next.config.ts`:**
```typescript
// ELIMINAR la línea serverExternalPackages con better-sqlite3
const nextConfig: NextConfig = {};
export default nextConfig;
```

**3.6 Aplicar schema a Neon:**
```bash
# Con DATABASE_URL apuntando a Neon (en .env.local temporalmente):
DATABASE_URL="postgresql://..." npx drizzle-kit push
```

### Paso 4 — Desplegar en Vercel

1. Ve a [vercel.com](https://vercel.com) e inicia sesión con la misma cuenta que Pedidos Pendientes
2. Clic en **Add New… → Project**
3. Selecciona el repositorio `farmacia-oncologica-hmanacor` de GitHub
4. **Framework Preset**: Next.js (se detecta automáticamente)
5. **Root Directory**: si el repo tiene carpeta raíz, apunta a `farmacia-oncologica/`. Si el repo es directamente el proyecto Next.js, déjalo como `.`
6. En **Environment Variables** añade:
   ```
   APP_PASSWORD = tu-contraseña-segura
   DATABASE_URL = postgresql://... (copiada de Neon en Paso 2)
   ```
7. Clic en **Deploy**
8. Vercel asignará una URL del tipo `https://farmacia-oncologica-hmanacor.vercel.app`

### Paso 5 — Verificar el despliegue

```bash
# Comprobar que la app responde
curl -I https://farmacia-oncologica-hmanacor.vercel.app/login

# Si hay errores, revisar:
# - Vercel Dashboard → Deployments → clic en el deployment → Functions → logs
# - Que DATABASE_URL esté correctamente configurada
# - Que el schema se aplicó correctamente en Neon (paso 3.6)
```

### Paso 6 — Importar el catálogo inicial

Una vez desplegado, desde la app en producción:
1. Login con el área `Oncología`
2. Ir a **Catálogo** → **Importar Excel**
3. Subir `Catálogo_IV.xlsx` (124 medicamentos)
4. Subir `Catálogo_ORALES.xlsx` (155 medicamentos)

---

## Integración con Pedidos Pendientes (fase producción)

Cuando ambas apps compartan la misma BD Neon, el módulo de Análisis puede consultar:

```typescript
// En src/db/pedidos-pendientes.ts (crear este archivo):
import { pgTable, serial, text, numeric, boolean, timestamp, date } from 'drizzle-orm/pg-core';

// Referencia a la tabla orders de Pedidos Pendientes (solo lectura):
export const ordersPP = pgTable('orders', {
  id: serial('id').primaryKey(),
  nMateProv: text('n_mate_prov'),           // CN del medicamento
  cantidadRecibida: numeric('cantidad_recibida'),
  fechaDocumento: date('fecha_documento'),
  recibido: boolean('recibido'),
  recibidoAt: timestamp('recibido_at'),
  proveedorNombre: text('proveedor_nombre'),
  cantidadPedido: numeric('cantidad_pedido'),
});

// Consulta de compras de un medicamento:
const compras = await db
  .select({
    fecha: ordersPP.fechaDocumento,
    cantidad: ordersPP.cantidadRecibida,
    proveedor: ordersPP.proveedorNombre,
  })
  .from(ordersPP)
  .where(and(
    eq(ordersPP.nMateProv, cn),
    eq(ordersPP.recibido, true)
  ))
  .orderBy(desc(ordersPP.recibidoAt));
```

**Campo de cruce:** `orders.n_mate_prov` = CN del medicamento (Código Nacional).

---

## Módulo Inventario — Especificación técnica pendiente

El módulo de Inventario está en la Navbar pero su implementación está pendiente. Cuando se desarrolle:

### Archivos a crear:
- `src/app/inventario/page.tsx` — Página principal
- `src/app/api/inventario/comparar/route.ts` — API de comparativa
- `src/app/api/inventario/exportar/route.ts` — API de exportación Excel

### Lógica de la API de comparativa (`POST /api/inventario/comparar`):
```typescript
// Parámetros: { importacion_manual_id, importacion_sap_id, area }
// Para cada medicamento activo del área:
// 1. Buscar stock_real en stock_registros WHERE importacion_id = importacion_manual_id
// 2. Buscar stock_sap en stock_registros WHERE importacion_id = importacion_sap_id
// 3. ajuste_cajas = (stock_real?.stock_cajas ?? null) - (stock_sap?.stock_cajas ?? null)
// 4. ajuste_unidades = ajuste_cajas × medicamento.unidades_por_caja
// Retornar array con todos los campos para la tabla
```

### Excel de exportación (dos hojas):
- **Hoja 1 - Inventario completo**: todos los medicamentos con Real, SAP y Ajuste
- **Hoja 2 - Solo ajustes**: medicamentos con `ajuste ≠ 0`, ordenados por `|ajuste_unidades|` desc
- Encabezado: área, fecha recuento, fecha SAP, fecha generación
- Colores: rojo para ajuste negativo, verde/azul para positivo, sin color si 0
- Archivo: `Inventario_YYYYMMDD_[area].xlsx`

### Interpretación del ajuste (mostrar en la UI):
> **+** (positivo) = hay más stock físico que en SAP → **Ajuste de inventario al alza en SAP**
> **-** (negativo) = hay menos stock físico que en SAP → **Registrar salidas en SAP**
> **0** = sin discrepancia

---

## Convenciones de código

- **Idioma del dominio**: español (nombres de variables de BD, estados, textos de UI)
- **Mantén la terminología**: "punto de pedido" (no "stock óptimo"), "unidades por caja" (no "múltiplo pedido")
- **Color de marca**: teal (no azul — azul es Pedidos Pendientes)
- **Sin comentarios superfluos**: solo documenta el "por qué", no el "qué"
- **Runtime explícito en API routes**: `export const runtime = 'nodejs'` (SQLite no funciona en edge)
- **Sin datos de paciente en la nube** hasta confirmar con DPO si se añaden campos identificativos

---

## Problemas conocidos y workarounds

| Problema | Causa | Solución |
|----------|-------|----------|
| `drizzle-kit push` pide TTY interactivo | Detecta columnas renombradas | Borrar la BD SQLite y recrearla (vacía) antes del push |
| Warning "middleware deprecated" en Next.js 16 | Next.js 16 usa `proxy.ts` | Archivo renombrado a `src/proxy.ts` con `export function proxy()` |
| Warning "multiple lockfiles" en Turbopack | Hay un `package-lock.json` en `/Users/luciarc/` | Ignorable en dev; en prod (Vercel) no aparece |
| `serverExternalPackages` requerido para better-sqlite3 | better-sqlite3 no es compatible con Webpack | Configurado en `next.config.ts` |

---

*© 2026 Lucía Rodríguez Cajaraville. Todos los derechos reservados.*
