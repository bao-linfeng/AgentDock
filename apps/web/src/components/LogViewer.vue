<script setup lang="ts">
import { computed, ref } from 'vue';

// Collapsible long-log viewer (docs/tasks.md T7.5 "长日志可折叠").
const props = defineProps<{ lines: string[]; collapsedHeight?: number }>();

const expanded = ref(false);
const COLLAPSE_THRESHOLD = 12;

const isLong = computed(() => props.lines.length > COLLAPSE_THRESHOLD);
const visibleLines = computed(() => {
  if (!isLong.value || expanded.value) return props.lines;
  return props.lines.slice(-COLLAPSE_THRESHOLD);
});
</script>

<template>
  <div class="log-viewer">
    <button v-if="isLong" class="btn toggle" type="button" @click="expanded = !expanded">
      {{ expanded ? `收起（共 ${lines.length} 行）` : `展开全部 ${lines.length} 行` }}
    </button>
    <pre class="log-content"><code>{{ visibleLines.join('\n') }}</code></pre>
  </div>
</template>

<style scoped>
.log-viewer {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.toggle {
  align-self: flex-start;
  font-size: 0.8rem;
  padding: 0.3rem 0.7rem;
}

.log-content {
  background: #05060a;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 0.75rem;
  font-size: 0.8rem;
  line-height: 1.4;
  overflow-x: auto;
  max-height: 60vh;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
