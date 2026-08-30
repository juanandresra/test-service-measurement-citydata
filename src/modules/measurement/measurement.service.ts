/* eslint-disable @typescript-eslint/no-base-to-string */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PinoLogger } from 'pino-nestjs';
import { ClientProxy } from '@nestjs/microservices/client/client-proxy';
import { firstValueFrom, of } from 'rxjs';
import { timeout, catchError } from 'rxjs/operators';
import { MeasurementPrismaService } from '../../common/modules/prisma/services/measurement.prisma.service';
import { CreateMeasurementDto } from './dto/create-measurement.dto';
import { QueryLocationsDto } from './dto/query-locations.dto';

import { DateTime } from 'luxon';
import * as Excel4Node from 'excel4node';
import { ZipArchive } from 'archiver';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { QueryMeasurementDto } from './dto/query-measurement.dto';
import {
  GetSummaryQueryDto,
  SummaryGrouping,
} from './dto/get-summary-query.dto';
import { OrganizationSummaryQueryDto } from './dto/organization-summary-query.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '@src/common/config/env/env.schema';

export interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface LocationRow {
  userId: string;
  lat: number;
  lon: number;
  date: string;
}

export interface LocationPoint {
  lat: number;
  lon: number;
  date: string;
}

export interface ResolvedUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface SummaryRawResult {
  group_key: string;
  total_measurements: number;
}

function toJsonInput(value: unknown): any {
  return JSON.parse(JSON.stringify(value));
}

function toStartOfDayIfDateOnly(value: string): Date {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Date(isDateOnly ? `${value}T00:00:00.000Z` : value);
}

function toEndOfDayIfDateOnly(value: string): Date {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Date(isDateOnly ? `${value}T23:59:59.999Z` : value);
}

interface FlattenedMeasurementRow {
  measurement_id: string;
  form_version: string;
  user_id: string;
  created_at?: Date | string | null;
  header: unknown;
  record: {
    id: string;
    answers: Record<string, unknown>;
    meta: {
      location: {
        address: string | null;
        accuracy: number;
        latitude: number;
        longitude: number;
      };
      timestamps: {
        gps: string | null;
        device: string;
        manual: string | null;
        server: string | null;
        resolved: 'manual' | 'server' | 'device' | 'gps';
      };
    };
    createdAt: string;
    deletedAt?: string;
  };
}

@Injectable()
export class MeasurementService {
  private readonly baseUploadPath = path.resolve(process.cwd(), 'files');

  constructor(
    @Inject('VALKEY_SERVICE')
    private readonly valkeyClient: ClientProxy,
    private readonly prisma: MeasurementPrismaService,
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService<EnvConfig>,
  ) {
    this.logger.setContext(MeasurementService.name);
  }

  private formatMapValue(value: any): string {
    if (!value) return '—';
    const address = typeof value.address === 'string' ? value.address : null;
    const coords = value.coords;
    let coordsArray: string | null = null;
    if (
      coords &&
      typeof coords.lat === 'number' &&
      typeof coords.lon === 'number'
    ) {
      coordsArray = `[${coords.lat.toFixed(3)}, ${coords.lon.toFixed(3)}]`;
    }
    if (address && coordsArray) return `${address} ${coordsArray}`;
    if (address) return address;
    if (coordsArray) return coordsArray;
    return '—';
  }

  private formatPDValue(value: any): string {
    if (!value || typeof value !== 'object') return '—';
    const selected = value.selected;
    const variablesOrder = value.variablesOrder;
    const snapshot = value.snapshot;
    if (
      !selected ||
      !Array.isArray(variablesOrder) ||
      !snapshot ||
      typeof snapshot !== 'object'
    ) {
      return '—';
    }
    const varsList = variablesOrder.join(', ');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const opsList = Object.values(snapshot)
      .map((values: any) =>
        Array.isArray(values) ? `[${values.join(',')}]` : `[${String(values)}]`,
      )
      .join(',');
    return `${String(selected)}, Var [${varsList}], Op [${opsList}]`;
  }

