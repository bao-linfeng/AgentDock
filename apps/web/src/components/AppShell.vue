<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const navItems = [
  { name: 'dashboard', label: '仪表盘', icon: '\u25A6' },
  { name: 'tasks', label: '任务', icon: '\u2261' },
  { name: 'projects', label: '项目', icon: '\u2318' },
];

function logout() {
  auth.clearToken();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <span class="brand">AgentDock</span>
      <nav class="desktop-nav" aria-label="主导航">
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name }"
          class="nav-item"
          :class="{ active: route.name === item.name }"
        >
          <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>
      <button class="btn logout-btn" type="button" @click="logout">退出</button>
    </header>

    <main class="content">
      <slot />
    </main>

    <nav class="bottom-nav" aria-label="主导航">
      <RouterLink
        v-for="item in navItems"
        :key="item.name"
        :to="{ name: item.name }"
        class="nav-item"
        :class="{ active: route.name === item.name }"
      >
        <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.brand {
  font-weight: 700;
  letter-spacing: 0.02em;
}

.logout-btn {
  padding: 0.35rem 0.75rem;
  font-size: 0.8rem;
}

.content {
  flex: 1;
}

.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
  padding-bottom: env(safe-area-inset-bottom);
  z-index: 10;
}

.nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  padding: 0.5rem 0;
  min-height: var(--nav-height);
  color: var(--color-text-muted);
  font-size: 0.75rem;
}

.nav-item.active {
  color: var(--color-primary);
}

.nav-icon {
  font-size: 1.2rem;
}

.desktop-nav {
  display: none;
}

@media (min-width: 768px) {
  .bottom-nav {
    display: none;
  }

  .desktop-nav {
    display: flex;
    gap: 0.25rem;
  }

  .desktop-nav .nav-item {
    flex-direction: row;
    min-height: 36px;
    padding: 0.4rem 0.75rem;
    border-radius: var(--radius);
  }

  .desktop-nav .nav-item.active {
    background: var(--color-surface-alt);
  }
}
</style>
