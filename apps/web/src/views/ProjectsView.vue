<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { reactive, ref } from 'vue';
import RepositoryBindingPanel from '../components/RepositoryBindingPanel.vue';
import { projectsApi } from '../api/projects';
import { runnersApi } from '../api/runners';
import { ApiError } from '../api/client';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import {
  EDITABLE_INTENTS,
  type EditableEvidenceRules,
  fromEditableRules,
  toEditableRules,
  toggleKind,
} from '../lib/evidence-rules';
import {
  type CreateProjectInput,
  DEFAULT_EVIDENCE_RULES,
  type EvidenceKind,
  type ProjectDto,
  type RunnerProjectDto,
  type TaskIntent,
} from '../types';

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

// Per-project evidence rules (docs/tasks.md T8.4 / issue #60). The form always
// edits a full per-intent map; only the intents that differ from the defaults
// are sent (see lib/evidence-rules.ts).
const customEvidence = ref(false);
const evidenceRules = ref<EditableEvidenceRules>(toEditableRules(null));

/** Evidence kinds offered per intent — `review` only has a report. */
function kindsFor(intent: TaskIntent): EvidenceKind[] {
  return intent === 'review'
    ? ['review_report']
    : ['git_changes', 'test_result', 'commit', 'pull_request'];
}

function isChecked(intent: TaskIntent, kind: EvidenceKind): boolean {
  return evidenceRules.value[intent].includes(kind);
}

function setChecked(intent: TaskIntent, kind: EvidenceKind, checked: boolean): void {
  toggleKind(evidenceRules.value[intent], kind, checked);
}

