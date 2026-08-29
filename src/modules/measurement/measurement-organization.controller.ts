// src/modules/measurement/measurement-organization.controller.ts

import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { PinoLogger } from 'pino-nestjs';
import { MeasurementService } from './measurement.service';
import { OrganizationSummaryQueryDto } from './dto/organization-summary-query.dto';

@Controller('measurement/:organizationId')
export class MeasurementOrganizationController {
  constructor(
    private readonly measurementService: MeasurementService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MeasurementOrganizationController.name);
  }

  @Get('organization-summary')
  async getOrganizationSummaryGet(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query() query: OrganizationSummaryQueryDto,
  ) {
    this.logger.info(
      { organizationId, query },
      'Fetching organization summary (GET)',
    );
    return this.measurementService.getOrganizationSummary(
      organizationId,
      query,
    );
  }

  @Post('organization-summary')
  async getOrganizationSummaryPost(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: OrganizationSummaryQueryDto,
  ) {
    this.logger.info(
      { organizationId, dto },
      'Fetching organization summary (POST)',
    );
    return this.measurementService.getOrganizationSummary(
      organizationId,
      dto,
    );
  }
}
