import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export const User = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): IKeycloakUser => {
    const request = ctx.switchToHttp().getRequest<Request>();

    return {
      id: request.headers['x-user-id'] as string,
      email: request.headers['x-user-email'] as string | undefined,
      username: request.headers['x-username'] as string | undefined,
      name: request.headers['x-user-name'] as string | undefined,
    };
  },
);
