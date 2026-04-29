/**
 * git.js — Provider-abstract git API layer.
 * Routes every call to the configured provider.
 *
 * gitProvider='disabled'  → write methods throw GitProviderDisabledError;
 *                           read methods return graceful fallbacks so ARTIFACTS
 *                           stage still works while traveling.
 * gitProvider='github'    → existing github.js logic (unchanged)
 * gitProvider='gitea'     → gitea.js, same surface, /api/v1 endpoints
 */
import * as github from './github.js';
import * as gitea from './gitea.js';

export class GitProviderDisabledError extends Error {
  constructor(method) {
    super(
      `Git provider is disabled. Cannot perform: ${method}. ` +
      `Set GIT_PROVIDER=gitea (or github) and provide credentials.`
    );
    this.name = 'GitProviderDisabledError';
    this.code = 'GIT_PROVIDER_DISABLED';
  }
}

function pickProvider(config) {
  switch (config.gitProvider) {
    case 'github': return github;
    case 'gitea':  return gitea;
    default:       return null;
  }
}

// ── Write operations — throw when provider is disabled ──────────

const WRITE_METHODS = [
  'getBranchSha', 'createBranch', 'deleteBranch',
  'commitFile', 'createPullRequest', 'mergePullRequest',
  'getPrFiles', 'postPrComment',
];

const writeMethods = {};
for (const m of WRITE_METHODS) {
  writeMethods[m] = async (...args) => {
    const config = args[args.length - 1];
    const provider = pickProvider(config);
    if (!provider) throw new GitProviderDisabledError(m);
    if (typeof provider[m] !== 'function') {
      throw new Error(`Provider '${config.gitProvider}' does not implement: ${m}`);
    }
    return provider[m](...args);
  };
}

export const {
  getBranchSha, createBranch, deleteBranch,
  commitFile, createPullRequest, mergePullRequest,
  getPrFiles, postPrComment,
} = writeMethods;

// ── Read operations — return graceful fallback when disabled ────

export async function listOwnerRepos(config) {
  const provider = pickProvider(config);
  if (!provider) {
    return [{
      name: 'provider-disabled', fullName: 'provider-disabled/(unavailable)',
      description: 'Git provider is disabled. Set GIT_PROVIDER=gitea (or github).',
      defaultBranch: 'unknown', language: 'unknown', visibility: 'unknown', archived: false,
    }];
  }
  return provider.listOwnerRepos(config);
}

export async function inspectRepository(targetRepo, config) {
  const provider = pickProvider(config);
  if (!provider) {
    return {
      targetRepo, defaultBranch: 'main', language: 'unknown',
      description: 'Git provider disabled — audit unavailable.',
      readmeSnippet: 'not available', agentsSnippet: 'not available',
      packageSnippet: 'not available', auditSource: 'disabled',
    };
  }
  return provider.inspectRepository(targetRepo, config);
}

export async function listRepoBranches(owner, repo, config, prefix = '') {
  const provider = pickProvider(config);
  if (!provider) return [];
  return provider.listRepoBranches(owner, repo, config, prefix);
}
