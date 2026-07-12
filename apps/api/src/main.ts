import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

if (!('crypto' in globalThis)) {
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID },
    configurable: true,
  });
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  await app.listen(3000);
}

void bootstrap();
