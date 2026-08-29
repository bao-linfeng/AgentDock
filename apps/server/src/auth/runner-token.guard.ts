import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { Runner } from '@prisma/client';
import { SERVER_CONFIG } from '../config/config.module.js';
import type { ServerConfig } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { extractToken, hashToken, tokensMatch } from './token.js';

/** Request shape after a successful runner authentication. */
export interface RunnerAuthenticatedRequest {
  runnerToken: string;
  /** `null` until the runner has registered itself (`POST /runner/register`). */
  runner: Runner | null;
}

/**
 * Guards the Runner Gateway with `RUNNER_TOKEN`.
 *
 * A runner row is looked up by `token_hash` so a token can be revoked from the
 * Web API (`POST /runners/:id/revoke`) without restarting the server
 * (docs/requirements.md §10 "Runner Token 独立且可撤销").
 */
@Injectable()
export class RunnerTokenGuard implements CanActivate {
  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = extractToken(request);
    if (!token || !tokensMatch(token, this.config.runnerToken)) {
      throw new UnauthorizedException('invalid or missing runner token');
    }

    const runner = await this.prisma.runner.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (runner?.revoked) {
      throw new UnauthorizedException('runner token has been revoked');
    }

    request.runnerToken = token;
    request.runner = runner ?? null;
    return true;
  }
}

/** Injects the authenticated (registered) runner, or `null` before registration. */
export const CurrentRunner = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest();
  return (request.runner ?? null) as Runner | null;
});

/** Injects the raw runner token (needed to derive `token_hash` on register). */
export const RunnerToken = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest();
  return request.runnerToken as string;
});
