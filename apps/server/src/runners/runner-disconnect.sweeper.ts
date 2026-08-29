import { RUNNER_DISCONNECT_SWEEP_INTERVAL_MS } from '@agentdock/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { RunsService } from '../runs/runs.service.js';
import { RunnersService } from './runners.service.js';

/** Run statuses that mean a runner still owns the run. */
const IN_FLIGHT_STATUSES = [
  'assigned',
  'running',
  'needs_approval',
  'verifying',
  'publishing',
] as const;

/**
 * Periodic disconnect sweep (docs/tasks.md T9.1, docs/architecture.md §9 / #38).
 *
 * A runner is only ever "online" because it recently heartbeat-ed. If that
 * stops happening, this sweep marks the runner `offline` and fails any run it
 * still owns with a diagnosable error, instead of leaving the run stuck
 * in-flight forever.
 */
@Injectable()
export class RunnerDisconnectSweeper {
  private readonly logger = new Logger(RunnerDisconnectSweeper.name);

  constructor(
    @Inject(RunnersService) private readonly runners: RunnersService,
    @Inject(RunsService) private readonly runs: RunsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Interval(RUNNER_DISCONNECT_SWEEP_INTERVAL_MS)
  async sweep(): Promise<void> {
    await this.run(new Date());
  }

  /** Exposed separately so tests (and manual triggers) can pass a fixed `now`. */
  async run(now: Date): Promise<void> {
    const staleRunners = await this.runners.findStaleOnlineRunners(now);
    for (const runner of staleRunners) {
      const orphanedRuns = await this.prisma.taskRun.findMany({
        where: { runnerId: runner.id, status: { in: [...IN_FLIGHT_STATUSES] } },
      });
      for (const run of orphanedRuns) {
        await this.runs.failDisconnected(run.id, runner.id);
        this.logger.warn(`run ${run.id} failed: runner ${runner.id} (${runner.name}) disconnected`);
      }
      await this.runners.markOffline(runner.id);
      this.logger.warn(`runner ${runner.id} (${runner.name}) marked offline (heartbeat stale)`);
    }
  }
}
