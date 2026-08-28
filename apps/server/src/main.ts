import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[agentdock-server] listening on http://localhost:${port}`);
}

void bootstrap();
