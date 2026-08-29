import {
  type AgentRun,
  type AgentTask,
  type RunStatus,
  type TaskStatus,
  assertTransition,
  isTerminal,
} from '@agentdock/protocol';
import { newRunId } from '@agentdock/shared';

/**
 * Derive the coarse task-level status from its latest run status.
 * See docs/requirements.md §5 review note (Task <-> Run cardinality).
 */
export function deriveTaskStatus(latestRunStatus: RunStatus): TaskStatus {
  switch (latestRunStatus) {
    case 'queued':
    case 'assigned':
      return 'queued';
    case 'running':
    case 'needs_approval':
    case 'verifying':
    case 'publishing':
      return 'running';
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
  }
}

/**
 * Guards a single run's status transitions against the authoritative state
 * machine (docs/architecture.md §8).
 */
export class RunLifecycle {
  constructor(private status: RunStatus = 'queued') {}

  get current(): RunStatus {
    return this.status;
  }

  transitionTo(next: RunStatus): RunStatus {
    assertTransition(this.status, next);
    this.status = next;
    return this.status;
  }

  get done(): boolean {
    return isTerminal(this.status);
  }
}

export interface QueuedItem {
  task: AgentTask;
  run: AgentRun;
}

export class TaskEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskEngineError';
  }
}

/**
 * Minimal in-memory task queue and scheduling core for the single-runner MVP
 * (docs/tasks.md T3.4): one task executes at a time, claims are atomic (no
 * double-claim), and each run gets a strictly increasing event sequence.
 *
 * All mutating methods are synchronous so a `claim` cannot interleave with
 * another on the single JS event-loop turn — this is what makes claiming
 * atomic without a database lock.
 */
export class TaskQueue {
  private readonly order: string[] = []; // FIFO of queued run ids
  private readonly runs = new Map<string, AgentRun>();
  private readonly tasks = new Map<string, AgentTask>();
  private readonly seq = new Map<string, number>();
  /** The currently in-flight (claimed, non-terminal) run — MVP allows one. */
  private activeRunId: string | null = null;

  /** Create a run for a task and place it at the back of the queue. */
  enqueue(task: AgentTask): QueuedItem {
    if (this.tasks.has(task.id)) {
      throw new TaskEngineError(`task already enqueued: ${task.id}`);
    }
    const run: AgentRun = {
      id: newRunId(),
      taskId: task.id,
      executor: 'opencode',
      status: 'queued',
    };
    this.tasks.set(task.id, task);
    this.runs.set(run.id, run);
    this.seq.set(run.id, 0);
    this.order.push(run.id);
    return { task, run };
  }

  /** Number of runs still waiting to be claimed. */
  get pending(): number {
    return this.order.length;
  }

  get active(): AgentRun | null {
    return this.activeRunId ? (this.runs.get(this.activeRunId) ?? null) : null;
  }

  /**
   * Atomically claim the next queued run for a runner. Returns `null` when the
   * queue is empty or a run is already in flight (one task at a time). A given
   * run is never returned by more than one successful claim.
   */
  claim(runnerId: string): QueuedItem | null {
    if (this.activeRunId !== null) return null;
    const runId = this.order.shift();
    if (!runId) return null;

    const run = this.runs.get(runId);
    if (!run) return null;

    assertTransition(run.status, 'assigned');
    run.status = 'assigned';
    run.runnerId = runnerId;
    this.activeRunId = runId;

    const task = this.tasks.get(run.taskId);
    if (!task) throw new TaskEngineError(`orphaned run without task: ${runId}`);
    return { task, run };
  }

  /** Advance a run's status, validating the transition and freeing the slot on terminal. */
  advance(runId: string, next: RunStatus): AgentRun {
    const run = this.runs.get(runId);
    if (!run) throw new TaskEngineError(`unknown run: ${runId}`);
    assertTransition(run.status, next);
    run.status = next;
    if (isTerminal(next) && this.activeRunId === runId) {
      this.activeRunId = null;
    }
    return run;
  }

  /** Monotonic, per-run event sequence number for `RunEvent.seq`. */
  nextSeq(runId: string): number {
    const current = this.seq.get(runId);
    if (current === undefined) throw new TaskEngineError(`unknown run: ${runId}`);
    const next = current + 1;
    this.seq.set(runId, next);
    return next;
  }

  getRun(runId: string): AgentRun | undefined {
    return this.runs.get(runId);
  }

  getTask(taskId: string): AgentTask | undefined {
    return this.tasks.get(taskId);
  }

  /** Coarse task status derived from its (single, MVP) run. */
  taskStatus(taskId: string): TaskStatus | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;
    for (const run of this.runs.values()) {
      if (run.taskId === taskId) return deriveTaskStatus(run.status);
    }
    return undefined;
  }
}
