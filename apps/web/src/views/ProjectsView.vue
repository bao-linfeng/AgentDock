<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { reactive, ref } from 'vue';
import RepositoryBindingPanel from '../components/RepositoryBindingPanel.vue';
import { projectsApi } from '../api/projects';
import { runnersApi } from '../api/runners';
import { ApiError } from '../api/client';
import type { CreateProjectInput, ProjectDto, RunnerProjectDto } from '../types';

// Projects (docs/tasks.md T7.2 / issue #33): list, create/edit, runner mapping.
//
// Repository binding is backed by /projects/:projectId/repositories once the
// GitHub App is configured (see RepositoryBindingPanel.vue, issue #28).

const queryClient = useQueryClient();

const projectsQuery = useQuery({
  queryKey: ['projects'],
  queryFn: () => projectsApi.list(),
});

const runnersQuery = useQuery({
  queryKey: ['runners'],
  queryFn: () => runnersApi.list(),
});

const showForm = ref(false);
const editingId = ref<string | null>(null);
const formError = ref<string | null>(null);

const form = reactive<CreateProjectInput>({
  name: '',
  workspaceKey: '',
  defaultBranch: 'main',
  testCommand: '',
  buildCommand: '',
});

function resetForm() {
  form.name = '';
  form.workspaceKey = '';
  form.defaultBranch = 'main';
  form.testCommand = '';
  form.buildCommand = '';
  editingId.value = null;
  formError.value = null;
}

function startCreate() {
  resetForm();
  showForm.value = true;
}

function startEdit(project: ProjectDto) {
  editingId.value = project.id;
  form.name = project.name;
  form.workspaceKey = project.workspaceKey;
  form.defaultBranch = project.defaultBranch;
  form.testCommand = project.testCommand ?? '';
  form.buildCommand = project.buildCommand ?? '';
  formError.value = null;
  showForm.value = true;
}

const saveMutation = useMutation({
  mutationFn: async () => {
    const payload: CreateProjectInput = {
      name: form.name.trim(),
      workspaceKey: form.workspaceKey.trim(),
      defaultBranch: form.defaultBranch?.trim() || 'main',
      testCommand: form.testCommand?.trim() ? form.testCommand.trim() : null,
      buildCommand: form.buildCommand?.trim() ? form.buildCommand.trim() : null,
    };
    if (editingId.value) {
      return projectsApi.update(editingId.value, payload);
    }
    return projectsApi.create(payload);
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    showForm.value = false;
    resetForm();
  },
  onError: (err: unknown) => {
    formError.value = err instanceof ApiError ? err.message : '保存失败';
  },
});

const deleteMutation = useMutation({
  mutationFn: (id: string) => projectsApi.remove(id),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  onError: (err: unknown) => {
    deleteError.value = err instanceof ApiError ? err.message : '删除失败';
  },
});

const deleteError = ref<string | null>(null);

function confirmDelete(project: ProjectDto) {
  deleteError.value = null;
  if (window.confirm(`删除项目「${project.name}」？此操作不可撤销。`)) {
    deleteMutation.mutate(project.id);
  }
}

// Runner mapping management, expanded per-project.
const expandedProjectId = ref<string | null>(null);
const mappingPath = ref('');
const mappingRunnerId = ref('');
const mappingError = ref<string | null>(null);

function toggleExpand(project: ProjectDto) {
  expandedProjectId.value = expandedProjectId.value === project.id ? null : project.id;
  mappingError.value = null;
}

async function loadMappingsFor(runnerId: string) {
  if (!runnerId) return [];
  return runnersApi.listProjects(runnerId);
}

const mappingsByRunner = reactive<Record<string, RunnerProjectDto[]>>({});

async function refreshMappings() {
  const runners = runnersQuery.data.value ?? [];
  for (const runner of runners) {
    mappingsByRunner[runner.id] = await loadMappingsFor(runner.id);
  }
}

const upsertMappingMutation = useMutation({
  mutationFn: async (vars: { runnerId: string; projectId: string; workspacePath: string }) =>
    runnersApi.upsertProject(vars.runnerId, vars.projectId, {
      workspacePath: vars.workspacePath,
      enabled: true,
    }),
  onSuccess: async () => {
    mappingPath.value = '';
    mappingRunnerId.value = '';
    await refreshMappings();
  },
  onError: (err: unknown) => {
    mappingError.value = err instanceof ApiError ? err.message : '映射保存失败';
  },
});

const removeMappingMutation = useMutation({
  mutationFn: (vars: { runnerId: string; projectId: string }) =>
    runnersApi.removeProject(vars.runnerId, vars.projectId),
  onSuccess: async () => {
    await refreshMappings();
  },
});

function addMapping(projectId: string) {
  mappingError.value = null;
  if (!mappingRunnerId.value) {
    mappingError.value = '请选择 Runner';
    return;
  }
  if (!mappingPath.value.trim()) {
    mappingError.value = '请填写该 Runner 本机的工作区路径';
    return;
  }
  upsertMappingMutation.mutate({
    runnerId: mappingRunnerId.value,
    projectId,
    workspacePath: mappingPath.value.trim(),
  });
}

function mappingsFor(projectId: string): Array<{ runnerName: string; mapping: RunnerProjectDto }> {
  const runners = runnersQuery.data.value ?? [];
  const result: Array<{ runnerName: string; mapping: RunnerProjectDto }> = [];
  for (const runner of runners) {
    const mapping = (mappingsByRunner[runner.id] ?? []).find((m) => m.projectId === projectId);
    if (mapping) result.push({ runnerName: runner.name, mapping });
  }
  return result;
}

