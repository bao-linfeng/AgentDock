import { normalizeGitHubEvent } from '@agentdock/github-adapter';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { SERVER_CONFIG } from '../config/config.module.js';
import type { ServerConfig } from '../config/env.js';
import { PrismaService, isUniqueConstraintError } from '../prisma/prisma.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { verifyGitHubSignature } from './webhook-signature.js';
import {
  type GitHubWebhookHeaders,
  type WebhookResult,
  isSupportedGitHubEvent,
} from './webhook.dto.js';

/**
 * Handles inbound `POST /github/webhook` deliveries (T6.2).
 *
 * Order of operations matters for security and idempotency:
 *  1. Verify `X-Hub-Signature-256` against the raw body — reject before doing
 *     anything else (docs/architecture.md §14: the endpoint is reachable from
 *     the public internet through the tunnel).
 *  2. Dedupe by `X-GitHub-Delivery` — GitHub retries deliveries on timeouts /
 *     non-2xx responses, so the same delivery id may arrive more than once
 *     (docs/tasks.md T9.3, requirements.md §6).
 *  3. Only then parse/normalize the payload and create a task.
 */
@Injectable()
export class GitHubWebhookService {
  private readonly logger = new Logger(GitHubWebhookService.name);

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TasksService) private readonly tasks: TasksService,
  ) {}

  /**
   * @param rawBody Exact bytes of the request body (required for HMAC — a
   *   re-serialized JSON object would not match GitHub's signature).
   */
  async handle(
    rawBody: Buffer | undefined,
    headers: GitHubWebhookHeaders,
    payload: unknown,
  ): Promise<WebhookResult> {
    const secret = this.config.github.webhookSecret;
    if (!secret) {
      // Fail closed: an unconfigured secret must never accept unsigned input.
      throw new UnauthorizedException('GitHub webhook secret is not configured');
    }
    if (!rawBody) {
      throw new BadRequestException('missing request body');
    }
    if (!verifyGitHubSignature(rawBody, headers.signature256, secret)) {
      throw new UnauthorizedException('invalid webhook signature');
    }

    // `ping` (and any other event we don't model) is accepted-but-ignored: a
    // valid signature already proves the sender is GitHub, so respond 2xx
    // rather than making GitHub retry an event we intentionally don't handle.
    if (!isSupportedGitHubEvent(headers.event)) {
      return { status: 'ignored', reason: `unsupported event: ${headers.event ?? 'unknown'}` };
    }

    if (headers.deliveryId) {
      const existing = await this.prisma.task.findUnique({
        where: { deliveryId: headers.deliveryId },
      });
      if (existing) {
        return { status: 'deduplicated', taskId: existing.id };
      }
    }

    const repoFullName = extractRepoFullName(payload);
    const project = repoFullName ? await this.findProjectForRepo(repoFullName) : null;
    if (!project) {
      return {
        status: 'ignored',
        reason: repoFullName
          ? `no project bound to repository ${repoFullName}`
          : 'payload missing repository',
      };
    }

    const allowlist = this.config.github.actorAllowlist;
    const normalized = normalizeGitHubEvent(headers.event, payload, { allowlist });
    if (!normalized) {
      return { status: 'ignored', reason: 'no actionable mention found' };
    }

    try {
      const result = await this.tasks.create({
        projectId: project.id,
        source: 'github',
        sourceRef: normalized.sourceRef,
        deliveryId: headers.deliveryId,
        intent: normalized.intent,
        prompt: normalized.prompt,
        createdBy: normalized.actor,
        callbackRepo: normalized.callbackRepo,
        callbackIssueNumber: normalized.callbackIssueNumber,
        callbackIsPullRequest: normalized.callbackIsPullRequest,
      });
      return {
        status: result.deduplicated ? 'deduplicated' : 'accepted',
        taskId: result.task.id,
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        // Lost a race against a concurrent delivery of the same event.
        this.logger.warn(`dedupe race on delivery ${headers.deliveryId ?? '(none)'}`);
        return { status: 'deduplicated' };
      }
      throw error;
    }
  }

  private async findProjectForRepo(fullName: string): Promise<{ id: string } | null> {
    const [owner, repo] = fullName.split('/', 2);
    if (!owner || !repo) return null;
    const repository = await this.prisma.repository.findUnique({
      where: { provider_owner_repo: { provider: 'github', owner, repo } },
      select: { projectId: true },
    });
    return repository ? { id: repository.projectId } : null;
  }
}

function extractRepoFullName(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const repository = (payload as { repository?: { full_name?: unknown } }).repository;
  const fullName = repository?.full_name;
  return typeof fullName === 'string' && fullName.length > 0 ? fullName : null;
}
