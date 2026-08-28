import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve workspace packages to their TypeScript sources so tests run without a
// prior build step.
const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@agentdock/shared': pkg('shared'),
      '@agentdock/protocol': pkg('protocol'),
      '@agentdock/agent-runtime': pkg('agent-runtime'),
      '@agentdock/git-runtime': pkg('git-runtime'),
      '@agentdock/github-adapter': pkg('github-adapter'),
      '@agentdock/task-engine': pkg('task-engine'),
      '@agentdock/governance': pkg('governance'),
    },
  },
  test: {
    include: ['packages/**/*.{test,spec}.ts', 'apps/**/*.{test,spec}.ts'],
    environment: 'node',
  },
});
