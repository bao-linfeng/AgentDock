import { redactSecrets } from '@agentdock/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuditLog, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AuditAction,
  AuditLogDto,
  AuditLogInput,
  AuditSource,
  ListAuditLogsQuery,
} from './audit.dto.js';

/** Prompts can be long; the audit trail keeps a bounded excerpt. */
const PROMPT_EXCERPT_LENGTH = 500;

export function auditPromptExcerpt(prompt: string): string {
  return prompt.length > PROMPT_EXCERPT_LENGTH
    ? `${prompt.slice(0, PROMPT_EXCERPT_LENGTH)}…`
    : prompt;
}

/**
 * Redact structured detail before storage — same posture as run-event payloads
 * and approval detail ("Secret 不写 RunEvent", docs/architecture.md §14).
 */
export function redactAuditDetail(
  detail: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  if (!detail) return undefined;
  const json = JSON.stringify(detail);
  if (json === undefined) return undefined;
  return JSON.parse(redactSecrets(json)) as Prisma.InputJsonValue;
}

export function toAuditLogDto(row: AuditLog): AuditLogDto {
  return {
    id: row.id,
    action: row.action as AuditAction,
    source: row.source as AuditSource,
    actor: row.actor ?? undefined,
    projectId: row.projectId ?? undefined,
    taskId: row.taskId ?? undefined,
    runId: row.runId ?? undefined,
    detail: row.detailJson ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Append-only audit trail (docs/requirements.md §10, docs/tasks.md T9.5, #63).
 *
 * Every write is best-effort: an audit failure must never break the action it
 * describes (a task still gets created even if the log write fails), so
 * `record` swallows errors and logs a warning — the same posture as the GitHub
 * callback service.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(input: AuditLogInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: input.action,
          source: input.source,
          actor: input.actor ?? null,
          projectId: input.projectId ?? null,
          taskId: input.taskId ?? null,
          runId: input.runId ?? null,
          detailJson: redactAuditDetail(input.detail),
        },
      });
    } catch (error) {
      this.logger.warn(
        `failed to write audit entry ${input.action}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async list(query: ListAuditLogsQuery): Promise<AuditLogDto[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        action: query.action,
        source: query.source,
        taskId: query.taskId,
        runId: query.runId,
        projectId: query.projectId,
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
    });
    return rows.map(toAuditLogDto);
  }
}
