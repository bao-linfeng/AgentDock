<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { Badge } from '@/components/ui/badge';
import { approvalsApi } from '../api/approvals';
import { projectsApi } from '../api/projects';
import { runnersApi } from '../api/runners';
import { tasksApi } from '../api/tasks';
import StatusBadge from '../components/StatusBadge.vue';
import type { ArtifactDto, TaskDto } from '../types';
import { runsApi } from '../api/runs';

// Dashboard (docs/tasks.md T7.1 / issue #32): running/failed tasks, online
// runners, recent PRs. Polls via TanStack Query — live per-run detail lives on
// the Task Detail page (SSE), the dashboard just needs a fresh-ish overview.

const REFRESH_MS = 10_000;

const runningTasksQuery = useQuery({
  queryKey: ['dashboard', 'running-tasks'],
  queryFn: () => tasksApi.list({ status: 'running', limit: 20 }),
  refetchInterval: REFRESH_MS,
});

const failedTasksQuery = useQuery({
  queryKey: ['dashboard', 'failed-tasks'],
  queryFn: () => tasksApi.list({ status: 'failed', limit: 20 }),
  refetchInterval: REFRESH_MS,
});

const runnersQuery = useQuery({
  queryKey: ['dashboard', 'runners'],
  queryFn: () => runnersApi.list(),
  refetchInterval: REFRESH_MS,
});

const pendingApprovalsQuery = useQuery({
  queryKey: ['dashboard', 'pending-approvals'],
  queryFn: () => approvalsApi.listPending(),
  refetchInterval: REFRESH_MS,
});

const projectsQuery = useQuery({
  queryKey: ['dashboard', 'projects'],
  queryFn: () => projectsApi.list(),
  refetchInterval: REFRESH_MS * 3,
});

const succeededTasksQuery = useQuery({
  queryKey: ['dashboard', 'succeeded-tasks'],
  queryFn: () => tasksApi.list({ status: 'succeeded', limit: 10 }),
  refetchInterval: REFRESH_MS,
});

// Recent PR artifacts: look at the latest run of each recently-succeeded task.
const recentPrsQuery = useQuery({
  queryKey: ['dashboard', 'recent-prs', () => succeededTasksQuery.data.value],
  enabled: computed(() => (succeededTasksQuery.data.value?.length ?? 0) > 0),
  queryFn: async () => {
    const tasks = succeededTasksQuery.data.value ?? [];
    const results: Array<{ task: TaskDto; artifact: ArtifactDto }> = [];
    for (const task of tasks) {
      const lastRun = task.runs?.[task.runs.length - 1];
      if (!lastRun) continue;
      const artifacts = await runsApi.listArtifacts(lastRun.id);
      const pr = artifacts.find((a) => a.type === 'pull_request');
      if (pr) results.push({ task, artifact: pr });
    }
    return results;
  },
});

function projectName(projectId: string): string {
  return projectsQuery.data.value?.find((p) => p.id === projectId)?.name ?? projectId;
}

// Resolve each pending approval's run -> task, so the dashboard can link
// straight to the Task Detail page where ApprovalPanel lives.
const pendingApprovalTasksQuery = useQuery({
  queryKey: ['dashboard', 'pending-approval-tasks', () => pendingApprovalsQuery.data.value],
  enabled: computed(() => (pendingApprovalsQuery.data.value?.length ?? 0) > 0),
  queryFn: async () => {
    const approvals = pendingApprovalsQuery.data.value ?? [];
    const entries: Array<{ approval: (typeof approvals)[number]; taskId: string }> = [];
    for (const approval of approvals) {
      const run = await runsApi.get(approval.runId);
      entries.push({ approval, taskId: run.taskId });
    }
    return entries;
  },
});

const approvalActionLabels: Record<string, string> = {
  shell: 'Shell 命令',
  push: '推送分支',
  destructive: '破坏性操作',
};
</script>

