import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

type ApiError = {
  code: string;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isApiErrorArray(value: unknown): value is ApiError[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.code === 'string' &&
        typeof item.message === 'string',
    )
  );
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();

    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;

    let errors: ApiError[] = [];

    if (isRecord(exceptionResponse)) {
      const candidateErrors = exceptionResponse.errors;

      if (isApiErrorArray(candidateErrors)) {
        errors = candidateErrors;
      } else if (
        typeof exceptionResponse.code === 'string' &&
        typeof exceptionResponse.message === 'string'
      ) {
        errors = [
          {
            code: exceptionResponse.code,
            message: exceptionResponse.message,
          },
        ];
      } else if (Array.isArray(exceptionResponse.message)) {
        errors = exceptionResponse.message
          .filter((message): message is string => typeof message === 'string')
          .map((message) => ({
            code: 'VALIDATION_ERROR',
            message,
          }));
      } else if (typeof exceptionResponse.message === 'string') {
        errors = [
          {
            code: 'HTTP_ERROR',
            message: exceptionResponse.message,
          },
        ];
      }
    }

    if (errors.length === 0) {
      errors = [
        {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error interno del servidor.',
        },
      ];
    }

    response.status(status).json({
      statusCode: status,
      errors,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    });
  }
}
