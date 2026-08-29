import { decideCompletion } from '@agentdock/governance';
import { type RunStatus, RunStatusSchema, canTransition, isTerminal } from '@agentdock/protocol';
import type { RunArtifact, TaskIntent } from '@agentdock/protocol';
import { redactSecrets } from '@agentdock/shared';
import { deriveTaskStatus } from '@agentdock/task-engine';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Artifact, Prisma, RunEvent, TaskRun } from '@prisma/client';
import { toIso } from '../common/serialize.js';
import { RunEventsBus } from '../events/run-events.bus.js';
import { PullRequestService } from '../github/pull-request.service.js';
import { PrismaService, isUniqueConstraintError } from '../prisma/prisma.service.js';
import type {
  AppendRunEventInput,
  ArtifactDto,
  CompleteRunInput,
  RunDto,
  RunEventDto,
  RunEventsQuery,
} from './runs.dto.js';

/** How many times to retry `seq` allocation when two writers race. */
const SEQ_ALLOCATION_ATTEMPTS = 5;

export function toRunDto(run: TaskRun): RunDto {
  return {
    id: run.id,
    taskId: run.taskId,
    runnerId: run.runnerId ?? undefined,
    executor: run.executor,
    status: run.status as RunStatus,
    branch: run.branch ?? undefined,
    worktreePath: run.worktreePath ?? undefined,
    startedAt: toIso(run.startedAt),
    finishedAt: toIso(run.finishedAt),
    errorCode: run.errorCode ?? undefined,
    errorMessage: run.errorMessage ?? undefined,
    cancelRequested: run.cancelRequestedAt !== null,
    createdAt: toIso(run.createdAt),
    updatedAt: toIso(run.updatedAt),
  };
}

export function toRunEventDto(event: RunEvent): RunEventDto {
  return {
    id: event.id,
    runId: event.runId,
    seq: event.seq,
    type: event.type,
    payload: event.payloadJson,
    createdAt: event.createdAt.toISOString(),
  };
}

export function toArtifactDto(artifact: Artifact): ArtifactDto {
  return {
    id: artifact.id,
    runId: artifact.runId,
    type: artifact.type,
    title: artifact.title,
    uri: artifact.uri ?? undefined,
    metadata: artifact.metadataJson ?? undefined,
    createdAt: artifact.createdAt.toISOString(),
  };
}

/**
 * Strip secrets from an event payload before it is persisted.
 * "Secret 不写 RunEvent" — docs/architecture.md §14.
 */
export function redactPayload(payload: unknown): Prisma.InputJsonValue {
  if (payload === undefined || payload === null) return {};
  const json = JSON.stringify(payload);
  if (json === undefined) return {};
  return JSON.parse(redactSecrets(json)) as Prisma.InputJsonValue;
}

/** Read a `RunStatus` out of a `status` event payload, if present. */
export function statusFromPayload(payload: unknown): RunStatus | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const parsed = RunStatusSchema.safeParse((payload as { status?: unknown }).status);
  return parsed.success ? parsed.data : null;
}

/**
 * Run lifecycle + run event store.
 *
 * Status transitions are validated against the authoritative state machine in
 * `@agentdock/protocol` (docs/architecture.md §8), and the coarse task status is
 * derived with `deriveTaskStatus` from `@agentdock/task-engine`.
 */
