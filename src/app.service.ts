import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  findAll(): string[] {
    return ['cache', 'interceptor', 'example'];
  }

  getHello(): string {
    return 'Hello World!';
  }
}
