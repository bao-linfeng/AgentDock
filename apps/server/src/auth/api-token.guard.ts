import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SERVER_CONFIG } from '../config/config.module.js';
import type { ServerConfig } from '../config/env.js';
import { extractToken, tokensMatch } from './token.js';

/**
 * Guards every human-facing (Web console) route with `API_AUTH_TOKEN`.
 *
 * The Control Server is reachable from the public internet through the tunnel,
 * so all non-health routes must be gated (docs/architecture.md §14).
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(@Inject(SERVER_CONFIG) private readonly config: ServerConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = extractToken(request);
    if (!token || !tokensMatch(token, this.config.apiAuthToken)) {
      throw new UnauthorizedException('invalid or missing API token');
    }
    return true;
  }
}
