import { defineStore } from 'pinia';

const STORAGE_KEY = 'agentdock.apiToken';

/**
 * Holds the static `API_AUTH_TOKEN` used to authenticate every Control Server
 * request (see apps/server/src/auth/token.ts). There is no login flow / JWT —
 * the MVP uses one shared token per docs/architecture.md §7.
 */
export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(STORAGE_KEY) ?? '',
  }),
  getters: {
    isAuthenticated: (state) => state.token.trim().length > 0,
  },
  actions: {
    setToken(token: string) {
      this.token = token.trim();
      if (this.token) {
        localStorage.setItem(STORAGE_KEY, this.token);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    },
    clearToken() {
      this.setToken('');
    },
  },
});
