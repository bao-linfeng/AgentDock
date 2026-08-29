import { describe, expect, it } from 'vitest';
import { hasMention, inferIntent, normalizeGitHubEvent, stripMention } from './index.js';

describe('mention helpers', () => {
  it('detects and strips the trigger while keeping surrounding text', () => {
    expect(hasMention('please @agent fix it')).toBe(true);
    expect(hasMention('no trigger here')).toBe(false);
    expect(stripMention('please @agent fix it')).toBe('please fix it');
  });
});

describe('inferIntent', () => {
  it('classifies common phrasings', () => {
    expect(inferIntent('fix the crash in checkout')).toBe('fix');
    expect(inferIntent('please review this PR')).toBe('review');
    expect(inferIntent('add a unit test for parser')).toBe('test');
    expect(inferIntent('implement dark mode')).toBe('implement');
    expect(inferIntent('hello there')).toBe('general');
  });
});

describe('normalizeGitHubEvent', () => {
  const repo = { full_name: 'bao/agentdock' };

  it('normalizes an issue_comment with a mention', () => {
    const out = normalizeGitHubEvent('issue_comment', {
      action: 'created',
      repository: repo,
      issue: { number: 7 },
      comment: { id: 42, body: '@agent fix the duplicate callback', user: { login: 'alice' } },
    });
    expect(out).toEqual({
      source: 'github',
      sourceRef: 'github:bao/agentdock:issue_comment#42',
      intent: 'fix',
      prompt: 'fix the duplicate callback',
      actor: 'alice',
      callbackRepo: 'bao/agentdock',
      callbackIssueNumber: 7,
      callbackIsPullRequest: false,
    });
  });

  it('normalizes an opened issue (title + body)', () => {
    const out = normalizeGitHubEvent('issues', {
      action: 'opened',
      repository: repo,
      issue: {
        number: 9,
        title: 'Broken login',
        body: '@agent fix the broken login flow',
        user: { login: 'bob' },
      },
    });
    expect(out?.intent).toBe('fix');
    expect(out?.sourceRef).toBe('github:bao/agentdock:issue#9');
    expect(out?.prompt).toContain('Broken login');
    expect(out?.callbackIssueNumber).toBe(9);
    expect(out?.callbackIsPullRequest).toBe(false);
  });

  it('normalizes a pull_request and review comment', () => {
    const pr = normalizeGitHubEvent('pull_request', {
      action: 'opened',
      repository: repo,
      pull_request: { number: 3, title: 'WIP', body: '@agent review this', user: { login: 'a' } },
    });
    expect(pr?.intent).toBe('review');
    expect(pr?.sourceRef).toBe('github:bao/agentdock:pull_request#3');
    expect(pr?.callbackIssueNumber).toBe(3);
    expect(pr?.callbackIsPullRequest).toBe(true);

    const rc = normalizeGitHubEvent('pull_request_review_comment', {
      action: 'created',
      repository: repo,
      pull_request: { number: 3 },
      comment: { id: 55, body: '@agent add tests here', user: { login: 'a' } },
    });
    expect(rc?.intent).toBe('test');
    expect(rc?.sourceRef).toBe('github:bao/agentdock:review_comment#55');
    expect(rc?.callbackIssueNumber).toBe(3);
    expect(rc?.callbackIsPullRequest).toBe(true);
  });

  it('normalizes a PR comment sent through issue_comment', () => {
    const out = normalizeGitHubEvent('issue_comment', {
      action: 'created',
      repository: repo,
      issue: { number: 12 },
      pull_request: { number: 12 },
      comment: { id: 88, body: '@agent add tests', user: { login: 'alice' } },
    });
    expect(out?.callbackIssueNumber).toBe(12);
    expect(out?.callbackIsPullRequest).toBe(true);
  });

  it('returns null without a trigger mention', () => {
    expect(
      normalizeGitHubEvent('issue_comment', {
        action: 'created',
        repository: repo,
        comment: { id: 1, body: 'just a normal comment', user: { login: 'alice' } },
      }),
    ).toBeNull();
  });

  it('ignores bot self-callbacks', () => {
    expect(
      normalizeGitHubEvent('issue_comment', {
        action: 'created',
        repository: repo,
        comment: { id: 1, body: '@agent fix', user: { login: 'agentdock[bot]', type: 'Bot' } },
      }),
    ).toBeNull();
  });

  it('enforces the actor allowlist', () => {
    const payload = {
      action: 'created',
      repository: repo,
      issue: { number: 1 },
      comment: { id: 1, body: '@agent fix it', user: { login: 'stranger' } },
    };
    expect(normalizeGitHubEvent('issue_comment', payload, { allowlist: ['alice'] })).toBeNull();
    expect(
      normalizeGitHubEvent('issue_comment', payload, { allowlist: ['stranger'] }),
    ).not.toBeNull();
  });

  it('ignores unsupported actions', () => {
    expect(
      normalizeGitHubEvent('issues', {
        action: 'closed',
        repository: repo,
        issue: { number: 1, body: '@agent fix', user: { login: 'a' } },
      }),
    ).toBeNull();
  });

  it('honors a custom trigger', () => {
    const out = normalizeGitHubEvent(
      'issue_comment',
      {
        action: 'created',
        repository: repo,
        issue: { number: 2 },
        comment: { id: 2, body: '/bot implement search', user: { login: 'alice' } },
      },
      { trigger: '/bot' },
    );
    expect(out?.intent).toBe('implement');
    expect(out?.prompt).toBe('implement search');
  });
});
