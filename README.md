# Service Measurement (`service-measurement`)

**Microservicio de Ingesta, Auditoría y Analítica de Mediciones de Campo**

Microservicio central de CityData v2 responsable de recibir las sesiones de medición desde la app móvil, procesar y optimizar fotografías mediante `Sharp`, almacenar la estructura relacional normalizada (`Measurement` + `MeasurementItem`) en PostgreSQL y ejecutar agregaciones analíticas de ultra-alto rendimiento respaldadas por índices B-Tree para el motor de reportes y resúmenes multiestudio.

---

## 🚀 Ficha Técnica

| Parámetro | Detalle |
| :--- | :--- |
| **Framework** | NestJS 11 + TypeScript |
| **ORM / Persistencia** | Prisma ORM + PostgreSQL Relacional Normalizado |
| **Puerto por Defecto** | `4006` |
| **Caché / Broker** | Valkey (Redis-compatible) en puerto `6379` |
| **Procesamiento de Fotos**| Sharp (JPEG multi-resolución a 1200px / q75) |
| **Prefijo de Rutas** | `/measurement` |

---

## 🏗️ Construcción Docker / Dokploy (Build Time)

> [!IMPORTANT]
> **Variable en tiempo de construcción (Build Argument):**
> Al compilar la imagen Docker en Dokploy o mediante `docker build`, es **obligatorio** pasar `DATABASE_URL` como **Build Argument** (`ARG DATABASE_URL`). Esto permite que Prisma genere el cliente tipado (`prisma:generate:mea`) durante la fase de compilación del contenedor:
>
> * **Build Argument en Dokploy / Docker**:
>   ```env
>   DATABASE_URL=postgresql://postgres:your_postgres_password@citydata-postgres-b1mysl:5432/service_measurement
>   ```

---

## 📂 Volúmenes y Persistencia en Dokploy / Docker

| Mount Type | Host Path | Mount Path | Mode | Propósito |
| :--- | :--- | :--- | :--- | :--- |
| **BIND** | `/root/service-measurement` | `/app/files` | Read/Write | Persistencia de imágenes procesadas y archivos de auditoría |

### Permisos requeridos en el Host (Linux):
```bash
# 1. Crear directorio en el servidor host
mkdir -p /root/service-measurement

# 2. Configurar permisos de lectura y escritura para el contenedor
chmod 755 /root
chmod 777 /root/service-measurement
```

---

## 📦 Estructura de Datos y Modelo Relacional (`Measurement` + `MeasurementItem`)

```mermaid
erDiagram
    Measurement ||--o{ MeasurementItem : "contiene (1:N)"

    Measurement {
        uuid id PK "Identificador único de la sesión"
        uuid organization_id "Organización propietaria"
        uuid research_id "Estudio vinculado"
        uuid campaign_id "Campaña vinculada"
        varchar form_version "Versión de formulario usada"
        uuid user_id "Medidor que realizó la captura"
        jsonb header "Respuestas globales de cabecera"
        jsonb meta "Metadata agregada (tracks GPS, device)"
        timestamp deletion_review_at "Fecha límite de retención"
        timestamp deleted_at "Soft-delete de sesión"
        timestamp created_at
        timestamp updated_at
    }

    MeasurementItem {
        varchar id PK "ID original del cliente móvil (ej: 1786555889098-dyn5zx68)"
        uuid measurement_id FK "Vínculo con la sesión padre (CASCADE)"
        uuid organization_id "Denormalizado para indexación directa"
        uuid research_id "Denormalizado"
        uuid campaign_id "Denormalizado"
        uuid user_id "Denormalizado"
        jsonb answers "Respuestas dinámicas del formulario"
        float latitude "Latitud materializada (Indexada)"
        float longitude "Longitud materializada (Indexada)"
        timestamp resolved_at "Timestamp oficial resuelto (Indexado B-Tree)"
        varchar resolved_source "Origen del timestamp (gps, server, device, manual)"
        jsonb meta_location "Auditoría de ubicación { address, accuracy }"
        jsonb meta_timestamps "Auditoría completa { gps, device, manual, server }"
        timestamp deleted_at "Soft-delete atómico e instantáneo"
        timestamp created_at
    }
```

### Mecánica de Consultas y Cero N+1 (Query Batching):
1. **Filtro Temporal**: Toda consulta analítica filtra por la columna `resolved_at` indexada en B-Tree.
2. **Query Batching**: Cuando se consultan 200 ítems, el servicio ejecuta **exactamente 2 consultas SQL**:
   - `SELECT * FROM measurement_item WHERE ... LIMIT 200`
   - `SELECT id, header, meta FROM measurement WHERE id IN (...)` (solo los IDs únicos).
   - Ensambla las cabeceras en memoria `O(1)` con cero sobrecarga en base de datos.

---

## 🛠️ Variables de Entorno (`.env`)

```env
NODE_ENV=production
APP_NAME=service-measurement
PORT=4006

LOKI_URL=http://citydata-loki:3100
VALKEY_URL=redis://:your_valkey_password@valkey:6379/0
CACHE_TTL=10000

DATABASE_URL=postgresql://postgres:your_postgres_password@citydata-postgres-b1mysl:5432/service_measurement
MEASUREMENT_DELETION_RETENTION_DAYS=30
```

---

## 💻 Comandos de Ejecución

```bash
# 1. Instalar dependencias
yarn install

# 2. Aplicar migraciones en base de datos (Producción)
yarn prisma:deploy:mea

# 3. Ejecutar script de backfill histórico
yarn backfill:items

# 4. Iniciar en modo desarrollo con recarga en caliente
yarn start:dev

# 5. Compilar e iniciar en producción
yarn build
yarn start:prod
```

---

## 🌐 Catálogo de Endpoints Principales

| Método | Endpoint | Descripción |
| :--- | :--- | :--- |
| `POST` | `/measurement/:orgId/:resId/:campId` | Ingesta multipart de medición con fotos |
| `GET` | `/measurement/:orgId/:resId/:campId` | Lista de mediciones paginadas con filtros |
| `GET` | `/measurement/:orgId/:resId/:campId/:id` | Detalle completo de una medición con sus ítems |
| `DELETE` | `/measurement/:orgId/:resId/:campId/:mId/:itemId` | Soft-delete atómico de un ítem individual |
| `GET` | `/measurement/:orgId/:resId/:campId/image/:mId/:imgId` | Descarga de fotografía procesada (Sharp) |
| `GET` | `/measurement/:orgId/:resId/:campId/locations` | Puntos GPS agrupados por usuario (Indexados) |
| `GET` | `/measurement/:orgId/:resId/:campId/users` | Medidores con actividad en rango de fechas |
| `GET` | `/measurement/:orgId/:resId/:campId/summary` | Resumen agregado por Día/Mes/Hora/Usuario |
| `GET` | `/measurement/:orgId/:resId/:campId/export` | Exportación XLSX / ZIP con enlaces a imágenes |
| `GET / POST` | `/measurement/:orgId/organization-summary` | **Resumen Multiestudio**: Métricas globales por Día/Mes/Usuario |
