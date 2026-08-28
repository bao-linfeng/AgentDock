<script setup lang="ts">
import { onMounted, ref } from 'vue';

// Minimal skeleton: pings the Control Server /health via the Vite proxy.
// TODO(M7): Dashboard, Projects, Task list, Task detail (timeline/logs/diff/tests).
const health = ref<string>('checking…');

onMounted(async () => {
  try {
    const res = await fetch('/api/health');
    health.value = res.ok ? `ok (${JSON.stringify(await res.json())})` : `error ${res.status}`;
  } catch {
    health.value = 'server unreachable (start apps/server first)';
  }
});
</script>

<template>
  <main style="font-family: system-ui; max-width: 640px; margin: 4rem auto; padding: 0 1rem">
    <h1>AgentDock</h1>
    <p>Local-first control plane for coding agents.</p>
    <p><strong>Server health:</strong> {{ health }}</p>
    <p style="color: #888">Web console skeleton — UI is Milestone 7.</p>
  </main>
</template>
