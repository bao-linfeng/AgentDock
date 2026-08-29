import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { App, type Octokit } from 'octokit';
import { SERVER_CONFIG } from '../config/config.module.js';
import type { ServerConfig } from '../config/env.js';

/**
 * GitHub App authentication (docs/tasks.md T6.1, architecture §7 `repositories`).
 *
 * Wraps `octokit`'s `App` helper (JWT app auth + installation access tokens via
 * `@octokit/auth-app`, see https://github.com/octokit/auth-app.js). Only
 * produces authenticated Octokit clients — it never calls the GitHub API on
 * its own. Consumers (repository binding validation here; comment/PR creation
 * in #30/#31) ask for an installation-scoped client by `installationId`.
 *
 * Deliberately **not** involved in webhook signature verification (#29) — App
 * auth (JWT/installation tokens) and webhook HMAC verification use unrelated
 * secrets (`privateKey` vs `webhookSecret`) even though both come from the
 * same GitHub App.
 *
 * `createPullRequest` (#30) is the one method here that performs a
 * write/mutating GitHub API call rather than just producing a client.
 */
@Injectable()
export class GitHubAppService {
  private app: App | undefined;

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    /** Test seam: overrides the `App` constructor to avoid a real JWT/network call. */
    @Optional()
    private readonly appFactory: (options: { appId: string; privateKey: string }) => App = (
      options,
    ) => new App(options),
  ) {}

  /** True once `GITHUB_APP_ID` + `GITHUB_PRIVATE_KEY` are both configured. */
  isConfigured(): boolean {
    return Boolean(this.config.github.appId && this.config.github.privateKey);
  }

  private getApp(): App {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'GitHub App is not configured (GITHUB_APP_ID / GITHUB_PRIVATE_KEY missing)',
      );
    }
    if (!this.app) {
      this.app = this.appFactory({
        appId: this.config.github.appId as string,
        privateKey: this.config.github.privateKey as string,
      });
    }
    return this.app;
  }

  /**
   * An Octokit client authenticated as the App itself (JWT), for App-level
   * calls such as listing installations. Not scoped to any repository.
   */
  appOctokit(): Octokit {
    return this.getApp().octokit;
  }

  /**
   * An Octokit client authenticated as a specific installation, scoped to
   * whatever repositories that installation was granted access to. Tokens are
   * minted on demand and cached/refreshed internally by `@octokit/auth-app`.
   */
  async installationOctokit(installationId: string): Promise<Octokit> {
    const app = this.getApp();
    return app.getInstallationOctokit(Number(installationId));
  }

  /**
   * Verify that the App's credentials are valid and that the given
   * installation id is real and reachable, by asking GitHub which
   * repositories that installation can see. Used when binding a repository
   * to a project so a typo'd `installationId` fails fast instead of only
   * surfacing later when a PR/comment call is attempted (#30/#31).
   */
  async listInstallationRepositories(
    installationId: string,
  ): Promise<{ owner: string; repo: string }[]> {
    const octokit = await this.installationOctokit(installationId);
    const repos: { owner: string; repo: string }[] = [];
    for await (const response of octokit.paginate.iterator(
      octokit.rest.apps.listReposAccessibleToInstallation,
      { per_page: 100 },
    )) {
      for (const repo of response.data as { owner: { login: string }; name: string }[]) {
        repos.push({ owner: repo.owner.login, repo: repo.name });
      }
    }
    return repos;
  }

  /**
   * Open a Pull Request against `owner/repo` (docs/tasks.md T6.5, #30), using
   * the given installation's access token. If a PR already exists for
   * `head` -> `base` (e.g. a retried run pushing to the same branch again),
   * GitHub's "already exists" error (422) is treated as success and the
   * existing PR is returned instead, keeping this call idempotent.
   */
  async createPullRequest(
    installationId: string,
    params: {
      owner: string;
      repo: string;
      title: string;
      body: string;
      base: string;
      head: string;
    },
  ): Promise<{ number: number; url: string; title: string }> {
    const octokit = await this.installationOctokit(installationId);
    try {
      const response = await octokit.rest.pulls.create({
        owner: params.owner,
        repo: params.repo,
        title: params.title,
        body: params.body,
        base: params.base,
        head: params.head,
      });
      return {
        number: response.data.number,
        url: response.data.html_url,
        title: response.data.title,
      };
    } catch (error) {
      const existing = await this.findExistingPullRequest(octokit, params);
      if (existing) return existing;
      throw error;
    }
  }

  /** Best-effort lookup of an already-open PR for the same head -> base pair. */
  private async findExistingPullRequest(
    octokit: Octokit,
    params: { owner: string; repo: string; base: string; head: string },
  ): Promise<{ number: number; url: string; title: string } | null> {
    const response = await octokit.rest.pulls.list({
      owner: params.owner,
      repo: params.repo,
      base: params.base,
      head: `${params.owner}:${params.head}`,
      state: 'open',
    });
    const [pr] = response.data;
    return pr ? { number: pr.number, url: pr.html_url, title: pr.title } : null;
  }
}
