// src/modules/measurement/measurement.controller.ts

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { PinoLogger } from 'pino-nestjs';
import { User } from '@src/common/decorators/user.decorator';
import { MeasurementService, type MulterFile } from './measurement.service';
import { CreateMeasurementDto } from './dto/create-measurement.dto';
import { QueryMeasurementDto } from './dto/query-measurement.dto';
import { QueryLocationsDto } from './dto/query-locations.dto';
import { GetSummaryQueryDto } from './dto/get-summary-query.dto';
import { QueryUsersDto } from './dto/query-users.dto';

// Interfaz para tipar localmente el usuario de Keycloak si no está global.
// El índice usa `unknown` en vez de `any`: solo leemos `.id` acá, así que
// no hace falta abrir la puerta a cualquier tipo para el resto de claims.
interface IKeycloakUser {
  id: string;
  [key: string]: unknown;
}

/**
 * Shape crudo de lo que llega en un POST multipart/form-data: multer entrega
 * todos los campos de texto como string (incluso los que semánticamente son
 * JSON), así que `header`/`body` pueden llegar como string sin parsear o,
 * si en algún momento este mismo DTO se reusa fuera de multipart, ya vengan
 * como objeto/array.
 */
interface RawMeasurementMultipartBody {
  formVersion?: string;
  header?: string | Record<string, unknown>;
  body?: string | Record<string, unknown>[];
  meta?: string | Record<string, unknown>;
}

/**
 * Parsea un campo que puede llegar como JSON serializado (string, típico de
 * multipart/form-data) o ya parseado. Nunca deja pasar un JSON.parse sin
 * controlar: un valor malformado del cliente debe traducirse en un 400
 * claro, no en un 500 por una excepción de SyntaxError sin capturar.
 */
function parseJsonField<T>(raw: unknown, fieldName: string): T {
  if (raw === undefined || raw === null) {
    throw new BadRequestException(`El campo "${fieldName}" es requerido.`);
  }

  if (typeof raw !== 'string') {
    return raw as T;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new BadRequestException(
      `El campo "${fieldName}" no contiene un JSON válido.`,
    );
  }
}

