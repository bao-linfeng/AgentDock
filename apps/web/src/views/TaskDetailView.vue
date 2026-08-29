<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { ApiError } from '../api/client';
import { projectsApi } from '../api/projects';
import { runsApi } from '../api/runs';
import { tasksApi } from '../api/tasks';
import ApprovalPanel from '../components/ApprovalPanel.vue';
import LogViewer from '../components/LogViewer.vue';
import RunTimeline from '../components/RunTimeline.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { Button } from '../components/ui/button';
import { useRunEvents } from '../composables/useRunEvents';
import { TERMINAL_RUN_STATUSES, type ArtifactDto, type RunEventDto } from '../types';

// Task Detail (docs/tasks.md T7.4 / issue #35): Overview / Timeline / Agent
// Output / Logs / Changed Files / Tests / Artifacts, plus Cancel + Open PR
// (docs/tasks.md T7.5 / issue #36).

const props = defineProps<{ id: string }>();
const queryClient = useQueryClient();

const taskQuery = useQuery({
  queryKey: ['task', () => props.id],
  queryFn: () => tasksApi.get(props.id),
  refetchInterval: (query) => {
    const status = query.state.data?.status;
    return status && TERMINAL_RUN_STATUSES.includes(status) ? false : 5000;
  },
});

const projectsQuery = useQuery({
  queryKey: ['projects'],
  queryFn: () => projectsApi.list(),
});

const latestRun = computed(() => {
  const runs = taskQuery.data.value?.runs;
  return runs && runs.length ? runs[runs.length - 1] : undefined;
});

const activeRunId = computed(() => latestRun.value?.id);
const { events: liveEvents, connected } = useRunEvents(activeRunId);

// Historical events for terminal runs (SSE still replays from DB, so this is
// mostly redundant, but keeps things working even if the run predates SSE
// support or the browser lacks EventSource).
const historyEventsQuery = useQuery({
  queryKey: ['run-events', () => activeRunId.value],
  queryFn: () => runsApi.listEvents(activeRunId.value as string),
  enabled: computed(() => !!activeRunId.value),
});

const allEvents = computed<RunEventDto[]>(() => {
  const map = new Map<string, RunEventDto>();
  for (const e of historyEventsQuery.data.value ?? []) map.set(e.id, e);
  for (const e of liveEvents.value) map.set(e.id, e);
  return Array.from(map.values()).sort((a, b) => a.seq - b.seq);
});

const logLines = computed(() =>
  allEvents.value.filter((e) => e.type === 'log').map((e) => String(e.payload ?? '')),
);

const agentOutputLines = computed(() =>
  allEvents.value
    .filter((e) => e.type === 'log' || e.type === 'tool')
    .map((e) => String(e.payload ?? '')),
);

const artifactsQuery = useQuery({
  queryKey: ['run-artifacts', () => activeRunId.value],
  queryFn: () => runsApi.listArtifacts(activeRunId.value as string),
  enabled: computed(() => !!activeRunId.value),
});

function artifactsOfType(type: string): ArtifactDto[] {
  return (artifactsQuery.data.value ?? []).filter((a) => a.type === type);
}

const changedFiles = computed(() => artifactsOfType('diff'));
const testResults = computed(() => artifactsOfType('test_result'));
const pullRequests = computed(() => artifactsOfType('pull_request'));
const otherArtifacts = computed(() =>
  (artifactsQuery.data.value ?? []).filter(
    (a) => !['diff', 'test_result', 'pull_request'].includes(a.type),
  ),
);

const tabs = ['overview', 'timeline', 'output', 'logs', 'files', 'tests', 'artifacts'] as const;
type Tab = (typeof tabs)[number];
const tabLabels: Record<Tab, string> = {
  overview: '概览',
  timeline: '时间线',
  output: 'Agent 输出',
  logs: '日志',
  files: '变更文件',
  tests: '测试',
  artifacts: '产物',
};
const activeTab = ref<Tab>('overview');

const projectName = computed(
  () =>
    projectsQuery.data.value?.find((p) => p.id === taskQuery.data.value?.projectId)?.name ??
    taskQuery.data.value?.projectId,
);

