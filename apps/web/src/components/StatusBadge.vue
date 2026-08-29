<script setup lang="ts">
import { Badge } from '@/components/ui/badge';

defineProps<{ status: string }>();

const labels: Record<string, string> = {
  queued: '排队中',
  assigned: '已分配',
  running: '运行中',
  needs_approval: '待审批',
  verifying: '验证中',
  publishing: '发布中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
};

const statusClasses: Record<string, string> = {
  queued: 'bg-muted-foreground/15 text-muted-foreground border-transparent',
  assigned: 'bg-muted-foreground/15 text-muted-foreground border-transparent',
  running: 'bg-primary/15 text-primary border-transparent',
  verifying: 'bg-primary/15 text-primary border-transparent',
  publishing: 'bg-primary/15 text-primary border-transparent',
  needs_approval: 'bg-amber-500/15 text-amber-500 border-transparent',
  succeeded: 'bg-emerald-500/15 text-emerald-500 border-transparent',
  failed: 'bg-destructive/15 text-destructive border-transparent',
  cancelled: 'bg-muted-foreground/15 text-muted-foreground border-transparent',
};
</script>

<template>
  <Badge
    variant="outline"
    class="rounded-full text-[0.7rem] font-bold uppercase tracking-wide"
    :class="statusClasses[status]"
  >
    {{ labels[status] ?? status }}
  </Badge>
</template>