@Controller('measurement/:organizationId/:researchId/:campaignId')
export class MeasurementController {
  constructor(
    private readonly measurementService: MeasurementService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MeasurementController.name);
  }

  /**
   * Sirve los recursos de imagen en tiempo real para el resumen web.
   */
  @Get('image/:measurementId/:imageId')
  getImage(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('researchId', ParseUUIDPipe) researchId: string,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('measurementId', ParseUUIDPipe) measurementId: string,
    @Param('imageId') imageId: string,
    @Res() res: Response,
  ): void {
    const stream = this.measurementService.getImageStream({
      organizationId,
      researchId,
      campaignId,
      measurementId,
      imageId,
    });

    res.setHeader('Content-Type', 'image/jpeg');

    // Antes no había manejo de error del stream: si el archivo se corrompe
    // o se borra entre el chequeo de existencia y el pipe (race condition),
    // el error del stream quedaba sin capturar. `setHeader` todavía no
    // envía nada al cliente, así que `headersSent` es un chequeo seguro
    // antes de intentar responder con un status de error.
    stream.on('error', (err) => {
      this.logger.error(
        { err, organizationId, researchId, campaignId, measurementId, imageId },
        'Error leyendo el stream de la imagen',
      );
      if (!res.headersSent) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).end();
      } else {
        res.end();
      }
    });

    stream.pipe(res);
  }

  @Get('export')
  async exportExcel(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('researchId', ParseUUIDPipe) researchId: string,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Query() query: QueryMeasurementDto,
    @Res() res: Response,
  ): Promise<void> {
    this.logger.info(
      `Exporting measurements for campaignId: ${campaignId}, researchId: ${researchId}, organizationId: ${organizationId}`,
    );

    // Obtenemos el objeto de exportación (que contiene el Buffer/Stream y el tipo)
    const exportResult = await this.measurementService.exportExcel(
      { organizationId, researchId, campaignId },
      query,
    );

    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    if (exportResult.type === 'zip') {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${exportResult.filename}"`,
      );

      // 1. Pipeamos el flujo del ZIP directamente a la respuesta de Express
      exportResult.archive.pipe(res);

      // 2. Finalizamos el archivo (esto le dice a 'archiver' que empiece a empaquetar y cerrar el flujo)
      await exportResult.archive.finalize();
    } else {
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${exportResult.filename}"`,
      );

      res.send(exportResult.buffer);
    }
  }

  @Get('locations')
  getLocations(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('researchId', ParseUUIDPipe) researchId: string,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Query() query: QueryLocationsDto,
  ) {
    return this.measurementService.getLocations(
      { organizationId, researchId, campaignId },
      query,
    );
  }

  @Get('summary')
  async getSummary(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('researchId', ParseUUIDPipe) researchId: string,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Query() query: GetSummaryQueryDto, // <-- Asegúrate de que este Dto esté bien importado y decorado
  ) {
    // Aquí puedes pasar opcionalmente los Ids del path al query si tu consulta los requiere en el WHERE
    return this.measurementService.getSummary(
      { organizationId, researchId, campaignId },
      query,
    );
  }

  /**
   * GET /researches/:researchId/campaigns/:campaignId/measurements/users
   * Obtiene los usuarios únicos de una campaña según el rango de fechas.
   */
  @Get('users')
  async getUsers(
    @Param('researchId', new ParseUUIDPipe({ version: '4' }))
    researchId: string,
    @Param('campaignId', new ParseUUIDPipe({ version: '4' }))
    campaignId: string,
    @Query() query: QueryUsersDto,
  ) {
    return this.measurementService.getUsers({ researchId, campaignId }, query);
  }

  @Get()
  findAll(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('researchId', ParseUUIDPipe) researchId: string,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Query() query: QueryMeasurementDto,
  ) {
    return this.measurementService.findAll(
      { organizationId, researchId, campaignId },
      query,
    );
  }

  @Get(':id')
  findOne(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('researchId', ParseUUIDPipe) researchId: string,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.measurementService.findOne({
      organizationId,
      researchId,
      campaignId,
      id,
    });
  }

  /**
   * Crea una medición (lote masivo) procesando y minificando todas las imágenes adjuntas.
   */
  @Post()
  @UseInterceptors(AnyFilesInterceptor())
  async create(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('researchId', ParseUUIDPipe) researchId: string,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() bodyPayload: RawMeasurementMultipartBody,
    @UploadedFiles() files: MulterFile[],
    @User() user: IKeycloakUser,
  ) {
    // formVersion es un campo VarChar requerido en Prisma — sin este check,
    // un multipart sin ese campo guardaría `undefined` silenciosamente
    // hasta que Prisma (o Postgres) fallen más abajo con un error menos claro.
    if (!bodyPayload.formVersion) {
      throw new BadRequestException('El campo "formVersion" es requerido.');
    }

    // Debido a que multipart/form-data envía objetos complejos como strings
    // de texto, los parseamos de forma segura (parseJsonField ya maneja el
    // caso de JSON malformado con un 400 en vez de una excepción cruda).
    //
    // El genérico usa `CreateMeasurementDto['header'|'body']` (el tipo real
    // declarado en el DTO) en vez de `Record<string, unknown>` — así queda
    // atado al shape real del DTO (id/answers/meta/createdAt en el caso de
    // body) y no se desincroniza si ese shape cambia ahí.
    const dto: CreateMeasurementDto = {
      formVersion: bodyPayload.formVersion,
      header: parseJsonField<CreateMeasurementDto['header']>(
        bodyPayload.header,
        'header',
      ),
      body: parseJsonField<CreateMeasurementDto['body']>(
        bodyPayload.body,
        'body',
      ),
      meta: parseJsonField<CreateMeasurementDto['meta']>(
        bodyPayload.meta,
        'meta',
      ),
    };

    return this.measurementService.createWithImages(
      { organizationId, researchId, campaignId },
      dto,
      files ?? [],
      user.id,
    );
  }

  @Delete(':measurementId/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('researchId', ParseUUIDPipe) researchId: string,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('measurementId', ParseUUIDPipe) measurementId: string,
    @Param('itemId') itemId: string, // no es UUID, es tipo "1786555889098-dyn5zx68"
  ) {
    return this.measurementService.remove({
      organizationId,
      researchId,
      campaignId,
      measurementId,
      itemId,
    });
  }
}
