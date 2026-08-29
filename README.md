# Service Measurement (`service-measurement`)

**Microservicio de Ingesta, Auditoría y Analítica de Mediciones de Campo**

Microservicio central de CityData v2 responsable de recibir las sesiones de medición desde la app móvil, procesar y optimizar fotografías mediante `Sharp`, almacenar estructuras JSONB heterogéneas en PostgreSQL y ejecutar agregaciones SQL laterales de alto rendimiento para el motor de reportes y resúmenes multiestudio.

---

## 🚀 Ficha Técnica

| Parámetro | Detalle |
| :--- | :--- |
| **Framework** | NestJS 11 + TypeScript |
| **ORM / Persistencia** | Prisma ORM + PostgreSQL (`JSONB`) |
| **Puerto por Defecto** | `4006` |
| **Caché / Broker** | Valkey (Redis-compatible) en puerto `6379` |
| **Procesamiento de Fotos**| Sharp (WebP / JPEG multi-resolución) |
| **Documentación Técnica** | [`docs/architecture.md`](./docs/architecture.md) y [`docs/database.md`](./docs/database.md) |

---

## 📦 Estructura de Datos (`JSONB`)

Una medición en PostgreSQL se modela con campos fijos de indexación relacional y tres columnas `JSONB` de alta flexibilidad:
- **`header`**: Respuestas generales de la sesión (Supervisor, Estación, Clima, etc.).
- **`body`**: Array de registros individuales de campo, cada uno con `answers`, `timestamps` (manual, gps, server, device) y `location`.
- **`meta`**: Metadatos de auditoría que contienen `device` (marca, modelo, OS, versión de app) y `track` (coordenadas GPS continuas).

---

## 🛠️ Variables de Entorno (`.env`)

```env
NODE_ENV=development
APP_NAME=service-measurement
PORT=4006
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/measurement_db?schema=public"
VALKEY_URL="redis://localhost:6379"
UPLOAD_PATH="uploads"
LOKI_URL="http://host.docker.internal:3100"
```

---

## 💻 Comandos de Ejecución

```bash
# 1. Instalar dependencias
yarn install

# 2. Sincronizar esquema de base de datos
npx prisma db push --schema ./prisma/measurement/schema.prisma

# 3. Iniciar en modo desarrollo con recarga en caliente
yarn start:dev
```

---

## 🌐 Catálogo de Endpoints Principales

| Método | Endpoint | Descripción |
| :--- | :--- | :--- |
| `POST` | `/measurement/:orgId/:resId/:campId` | Ingesta multipart de medición con fotos |
| `GET` | `/measurement/:orgId/:resId/:campId` | Lista de mediciones paginadas |
| `GET` | `/measurement/:orgId/:resId/:campId/:id` | Detalle completo de una medición |
| `GET` | `/measurement/:orgId/:resId/:campId/image/:mId/:imgId` | Descarga de fotografía procesada |
| `GET` | `/measurement/:orgId/:resId/:campId/summary` | Resumen agregado de una campaña individual |
| `GET` | `/measurement/:orgId/:resId/:campId/export` | Exportación de datos para análisis |
| `GET / POST` | `/measurement/:orgId/organization-summary` | **Resumen Multiestudio**: Agregación por Día, Mes o Usuario |
