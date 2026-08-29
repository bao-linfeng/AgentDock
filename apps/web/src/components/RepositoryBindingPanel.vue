<script setup lang="ts">
// Repository <-> Project binding (docs/tasks.md T6.1/T7.2, issue #28/#33).
//
// New component built with Tailwind + shadcn-vue primitives per project rule
// #5/#6 (new UI work should not extend the legacy `.btn`/`.card` classes still
// used by the surrounding ProjectsView.vue, which predates the shadcn-vue
// migration).
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { ApiError } from '../api/client';
import { githubApi } from '../api/github';
import { repositoriesApi } from '../api/repositories';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

const props = defineProps<{ projectId: string }>();

const queryClient = useQueryClient();

const statusQuery = useQuery({
  queryKey: ['github', 'status'],
  queryFn: () => githubApi.status(),
});

const installationsQuery = useQuery({
  queryKey: ['github', 'installations'],
  queryFn: () => githubApi.installations(),
  enabled: computed(() => statusQuery.data.value?.appConfigured === true),
});

const repositoriesQuery = useQuery({
  queryKey: ['repositories', props.projectId],
  queryFn: () => repositoriesApi.list(props.projectId),
});

const owner = ref('');
const repo = ref('');
const installationId = ref('');
const formError = ref<string | null>(null);

const bindMutation = useMutation({
  mutationFn: () =>
    repositoriesApi.bind(props.projectId, {
      owner: owner.value.trim(),
      repo: repo.value.trim(),
      installationId: installationId.value,
    }),
  onSuccess: () => {
    owner.value = '';
    repo.value = '';
    installationId.value = '';
    formError.value = null;
    queryClient.invalidateQueries({ queryKey: ['repositories', props.projectId] });
  },
  onError: (err: unknown) => {
    formError.value = err instanceof ApiError ? err.message : '绑定失败';
  },
});

const unbindMutation = useMutation({
  mutationFn: (repositoryId: string) => repositoriesApi.unbind(props.projectId, repositoryId),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['repositories', props.projectId] });
  },
});

function submitBinding() {
  formError.value = null;
  if (!owner.value.trim() || !repo.value.trim()) {
    formError.value = '请填写 owner 与 repo';
    return;
  }
  if (!installationId.value) {
    formError.value = '请选择 GitHub App Installation';
    return;
  }
  bindMutation.mutate();
}
</script>

<template>
  <div class="flex flex-col gap-3 border-t pt-3 text-sm">
    <p class="font-medium text-foreground">仓库绑定</p>

    <p v-if="statusQuery.isLoading.value" class="text-muted-foreground">加载 GitHub 配置中…</p>

    <p v-else-if="!statusQuery.data.value?.appConfigured" class="text-muted-foreground">
      尚未配置 GitHub App（<code class="text-xs">GITHUB_APP_ID</code> /
      <code class="text-xs">GITHUB_PRIVATE_KEY</code>），无法绑定仓库。配置后重启 Control
      Server 即可使用。
    </p>

    <template v-else>
      <ul v-if="repositoriesQuery.data.value?.length" class="flex flex-col gap-1">
        <li
          v-for="repository in repositoriesQuery.data.value"
          :key="repository.id"
          class="flex items-center justify-between rounded-md border px-3 py-1.5"
        >
          <span>
            {{ repository.owner }}/{{ repository.repo }}
            <span class="text-muted-foreground"> · installation {{ repository.installationId }}</span>
          </span>
          <Button
            variant="destructive"
            size="sm"
            type="button"
            :disabled="unbindMutation.isPending.value"
            @click="unbindMutation.mutate(repository.id)"
          >
            解绑
          </Button>
        </li>
      </ul>
      <p v-else class="text-muted-foreground">该项目尚未绑定任何仓库。</p>

      <form class="flex flex-col gap-2" @submit.prevent="submitBinding">
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div class="flex flex-col gap-1">
            <Label :for="`owner-${projectId}`">Owner</Label>
            <Input :id="`owner-${projectId}`" v-model="owner" placeholder="acme" maxlength="100" />
          </div>
          <div class="flex flex-col gap-1">
            <Label :for="`repo-${projectId}`">Repo</Label>
            <Input :id="`repo-${projectId}`" v-model="repo" placeholder="payment-service" maxlength="100" />
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <Label>GitHub App Installation</Label>
          <Select v-model="installationId">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="选择 Installation" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="installation in installationsQuery.data.value"
                :key="installation.id"
                :value="installation.id"
              >
                {{ installation.account }} ({{ installation.id }})
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="installationsQuery.data.value?.length === 0" class="text-xs text-muted-foreground">
            未找到任何 Installation，请先在 GitHub 上为该 App 安装并授权仓库。
          </p>
        </div>

        <p v-if="formError" class="text-destructive text-sm">{{ formError }}</p>

        <Button type="submit" size="sm" class="self-start" :disabled="bindMutation.isPending.value">
          {{ bindMutation.isPending.value ? '绑定中…' : '绑定仓库' }}
        </Button>
      </form>
    </template>
  </div>
</template>
