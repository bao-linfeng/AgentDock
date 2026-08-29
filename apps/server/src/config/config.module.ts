import { Global, Module } from '@nestjs/common';
import { type ServerConfig, loadServerConfig } from './env.js';

/** DI token for the validated `ServerConfig`. */
export const SERVER_CONFIG = 'SERVER_CONFIG';

/**
 * Global config module. Providers are declared with explicit `@Inject(...)`
 * tokens throughout the server so DI never depends on `emitDecoratorMetadata`
 * (esbuild-based runners such as `tsx` / vitest do not emit it).
 */
@Global()
@Module({
  providers: [{ provide: SERVER_CONFIG, useFactory: (): ServerConfig => loadServerConfig() }],
  exports: [SERVER_CONFIG],
})
export class ConfigModule {}