const cancelError = ref<string | null>(null);
const cancelMutation = useMutation({
  mutationFn: () => tasksApi.cancel(props.id),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['task', props.id] });
  },
  onError: (err: unknown) => {
    cancelError.value = err instanceof ApiError ? err.message : '取消失败';
  },
});

const canCancel = computed(() => {
  const status = taskQuery.data.value?.status;
  return !!status && !TERMINAL_RUN_STATUSES.includes(status);
});

function confirmCancel() {
  cancelError.value = null;
  if (window.confirm('确认取消该任务？')) {
    cancelMutation.mutate();
  }
}

// Retry a failed run (docs/tasks.md T9.2 / #39; UI entry point T7.7 / #61 —
// requirements.md US-05 requires a retry entry on the failure view).
const retryError = ref<string | null>(null);
const retryMutation = useMutation({
  mutationFn: () => runsApi.retry(latestRun.value?.id as string),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['task', props.id] });
  },
  onError: (err: unknown) => {
    retryError.value = err instanceof ApiError ? err.message : '重试失败';
  },
});

const canRetry = computed(() => latestRun.value?.status === 'failed');

function retryRun() {
  retryError.value = null;
  if (!latestRun.value) return;
  retryMutation.mutate();
}

function formatTime(iso?: string): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}
</script>

