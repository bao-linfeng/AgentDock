import { Global, Module } from '@nestjs/common';
import { ApiTokenGuard } from './api-token.guard.js';
import { RunnerTokenGuard } from './runner-token.guard.js';

/**
 * AuthModule — MVP token authentication (no users table, confirmed decision in
 * docs/architecture.md §7). Exposes two guards: one for the Web API and one for
 * the Runner Gateway.
 */
@Global()
@Module({
  providers: [ApiTokenGuard, RunnerTokenGuard],
  exports: [ApiTokenGuard, RunnerTokenGuard],
})
export class AuthModule {}