@Injectable()
export class RunsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RunEventsBus) private readonly bus: RunEventsBus,
    @Inject(PullRequestService) private readonly pullRequests: PullRequestService,
  ) {}

  async requireRun(runId: string): Promise<TaskRun> {
    const run = await this.prisma.taskRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException(`unknown run: ${runId}`);
    return run;
  }

  async get(runId: string): Promise<RunDto> {
    return toRunDto(await this.requireRun(runId));
  }

  async listForTask(taskId: string): Promise<RunDto[]> {
    const runs = await this.prisma.taskRun.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
    });
    return runs.map(toRunDto);
  }

  async listEvents(runId: string, query: RunEventsQuery): Promise<RunEventDto[]> {
    await this.requireRun(runId);
    const events = await this.prisma.runEvent.findMany({
      where: { runId, ...(query.afterSeq === undefined ? {} : { seq: { gt: query.afterSeq } }) },
      orderBy: { seq: 'asc' },
      take: query.limit,
    });
    return events.map(toRunEventDto);
  }

  async listArtifacts(runId: string): Promise<ArtifactDto[]> {
    await this.requireRun(runId);
    const artifacts = await this.prisma.artifact.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
    });
    return artifacts.map(toArtifactDto);
  }

  /**
   * Persist an event with the next per-run `seq` and publish it to SSE
   * subscribers. Does **not** touch the run status — see `appendEvent`.
   */
  async recordEvent(runId: string, type: string, payload: unknown): Promise<RunEventDto> {
    const data = redactPayload(payload);
    for (let attempt = 0; attempt < SEQ_ALLOCATION_ATTEMPTS; attempt += 1) {
      const aggregate = await this.prisma.runEvent.aggregate({
        where: { runId },
        _max: { seq: true },
      });
      const seq = (aggregate._max.seq ?? 0) + 1;
      try {
        const event = await this.prisma.runEvent.create({
          data: { runId, seq, type, payloadJson: data },
        });
        const dto = toRunEventDto(event);
        this.bus.publish(dto);
        return dto;
      } catch (error) {
        // `(runId, seq)` is unique: another writer won the race, so retry.
        if (!isUniqueConstraintError(error)) throw error;
      }
    }
    throw new ConflictException(`could not allocate an event sequence for run ${runId}`);
  }

  /**
   * Append a runner-reported event. `status` events drive the run state machine,
   * so an illegal transition is rejected before anything is written.
   */
  async appendEvent(runId: string, input: AppendRunEventInput): Promise<RunEventDto> {
    const run = await this.requireRun(runId);
    if (input.type === 'status') {
      const next = statusFromPayload(input.payload);
      if (!next) {
        throw new BadRequestException('a status event requires payload.status to be a RunStatus');
      }
      await this.applyStatus(run, next);
    }
    return this.recordEvent(runId, input.type, input.payload);
  }

  /** Validate + persist a run status transition and refresh the task status. */
  async applyStatus(run: TaskRun, next: RunStatus): Promise<TaskRun> {
    const current = run.status as RunStatus;
    if (current === next) return run;
    if (isTerminal(current)) {
      throw new ConflictException(`run ${run.id} already finished with status ${current}`);
    }
    if (!canTransition(current, next)) {
      const hint =
        next === 'succeeded'
          ? ' (report verifying and publishing before completing as succeeded)'
          : '';
      throw new BadRequestException(`invalid run status transition: ${current} -> ${next}${hint}`);
    }

    const now = new Date();
    const updated = await this.prisma.taskRun.update({
      where: { id: run.id },
      data: {
        status: next,
        startedAt: next === 'running' && run.startedAt === null ? now : undefined,
        finishedAt: isTerminal(next) ? now : undefined,
      },
    });
    await this.prisma.task.update({
      where: { id: run.taskId },
      data: { status: deriveTaskStatus(next) },
    });
    return updated;
  }

  /**
   * Request cancellation (US-04). A run that no runner has claimed yet is
   * cancelled immediately; an in-flight run is only flagged, and the runner
   * picks the flag up from its next heartbeat response (`cancelRequested`).
   */
  async requestCancel(runId: string): Promise<RunDto> {
    const run = await this.requireRun(runId);
    if (isTerminal(run.status as RunStatus)) {
      throw new ConflictException(`run ${runId} already finished with status ${run.status}`);
    }

    await this.prisma.taskRun.update({
      where: { id: runId },
      data: { cancelRequestedAt: run.cancelRequestedAt ?? new Date() },
    });

    if (run.status === 'queued' && run.runnerId === null) {
      await this.appendEvent(runId, {
        type: 'status',
        payload: { status: 'cancelled', reason: 'cancelled before it was claimed' },
      });
    } else {
      await this.recordEvent(runId, 'log', { message: 'cancellation requested by user' });
    }
    return toRunDto(await this.requireRun(runId));
  }

  /**
   * Fail an in-flight run because its runner disconnected (docs/tasks.md
   * T9.1 / #38). Unlike `complete()`, this is server-initiated: there is no
   * runner left to report a terminal status, so the server applies the
   * transition itself with a diagnosable error code.
   */
  async failDisconnected(runId: string, runnerId: string): Promise<RunDto> {
    const run = await this.requireRun(runId);
    if (isTerminal(run.status as RunStatus)) return toRunDto(run);

    await this.prisma.taskRun.update({
      where: { id: runId },
      data: {
        errorCode: 'runner_disconnected',
        errorMessage: `runner ${runnerId} stopped sending heartbeats while this run was in flight`,
      },
    });
    await this.appendEvent(runId, {
      type: 'status',
      payload: {
        status: 'failed',
        errorCode: 'runner_disconnected',
        errorMessage: `runner ${runnerId} stopped sending heartbeats while this run was in flight`,
      },
    });
    return toRunDto(await this.requireRun(runId));
  }

  /**
   * Retry a failed run: create a fresh run (new id, `queued`) on the same
   * task so the runner-claim loop can pick it up again, while the failed
   * run and its full event history stay untouched (docs/tasks.md T9.2 / #39).
   */
  async retry(runId: string): Promise<RunDto> {
    const run = await this.requireRun(runId);
    if (run.status !== 'failed') {
      throw new ConflictException(
        `only a failed run can be retried (run ${runId} is ${run.status})`,
      );
    }

    const activeSibling = await this.prisma.taskRun.findFirst({
      where: { taskId: run.taskId, status: { notIn: ['succeeded', 'failed', 'cancelled'] } },
    });
    if (activeSibling) {
      throw new ConflictException(
        `task ${run.taskId} already has an active run (${activeSibling.id}); cancel or wait for it first`,
      );
    }

    const retryRun = await this.prisma.taskRun.create({
      data: { taskId: run.taskId, executor: run.executor },
    });
    await this.prisma.task.update({ where: { id: run.taskId }, data: { status: 'queued' } });
    await this.recordEvent(retryRun.id, 'log', {
      message: `retrying failed run ${run.id}`,
      previousRunId: run.id,
    });
    return toRunDto(retryRun);
  }

  /**
   * Terminal completion reported by the runner, including artifact metadata.
   *
   * Before applying the runner's reported status, this tries to open a Pull
   * Request when the run looks like it's only failing evidence because a PR
   * doesn't exist yet (docs/tasks.md T6.5, #30): the runner-side
   * `decideCompletion` (`apps/runner/src/claim-execute-loop.ts`) cannot call
   * the GitHub API itself — only the Control Server holds the GitHub App
   * credentials (docs/requirements.md principle 1: Runner never touches
   * cloud secrets, Server never touches source/model keys, but PR creation
   * is a Server-side credential, not a local one). If a PR is opened, a
   * `pull_request` artifact is appended and the completion decision is
   * re-evaluated with `decideCompletion` before the terminal status event is
   * recorded — turning what the runner reported as `failed
   * (evidence_incomplete)` into `succeeded` once the PR closes the gap.
   */
  async complete(runId: string, input: CompleteRunInput): Promise<RunDto> {
    const run = await this.requireRun(runId);
    if (isTerminal(run.status as RunStatus)) {
      throw new ConflictException(`run ${runId} already finished with status ${run.status}`);
    }

    const artifacts: RunArtifact[] = [...input.artifacts];
    let status = input.status;
    let errorCode = input.errorCode;
    let errorMessage = input.errorMessage;

    const pr = await this.maybeOpenPullRequest(runId, input, artifacts);
    if (pr) {
      artifacts.push({
        type: 'pull_request',
        title: pr.title,
        uri: pr.url,
        metadata: { number: pr.number, base: pr.base, head: pr.head },
      });

      const task = await this.prisma.task.findUniqueOrThrow({ where: { id: run.taskId } });
      const decision = decideCompletion(task.intent as TaskIntent, artifacts);
      if (decision.status === 'succeeded') {
        status = 'succeeded';
        errorCode = undefined;
        errorMessage = undefined;
      } else {
        errorMessage = `missing required evidence: ${decision.missing.join(', ')}`;
      }
    }

    await this.prisma.taskRun.update({
      where: { id: runId },
      data: {
        branch: input.branch ?? undefined,
        worktreePath: input.worktreePath ?? undefined,
        errorCode: errorCode ?? null,
        errorMessage: errorMessage ? redactSecrets(errorMessage) : null,
      },
    });

    for (const artifact of artifacts) {
      await this.prisma.artifact.create({
        data: {
          runId,
          type: artifact.type,
          title: artifact.title,
          uri: artifact.uri ?? null,
          metadataJson: artifact.metadata
            ? (redactPayload(artifact.metadata) as Prisma.InputJsonValue)
            : undefined,
        },
      });
      await this.recordEvent(runId, 'artifact', artifact);
    }

    await this.appendEvent(runId, {
      type: 'status',
      payload: { status, errorCode, errorMessage },
    });
    return toRunDto(await this.requireRun(runId));
  }

  /**
   * Only attempts a PR when the runner's own evidence check failed
   * specifically for a missing `pull_request` (`errorCode ===
   * 'evidence_incomplete'`) and there is a pushed commit artifact to open a
   * PR from. Returns `null` (no-op) in every other case — including when a
   * `pull_request` artifact was already reported by the runner.
   */
  private async maybeOpenPullRequest(
    runId: string,
    input: CompleteRunInput,
    artifacts: RunArtifact[],
  ) {
    if (input.status !== 'failed' || input.errorCode !== 'evidence_incomplete') return null;
    if (artifacts.some((a) => a.type === 'pull_request')) return null;

    const hasPushedCommit = artifacts.some(
      (a) => a.type === 'commit' && a.metadata?.pushed === true,
    );
    if (!hasPushedCommit) return null;

    return this.pullRequests.openForRun(runId, input.branch);
  }
}