<template>
  <div class="page stack">
    <RouterLink to="/tasks" class="muted back-link">&larr; 返回任务列表</RouterLink>

    <p v-if="taskQuery.isLoading.value" class="muted">加载中…</p>

    <template v-else-if="taskQuery.data.value">
      <div class="card stack sticky-summary">
        <div class="row-between">
          <StatusBadge :status="taskQuery.data.value.status" />
          <span v-if="activeRunId" class="muted live-indicator">
            <span class="dot" :class="{ live: connected }"></span>
            {{ connected ? '实时连接中' : '连接中断，重试中…' }}
          </span>
        </div>
        <p class="prompt-text">{{ taskQuery.data.value.prompt }}</p>
        <div class="row action-row">
          <Button
            variant="destructive"
            type="button"
            class="min-h-11"
            :disabled="!canCancel || cancelMutation.isPending.value"
            @click="confirmCancel"
          >
            {{ cancelMutation.isPending.value ? '取消中…' : '取消任务' }}
          </Button>
          <Button
            v-if="canRetry"
            type="button"
            class="min-h-11"
            :disabled="retryMutation.isPending.value"
            @click="retryRun"
          >
            {{ retryMutation.isPending.value ? '重试中…' : '重试' }}
          </Button>
          <Button
            v-if="pullRequests.length && pullRequests[0].uri"
            as="a"
            variant="outline"
            class="min-h-11"
            :href="pullRequests[0].uri"
            target="_blank"
            rel="noopener noreferrer"
          >
            打开 PR
          </Button>
        </div>
        <p v-if="cancelError" class="error-text">{{ cancelError }}</p>
        <p v-if="retryError" class="error-text">{{ retryError }}</p>

        <ApprovalPanel :run-id="activeRunId" :events="allEvents" />
      </div>

      <nav class="tab-bar" aria-label="任务详情分区">
        <button
          v-for="tab in tabs"
          :key="tab"
          class="tab-btn"
          :class="{ active: activeTab === tab }"
          type="button"
          @click="activeTab = tab"
        >
          {{ tabLabels[tab] }}
        </button>
      </nav>

      <section v-if="activeTab === 'overview'" class="card stack">
        <dl class="overview-grid">
          <dt>项目</dt>
          <dd>{{ projectName }}</dd>
          <dt>来源</dt>
          <dd>{{ taskQuery.data.value.source }}</dd>
          <dt>意图</dt>
          <dd>{{ taskQuery.data.value.intent }}</dd>
          <dt>创建者</dt>
          <dd>{{ taskQuery.data.value.createdBy ?? '—' }}</dd>
          <dt>创建时间</dt>
          <dd>{{ formatTime(taskQuery.data.value.createdAt) }}</dd>
          <dt v-if="latestRun">Run ID</dt>
          <dd v-if="latestRun">{{ latestRun.id }}</dd>
          <dt v-if="latestRun">Runner</dt>
          <dd v-if="latestRun">{{ latestRun.runnerId ?? '未分配' }}</dd>
          <dt v-if="latestRun">分支</dt>
          <dd v-if="latestRun">{{ latestRun.branch ?? '—' }}</dd>
          <dt v-if="latestRun?.errorCode">错误码</dt>
          <dd v-if="latestRun?.errorCode">{{ latestRun.errorCode }}</dd>
          <dt v-if="latestRun?.errorMessage">错误信息</dt>
          <dd v-if="latestRun?.errorMessage">{{ latestRun.errorMessage }}</dd>
        </dl>
      </section>

      <section v-else-if="activeTab === 'timeline'" class="card">
        <RunTimeline :events="allEvents" />
      </section>

      <section v-else-if="activeTab === 'output'" class="card">
        <LogViewer :lines="agentOutputLines" />
        <p v-if="!agentOutputLines.length" class="muted">暂无 Agent 输出。</p>
      </section>

      <section v-else-if="activeTab === 'logs'" class="card">
        <LogViewer :lines="logLines" />
        <p v-if="!logLines.length" class="muted">暂无日志。</p>
      </section>

      <section v-else-if="activeTab === 'files'" class="card stack">
        <p v-if="!changedFiles.length" class="muted">暂无变更文件记录。</p>
        <div v-for="artifact in changedFiles" :key="artifact.id" class="stack artifact-block">
          <strong>{{ artifact.title }}</strong>
          <pre v-if="artifact.metadata" class="log-content-inline">{{
            JSON.stringify(artifact.metadata, null, 2)
          }}</pre>
        </div>
      </section>

      <section v-else-if="activeTab === 'tests'" class="card stack">
        <p v-if="!testResults.length" class="muted">暂无测试结果。</p>
        <div v-for="artifact in testResults" :key="artifact.id" class="stack artifact-block">
          <strong>{{ artifact.title }}</strong>
          <pre v-if="artifact.metadata" class="log-content-inline">{{
            JSON.stringify(artifact.metadata, null, 2)
          }}</pre>
        </div>
      </section>

      <section v-else-if="activeTab === 'artifacts'" class="card stack">
        <p v-if="!otherArtifacts.length && !pullRequests.length" class="muted">暂无产物。</p>
        <div v-for="artifact in [...pullRequests, ...otherArtifacts]" :key="artifact.id" class="row-between">
          <span>
            <strong>{{ artifact.title }}</strong>
            <span class="muted"> · {{ artifact.type }}</span>
          </span>
          <a v-if="artifact.uri" :href="artifact.uri" target="_blank" rel="noopener noreferrer">打开</a>
        </div>
      </section>
    </template>

    <p v-else class="empty-state">任务不存在或已被删除。</p>
  </div>
</template>

<style scoped>
.back-link {
  display: inline-block;
}

.sticky-summary {
  position: sticky;
  top: calc(var(--nav-height) - 4px);
  z-index: 5;
}

.prompt-text {
  white-space: pre-wrap;
  margin: 0;
}

.live-indicator {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-muted);
}

.dot.live {
  background: var(--color-success);
}

.action-row {
  flex-wrap: wrap;
}

.tab-bar {
  display: flex;
  overflow-x: auto;
  gap: 0.4rem;
  padding-bottom: 0.25rem;
  -webkit-overflow-scrolling: touch;
}

.tab-btn {
  flex-shrink: 0;
  padding: 0.5rem 0.9rem;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-alt);
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.tab-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-primary-contrast);
}

.overview-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.4rem 0.75rem;
  margin: 0;
}

.overview-grid dt {
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.overview-grid dd {
  margin: 0;
  word-break: break-word;
}

.artifact-block {
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0.75rem;
}

.artifact-block:last-child {
  border-bottom: none;
}

.log-content-inline {
  background: #05060a;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 0.5rem;
  font-size: 0.75rem;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (min-width: 768px) {
  .sticky-summary {
    position: static;
  }
}
</style>