// Load runner->project mappings once runners are available.
runnersQuery.suspense().then(refreshMappings);
</script>

<template>
  <div class="page stack">
    <div class="row-between">
      <h1>项目</h1>
      <button class="btn btn-primary" type="button" @click="startCreate">新建项目</button>
    </div>

    <p v-if="projectsQuery.isLoading.value" class="muted">加载中…</p>
    <p v-else-if="!projectsQuery.data.value?.length" class="empty-state">
      还没有项目，点击「新建项目」创建第一个。
    </p>

    <ul v-else class="stack project-list">
      <li v-for="project in projectsQuery.data.value" :key="project.id" class="card stack">
        <div class="row-between">
          <div>
            <strong>{{ project.name }}</strong>
            <div class="muted">workspaceKey: {{ project.workspaceKey }}</div>
          </div>
          <div class="row">
            <button class="btn" type="button" @click="startEdit(project)">编辑</button>
            <button class="btn btn-danger" type="button" @click="confirmDelete(project)">删除</button>
          </div>
        </div>
        <div class="muted">
          默认分支：{{ project.defaultBranch }}
          <span v-if="project.testCommand"> · 测试命令：{{ project.testCommand }}</span>
          <span v-if="project.buildCommand"> · 构建命令：{{ project.buildCommand }}</span>
        </div>

        <RepositoryBindingPanel :project-id="project.id" />

        <button class="btn mapping-toggle" type="button" @click="toggleExpand(project)">
          {{ expandedProjectId === project.id ? '收起 Runner 映射' : '管理 Runner 映射' }}
        </button>

        <div v-if="expandedProjectId === project.id" class="stack mapping-panel">
          <div v-if="mappingsFor(project.id).length" class="stack">
            <div
              v-for="entry in mappingsFor(project.id)"
              :key="entry.mapping.runnerId"
              class="row-between mapping-row"
            >
              <span>
                <strong>{{ entry.runnerName }}</strong>
                <span class="muted"> · {{ entry.mapping.workspacePath }}</span>
                <span v-if="!entry.mapping.enabled" class="muted"> (已禁用)</span>
              </span>
              <button
                class="btn btn-danger"
                type="button"
                @click="removeMappingMutation.mutate({ runnerId: entry.mapping.runnerId, projectId: project.id })"
              >
                移除
              </button>
            </div>
          </div>
          <p v-else class="muted">该项目尚未映射到任何 Runner。</p>

          <div class="stack add-mapping">
            <div class="field">
              <label>Runner</label>
              <select v-model="mappingRunnerId">
                <option value="" disabled>选择 Runner</option>
                <option v-for="runner in runnersQuery.data.value" :key="runner.id" :value="runner.id">
                  {{ runner.name }}
                </option>
              </select>
            </div>
            <div class="field">
              <label>该 Runner 本机的工作区绝对路径</label>
              <input v-model="mappingPath" type="text" placeholder="例如 C:\\work\\my-project" />
            </div>
            <p v-if="mappingError" class="error-text">{{ mappingError }}</p>
            <button
              class="btn btn-primary"
              type="button"
              :disabled="upsertMappingMutation.isPending.value"
              @click="addMapping(project.id)"
            >
              保存映射
            </button>
          </div>
        </div>
      </li>
    </ul>

    <p v-if="deleteError" class="error-text">{{ deleteError }}</p>

    <div v-if="showForm" class="modal-backdrop" @click.self="showForm = false">
      <form class="card stack modal-form" @submit.prevent="saveMutation.mutate()">
        <h2>{{ editingId ? '编辑项目' : '新建项目' }}</h2>
        <div class="field">
          <label for="name">名称</label>
          <input id="name" v-model="form.name" type="text" required maxlength="120" />
        </div>
        <div class="field">
          <label for="workspaceKey">workspaceKey（逻辑标识，仅限字母/数字/._-）</label>
          <input
            id="workspaceKey"
            v-model="form.workspaceKey"
            type="text"
            required
            maxlength="120"
            pattern="^[A-Za-z0-9._-]+$"
          />
        </div>
        <div class="field">
          <label for="defaultBranch">默认分支</label>
          <input id="defaultBranch" v-model="form.defaultBranch" type="text" maxlength="200" />
        </div>
        <div class="field">
          <label for="testCommand">测试命令（可选）</label>
          <input id="testCommand" v-model="form.testCommand" type="text" maxlength="500" />
        </div>
        <div class="field">
          <label for="buildCommand">构建命令（可选）</label>
          <input id="buildCommand" v-model="form.buildCommand" type="text" maxlength="500" />
        </div>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="row">
          <button class="btn btn-primary" type="submit" :disabled="saveMutation.isPending.value">
            {{ saveMutation.isPending.value ? '保存中…' : '保存' }}
          </button>
          <button class="btn" type="button" @click="showForm = false">取消</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.project-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.mapping-toggle {
  align-self: flex-start;
  font-size: 0.85rem;
}

.mapping-panel {
  border-top: 1px solid var(--color-border);
  padding-top: 0.75rem;
}

.mapping-row {
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--color-border);
}

.add-mapping {
  border-top: 1px dashed var(--color-border);
  padding-top: 0.75rem;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 50;
  padding: 0;
}

.modal-form {
  width: 100%;
  max-width: 480px;
  border-radius: var(--radius) var(--radius) 0 0;
  max-height: 90vh;
  overflow-y: auto;
}

@media (min-width: 768px) {
  .modal-backdrop {
    align-items: center;
    padding: 1rem;
  }

  .modal-form {
    border-radius: var(--radius);
  }
}
</style>