<template>
  <div class="page stack">
    <h1>仪表盘</h1>

    <section class="card stack">
      <div class="row-between">
        <h2>运行中任务</h2>
        <span class="muted">{{ runningTasksQuery.data.value?.length ?? 0 }}</span>
      </div>
      <p v-if="runningTasksQuery.isLoading.value" class="muted">加载中…</p>
      <p v-else-if="!runningTasksQuery.data.value?.length" class="muted">当前没有运行中的任务。</p>
      <ul v-else class="stack task-list">
        <li v-for="task in runningTasksQuery.data.value" :key="task.id">
          <RouterLink :to="{ name: 'task-detail', params: { id: task.id } }" class="task-row">
            <span class="task-prompt">{{ task.prompt }}</span>
            <span class="row">
              <span class="muted">{{ projectName(task.projectId) }}</span>
              <StatusBadge :status="task.status" />
            </span>
          </RouterLink>
        </li>
      </ul>
    </section>

    <section class="card stack">
      <div class="row-between">
        <h2>待审批</h2>
        <span class="muted">{{ pendingApprovalsQuery.data.value?.length ?? 0 }}</span>
      </div>
      <p v-if="pendingApprovalsQuery.isLoading.value" class="muted">加载中…</p>
      <p v-else-if="!pendingApprovalsQuery.data.value?.length" class="muted">当前没有待审批的操作。</p>
      <ul v-else class="stack task-list">
        <li v-for="entry in pendingApprovalTasksQuery.data.value" :key="entry.approval.id">
          <RouterLink :to="{ name: 'task-detail', params: { id: entry.taskId } }" class="task-row">
            <span class="task-prompt">
              {{ approvalActionLabels[entry.approval.action] ?? entry.approval.action }}
              <span class="muted"> · {{ entry.approval.summary ?? '（无摘要）' }}</span>
            </span>
          </RouterLink>
        </li>
      </ul>
    </section>

    <section class="card stack">
      <div class="row-between">
        <h2>失败任务</h2>
        <span class="muted">{{ failedTasksQuery.data.value?.length ?? 0 }}</span>
      </div>
      <p v-if="failedTasksQuery.isLoading.value" class="muted">加载中…</p>
      <p v-else-if="!failedTasksQuery.data.value?.length" class="muted">没有失败的任务。</p>
      <ul v-else class="stack task-list">
        <li v-for="task in failedTasksQuery.data.value" :key="task.id">
          <RouterLink :to="{ name: 'task-detail', params: { id: task.id } }" class="task-row">
            <span class="task-prompt">{{ task.prompt }}</span>
            <span class="row">
              <span class="muted">{{ projectName(task.projectId) }}</span>
              <StatusBadge :status="task.status" />
            </span>
          </RouterLink>
        </li>
      </ul>
    </section>

    <section class="card stack">
      <div class="row-between">
        <h2>在线 Runner</h2>
        <span class="muted">
          {{ runnersQuery.data.value?.filter((r) => r.online).length ?? 0 }} /
          {{ runnersQuery.data.value?.length ?? 0 }}
        </span>
      </div>
      <p v-if="runnersQuery.isLoading.value" class="muted">加载中…</p>
      <p v-else-if="!runnersQuery.data.value?.length" class="muted">尚未注册任何 Runner。</p>
      <ul v-else class="stack">
        <li v-for="runner in runnersQuery.data.value" :key="runner.id" class="row-between runner-row">
          <span>
            <strong>{{ runner.name }}</strong>
            <span v-if="runner.machineName" class="muted"> · {{ runner.machineName }}</span>
          </span>
          <Badge
            variant="outline"
            class="rounded-full text-[0.7rem] font-bold uppercase tracking-wide"
            :class="
              runner.online
                ? 'bg-emerald-500/15 text-emerald-500 border-transparent'
                : 'bg-muted-foreground/15 text-muted-foreground border-transparent'
            "
          >
            {{ runner.online ? '在线' : '离线' }}
          </Badge>
        </li>
      </ul>
    </section>

    <section class="card stack">
      <h2>最近 PR</h2>
      <p v-if="recentPrsQuery.isLoading.value" class="muted">加载中…</p>
      <p v-else-if="!recentPrsQuery.data.value?.length" class="muted">还没有已创建的 PR。</p>
      <ul v-else class="stack">
        <li v-for="entry in recentPrsQuery.data.value" :key="entry.artifact.id">
          <a
            v-if="entry.artifact.uri"
            :href="entry.artifact.uri"
            target="_blank"
            rel="noopener noreferrer"
            class="pr-link"
          >
            {{ entry.artifact.title }}
          </a>
          <span v-else>{{ entry.artifact.title }}</span>
          <div class="muted">{{ projectName(entry.task.projectId) }}</div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.task-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.task-row {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text);
}

.task-list li:last-child .task-row {
  border-bottom: none;
}

.task-prompt {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.runner-row {
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--color-border);
}

.runner-row:last-child {
  border-bottom: none;
}

.pr-link {
  font-weight: 600;
}
</style>
