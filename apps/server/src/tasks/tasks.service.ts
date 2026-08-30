import type { TaskIntent, TaskSource, TaskStatus } from '@agentdock/protocol';
import { isTerminal } from '@agentdock/protocol';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Task, TaskRun } from '@prisma/client';
import { AuditService, auditPromptExcerpt } from '../audit/audit.service.js';
import { toIso } from '../common/serialize.js';
import { PrismaService, isUniqueConstraintError } from '../prisma/prisma.service.js';
import { RunsService, toRunDto } from '../runs/runs.service.js';
import type { CreateTaskInput, CreateTaskResult, ListTasksQuery, TaskDto } from './tasks.dto.js';

export function toTaskDto(task: Task, runs?: TaskRun[]): TaskDto {
  return {
    id: task.id,
    projectId: task.projectId,
    source: task.source as TaskSource,
    sourceRef: task.sourceRef ?? undefined,
    deliveryId: task.deliveryId ?? undefined,
    intent: task.intent as TaskIntent,
    prompt: task.prompt,
    status: task.status as TaskStatus,
    createdBy: task.createdBy ?? undefined,
    callbackRepo: task.callbackRepo ?? undefined,
    callbackIssueNumber: task.callbackIssueNumber ?? undefined,
    callbackIsPullRequest: task.callbackIsPullRequest,
    createdAt: toIso(task.createdAt),
    updatedAt: toIso(task.updatedAt),
    runs: runs?.map(toRunDto),
  };
}

@Injectable()
export class TasksService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RunsService) private readonly runs: RunsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Create a task plus its initial queued run.
   *
   * `sourceRef` / `deliveryId` are unique, so a replayed GitHub delivery returns
   * the existing task instead of queueing the work twice (docs/tasks.md T9.3).
   */
  async create(input: CreateTaskInput): Promise<CreateTaskResult> {
    const project = await this.prisma.project.findUnique({ where: { id: input.projectId } });
    if (!project) throw new NotFoundException(`unknown project: ${input.projectId}`);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const task = await tx.task.create({
          data: {
            projectId: input.projectId,
            source: input.source,
            sourceRef: input.sourceRef ?? null,
            deliveryId: input.deliveryId ?? null,
            intent: input.intent,
            prompt: input.prompt,
            createdBy: input.createdBy ?? null,
            callbackRepo: input.callbackRepo ?? null,
            callbackIssueNumber: input.callbackIssueNumber ?? null,
            callbackIsPullRequest: input.callbackIsPullRequest ?? false,
          },
        });
        const run = await tx.taskRun.create({ data: { taskId: task.id } });
        return { task, run };
      });

      await this.runs.recordEvent(created.run.id, 'log', {
        message: `task queued from ${input.source}`,
        intent: input.intent,
      });

      // Audit trail (docs/requirements.md §10, #63): who dispatched what.
      await this.audit.record({
        action: 'task_created',
        source: input.source,
        actor: input.createdBy ?? input.source,
        projectId: input.projectId,
        taskId: created.task.id,
        runId: created.run.id,
        detail: {
          intent: input.intent,
          prompt: auditPromptExcerpt(input.prompt),
          sourceRef: input.sourceRef,
          executor: created.run.executor,
        },
      });

      return {
        task: toTaskDto(created.task, [created.run]),
        run: toRunDto(created.run),
        deduplicated: false,
      };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing = await this.findByDedupeKey(input);
      if (!existing) throw error;
      return { task: existing, deduplicated: true };
    }
  }

  private async findByDedupeKey(input: CreateTaskInput): Promise<TaskDto | null> {
    const where = input.deliveryId
      ? { deliveryId: input.deliveryId }
      : input.sourceRef
        ? { sourceRef: input.sourceRef }
        : null;
    if (!where) return null;
    const task = await this.prisma.task.findFirst({ where, include: { runs: true } });
    return task ? toTaskDto(task, task.runs) : null;
  }

  async list(query: ListTasksQuery): Promise<TaskDto[]> {
    const tasks = await this.prisma.task.findMany({
      where: {
        projectId: query.projectId,
        status: query.status,
        source: query.source,
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: { runs: { orderBy: { createdAt: 'asc' } } },
    });
    return tasks.map((task) => toTaskDto(task, task.runs));
  }

  async get(id: string): Promise<TaskDto> {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: { runs: { orderBy: { createdAt: 'asc' } } },
    });
    if (!task) throw new NotFoundException(`unknown task: ${id}`);
    return toTaskDto(task, task.runs);
  }

  /** Cancel the task's latest non-terminal run (US-04). */
  async cancel(id: string): Promise<TaskDto> {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: { runs: { orderBy: { createdAt: 'desc' } } },
    });
    if (!task) throw new NotFoundException(`unknown task: ${id}`);

    const activeRun = task.runs.find((run) => !isTerminal(run.status));
    if (activeRun) {
      await this.runs.requestCancel(activeRun.id);
    } else if (task.status !== 'cancelled') {
      await this.prisma.task.update({ where: { id }, data: { status: 'cancelled' } });
    }
    await this.audit.record({
      action: 'task_cancelled',
      source: 'web',
      actor: 'web',
      projectId: task.projectId,
      taskId: task.id,
      runId: activeRun?.id,
      detail: { hadActiveRun: !!activeRun },
    });
    return this.get(id);
  }
}
