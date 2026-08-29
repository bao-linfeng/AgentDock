<script setup lang="ts">
// Approval gate panel (docs/tasks.md T8.3, #37): surfaces pending shell / push
// / destructive approvals for a run and lets the user approve or deny them.
//
// New component built with Tailwind + shadcn-vue primitives per project rule
// #5/#6 (kept consistent with RepositoryBindingPanel.vue).
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { approvalsApi } from '../api/approvals';
import { ApiError } from '../api/client';
import type { ApprovalDto } from '../types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

const props = defineProps<{ runId: string | undefined }>();

const queryClient = useQueryClient();

const approvalsQuery = useQuery({
  queryKey: ['run-approvals', () => props.runId],
  queryFn: () => approvalsApi.listForRun(props.runId as string),
  enabled: computed(() => !!props.runId),
  refetchInterval: 5000,
});

const pendingApprovals = computed(() =>
  (approvalsQuery.data.value ?? []).filter((a) => a.status === 'pending'),
);
const resolvedApprovals = computed(() =>
  (approvalsQuery.data.value ?? []).filter((a) => a.status !== 'pending'),
);

const error = ref<string | null>(null);

const resolveMutation = useMutation({
  mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'denied' }) =>
    approvalsApi.resolve(id, { decision, resolvedBy: 'web' }),
  onSuccess: () => {
    error.value = null;
    queryClient.invalidateQueries({ queryKey: ['run-approvals', props.runId] });
  },
  onError: (err: unknown) => {
    error.value = err instanceof ApiError ? err.message : '操作失败';
  },
});

// Re-fetch immediately once the run id becomes available (e.g. task just claimed).
watch(
  () => props.runId,
  () => {
    if (props.runId) queryClient.invalidateQueries({ queryKey: ['run-approvals', props.runId] });
  },
);

const actionLabels: Record<ApprovalDto['action'], string> = {
  shell: 'Shell 命令',
  push: '推送分支',
  destructive: '破坏性操作',
};

function formatTime(iso?: string): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}
</script>

<template>
  <div v-if="pendingApprovals.length || resolvedApprovals.length" class="flex flex-col gap-3 border-t pt-3 text-sm">
    <p class="font-medium text-foreground">审批</p>

    <ul v-if="pendingApprovals.length" class="flex flex-col gap-2">
      <li
        v-for="approval in pendingApprovals"
        :key="approval.id"
        class="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3"
      >
        <div class="flex items-center justify-between gap-2">
          <Badge variant="outline" class="border-transparent bg-amber-500/15 text-amber-500">
            {{ actionLabels[approval.action] }}
          </Badge>
          <span class="text-xs text-muted-foreground">{{ formatTime(approval.requestedAt) }}</span>
        </div>
        <p class="break-words font-mono text-xs">{{ approval.summary ?? '（无摘要）' }}</p>
        <div class="flex gap-2">
          <Button
            size="sm"
            :disabled="resolveMutation.isPending.value"
            @click="resolveMutation.mutate({ id: approval.id, decision: 'approved' })"
          >
            批准
          </Button>
          <Button
            size="sm"
            variant="destructive"
            :disabled="resolveMutation.isPending.value"
            @click="resolveMutation.mutate({ id: approval.id, decision: 'denied' })"
          >
            拒绝
          </Button>
        </div>
      </li>
    </ul>

    <p v-if="error" class="text-destructive text-sm">{{ error }}</p>

    <details v-if="resolvedApprovals.length" class="text-xs text-muted-foreground">
      <summary class="cursor-pointer select-none">已处理的审批（{{ resolvedApprovals.length }}）</summary>
      <ul class="mt-2 flex flex-col gap-1">
        <li v-for="approval in resolvedApprovals" :key="approval.id" class="flex items-center justify-between gap-2">
          <span>
            {{ actionLabels[approval.action] }}
            <span class="font-mono">· {{ approval.summary ?? '' }}</span>
          </span>
          <span :class="approval.status === 'approved' ? 'text-emerald-500' : 'text-destructive'">
            {{ approval.status === 'approved' ? '已批准' : '已拒绝' }}
          </span>
        </li>
      </ul>
    </details>
  </div>
</template>
