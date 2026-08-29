<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';
import type { HealthDto } from '../types';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const tokenInput = ref('');
const error = ref<string | null>(null);
const checking = ref(false);

async function submit() {
  error.value = null;
  if (!tokenInput.value.trim()) {
    error.value = '请输入 API Token';
    return;
  }
  checking.value = true;
  auth.setToken(tokenInput.value);
  try {
    // Cheap authenticated probe: GitHub status requires ApiTokenGuard.
    await api.get<HealthDto>('/health');
    const redirect = (route.query.redirect as string) || '/';
    router.push(redirect);
  } catch {
    // Even if the probe fails (e.g. offline), keep the token — most API
    // calls will surface a clearer 401 message where relevant.
    const redirect = (route.query.redirect as string) || '/';
    router.push(redirect);
  } finally {
    checking.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <form class="card stack login-card" @submit.prevent="submit">
      <div>
        <h1>AgentDock</h1>
        <p class="muted">输入控制台 API Token（对应服务端 API_AUTH_TOKEN）以继续。</p>
      </div>
      <div class="field">
        <label for="token">API Token</label>
        <input id="token" v-model="tokenInput" type="password" autocomplete="off" placeholder="粘贴 API Token" />
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
      <button class="btn btn-primary" type="submit" :disabled="checking">
        {{ checking ? '验证中…' : '进入控制台' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.login-card {
  width: 100%;
  max-width: 380px;
}
</style>
