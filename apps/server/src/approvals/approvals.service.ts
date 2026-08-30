import type { ApprovalAction } from '@agentdock/protocol';
import { redactSecrets } from '@agentdock/shared';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Approval, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { RunEventsBus } from '../events/run-events.bus.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toRunEventDto } from '../runs/runs.service.js';
import type { ApprovalDto, RequestApprovalInput, ResolveApprovalInput } from './approvals.dto.js';

/**
 * Redact a free-form detail object before it is persisted, mirroring
 * `redactPayload` in `runs.service.ts` ("Secret 不写 RunEvent" — architecture
 * §14 applies equally to approval detail, which may embed a shell command or
 * tool-call payload).
 */
function redactDetail(
  detail: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  if (!detail) return undefined;
  const json = JSON.stringify(detail);
  if (json === undefined) return undefined;
  return JSON.parse(redactSecrets(json)) as Prisma.InputJsonValue;
}

export function toApprovalDto(approval: Approval): ApprovalDto {
  return {
    id: approval.id,
    runId: approval.runId,
    action: approval.action as ApprovalAction,
    status: approval.status,
    summary: approval.summary ?? undefined,
    detail: approval.detailJson ?? undefined,
    requestedAt: approval.requestedAt.toISOString(),
    resolvedAt: approval.resolvedAt?.toISOString(),
    resolvedBy: approval.resolvedBy ?? undefined,
  };
}

/**
 * Approval gate for high-risk Runner actions (docs/tasks.md T8.3, #37):
 * shell tool calls requested by the executor over ACP, pushing the agent
 * branch to a remote, and other operations the Runner flags as destructive.
 *
 * The Runner has no inbound channel (docs/architecture.md §9), so it learns
 * about a decision the same way it learns about cancellation: by polling
 * `POST /runner/runs/:id/heartbeat`, which now also returns the status of any
 * approval it is waiting on.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RunEventsBus) private readonly bus: RunEventsBus,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async requireApproval(id: string): Promise<Approval> {
    const approval = await this.prisma.approval.findUnique({ where: { id } });
    if (!approval) throw new NotFoundException(`unknown approval: ${id}`);
    return approval;
  }

  async get(id: string): Promise<ApprovalDto> {
    return toApprovalDto(await this.requireApproval(id));
  }

  async listForRun(runId: string): Promise<ApprovalDto[]> {
    const approvals = await this.prisma.approval.findMany({
      where: { runId },
      orderBy: { requestedAt: 'asc' },
    });
    return approvals.map(toApprovalDto);
  }

  /** All approvals still awaiting a decision, across every run — for the Web dashboard. */
  async listPending(): Promise<ApprovalDto[]> {
    const approvals = await this.prisma.approval.findMany({
      where: { status: 'pending' },
      orderBy: { requestedAt: 'asc' },
    });
    return approvals.map(toApprovalDto);
  }

  /**
   * Create a pending approval for a run and record it as a `run_events`
   * entry (type `approval`) so the Web timeline/SSE stream surfaces it
   * immediately, the same way artifacts do.
   *
   * Idempotent under retry (mirrors `claim`/`complete` elsewhere on the
   * Runner Gateway): if the run already has a pending approval for the same
   * action + summary, that row is returned instead of creating a duplicate,
   * so a Runner retry after a network blip doesn't leave a human resolving
   * one row while the Runner keeps polling for a different `approvalId`.
   */
  async request(runId: string, input: RequestApprovalInput): Promise<ApprovalDto> {
    await this.prisma.taskRun.findUniqueOrThrow({ where: { id: runId } });

    const existing = await this.prisma.approval.findFirst({
      where: {
        runId,
        status: 'pending',
        action: input.action,
        summary: input.summary ?? null,
      },
    });
    if (existing) return toApprovalDto(existing);

    const approval = await this.prisma.approval.create({
      data: {
        runId,
        action: input.action,
        summary: input.summary,
        detailJson: redactDetail(input.detail),
      },
    });
    await this.publishEvent(approval);
    await this.audit.record({
      action: 'approval_requested',
      source: 'runner',
      runId,
      detail: { approvalId: approval.id, gate: input.action, summary: input.summary },
    });
    return toApprovalDto(approval);
  }

  /**
   * Resolve a pending approval (Web-initiated). Resolving twice is rejected —
   * the Runner may already have acted on the first decision.
   */
  async resolve(id: string, input: ResolveApprovalInput): Promise<ApprovalDto> {
    const approval = await this.requireApproval(id);
    if (approval.status !== 'pending') {
      throw new ConflictException(`approval ${id} was already ${approval.status}`);
    }

    const updated = await this.prisma.approval.update({
      where: { id },
      data: {
        status: input.decision,
        resolvedAt: new Date(),
        resolvedBy: input.resolvedBy,
      },
    });
    await this.publishEvent(updated);
    await this.audit.record({
      action: 'approval_resolved',
      source: 'web',
      actor: input.resolvedBy ?? 'web',
      runId: approval.runId,
      detail: {
        approvalId: id,
        gate: approval.action,
        decision: input.decision,
        summary: approval.summary ?? undefined,
      },
    });
    return toApprovalDto(updated);
  }

  /** Latest pending approval for a run, if the runner is currently blocked on one. */
  async pendingForRun(runId: string): Promise<Approval | null> {
    return this.prisma.approval.findFirst({
      where: { runId, status: 'pending' },
      orderBy: { requestedAt: 'asc' },
    });
  }

  /**
   * Every approval for a run that a Runner might still be polling for a
   * decision on (docs/tasks.md T8.3, #37): pending ones (still awaiting a
   * human) *and* recently resolved ones, so a poller looking for a specific
   * `approvalId` can observe the transition out of `pending` — a Runner
   * that only ever saw approvals filtered to `status: 'pending'` would never
   * see a resolution, since the row disappears from that filter the moment
   * it stops being pending. Bounded to the last hour of resolved approvals
   * so this doesn't grow unbounded over a long-running run.
   */
  async approvalsForHeartbeat(runId: string): Promise<Approval[]> {
    const resolvedSince = new Date(Date.now() - 60 * 60_000);
    return this.prisma.approval.findMany({
      where: {
        runId,
        OR: [{ status: 'pending' }, { resolvedAt: { gte: resolvedSince } }],
      },
      orderBy: { requestedAt: 'asc' },
    });
  }

  private async publishEvent(approval: Approval): Promise<void> {
    const aggregate = await this.prisma.runEvent.aggregate({
      where: { runId: approval.runId },
      _max: { seq: true },
    });
    const seq = (aggregate._max.seq ?? 0) + 1;
    try {
      const event = await this.prisma.runEvent.create({
        data: {
          runId: approval.runId,
          seq,
          type: 'approval',
          payloadJson: toApprovalDto(approval) as unknown as Prisma.InputJsonValue,
        },
      });
      this.bus.publish(toRunEventDto(event));
    } catch {
      // Best-effort: losing the live SSE notification is not fatal, the
      // approval row itself is already committed and polling still works.
    }
  }
}
