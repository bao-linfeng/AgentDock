import { type RunStatus, RunStatusSchema, canTransition, isTerminal } from '@agentdock/protocol';
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

  /** Terminal completion reported by the runner, including artifact metadata. */
  async complete(runId: string, input: CompleteRunInput): Promise<RunDto> {
    const run = await this.requireRun(runId);
    if (isTerminal(run.status as RunStatus)) {
      throw new ConflictException(`run ${runId} already finished with status ${run.status}`);
    }

    await this.prisma.taskRun.update({
      where: { id: runId },
      data: {
        branch: input.branch ?? undefined,
        worktreePath: input.worktreePath ?? undefined,
        errorCode: input.errorCode ?? undefined,
        errorMessage: input.errorMessage ? redactSecrets(input.errorMessage) : undefined,
      },
    });

    for (const artifact of input.artifacts) {
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
      payload: {
        status: input.status,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      },
    });
    return toRunDto(await this.requireRun(runId));
  }
}
