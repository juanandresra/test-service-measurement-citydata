import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { MeasurementPrismaService } from '../common/modules/prisma/services/measurement.prisma.service';

async function runBackfill() {
  const started = Date.now();
  console.log('🚀 Iniciando script de Backfill para MeasurementItem...');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const prisma = app.get(MeasurementPrismaService);

  try {
    const totalMeasurements = await prisma.measurement.count();
    console.log(`📊 Total de lotes (Measurement) en base de datos: ${totalMeasurements}`);

    let cursor: string | undefined = undefined;
    const batchSize = 50;
    let processedBatches = 0;
    let totalItemsCreated = 0;
    let totalItemsSkipped = 0;

    while (true) {
      const measurements = await prisma.measurement.findMany({
        take: batchSize,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { id: 'asc' },
      });

      if (measurements.length === 0) break;

      for (const m of measurements) {
        cursor = m.id;
        processedBatches++;

        const bodyArray = Array.isArray(m.body) ? (m.body as any[]) : [];
        if (bodyArray.length === 0) continue;

        const itemsToInsert: any[] = [];

        for (const item of bodyArray) {
          if (!item || typeof item !== 'object' || !item.id) {
            totalItemsSkipped++;
            continue;
          }

          const meta = item.meta || {};
          const timestamps = meta.timestamps || {};
          const location = meta.location || {};

          // Resolver fecha canónica oficial
          const resolvedKey = typeof timestamps.resolved === 'string' ? timestamps.resolved : 'server';
          const resolvedIso =
            timestamps[resolvedKey] ||
            timestamps.server ||
            timestamps.device ||
            timestamps.gps ||
            timestamps.manual ||
            item.createdAt ||
            m.createdAt;

          let resolvedAt = new Date(resolvedIso);
          if (isNaN(resolvedAt.getTime())) {
            resolvedAt = new Date(m.createdAt);
          }

          const latitude =
            typeof location.latitude === 'number'
              ? location.latitude
              : !isNaN(Number(location.latitude)) && location.latitude !== null
              ? Number(location.latitude)
              : null;

          const longitude =
            typeof location.longitude === 'number'
              ? location.longitude
              : !isNaN(Number(location.longitude)) && location.longitude !== null
              ? Number(location.longitude)
              : null;

          let itemCreatedAt = new Date(item.createdAt || m.createdAt);
          if (isNaN(itemCreatedAt.getTime())) {
            itemCreatedAt = new Date(m.createdAt);
          }

          let itemDeletedAt: Date | null = null;
          if (item.deletedAt) {
            const parsedDeletedAt = new Date(item.deletedAt);
            if (!isNaN(parsedDeletedAt.getTime())) {
              itemDeletedAt = parsedDeletedAt;
            }
          } else if (m.deletedAt) {
            itemDeletedAt = new Date(m.deletedAt);
          }

          itemsToInsert.push({
            id: String(item.id),
            measurementId: m.id,
            organizationId: m.organizationId,
            researchId: m.researchId,
            campaignId: m.campaignId,
            userId: m.userId,
            answers: item.answers && typeof item.answers === 'object' ? item.answers : {},
            latitude,
            longitude,
            resolvedAt,
            resolvedSource: resolvedKey,
            metaLocation: location && Object.keys(location).length > 0 ? location : null,
            metaTimestamps: timestamps && Object.keys(timestamps).length > 0 ? timestamps : null,
            deletedAt: itemDeletedAt,
            createdAt: itemCreatedAt,
          });
        }

        if (itemsToInsert.length > 0) {
          const result = await prisma.measurementItem.createMany({
            data: itemsToInsert,
            skipDuplicates: true,
          });
          totalItemsCreated += result.count;
        }

        if (processedBatches % 20 === 0 || processedBatches === totalMeasurements) {
          console.log(
            `⏳ Progreso: ${processedBatches}/${totalMeasurements} lotes procesados (${totalItemsCreated} items insertados)...`,
          );
        }
      }
    }

    const durationSeconds = ((Date.now() - started) / 1000).toFixed(2);
    console.log('\n========================================');
    console.log('✅ Backfill completado exitosamente:');
    console.log(`📦 Lotes procesados: ${processedBatches}`);
    console.log(`📝 Items insertados en MeasurementItem: ${totalItemsCreated}`);
    console.log(`⚠️  Items omitidos por formato inválido: ${totalItemsSkipped}`);
    console.log(`⏱️  Tiempo transcurrido: ${durationSeconds} segundos`);
    console.log('========================================\n');
  } catch (error) {
    console.error('❌ Error durante el backfill:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

void runBackfill();
