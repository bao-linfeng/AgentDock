import type { TaskIntent, TaskSource } from '@agentdock/protocol';
import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Runner } from '@prisma/client';
import type { ApprovalDto, RequestApprovalInput } from '../approvals/approvals.dto.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { RunCallbackService } from '../github/run-callback.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RunnersService } from '../runners/runners.service.js';
import type {
  AppendRunEventInput,
  CompleteRunInput,
  RunDto,
  RunEventDto,
} from '../runs/runs.dto.js';
import { RunsService, toRunDto } from '../runs/runs.service.js';
import type {
  ClaimResponseDto,
  RunHeartbeatResponseDto,
  RunnerHeartbeatResponseDto,
} from './runner-gateway.dto.js';

/** Statuses that mean the runner still owns the run. */
const IN_FLIGHT_STATUSES = [
  'assigned',
  'running',
  'needs_approval',
  'verifying',
  'publishing',
] as const;

/** How many queued runs to try before giving up on a claim round. */
const CLAIM_CANDIDATES = 10;

/**
 * Runner Gateway (docs/architecture.md §9, docs/tasks.md T2.4).
 *
 * The runner only ever makes outbound calls: claim → events → heartbeat →
 * complete. Cancellation travels back on the heartbeat response, which is why
 * no inbound channel to the runner is required.
 */
@Injectable()
export class RunnerGatewayService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RunsService) private readonly runs: RunsService,
    @Inject(RunnersService) private readonly runners: RunnersService,
    @Inject(RunCallbackService) private readonly callbacks: RunCallbackService,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
  ) {}

  /** A runner must register before it can claim or report anything. */
  requireRegistered(runner: Runner | null): Runner {
    if (!runner) {
      throw new UnauthorizedException('runner is not registered; POST /runner/register first');
    }
    return runner;
  }

  /**
   * Atomically claim the oldest queued run for a project mapped to this runner.
   *
   * The claim itself is a single conditional `UPDATE ... WHERE status='queued'
   * AND runner_id IS NULL`, so two concurrent claims can never take the same
   * run (docs/tasks.md T3.4 "claim 后原子更新 assigned").
   */
  async claim(runner: Runner): Promise<ClaimResponseDto> {
    await this.runners.touchHeartbeat(runner.id);

    const mappings = await this.prisma.runnerProject.findMany({
      where: { runnerId: runner.id, enabled: true },
    });
    if (mappings.length === 0) return { claimed: false };

    // MVP executes one task at a time per runner (docs/tasks.md T3.4).
    const inFlight = await this.prisma.taskRun.count({
      where: { runnerId: runner.id, status: { in: [...IN_FLIGHT_STATUSES] } },
    });
    if (inFlight > 0) return { claimed: false };

    const workspaceByProject = new Map(mappings.map((m) => [m.projectId, m.workspacePath]));
    const candidates = await this.prisma.taskRun.findMany({
      where: {
        status: 'queued',
        runnerId: null,
        cancelRequestedAt: null,
        task: { projectId: { in: [...workspaceByProject.keys()] } },
      },
      orderBy: { createdAt: 'asc' },
      take: CLAIM_CANDIDATES,
    });

    for (const candidate of candidates) {
      const claimed = await this.prisma.taskRun.updateMany({
        where: { id: candidate.id, status: 'queued', runnerId: null },
        data: { status: 'assigned', runnerId: runner.id },
      });
      if (claimed.count !== 1) continue; // another claim won the race

      const run = await this.prisma.taskRun.findUniqueOrThrow({
        where: { id: candidate.id },
        include: { task: { include: { project: true } } },
      });
      await this.runs.recordEvent(run.id, 'status', {
        status: 'assigned',
        runnerId: runner.id,
        runnerName: runner.name,
      });
      void this.callbacks.post('picked_up', { runId: run.id });

      const workspacePath = workspaceByProject.get(run.task.projectId);
      if (!workspacePath) continue;

      return {
        claimed: true,
        work: {
          run: toRunDto(run),
          task: {
            id: run.task.id,
            intent: run.task.intent as TaskIntent,
            source: run.task.source as TaskSource,
            sourceRef: run.task.sourceRef ?? undefined,
            prompt: run.task.prompt,
          },
          project: {
            id: run.task.project.id,
            name: run.task.project.name,
            workspaceKey: run.task.project.workspaceKey,
            defaultBranch: run.task.project.defaultBranch,
            testCommand: run.task.project.testCommand ?? undefined,
            buildCommand: run.task.project.buildCommand ?? undefined,
            workspacePath,
          },
        },
      };
    }

    return { claimed: false };
  }

  /** Reject reporting on a run that belongs to a different runner. */
  private async requireOwnedRun(runner: Runner, runId: string) {
    const run = await this.runs.requireRun(runId);
    if (run.runnerId !== runner.id) {
      throw new ForbiddenException(`run ${runId} is not assigned to runner ${runner.id}`);
    }
    return run;
  }

  async appendEvent(
    runner: Runner,
    runId: string,
    input: AppendRunEventInput,
  ): Promise<RunEventDto> {
    await this.requireOwnedRun(runner, runId);
    await this.runners.touchHeartbeat(runner.id);
    return this.runs.appendEvent(runId, input);
  }

  /** Heartbeat for a specific run; carries the cancellation flag back. */
  async runHeartbeat(
    runner: Runner,
    runId: string,
    note?: string,
  ): Promise<RunHeartbeatResponseDto> {
    const run = await this.requireOwnedRun(runner, runId);
    await this.runners.touchHeartbeat(runner.id);
    if (note) {
      await this.runs.recordEvent(runId, 'log', { message: note, source: 'heartbeat' });
    }
    const pending = await this.approvals.approvalsForHeartbeat(runId);
    return {
      runId: run.id,
      status: run.status,
      cancelRequested: run.cancelRequestedAt !== null,
      approvals: pending.map((approval) => ({
        approvalId: approval.id,
        action: approval.action,
        status: approval.status,
      })),
    };
  }

  /**
   * Request approval for a high-risk action (docs/tasks.md T8.3, #37): the
   * runner is about to run a shell command on the executor's behalf, push
   * the agent branch, or perform another operation it flags as destructive.
   * Transitions the run to `needs_approval` (the runner should stop and poll
   * `runHeartbeat` for the decision — see `RunHeartbeatResponseDto.approvals`)
   * unless the run is already there (idempotent under retry).
   */
  async requestApproval(
    runner: Runner,
    runId: string,
    input: RequestApprovalInput,
  ): Promise<ApprovalDto> {
    const run = await this.requireOwnedRun(runner, runId);
    await this.runners.touchHeartbeat(runner.id);
    if (run.status !== 'needs_approval') {
      await this.runs.applyStatus(run, 'needs_approval');
    }
    return this.approvals.request(runId, input);
  }

  /** Idle heartbeat (no run in flight) — keeps the runner marked online. */
  async runnerHeartbeat(runner: Runner): Promise<RunnerHeartbeatResponseDto> {
    await this.runners.touchHeartbeat(runner.id);
    const runs = await this.prisma.taskRun.findMany({
      where: { runnerId: runner.id, status: { in: [...IN_FLIGHT_STATUSES] } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      runnerId: runner.id,
      activeRuns: runs.map((run) => ({
        runId: run.id,
        status: run.status,
        cancelRequested: run.cancelRequestedAt !== null,
      })),
    };
  }

  async complete(runner: Runner, runId: string, input: CompleteRunInput): Promise<RunDto> {
    await this.requireOwnedRun(runner, runId);
    await this.runners.touchHeartbeat(runner.id);
    return this.runs.complete(runId, input);
  }
}