  private formatCellValueForExcel(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if ('coords' in obj || 'address' in obj) return this.formatMapValue(obj);
      if ('variablesOrder' in obj && 'snapshot' in obj && 'selected' in obj)
        return this.formatPDValue(obj);
      try {
        return JSON.stringify(obj);
      } catch {
        return '[Objeto Complejo]';
      }
    }
    return String(value);
  }

  private async getUsersMap(userIds: string[]): Promise<Map<string, unknown>> {
    const uniqueIds = [...new Set(userIds)];
    const entries = await Promise.all(
      uniqueIds.map(async (userId) => {
        try {
          const user = await firstValueFrom(
            this.valkeyClient.send<unknown>('find-user', { userId }).pipe(
              timeout(5000),
              catchError((err: unknown) => {
                this.logger.error(
                  { err, userId },
                  'Error fetching user from valkey',
                );
                throw err;
              }),
            ),
          );
          return [userId, user] as const;
        } catch {
          return [userId, null] as const;
        }
      }),
    );
    return new Map(entries);
  }

  private toResolvedUser(userId: string, user: unknown): ResolvedUser {
    if (!user || typeof user !== 'object') {
      return { id: userId, email: null, firstName: null, lastName: null };
    }
    const u = user as Record<string, unknown>;
    return {
      id: userId,
      email: typeof u.email === 'string' ? u.email : null,
      firstName: typeof u.firstName === 'string' ? u.firstName : null,
      lastName: typeof u.lastName === 'string' ? u.lastName : null,
    };
  }

  private extractLabelsFromSchema(schema: any): Record<string, string> {
    const labelMap: Record<string, string> = {};

    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;

      if (node.id && node.label) {
        labelMap[String(node.id)] = String(node.label);
      }

      if (Array.isArray(node)) {
        node.forEach(walk);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        Object.values(node).forEach(walk);
      }
    };

    if (schema && schema.form) {
      walk(schema.form.header);
      walk(schema.form.body);
    } else {
      walk(schema);
    }

    return labelMap;
  }

  async createWithImages(
    paramIds: {
      organizationId: string;
      researchId: string;
      campaignId: string;
    },
    dto: CreateMeasurementDto,
    files: MulterFile[],
    userId: string,
  ) {
    const started = Date.now();
    const initialHeader = (dto.header ?? {}) as Record<string, unknown>;
    const initialBody = (dto.body ?? []) as Record<string, unknown>[];
    const initialMeta = (dto.meta ?? {}) as Record<string, unknown>;

    const measurement = await this.prisma.measurement.create({
      data: {
        organizationId: paramIds.organizationId,
        researchId: paramIds.researchId,
        campaignId: paramIds.campaignId,
        userId,
        formVersion: dto.formVersion,
        header: toJsonInput(initialHeader),
        body: toJsonInput(initialBody),
        meta: toJsonInput(initialMeta),
      },
    });

    const measurementId = measurement.id;
    const fileUrlMapping: Record<string, string> = {};

    if (files && files.length > 0) {
      const targetFolder = path.join(
        this.baseUploadPath,
        paramIds.organizationId,
        paramIds.researchId,
        paramIds.campaignId,
        measurementId,
      );

      if (!fs.existsSync(targetFolder)) {
        fs.mkdirSync(targetFolder, { recursive: true });
      }

      const imageProcessingPromises = files.map(async (file) => {
        const imageId = path.parse(file.originalname).name;
        const finalFileName = `${imageId}.jpeg`;
        const finalFullDestination = path.join(targetFolder, finalFileName);

        try {
          await sharp(file.buffer)
            .resize({ width: 1200, withoutEnlargement: true })
            .jpeg({ quality: 75 })
            .toFile(finalFullDestination);

          const publicUrl = `/measurement/${paramIds.organizationId}/${paramIds.researchId}/${paramIds.campaignId}/image/${measurementId}/${imageId}`;
          fileUrlMapping[file.fieldname] = publicUrl;
          fileUrlMapping[file.originalname] = publicUrl;
          fileUrlMapping[imageId] = publicUrl;
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(
            `Error optimizando la imagen masiva ${file.originalname}: ${msg}`,
          );
          throw new BadRequestException(
            `No se pudo procesar y minificar el archivo: ${file.originalname}`,
          );
        }
      });

      await Promise.all(imageProcessingPromises);
    }

    const injectUrlsIntoJson = (obj: unknown): unknown => {
      if (Array.isArray(obj)) {
        return obj.map((item) => injectUrlsIntoJson(item));
      } else if (obj !== null && typeof obj === 'object') {
        const record = obj as Record<string, unknown>;
        const newObj: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(record)) {
          if (typeof value === 'string' && fileUrlMapping[value]) {
            newObj[key] = fileUrlMapping[value];
          } else {
            newObj[key] = injectUrlsIntoJson(value);
          }
        }
        return newObj;
      }
      return obj;
    };

    const finalHeader = injectUrlsIntoJson(initialHeader) as Record<
      string,
      unknown
    >;
    const finalBody = injectUrlsIntoJson(initialBody) as Record<
      string,
      unknown
    >[];

    const itemsToInsert = this.extractMeasurementItems(
      {
        ...paramIds,
        measurementId,
        userId,
        measurementCreatedAt: measurement.createdAt,
      },
      finalBody,
    );

    const [updatedMeasurement] = await this.prisma.$transaction([
      this.prisma.measurement.update({
        where: { id: measurementId },
        data: {
          header: toJsonInput(finalHeader),
          body: toJsonInput(finalBody),
        },
      }),
      this.prisma.measurementItem.createMany({
        data: itemsToInsert,
        skipDuplicates: true,
      }),
    ]);

    const usersById = await this.getUsersMap([userId]);
    const user = this.toResolvedUser(userId, usersById.get(userId));

    this.logger.info(
      {
        ...paramIds,
        measurementId,
        totalMeasurementsInBatch: finalBody.length,
        totalImagesProcessed: files ? files.length : 0,
        durationMs: Date.now() - started,
      },
      'Lote masivo guardado con dual-write (Measurement + MeasurementItem).',
    );

    return { ...updatedMeasurement, user };
  }

  private extractMeasurementItems(
    paramIds: {
      organizationId: string;
      researchId: string;
      campaignId: string;
      measurementId: string;
      userId: string;
      measurementCreatedAt?: Date;
    },
    body: Record<string, unknown>[],
  ) {
    const itemsToInsert: any[] = [];

    const defaultDate = paramIds.measurementCreatedAt ?? new Date();

    for (const item of body) {
      if (!item || typeof item !== 'object' || !item.id) {
        continue;
      }

      const meta = (item.meta ?? {}) as Record<string, unknown>;
      const timestamps = (meta.timestamps ?? {}) as Record<
        string,
        string | null
      >;
      const location = (meta.location ?? {}) as Record<string, unknown>;

      const resolvedKey =
        typeof timestamps.resolved === 'string'
          ? timestamps.resolved
          : 'server';
      const resolvedIso =
        timestamps[resolvedKey] ||
        timestamps.server ||
        timestamps.device ||
        timestamps.gps ||
        timestamps.manual ||
        item.createdAt;

      let resolvedAt = resolvedIso ? new Date(String(resolvedIso)) : defaultDate;
      if (isNaN(resolvedAt.getTime())) {
        resolvedAt = defaultDate;
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

      let itemCreatedAt = item.createdAt
        ? new Date(String(item.createdAt))
        : defaultDate;
      if (isNaN(itemCreatedAt.getTime())) {
        itemCreatedAt = defaultDate;
      }

      let itemDeletedAt: Date | null = null;
      if (item.deletedAt) {
        const parsedDeletedAt = new Date(String(item.deletedAt));
        if (!isNaN(parsedDeletedAt.getTime())) {
          itemDeletedAt = parsedDeletedAt;
        }
      }

      itemsToInsert.push({
        id: String(item.id),
        measurementId: paramIds.measurementId,
        organizationId: paramIds.organizationId,
        researchId: paramIds.researchId,
        campaignId: paramIds.campaignId,
        userId: paramIds.userId,
        answers: toJsonInput(
          item.answers && typeof item.answers === 'object'
            ? (item.answers as Record<string, unknown>)
            : {},
        ),
        latitude,
        longitude,
        resolvedAt,
        resolvedSource: resolvedKey,
        metaLocation: toJsonInput(location && Object.keys(location).length > 0 ? location : null),
        metaTimestamps: toJsonInput(timestamps && Object.keys(timestamps).length > 0 ? timestamps : null),
        deletedAt: itemDeletedAt,
        createdAt: itemCreatedAt,
      });
    }

    return itemsToInsert;
  }

  getImageStream(params: {
    organizationId: string;
    researchId: string;
    campaignId: string;
    measurementId: string;
    imageId: string;
  }): fs.ReadStream {
    const filePath = path.join(
      this.baseUploadPath,
      params.organizationId,
      params.researchId,
      params.campaignId,
      params.measurementId,
      `${params.imageId}.jpeg`,
    );
    if (!fs.existsSync(filePath)) {
      this.logger.warn(`File-system resource not found: ${filePath}`);
      throw new NotFoundException(
        'La imagen solicitada no existe en el repositorio.',
      );
    }
    return fs.createReadStream(filePath);
  }

  async findAll(
    {
      organizationId,
      researchId,
      campaignId,
    }: { organizationId: string; researchId: string; campaignId: string },
    query: QueryMeasurementDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const userIds =
      query.userId && query.userId.length > 0 ? query.userId : null;
    const dateFrom = query.dateFrom
      ? toStartOfDayIfDateOnly(query.dateFrom)
      : null;
    const dateTo = query.dateTo ? toEndOfDayIfDateOnly(query.dateTo) : null;

    const rows = await this.prisma.$queryRaw<FlattenedMeasurementRow[]>`
      SELECT
        m.id AS measurement_id,
        m.form_version,
        m.user_id,
        m.created_at,
        elem.value AS record
      FROM measurement m,
      LATERAL jsonb_array_elements(m.body) AS elem(value)
      WHERE m.organization_id = ${organizationId}::uuid
        AND m.research_id = ${researchId}::uuid
        AND m.campaign_id = ${campaignId}::uuid
        AND m.deleted_at IS NULL
        AND (elem.value->>'deletedAt') IS NULL
        AND (${userIds}::uuid[] IS NULL OR m.user_id = ANY(${userIds}::uuid[]))
        AND (
          ${dateFrom}::timestamptz IS NULL
          OR (elem.value #>> array['meta', 'timestamps', elem.value->'meta'->'timestamps'->>'resolved'])::timestamptz >= ${dateFrom}::timestamptz
        )
        AND (
          ${dateTo}::timestamptz IS NULL
          OR (elem.value #>> array['meta', 'timestamps', elem.value->'meta'->'timestamps'->>'resolved'])::timestamptz <= ${dateTo}::timestamptz
        )
      ORDER BY (elem.value #>> array['meta', 'timestamps', elem.value->'meta'->'timestamps'->>'resolved'])::timestamptz DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countResult = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*)::bigint AS total
      FROM measurement m,
      LATERAL jsonb_array_elements(m.body) AS elem(value)
      WHERE m.organization_id = ${organizationId}::uuid
        AND m.research_id = ${researchId}::uuid
        AND m.campaign_id = ${campaignId}::uuid
        AND m.deleted_at IS NULL
        AND (elem.value->>'deletedAt') IS NULL
        AND (${userIds}::uuid[] IS NULL OR m.user_id = ANY(${userIds}::uuid[]))
        AND (
          ${dateFrom}::timestamptz IS NULL
          OR (elem.value #>> array['meta', 'timestamps', elem.value->'meta'->'timestamps'->>'resolved'])::timestamptz >= ${dateFrom}::timestamptz
        )
        AND (
          ${dateTo}::timestamptz IS NULL
          OR (elem.value #>> array['meta', 'timestamps', elem.value->'meta'->'timestamps'->>'resolved'])::timestamptz <= ${dateTo}::timestamptz
        )
    `;

    const total = Number(countResult[0]?.total ?? 0);
    const measurementIds = [...new Set(rows.map((r) => r.measurement_id))];
    const headerRows =
      measurementIds.length > 0
        ? await this.prisma.measurement.findMany({
            where: { id: { in: measurementIds } },
            select: { id: true, header: true, meta: true },
          })
        : [];

    const headersByMeasurementId = Object.fromEntries(
      headerRows.map((h) => [h.id, h.header]),
    );

    const devicesByMeasurementId = Object.fromEntries(
      headerRows
        .map((h): [string, unknown] | undefined => {
          const meta = h.meta as { device?: unknown } | undefined;
          const device = meta?.device;
          return device ? [h.id, device] : undefined;
        })
        .filter((entry): entry is [string, unknown] => entry !== undefined),
    );

    const tracksByMeasurementId = Object.fromEntries(
      headerRows
        .map((h): [string, unknown] | undefined => {
          const meta = h.meta as { track?: unknown } | undefined;
          const track = meta?.track;
          return Array.isArray(track) && track.length > 0
            ? [h.id, track]
            : undefined;
        })
        .filter((entry): entry is [string, unknown] => entry !== undefined),
    );

    const uniqueUserIds = [...new Set(rows.map((row) => row.user_id))];
    const usersById = await this.getUsersMap(uniqueUserIds);

    const items = rows.map((row) => {
      const parentRow = headerRows.find((h) => h.id === row.measurement_id);
      let parentMeta = parentRow?.meta as Record<string, unknown> | undefined;
      if (typeof parentMeta === 'string') {
        try {
          parentMeta = JSON.parse(parentMeta) as Record<string, unknown>;
        } catch {}
      }
      let rowMeta = row.record.meta as Record<string, unknown> | undefined;
      if (typeof rowMeta === 'string') {
        try {
          rowMeta = JSON.parse(rowMeta) as Record<string, unknown>;
        } catch {}
      }
      const device = (rowMeta?.device ?? parentMeta?.device ?? null) as Record<string, unknown> | null;
      return {
        id: row.record.id,
        measurementId: row.measurement_id,
        formVersion: row.form_version,
        userId: row.user_id,
        user: this.toResolvedUser(row.user_id, usersById.get(row.user_id)),
        answers: row.record.answers,
        meta: row.record.meta,
        device,
        savedAt: row.created_at ? new Date(row.created_at).toISOString() : row.record.createdAt,
        createdAt: row.record.createdAt,
      };
    });

    return {
      body: items,
      header: headersByMeasurementId,
      tracks: tracksByMeasurementId,
      devices: devicesByMeasurementId,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne({
    organizationId,
    researchId,
    campaignId,
    id,
  }: {
    organizationId: string;
    researchId: string;
    campaignId: string;
    id: string;
  }) {
    const measurement = await this.prisma.measurement.findFirst({
      where: { id, organizationId, researchId, campaignId, deletedAt: null },
    });
    if (!measurement) {
      this.logger.warn(
        { organizationId, researchId, campaignId, id },
        'measurement not found',
      );
      throw new NotFoundException(`Measurement ${id} not found`);
    }

    const bodyArray = (measurement.body as any[]) || [];
    const activeBody = bodyArray.filter((item) => !item.deletedAt);

    const usersById = await this.getUsersMap([measurement.userId]);
    const user = this.toResolvedUser(
      measurement.userId,
      usersById.get(measurement.userId),
    );

    return { ...measurement, body: activeBody, user };
  }

  async create(
    {
      organizationId,
      researchId,
      campaignId,
    }: { organizationId: string; researchId: string; campaignId: string },
    dto: CreateMeasurementDto,
    userId: string,
  ) {
    const initialHeader = (dto.header ?? {}) as Record<string, unknown>;
    const initialBody = (dto.body ?? []) as Record<string, unknown>[];

    const measurement = await this.prisma.measurement.create({
      data: {
        organizationId,
        researchId,
        campaignId,
        userId,
        formVersion: dto.formVersion,
        header: toJsonInput(initialHeader),
        body: toJsonInput(initialBody),
      },
    });

    const itemsToInsert = this.extractMeasurementItems(
      {
        organizationId,
        researchId,
        campaignId,
        measurementId: measurement.id,
        userId,
        measurementCreatedAt: measurement.createdAt,
      },
      initialBody,
    );

    if (itemsToInsert.length > 0) {
      await this.prisma.measurementItem.createMany({
        data: itemsToInsert,
        skipDuplicates: true,
      });
    }

    const usersById = await this.getUsersMap([userId]);
    const user = this.toResolvedUser(userId, usersById.get(userId));
    return { ...measurement, user };
  }

  async remove({
    organizationId,
    researchId,
    campaignId,
    measurementId,
    itemId,
  }: {
    organizationId: string;
    researchId: string;
    campaignId: string;
    measurementId: string;
    itemId: string;
  }) {
    const existing = await this.findOne({
      organizationId,
      researchId,
      campaignId,
      id: measurementId,
    });

    const now = new Date();

    // Each deletion resets the retention period for the measurement.
    // This allows the deletion review to happen only after the configured
    // retention period has elapsed since the last deleted item.
    const retentionDays =
      this.configService.get('MEASUREMENT_DELETION_RETENTION_DAYS', {
        infer: true,
      }) ?? 30;

    const deletionReviewAt = new Date(now);
    deletionReviewAt.setDate(deletionReviewAt.getDate() + retentionDays);

    const body = existing.body || [];

    const targetItem = body.find((item) => item.id === itemId);

    if (!targetItem) {
      throw new NotFoundException('Measurement item not found');
    }

    // Soft-delete the item by setting its deletion timestamp.
    // If the item was already deleted, preserve its original timestamp.
    const newBody = body.map((item) =>
      item.id === itemId
        ? { ...item, deletedAt: item.deletedAt ?? now.toISOString() }
        : item,
    );

    const activeItems = newBody.filter((item) => !item.deletedAt);

    // Dual-write: update both Measurement and MeasurementItem
    if (activeItems.length === 0) {
      const [deletedMeasurement] = await this.prisma.$transaction([
        this.prisma.measurement.update({
          where: { id: measurementId },
          data: {
            body: newBody,
            deletedAt: now,
            deletionReviewAt,
          },
        }),
        this.prisma.measurementItem.updateMany({
          where: { id: itemId },
          data: { deletedAt: now },
        }),
      ]);

      return { ...deletedMeasurement, user: existing.user };
    }

    // The measurement still contains active items, but its deletion
    // review date is reset because a new item was deleted.
    const [updatedMeasurement] = await this.prisma.$transaction([
      this.prisma.measurement.update({
        where: { id: measurementId },
        data: {
          body: newBody,
          deletionReviewAt,
        },
      }),
      this.prisma.measurementItem.updateMany({
        where: { id: itemId },
        data: { deletedAt: now },
      }),
    ]);

    return { ...updatedMeasurement, user: existing.user };
  }

  async exportExcel(
    ids: { organizationId: string; researchId: string; campaignId: string },
    query: QueryMeasurementDto,
  ): Promise<
    | { type: 'zip'; archive: ZipArchive; filename: string }
    | { type: 'xlsx'; buffer: Buffer; filename: string }
  > {
    const { organizationId, researchId, campaignId } = ids;
    const tz = query.timezone ?? 'America/Santiago';

    const result = await this.findAll(ids, {
      ...query,
      page: 1,
      limit: 100000,
    });

    const measurements = result.body;
    if (!Array.isArray(measurements) || measurements.length === 0) {
      throw new BadRequestException(
        'No se encontraron mediciones para exportar.',
      );
    }

    const uniqueVersions = Array.from(
      new Set(
        measurements.map((m) => m.formVersion).filter((v): v is string => !!v),
      ),
    );

    let labelsMap: Record<string, string> = {};
    if (uniqueVersions.length > 0) {
      try {
        const schemasResults = await Promise.all(
          uniqueVersions.map((version) =>
            firstValueFrom(
              this.valkeyClient
                .send<any>('find-form-version', { campaignId, version })
                .pipe(
                  timeout(4000),
                  catchError((err) => {
                    this.logger.warn(
                      { campaignId, version, err: err.message },
                      'Error al obtener versión específica del formulario.',
                    );
                    return of(null);
                  }),
                ),
            ),
          ),
        );

        for (const formVersionData of schemasResults) {
          if (formVersionData && formVersionData.schema) {
            const versionLabels = this.extractLabelsFromSchema(
              formVersionData.schema,
            );
            labelsMap = { ...labelsMap, ...versionLabels };
          }
        }
      } catch (err) {
        this.logger.error(
          { err, campaignId },
          'Error crítico al resolver los diccionarios de versiones. Se usarán llaves técnicas.',
        );
      }
    }

    let campaignSlug = `campana_${campaignId.substring(0, 8)}`;

    try {
      const campaignData = await firstValueFrom(
        this.valkeyClient
          .send<any>('find-campaign', {
            campaignId,
            organizationId,
            researchId,
          })
          .pipe(
            timeout(4000),
            catchError((err) => {
              this.logger.warn(
                { campaignId, err: err.message },
                'Error al obtener la campaña vía Valkey. Usando slug genérico.',
              );
              return of(null);
            }),
          ),
      );

      if (campaignData?.name) {
        campaignSlug = campaignData.name.replace(/[^a-zA-Z0-9]/g, '_');
      }
    } catch (err: any) {
      this.logger.error(
        { err, campaignId },
        'Fallo crítico al resolver el nombre de la campaña. Usando slug genérico.',
      );
    }

    const workbook = new Excel4Node.Workbook({
      dateFormat: 'yyyy-mm-dd hh:mm:ss',
    });
    const worksheet = workbook.addWorksheet('Mediciones');

    const titleStyle = workbook.createStyle({
      fill: {
        type: 'pattern',
        patternType: 'solid',
        bgColor: '#C00000',
        fgColor: '#C00000',
      },
      font: { color: '#FFFFFF', bold: true },
      alignment: { wrapText: true, horizontal: 'center', vertical: 'center' },
    });

    const collectColumns = (
      records: Array<Record<string, unknown>>,
    ): string[] => {
      const seen = new Set<string>();
      const columns: string[] = [];
      for (const record of records) {
        if (!record) continue;
        for (const key of Object.keys(record)) {
          if (!seen.has(key)) {
            seen.add(key);
            columns.push(key);
          }
        }
      }
      return columns;
    };

    const rawHeaders = result.header as Record<string, Record<string, unknown>>;
    const headerColumns = collectColumns(Object.values(rawHeaders));
    const answerColumns = collectColumns(measurements.map((m) => m.answers));

    const columnsOrder = [
      ...headerColumns,
      ...answerColumns,
      'Usuario',
      'Formulario',
      'App',
      'GPS Latitud',
      'GPS Longitud',
      'Fecha Guardado BD',
      'Fecha Captura',
      'Fecha GPS',
      'Fecha Dispositivo',
      'Fecha Manual',
      'Fecha Servidor',
      'Origen Fecha Elegida',
      'UUID Registro',
    ];
    const maxColWidths = columnsOrder.map((col) => col.length);

    columnsOrder.forEach((colName, index) => {
      const friendlyName = labelsMap[colName] ?? colName;
      worksheet
        .cell(1, index + 1)
        .string(friendlyName)
        .style(titleStyle);
    });

    const groups = new Map<string, typeof measurements>();
    for (const measurement of measurements) {
      const group = groups.get(measurement.measurementId);
      if (group) {
        group.push(measurement);
      } else {
        groups.set(measurement.measurementId, [measurement]);
      }
    }

    let currentRow = 2;
    let archiveZip: ZipArchive | null = null;
    const archivesInZip = new Set<string>();

    for (const [measurementId, groupRows] of groups) {
      const headerObj = rawHeaders[measurementId] ?? {};

      for (let index = 0; index < groupRows.length; index++) {
        const measurement = groupRows[index];
        const user = measurement.user;
        const nombreCompleto =
          user && (user.firstName || user.lastName)
            ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
            : 'Usuario Desconocido';

        let currentCol = 1;

        for (const colName of headerColumns) {
          const rawValue = headerObj[colName];
          let cellValue = this.formatCellValueForExcel(rawValue);

          if (typeof rawValue === 'string' && rawValue.includes('/image/')) {
            const parts = rawValue.split('/');
            const extractedImageId = parts[parts.length - 1];
            const localImagePath = path.join(
              this.baseUploadPath,
              organizationId,
              researchId,
              campaignId,
              measurementId,
              `${extractedImageId}.jpeg`,
            );

            if (
              fs.existsSync(localImagePath) &&
              fs.lstatSync(localImagePath).isFile()
            ) {
              const relativePathInZip = path.join(
                'archivos',
                `${extractedImageId}.jpeg`,
              );
              if (!archiveZip) {
                archiveZip = new ZipArchive({ zlib: { level: 9 } });
                archiveZip.on('error', (err) => {
                  this.logger.error(
                    { err },
                    'Error durante la compresión del ZIP de imágenes',
                  );
                  throw err;
                });
              }
              if (!archivesInZip.has(relativePathInZip)) {
                archiveZip.file(localImagePath, { name: relativePathInZip });
                archivesInZip.add(relativePathInZip);
              }
              cellValue = `${extractedImageId}.jpeg`;
            } else {
              cellValue = 'Archivo no disponible';
            }
          }

          worksheet.cell(currentRow, currentCol).string(cellValue);
          maxColWidths[currentCol - 1] = Math.max(
            maxColWidths[currentCol - 1],
            cellValue.length,
          );
          currentCol++;
        }

        for (const colName of answerColumns) {
          const rawValue = measurement.answers[colName];
          let cellValue = this.formatCellValueForExcel(rawValue);

          if (typeof rawValue === 'string' && rawValue.includes('/image/')) {
            const parts = rawValue.split('/');
            const extractedImageId = parts[parts.length - 1];
            const localImagePath = path.join(
              this.baseUploadPath,
              organizationId,
              researchId,
              campaignId,
              measurement.measurementId,
              `${extractedImageId}.jpeg`,
            );

            if (
              fs.existsSync(localImagePath) &&
              fs.lstatSync(localImagePath).isFile()
            ) {
              const relativePathInZip = path.join(
                'archivos',
                `${extractedImageId}.jpeg`,
              );
              if (!archiveZip) {
                archiveZip = new ZipArchive({ zlib: { level: 9 } });
                archiveZip.on('error', (err) => {
                  this.logger.error(
                    { err },
                    'Error durante la compresión del ZIP de imágenes',
                  );
                  throw err;
                });
              }
              if (!archivesInZip.has(relativePathInZip)) {
                archiveZip.file(localImagePath, { name: relativePathInZip });
                archivesInZip.add(relativePathInZip);
              }
              cellValue = `${extractedImageId}.jpeg`;
            } else {
              cellValue = 'Archivo no disponible';
            }
          }

          worksheet.cell(currentRow, currentCol).string(cellValue);
          maxColWidths[currentCol - 1] = Math.max(
            maxColWidths[currentCol - 1],
            cellValue.length,
          );
          currentCol++;
        }

        worksheet.cell(currentRow, currentCol).string(nombreCompleto);
        maxColWidths[currentCol - 1] = Math.max(
          maxColWidths[currentCol - 1],
          nombreCompleto.length,
        );
        currentCol++;

        const currentVersion = measurement.formVersion ? `v${measurement.formVersion}` : 'v1.0';
        worksheet.cell(currentRow, currentCol).string(currentVersion);
        maxColWidths[currentCol - 1] = Math.max(
          maxColWidths[currentCol - 1],
          currentVersion.length,
        );
        currentCol++;

        const dev = (measurement as any).device ?? (measurement.meta as any)?.device;
        const os = (dev?.os ? String(dev.os) : '').toLowerCase();
        const isIos =
          os.includes('ios') ||
          os.includes('iphone') ||
          os.includes('ipad') ||
          (dev?.brand ? String(dev.brand).toLowerCase().includes('apple') : false);
        const appVersion =
          dev?.appVersion ??
          (measurement.meta as any)?.appVersion ??
          (measurement.meta as any)?.device?.appVersion ??
          '1.0.0';
        const formattedAppVer = String(appVersion).startsWith('v')
          ? String(appVersion)
          : `v${appVersion}`;
        const deviceDisplay = isIos
          ? `iOS ${formattedAppVer}`
          : `Android ${formattedAppVer}`;

        worksheet.cell(currentRow, currentCol).string(deviceDisplay);
        maxColWidths[currentCol - 1] = Math.max(
          maxColWidths[currentCol - 1],
          deviceDisplay.length,
        );
        currentCol++;

        const latitudeVal = measurement.meta?.location?.latitude;
        const latitudeStr =
          latitudeVal !== undefined && latitudeVal !== null
            ? String(latitudeVal)
            : '';
        worksheet.cell(currentRow, currentCol).string(latitudeStr);
        maxColWidths[currentCol - 1] = Math.max(
          maxColWidths[currentCol - 1],
          latitudeStr.length,
        );
        currentCol++;

        const longitudeVal = measurement.meta?.location?.longitude;
        const longitudeStr =
          longitudeVal !== undefined && longitudeVal !== null
            ? String(longitudeVal)
            : '';
        worksheet.cell(currentRow, currentCol).string(longitudeStr);
        maxColWidths[currentCol - 1] = Math.max(
          maxColWidths[currentCol - 1],
          longitudeStr.length,
        );
        currentCol++;

        const formatTz = (isoStr: string | null | undefined): string => {
          if (!isoStr) return '';
          const dt = DateTime.fromISO(isoStr, { zone: 'utc' });
          return dt.isValid
            ? dt.setZone(tz).toFormat('yyyy-MM-dd HH:mm:ss')
            : '';
        };

        const savedAtStr = formatTz(
          (measurement as any).savedAt ?? measurement.createdAt,
        );
        worksheet.cell(currentRow, currentCol).string(savedAtStr);
        maxColWidths[currentCol - 1] = Math.max(
          maxColWidths[currentCol - 1],
          savedAtStr.length,
        );
        currentCol++;

        const timestamps = measurement.meta?.timestamps;
        const resolvedKey = timestamps?.resolved;
        const resolvedTimestamp = resolvedKey && timestamps?.[resolvedKey];

        const timestampStr = formatTz(resolvedTimestamp);
        worksheet.cell(currentRow, currentCol).string(timestampStr);
        maxColWidths[currentCol - 1] = Math.max(
          maxColWidths[currentCol - 1],
          timestampStr.length,
        );
        currentCol++;

        const gpsStr = formatTz(timestamps?.gps);
        worksheet.cell(currentRow, currentCol).string(gpsStr);
        maxColWidths[currentCol - 1] = Math.max(
          maxColWidths[currentCol - 1],
          gpsStr.length,
        );
        currentCol++;

        const deviceStr = formatTz(timestamps?.device);
        worksheet.cell(currentRow, currentCol).string(deviceStr);
        maxColWidths[currentCol - 1] = Math.max(
          maxColWidths[currentCol - 1],
          deviceStr.length,
        );
        currentCol++;

        const manualStr = formatTz(timestamps?.manual);
        worksheet.cell(currentRow, currentCol).string(manualStr);
        maxColWidths[currentCol - 1] = Math.max(
          maxColWidths[currentCol - 1],
          manualStr.length,
        );
        currentCol++;

        const serverStr = formatTz(timestamps?.server);
        worksheet.cell(currentRow, currentCol).string(serverStr);
        maxColWidths[currentCol - 1] = Math.max(
          maxColWidths[currentCol - 1],
          serverStr.length,
        );
        currentCol++;

        const origenElegido = resolvedKey ?? '';
        worksheet.cell(currentRow, currentCol).string(origenElegido);
        maxColWidths[currentCol - 1] = Math.max(
          maxColWidths[currentCol - 1],
          origenElegido.length,
        );
        currentCol++;

        worksheet.cell(currentRow, currentCol).string(measurement.id);
        maxColWidths[currentCol - 1] = Math.max(
          maxColWidths[currentCol - 1],
          measurement.id.length,
        );

        currentRow++;
      }
    }

    maxColWidths.forEach((width, index) => {
      const calculatedWidth = Math.min(Math.max(width * 1.2, 10), 50);
      worksheet.column(index + 1).setWidth(calculatedWidth);
    });

    const filenameTimestamp = DateTime.now()
      .setZone(tz)
      .toFormat('yyyyMMddHHmm');
    const excelBuffer = (await workbook.writeToBuffer()) as Buffer;

    if (archiveZip) {
      archiveZip.append(excelBuffer, { name: `${campaignSlug}.xlsx` });
      return {
        type: 'zip',
        archive: archiveZip,
        filename: `${campaignSlug}-${filenameTimestamp}.zip`,
      };
    }

    return {
      type: 'xlsx',
      buffer: excelBuffer,
      filename: `${campaignSlug}-${filenameTimestamp}.xlsx`,
    };
  }

  /**
   * Devuelve, agrupadas por usuario, todas las ubicaciones capturadas en el
   * rango/filtros dados basándose en el timestamp resuelto por negocio.
   */
  async getLocations(
    {
      organizationId,
      researchId,
      campaignId,
    }: { organizationId: string; researchId: string; campaignId: string },
    query: QueryLocationsDto,
  ): Promise<Array<{ user: ResolvedUser; locations: LocationPoint[] }>> {
    const userIds =
      query.userId && query.userId.length > 0 ? query.userId : null;
    const dateFrom = query.dateFrom
      ? toStartOfDayIfDateOnly(query.dateFrom)
      : null;
    const dateTo = query.dateTo ? toEndOfDayIfDateOnly(query.dateTo) : null;

    this.logger.info(
      { organizationId, researchId, campaignId, userIds, dateFrom, dateTo },
      'Fetching locations for given filters',
    );
    this.logger.info(query);

    const rows = await this.prisma.$queryRaw<LocationRow[]>`
      SELECT
        m.user_id AS "userId",
        (elem.value->'meta'->'location'->>'latitude')::float8 AS lat,
        (elem.value->'meta'->'location'->>'longitude')::float8 AS lon,
        (elem.value #>> array['meta', 'timestamps', elem.value->'meta'->'timestamps'->>'resolved']) AS date
      FROM measurement m,
      LATERAL jsonb_array_elements(m.body) AS elem(value)
      WHERE m.organization_id = ${organizationId}::uuid
        AND m.research_id = ${researchId}::uuid
        AND m.campaign_id = ${campaignId}::uuid
        AND m.deleted_at IS NULL
        AND (elem.value->>'deletedAt') IS NULL
        AND (${userIds}::uuid[] IS NULL OR m.user_id = ANY(${userIds}::uuid[]))
        AND elem.value->'meta'->'location'->>'latitude' IS NOT NULL
        AND elem.value->'meta'->'location'->>'longitude' IS NOT NULL
        AND (
          ${dateFrom}::timestamptz IS NULL
          OR (elem.value #>> array['meta', 'timestamps', elem.value->'meta'->'timestamps'->>'resolved'])::timestamptz >= ${dateFrom}::timestamptz
        )
        AND (
          ${dateTo}::timestamptz IS NULL
          OR (elem.value #>> array['meta', 'timestamps', elem.value->'meta'->'timestamps'->>'resolved'])::timestamptz <= ${dateTo}::timestamptz
        )
      ORDER BY m.user_id, (elem.value #>> array['meta', 'timestamps', elem.value->'meta'->'timestamps'->>'resolved'])::timestamptz ASC
    `;

    const grouped = new Map<string, LocationPoint[]>();

    for (const row of rows) {
      const points = grouped.get(row.userId);
      const point: LocationPoint = {
        lat: row.lat,
        lon: row.lon,
        date: row.date,
      };

      if (points) {
        points.push(point);
      } else {
        grouped.set(row.userId, [point]);
      }
    }

    const usersById = await this.getUsersMap([...grouped.keys()]);

    return [...grouped.entries()].map(([userId, locations]) => ({
      user: this.toResolvedUser(userId, usersById.get(userId)),
      locations,
    }));
  }

  /**
   * Devuelve un resumen agrupado por el criterio solicitado, filtrando por el path context.
   */
  async getSummary(
    ids: { organizationId: string; researchId: string; campaignId: string },
    query: GetSummaryQueryDto,
  ) {
    const { organizationId, researchId, campaignId } = ids;
    const { groupBy, dateFrom, dateTo, userId, timezone } = query;
    const tz = timezone ?? 'UTC';

    const resolvedTimestampExpr = `(elem.value #>> array['meta', 'timestamps', elem.value->'meta'->'timestamps'->>'resolved'])`;

    const filters: string[] = [
      `m.organization_id = '${organizationId}'::uuid`,
      `m.research_id = '${researchId}'::uuid`,
      `m.campaign_id = '${campaignId}'::uuid`,
      `m.deleted_at IS NULL`,
      `(elem.value->>'deletedAt') IS NULL`,
    ];

    if (dateFrom) {
      filters.push(
        `${resolvedTimestampExpr}::timestamptz >= '${dateFrom}'::timestamptz`,
      );
    }
    if (dateTo) {
      filters.push(
        `${resolvedTimestampExpr}::timestamptz <= '${dateTo}'::timestamptz`,
      );
    }

    if (userId && userId.length > 0) {
      const escapedUserIds = userId.map((id) => `'${id}'`).join(',');
      filters.push(`m.user_id::text IN (${escapedUserIds})`);
    }

    const whereClause = `WHERE ${filters.join(' AND ')}`;
    let selectGroupExpr = '';

    switch (groupBy) {
      case SummaryGrouping.USER:
        selectGroupExpr = `m.user_id::text`;
        break;
      case SummaryGrouping.MONTH:
        selectGroupExpr = `to_char(date_trunc('month', ${resolvedTimestampExpr}::timestamptz AT TIME ZONE '${tz}'), 'YYYY-MM')`;
        break;
      case SummaryGrouping.DAY:
        selectGroupExpr = `to_char(date_trunc('day', ${resolvedTimestampExpr}::timestamptz AT TIME ZONE '${tz}'), 'YYYY-MM-DD')`;
        break;
      case SummaryGrouping.HOUR:
        selectGroupExpr = `to_char(date_trunc('hour', ${resolvedTimestampExpr}::timestamptz AT TIME ZONE '${tz}'), 'YYYY-MM-DD HH24:00')`;
        break;
      default:
        throw new BadRequestException('Agrupación no válida');
    }

    const rawData = await this.prisma.$queryRawUnsafe<SummaryRawResult[]>(`
      SELECT 
        ${selectGroupExpr} AS group_key,
        COUNT(*)::int AS total_measurements
      FROM "measurement" m,
      LATERAL jsonb_array_elements(m.body) AS elem
      ${whereClause}
      GROUP BY group_key
      ORDER BY group_key ASC;
    `);

    if (groupBy === SummaryGrouping.USER) {
      return this.enrichUserSummary(rawData);
    }

    return rawData.map((row) => ({
      [groupBy]: row.group_key,
      count: row.total_measurements,
    }));
  }

  /**
   * Resuelve los datos de perfil de usuario utilizando el cliente de Valkey local del servicio
   */
  private async enrichUserSummary(rawData: SummaryRawResult[]) {
    const userIds = rawData.map((r) => r.group_key);
    if (userIds.length === 0) return [];

    const usersById = await this.getUsersMap(userIds);

    return rawData.map((row) => {
      const user = this.toResolvedUser(
        row.group_key,
        usersById.get(row.group_key),
      );
      return {
        user,
        count: row.total_measurements,
      };
    });
  }

  async getUsers(
    ids: { researchId: string; campaignId: string },
    query: QueryUsersDto,
  ): Promise<ResolvedUser[]> {
    const { researchId, campaignId } = ids;
    const { dateFrom, dateTo } = query;

    const filterDateFrom = dateFrom ? toStartOfDayIfDateOnly(dateFrom) : null;
    const filterDateTo = dateTo ? toEndOfDayIfDateOnly(dateTo) : null;

    const rawUsers = await this.prisma.$queryRaw<{ user_id: string }[]>`
      SELECT DISTINCT 
        m.user_id::text AS user_id
      FROM measurement m,
      LATERAL jsonb_array_elements(m.body) AS elem(value)
      WHERE m.research_id = ${researchId}::uuid
        AND m.campaign_id = ${campaignId}::uuid
        AND m.deleted_at IS NULL
        AND (elem.value->>'deletedAt') IS NULL
        AND (
          ${filterDateFrom}::timestamptz IS NULL 
          OR (elem.value #>> array['meta', 'timestamps', elem.value->'meta'->'timestamps'->>'resolved'])::timestamptz >= ${filterDateFrom}::timestamptz
        )
        AND (
          ${filterDateTo}::timestamptz IS NULL 
          OR (elem.value #>> array['meta', 'timestamps', elem.value->'meta'->'timestamps'->>'resolved'])::timestamptz <= ${filterDateTo}::timestamptz
        )
      ORDER BY user_id ASC
    `;

    const distinctUserIds = rawUsers.map((r) => r.user_id);
    if (distinctUserIds.length === 0) return [];

    const usersById = await this.getUsersMap(distinctUserIds);

    return distinctUserIds.map((id) =>
      this.toResolvedUser(id, usersById.get(id)),
    );
  }

  /**
   * Obtiene resumen de mediciones para múltiples estudios/campañas a nivel organización.
   */
  async getOrganizationSummary(
    organizationId: string,
    query: OrganizationSummaryQueryDto,
  ) {
    const { researchIds, campaignIds, groupBy, dateFrom, dateTo, timezone } =
      query;
    const tz = timezone ?? 'UTC';

    const filterDateFrom = dateFrom ? toStartOfDayIfDateOnly(dateFrom) : null;
    const filterDateTo = dateTo ? toEndOfDayIfDateOnly(dateTo) : null;
    const rIds = researchIds && researchIds.length > 0 ? researchIds : null;
    const cIds = campaignIds && campaignIds.length > 0 ? campaignIds : null;

    const resolvedTimestampExpr = `(elem.value #>> array['meta', 'timestamps', elem.value->'meta'->'timestamps'->>'resolved'])`;

    let selectGroupExpr = '';
    switch (groupBy) {
      case SummaryGrouping.USER:
        selectGroupExpr = `m.user_id::text`;
        break;
      case SummaryGrouping.MONTH:
        selectGroupExpr = `to_char(date_trunc('month', ${resolvedTimestampExpr}::timestamptz AT TIME ZONE '${tz}'), 'YYYY-MM')`;
        break;
      case SummaryGrouping.DAY:
        selectGroupExpr = `to_char(date_trunc('day', ${resolvedTimestampExpr}::timestamptz AT TIME ZONE '${tz}'), 'YYYY-MM-DD')`;
        break;
      case SummaryGrouping.HOUR:
        selectGroupExpr = `to_char(date_trunc('hour', ${resolvedTimestampExpr}::timestamptz AT TIME ZONE '${tz}'), 'YYYY-MM-DD HH24:00')`;
        break;
      default:
        throw new BadRequestException('Agrupación no válida');
    }

    const filters: string[] = [
      `m.organization_id = '${organizationId}'::uuid`,
      `m.deleted_at IS NULL`,
      `(elem.value->>'deletedAt') IS NULL`,
    ];

    if (rIds) {
      const escapedResearchIds = rIds.map((id) => `'${id}'`).join(',');
      filters.push(`m.research_id::text IN (${escapedResearchIds})`);
    }

    if (cIds) {
      const escapedCampaignIds = cIds.map((id) => `'${id}'`).join(',');
      filters.push(`m.campaign_id::text IN (${escapedCampaignIds})`);
    }

    if (filterDateFrom) {
      filters.push(
        `${resolvedTimestampExpr}::timestamptz >= '${filterDateFrom.toISOString()}'::timestamptz`,
      );
    }

    if (filterDateTo) {
      filters.push(
        `${resolvedTimestampExpr}::timestamptz <= '${filterDateTo.toISOString()}'::timestamptz`,
      );
    }

    const whereClause = `WHERE ${filters.join(' AND ')}`;

    const rawData = await this.prisma.$queryRawUnsafe<
      Array<{
        research_id: string;
        campaign_id: string;
        group_key: string;
        total_measurements: number;
      }>
    >(`
      SELECT 
        m.research_id::text AS research_id,
        m.campaign_id::text AS campaign_id,
        ${selectGroupExpr} AS group_key,
        COUNT(*)::int AS total_measurements
      FROM "measurement" m,
      LATERAL jsonb_array_elements(m.body) AS elem
      ${whereClause}
      GROUP BY m.research_id, m.campaign_id, group_key
      ORDER BY m.research_id, m.campaign_id, group_key ASC;
    `);

    if (groupBy === SummaryGrouping.USER) {
      const userIds = [...new Set(rawData.map((r) => r.group_key))];
      const usersById = await this.getUsersMap(userIds);
      return rawData.map((row) => ({
        researchId: row.research_id,
        campaignId: row.campaign_id,
        groupKey: row.group_key,
        user: this.toResolvedUser(row.group_key, usersById.get(row.group_key)),
        count: row.total_measurements,
      }));
    }

    return rawData.map((row) => ({
      researchId: row.research_id,
      campaignId: row.campaign_id,
      groupKey: row.group_key,
      count: row.total_measurements,
    }));
  }
}