function resetForm() {
  form.name = '';
  form.workspaceKey = '';
  form.defaultBranch = 'main';
  form.testCommand = '';
  form.buildCommand = '';
  customEvidence.value = false;
  evidenceRules.value = toEditableRules(null);
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
  customEvidence.value = !!project.evidenceRules;
  evidenceRules.value = toEditableRules(project.evidenceRules);
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
      evidenceRules: fromEditableRules(evidenceRules.value, customEvidence.value),
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
  <div class="flex flex-col gap-6 p-4 sm:p-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold text-foreground">项目</h1>
      <Button type="button" @click="startCreate">新建项目</Button>
    </div>

    <p v-if="projectsQuery.isLoading.value" class="text-muted-foreground">加载中…</p>
    <p
      v-else-if="!projectsQuery.data.value?.length"
      class="rounded-md border border-dashed p-6 text-center text-muted-foreground"
    >
      还没有项目，点击「新建项目」创建第一个。
    </p>

    <ul v-else class="flex flex-col gap-4">
      <li
        v-for="project in projectsQuery.data.value"
        :key="project.id"
        class="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm"
      >
        <div class="flex items-center justify-between">
          <div>
            <strong class="text-foreground">{{ project.name }}</strong>
            <div class="text-sm text-muted-foreground">workspaceKey: {{ project.workspaceKey }}</div>
          </div>
          <div class="flex gap-2">
            <Button variant="outline" size="sm" type="button" @click="startEdit(project)">编辑</Button>
            <Button variant="destructive" size="sm" type="button" @click="confirmDelete(project)">
              删除
            </Button>
          </div>
        </div>
        <div class="text-sm text-muted-foreground">
          默认分支：{{ project.defaultBranch }}
          <span v-if="project.testCommand"> · 测试命令：{{ project.testCommand }}</span>
          <span v-if="project.buildCommand"> · 构建命令：{{ project.buildCommand }}</span>
          <span v-if="project.evidenceRules"> · 证据规则：已自定义</span>
        </div>

        <RepositoryBindingPanel :project-id="project.id" />

        <Button
          variant="ghost"
          size="sm"
          type="button"
          class="self-start text-xs"
          @click="toggleExpand(project)"
        >
          {{ expandedProjectId === project.id ? '收起 Runner 映射' : '管理 Runner 映射' }}
        </Button>

        <div
          v-if="expandedProjectId === project.id"
          class="flex flex-col gap-3 border-t pt-3 text-sm"
        >
          <div v-if="mappingsFor(project.id).length" class="flex flex-col gap-1">
            <div
              v-for="entry in mappingsFor(project.id)"
              :key="entry.mapping.runnerId"
              class="flex items-center justify-between rounded-md border px-3 py-1.5"
            >
              <span>
                <strong>{{ entry.runnerName }}</strong>
                <span class="text-muted-foreground"> · {{ entry.mapping.workspacePath }}</span>
                <span v-if="!entry.mapping.enabled" class="text-muted-foreground"> (已禁用)</span>
              </span>
              <Button
                variant="destructive"
                size="sm"
                type="button"
                @click="removeMappingMutation.mutate({ runnerId: entry.mapping.runnerId, projectId: project.id })"
              >
                移除
              </Button>
            </div>
          </div>
          <p v-else class="text-muted-foreground">该项目尚未映射到任何 Runner。</p>

          <div class="flex flex-col gap-2 border-t border-dashed pt-3">
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div class="flex flex-col gap-1">
                <Label>Runner</Label>
                <Select v-model="mappingRunnerId">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="选择 Runner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="runner in runnersQuery.data.value"
                      :key="runner.id"
                      :value="runner.id"
                    >
                      {{ runner.name }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="flex flex-col gap-1">
                <Label>该 Runner 本机的工作区绝对路径</Label>
                <Input v-model="mappingPath" type="text" placeholder="例如 C:\work\my-project" />
              </div>
            </div>
            <p v-if="mappingError" class="text-sm text-destructive">{{ mappingError }}</p>
            <Button
              type="button"
              size="sm"
              class="self-start"
              :disabled="upsertMappingMutation.isPending.value"
              @click="addMapping(project.id)"
            >
              保存映射
            </Button>
          </div>
        </div>
      </li>
    </ul>

    <p v-if="deleteError" class="text-sm text-destructive">{{ deleteError }}</p>

    <Dialog v-model:open="showForm">
      <DialogContent class="sm:max-w-[480px]">
        <form class="flex flex-col gap-4" @submit.prevent="saveMutation.mutate()">
          <DialogHeader>
            <DialogTitle>{{ editingId ? '编辑项目' : '新建项目' }}</DialogTitle>
          </DialogHeader>

          <div class="flex flex-col gap-1.5">
            <Label for="name">名称</Label>
            <Input id="name" v-model="form.name" type="text" required maxlength="120" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="workspaceKey">workspaceKey（逻辑标识，仅限字母/数字/._-）</Label>
            <Input
              id="workspaceKey"
              v-model="form.workspaceKey"
              type="text"
              required
              maxlength="120"
              pattern="^[A-Za-z0-9._-]+$"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="defaultBranch">默认分支</Label>
            <Input id="defaultBranch" v-model="form.defaultBranch" type="text" maxlength="200" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="testCommand">测试命令（可选）</Label>
            <Input
              id="testCommand"
              :model-value="form.testCommand ?? ''"
              type="text"
              maxlength="500"
              @update:model-value="(v) => (form.testCommand = String(v))"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="buildCommand">构建命令（可选）</Label>
            <Input
              id="buildCommand"
              :model-value="form.buildCommand ?? ''"
              type="text"
              maxlength="500"
              @update:model-value="(v) => (form.buildCommand = String(v))"
            />
          </div>
          <p v-if="formError" class="text-sm text-destructive">{{ formError }}</p>

          <div class="flex flex-col gap-2 border-t pt-3">
            <div class="flex items-start gap-2">
              <Checkbox
                id="custom-evidence"
                :model-value="customEvidence"
                @update:model-value="(v) => (customEvidence = v === true)"
              />
              <div class="flex flex-col gap-0.5">
                <Label for="custom-evidence">自定义证据规则</Label>
                <span class="text-xs text-muted-foreground">
                  默认要求 fix / implement 满足变更 + 测试 + 提交 + PR。没有远端仓库
                  或未配置 GitHub App 的项目应去掉 pull_request，否则这类任务会一直
                  失败于 evidence_incomplete。
                </span>
              </div>
            </div>

            <div v-if="customEvidence" class="flex flex-col gap-3">
              <div
                v-for="intent in EDITABLE_INTENTS"
                :key="intent"
                class="flex flex-col gap-1.5 rounded-md border p-2"
              >
                <span class="text-sm font-medium text-foreground">{{ intent }}</span>
                <div class="flex flex-wrap gap-x-4 gap-y-1.5">
                  <label
                    v-for="kind in kindsFor(intent)"
                    :key="kind"
                    class="flex items-center gap-1.5 text-sm text-muted-foreground"
                  >
                    <Checkbox
                      :model-value="isChecked(intent, kind)"
                      @update:model-value="(v) => setChecked(intent, kind, v === true)"
                    />
                    {{ kind }}
                  </label>
                </div>
                <span class="text-xs text-muted-foreground">
                  默认：{{ DEFAULT_EVIDENCE_RULES[intent].join(', ') || '（无要求）' }}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" type="button" @click="showForm = false">取消</Button>
            <Button type="submit" :disabled="saveMutation.isPending.value">
              {{ saveMutation.isPending.value ? '保存中…' : '保存' }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
