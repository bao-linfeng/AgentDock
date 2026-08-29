<script setup lang="ts">
import { computed } from 'vue';
import type { RunEventDto } from '../types';

// Timeline tab: chronological status transitions + errors (docs/tasks.md T7.4).
const props = defineProps<{ events: RunEventDto[] }>();

const timelineEvents = computed(() =>
  props.events
    .filter((e) => e.type === 'status' || e.type === 'error')
    .slice()
    .sort((a, b) => a.seq - b.seq),
);

function describe(event: RunEventDto): string {
  if (event.type === 'status') {
    const payload = event.payload as { status?: string } | undefined;
    return `状态变更为 ${payload?.status ?? '未知'}`;
  }
  const payload = event.payload as { message?: string; code?: string } | undefined;
  return `错误：${payload?.message ?? '未知错误'}${payload?.code ? ` (${payload.code})` : ''}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}
</script>

<template>
  <ol class="timeline">
    <li v-for="event in timelineEvents" :key="event.id" class="timeline-item" :class="event.type">
      <span class="dot" aria-hidden="true"></span>
      <div class="timeline-body">
        <div class="row-between">
          <strong>{{ describe(event) }}</strong>
          <span class="muted">{{ formatTime(event.createdAt) }}</span>
        </div>
      </div>
    </li>
    <li v-if="!timelineEvents.length" class="empty-state">暂无时间线事件。</li>
  </ol>
</template>

<style scoped>
.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.timeline-item {
  display: flex;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-left: 2px solid var(--color-border);
  margin-left: 0.4rem;
  padding-left: 1rem;
  position: relative;
}

.dot {
  position: absolute;
  left: -0.5rem;
  top: 0.6rem;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-muted);
}

.timeline-item.error .dot {
  background: var(--color-danger);
}

.timeline-body {
  flex: 1;
}
</style>
