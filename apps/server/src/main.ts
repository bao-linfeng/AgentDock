import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ConfigError, loadServerConfig } from './config/env.js';

/** Load `apps/server/.env` when present (no dotenv dependency needed). */
function loadEnvFile(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    new Logger('bootstrap').warn(`could not read ${envPath}: ${String(error)}`);
  }
}

async function bootstrap(): Promise<void> {
  loadEnvFile();
  const logger = new Logger('bootstrap');

  // Fail fast on a bad configuration instead of exposing weak tokens.
  const config = loadServerConfig();

  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: config.corsOrigins ?? true });
  app.enableShutdownHooks();
  await app.listen(config.port);
  logger.log(`agentdock-server listening on http://localhost:${config.port}`);
}

void bootstrap().catch((error) => {
  const logger = new Logger('bootstrap');
  if (error instanceof ConfigError) {
    logger.error(error.message);
  } else {
    logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  }
  process.exitCode = 1;
});
