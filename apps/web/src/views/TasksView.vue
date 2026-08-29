<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError } from '../api/client';
import { projectsApi } from '../api/projects';
import { tasksApi } from '../api/tasks';
import StatusBadge from '../components/StatusBadge.vue';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { PROMPT_MAX_LENGTH, buildCreateTaskPayload } from '../lib/task-form';
import {
  type ListTasksQuery,
  TASK_INTENTS,
  TASK_STATUSES,
  type TaskIntent,
  type TaskSource,
  type TaskStatus,
} from '../types';

/** Sentinel for "no filter" — reka-ui's Select does not allow an empty value. */
const ALL = 'all';

// Task list (docs/tasks.md T7.3 / issue #34) with status/project/source filters,
// plus the "new task" dispatch form (T7.6 / issue #59 — requirements.md §3.1
// "Web 创建 Task", US-01).

const router = useRouter();
const queryClient = useQueryClient();

const filters = reactive<{
  status: TaskStatus | typeof ALL;
  projectId: string;
  source: TaskSource | typeof ALL;
}>({
  status: ALL,
  projectId: ALL,
  source: ALL,
});

const query = computed<ListTasksQuery>(() => ({
  status: filters.status === ALL ? undefined : filters.status,
  projectId: filters.projectId === ALL ? undefined : filters.projectId,
  source: filters.source === ALL ? undefined : filters.source,
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

function projectName(projectId: string): string {
  return projectsQuery.data.value?.find((p) => p.id === projectId)?.name ?? projectId;
}

function clearFilters() {
  filters.status = ALL;
  filters.projectId = ALL;
  filters.source = ALL;
}

// --- New task dispatch (T7.6) ---------------------------------------------

const showForm = ref(false);
const formError = ref<string | null>(null);
const dedupeNotice = ref<string | null>(null);

const form = reactive<{ projectId: string; intent: TaskIntent; prompt: string }>({
  projectId: '',
  intent: 'general',
  prompt: '',
});

function startCreate() {
  formError.value = null;
  dedupeNotice.value = null;
  form.projectId =
    filters.projectId !== ALL ? filters.projectId : (projectsQuery.data.value?.[0]?.id ?? '');
  form.intent = 'general';
  form.prompt = '';
  showForm.value = true;
}

const createMutation = useMutation({
  mutationFn: () => {
    const built = buildCreateTaskPayload(form);
    if (!built.ok) throw new Error(built.error);
    return tasksApi.create(built.payload);
  },
  onSuccess: (result) => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    showForm.value = false;
    dedupeNotice.value = result.deduplicated ? '该任务与已有任务重复，已打开既有任务。' : null;
    router.push({ name: 'task-detail', params: { id: result.task.id } });
  },
  onError: (err: unknown) => {
    formError.value =
      err instanceof ApiError ? err.message : err instanceof Error ? err.message : '创建任务失败';
  },
});

function submitCreate() {
  const built = buildCreateTaskPayload(form);
  if (!built.ok) {
    formError.value = built.error;
    return;
  }
  formError.value = null;
  createMutation.mutate();
}
</script>

<template>
  <div class="flex flex-col gap-6 p-4 sm:p-6">
    <div class="flex items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold text-foreground">任务</h1>
      <Button type="button" class="min-h-11" @click="startCreate">新建任务</Button>
    </div>

    <p v-if="dedupeNotice" class="text-sm text-muted-foreground">{{ dedupeNotice }}</p>

    <div
      class="grid grid-cols-1 gap-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-[repeat(3,1fr)_auto] sm:items-end"
    >
      <div class="flex flex-col gap-1.5">
        <Label for="f-status">状态</Label>
        <Select v-model="filters.status">
          <SelectTrigger id="f-status" class="w-full min-h-11">
            <SelectValue placeholder="全部" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="ALL">全部</SelectItem>
            <SelectItem v-for="s in TASK_STATUSES" :key="s" :value="s">{{ s }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="flex flex-col gap-1.5">
        <Label for="f-project">项目</Label>
        <Select v-model="filters.projectId">
          <SelectTrigger id="f-project" class="w-full min-h-11">
            <SelectValue placeholder="全部" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="ALL">全部</SelectItem>
            <SelectItem v-for="p in projectsQuery.data.value" :key="p.id" :value="p.id">
              {{ p.name }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="flex flex-col gap-1.5">
        <Label for="f-source">来源</Label>
        <Select v-model="filters.source">
          <SelectTrigger id="f-source" class="w-full min-h-11">
            <SelectValue placeholder="全部" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="ALL">全部</SelectItem>
            <SelectItem value="web">web</SelectItem>
            <SelectItem value="github">github</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button variant="outline" type="button" class="min-h-11" @click="clearFilters">重置</Button>
    </div>

    <p v-if="tasksQuery.isLoading.value" class="text-muted-foreground">加载中…</p>
    <p
      v-else-if="!tasksQuery.data.value?.length"
      class="rounded-md border border-dashed p-6 text-center text-muted-foreground"
    >
      没有匹配的任务。
    </p>

    <ul v-else class="flex list-none flex-col gap-4 p-0">
      <li v-for="task in tasksQuery.data.value" :key="task.id">
        <RouterLink
          :to="{ name: 'task-detail', params: { id: task.id } }"
          class="flex flex-col gap-2 rounded-lg border bg-card p-4 text-foreground shadow-sm"
        >
          <div class="flex items-center justify-between">
            <StatusBadge :status="task.status" />
            <span class="text-sm text-muted-foreground">{{ task.source }}</span>
          </div>
          <p class="m-0 line-clamp-3">{{ task.prompt }}</p>
          <div class="flex items-center justify-between text-sm text-muted-foreground">
            <span>{{ projectName(task.projectId) }}</span>
            <span>{{ task.intent }}</span>
          </div>
        </RouterLink>
      </li>
    </ul>

    <Dialog v-model:open="showForm">
      <DialogContent class="sm:max-w-[520px]">
        <form class="flex flex-col gap-4" @submit.prevent="submitCreate()">
          <DialogHeader>
            <DialogTitle>新建任务</DialogTitle>
          </DialogHeader>

          <div class="flex flex-col gap-1.5">
            <Label for="new-project">项目</Label>
            <Select v-model="form.projectId">
              <SelectTrigger id="new-project" class="w-full min-h-11">
                <SelectValue placeholder="选择项目" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="p in projectsQuery.data.value" :key="p.id" :value="p.id">
                  {{ p.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p v-if="!projectsQuery.data.value?.length" class="text-sm text-muted-foreground">
              还没有项目，请先在「项目」页创建并映射 Runner。
            </p>
          </div>

          <div class="flex flex-col gap-1.5">
            <Label for="new-intent">意图</Label>
            <Select v-model="form.intent">
              <SelectTrigger id="new-intent" class="w-full min-h-11">
                <SelectValue placeholder="选择意图" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="i in TASK_INTENTS" :key="i" :value="i">{{ i }}</SelectItem>
              </SelectContent>
            </Select>
            <p class="text-sm text-muted-foreground">
              fix / implement 需要满足项目配置的证据规则（默认含测试、提交与 PR）才会判定成功。
            </p>
          </div>

          <div class="flex flex-col gap-1.5">
            <Label for="new-prompt">任务描述</Label>
            <Textarea
              id="new-prompt"
              v-model="form.prompt"
              rows="6"
              :maxlength="PROMPT_MAX_LENGTH"
              placeholder="例如：修复支付回调重复处理问题，并运行相关测试。"
            />
          </div>

          <p v-if="formError" class="text-sm text-destructive">{{ formError }}</p>

          <DialogFooter>
            <Button variant="outline" type="button" class="min-h-11" @click="showForm = false">
              取消
            </Button>
            <Button type="submit" class="min-h-11" :disabled="createMutation.isPending.value">
              {{ createMutation.isPending.value ? '创建中…' : '创建任务' }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
