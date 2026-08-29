<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive } from 'vue';
import { projectsApi } from '../api/projects';
import { tasksApi } from '../api/tasks';
import StatusBadge from '../components/StatusBadge.vue';
import type { ListTasksQuery, TaskSource, TaskStatus } from '../types';

// Task list (docs/tasks.md T7.3 / issue #34) with status/project/source filters.

const filters = reactive<{ status: TaskStatus | ''; projectId: string; source: TaskSource | '' }>({
  status: '',
  projectId: '',
  source: '',
});

const query = computed<ListTasksQuery>(() => ({
  status: filters.status || undefined,
  projectId: filters.projectId || undefined,
  source: filters.source || undefined,
  limit: 100,
}));

const projectsQuery = useQuery({
  queryKey: ['projects'],
  queryFn: () => projectsApi.list(),
});

const tasksQuery = useQuery({
  queryKey: ['tasks', query],
  queryFn: () => tasksApi.list(query.value),
});

const statusOptions: TaskStatus[] = [
  'queued',
  'assigned',
  'running',
  'needs_approval',
  'verifying',
  'publishing',
  'succeeded',
  'failed',
  'cancelled',
];

function projectName(projectId: string): string {
  return projectsQuery.data.value?.find((p) => p.id === projectId)?.name ?? projectId;
}

function clearFilters() {
  filters.status = '';
  filters.projectId = '';
  filters.source = '';
}
</script>

<template>
  <div class="page stack">
    <h1>任务</h1>

    <div class="card filters">
      <div class="field">
        <label for="f-status">状态</label>
        <select id="f-status" v-model="filters.status">
          <option value="">全部</option>
          <option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>
      <div class="field">
        <label for="f-project">项目</label>
        <select id="f-project" v-model="filters.projectId">
          <option value="">全部</option>
          <option v-for="p in projectsQuery.data.value" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
      <div class="field">
        <label for="f-source">来源</label>
        <select id="f-source" v-model="filters.source">
          <option value="">全部</option>
          <option value="web">web</option>
          <option value="github">github</option>
        </select>
      </div>
      <button class="btn" type="button" @click="clearFilters">重置</button>
    </div>

    <p v-if="tasksQuery.isLoading.value" class="muted">加载中…</p>
    <p v-else-if="!tasksQuery.data.value?.length" class="empty-state">没有匹配的任务。</p>

    <ul v-else class="stack task-list">
      <li v-for="task in tasksQuery.data.value" :key="task.id">
        <RouterLink :to="{ name: 'task-detail', params: { id: task.id } }" class="card task-card">
          <div class="row-between">
            <StatusBadge :status="task.status" />
            <span class="muted">{{ task.source }}</span>
          </div>
          <p class="task-prompt">{{ task.prompt }}</p>
          <div class="muted row-between">
            <span>{{ projectName(task.projectId) }}</span>
            <span>{{ task.intent }}</span>
          </div>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
}

.task-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.task-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  color: var(--color-text);
}

.task-prompt {
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

@media (min-width: 600px) {
  .filters {
    grid-template-columns: repeat(3, 1fr) auto;
    align-items: end;
  }
}
</style>
