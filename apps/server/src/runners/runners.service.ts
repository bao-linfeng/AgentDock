import { RUNNER_OFFLINE_TIMEOUT_MS } from '@agentdock/shared';
import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Runner, RunnerProject } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { hashToken } from '../auth/token.js';
import { toIso } from '../common/serialize.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  RegisterRunnerInput,
  RunnerDto,
  RunnerProjectDto,
  UpsertRunnerProjectInput,
} from './runners.dto.js';

/** A runner is considered online while its last heartbeat is recent enough. */
export function isRunnerOnline(runner: Runner, now: Date = new Date()): boolean {
  if (runner.revoked || !runner.lastHeartbeatAt) return false;
  return now.getTime() - runner.lastHeartbeatAt.getTime() <= RUNNER_OFFLINE_TIMEOUT_MS;
}

export function toRunnerDto(runner: Runner, now: Date = new Date()): RunnerDto {
  const online = isRunnerOnline(runner, now);
  return {
    id: runner.id,
    name: runner.name,
    machineName: runner.machineName ?? undefined,
    platform: runner.platform ?? undefined,
    version: runner.version ?? undefined,
    // Stored status is refreshed on heartbeat; `online` is the derived truth
    // (full disconnect handling is tracked in T9.1 / #38).
    status: online ? 'online' : 'offline',
    online,
    revoked: runner.revoked,
    revokedAt: toIso(runner.revokedAt),
    lastHeartbeatAt: toIso(runner.lastHeartbeatAt),
    createdAt: toIso(runner.createdAt),
  };
}

export function toRunnerProjectDto(mapping: RunnerProject): RunnerProjectDto {
  return {
    runnerId: mapping.runnerId,
    projectId: mapping.projectId,
    workspacePath: mapping.workspacePath,
    enabled: mapping.enabled,
  };
}

@Injectable()
export class RunnersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Register (or refresh) the runner identified by its token. Only the token
   * hash is stored, so the row can be revoked without knowing the raw token.
   */
  async register(token: string, input: RegisterRunnerInput): Promise<RunnerDto> {
    const tokenHash = hashToken(token);
    const existing = await this.prisma.runner.findUnique({ where: { tokenHash } });
    if (existing?.revoked) {
      throw new UnauthorizedException('runner token has been revoked');
    }

    const runner = await this.prisma.runner.upsert({
      where: { tokenHash },
      create: {
        tokenHash,
        name: input.name,
        machineName: input.machineName ?? null,
        platform: input.platform ?? null,
        version: input.version ?? null,
        status: 'online',
        lastHeartbeatAt: new Date(),
      },
      update: {
        name: input.name,
        machineName: input.machineName ?? null,
        platform: input.platform ?? null,
        version: input.version ?? null,
        status: 'online',
        lastHeartbeatAt: new Date(),
      },
    });
    if (!existing) {
      // First registration for this token — later calls are heartbeat refreshes.
      await this.audit.record({
        action: 'runner_registered',
        source: 'runner',
        actor: runner.name,
        detail: {
          runnerId: runner.id,
          platform: runner.platform ?? undefined,
          version: runner.version ?? undefined,
          machineName: runner.machineName ?? undefined,
        },
      });
    }
    return toRunnerDto(runner);
  }

  async list(): Promise<RunnerDto[]> {
    const runners = await this.prisma.runner.findMany({ orderBy: { createdAt: 'desc' } });
    const now = new Date();
    return runners.map((runner) => toRunnerDto(runner, now));
  }

  async requireRunner(id: string): Promise<Runner> {
    const runner = await this.prisma.runner.findUnique({ where: { id } });
    if (!runner) throw new NotFoundException(`unknown runner: ${id}`);
    return runner;
  }

  async get(id: string): Promise<RunnerDto> {
    return toRunnerDto(await this.requireRunner(id));
  }

  /** Revoke a runner token; the guard rejects it from the next request on. */
  async revoke(id: string): Promise<RunnerDto> {
    await this.requireRunner(id);
    const runner = await this.prisma.runner.update({
      where: { id },
      data: { revoked: true, revokedAt: new Date(), status: 'offline' },
    });
    await this.audit.record({
      action: 'runner_revoked',
      source: 'web',
      actor: 'web',
      detail: { runnerId: runner.id, runnerName: runner.name },
    });
    return toRunnerDto(runner);
  }

  async touchHeartbeat(id: string): Promise<void> {
    await this.prisma.runner.update({
      where: { id },
      data: { status: 'online', lastHeartbeatAt: new Date() },
    });
  }

  /**
   * Find runners whose stored status is still `online` but whose heartbeat
   * has gone stale (docs/tasks.md T9.1 / #38). Revoked runners are excluded —
   * `revoke()` already marks them offline.
   */
  async findStaleOnlineRunners(now: Date = new Date()): Promise<Runner[]> {
    const runners = await this.prisma.runner.findMany({ where: { status: 'online' } });
    return runners.filter((runner) => !isRunnerOnline(runner, now));
  }

  /** Flip a runner's stored status to `offline` once its heartbeat is stale. */
  async markOffline(id: string): Promise<void> {
    await this.prisma.runner.update({ where: { id }, data: { status: 'offline' } });
  }

  async listProjects(runnerId: string): Promise<RunnerProjectDto[]> {
    await this.requireRunner(runnerId);
    const mappings = await this.prisma.runnerProject.findMany({ where: { runnerId } });
    return mappings.map(toRunnerProjectDto);
  }

  /**
   * Map a project onto a runner-local workspace path. A runner may only claim
   * work for projects that are explicitly mapped and enabled
   * ("Runner 不执行未知 Project" — docs/architecture.md §14).
   */
  async upsertProject(
    runnerId: string,
    projectId: string,
    input: UpsertRunnerProjectInput,
  ): Promise<RunnerProjectDto> {
    await this.requireRunner(runnerId);
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`unknown project: ${projectId}`);

    const mapping = await this.prisma.runnerProject.upsert({
      where: { runnerId_projectId: { runnerId, projectId } },
      create: { runnerId, projectId, workspacePath: input.workspacePath, enabled: input.enabled },
      update: { workspacePath: input.workspacePath, enabled: input.enabled },
    });
    return toRunnerProjectDto(mapping);
  }

  async removeProject(
    runnerId: string,
    projectId: string,
  ): Promise<{ runnerId: string; projectId: string; deleted: true }> {
    await this.requireRunner(runnerId);
    await this.prisma.runnerProject.deleteMany({ where: { runnerId, projectId } });
    return { runnerId, projectId, deleted: true };
  }
}
