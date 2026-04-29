/**
 * gitea.js — Self-hosted Gitea git API layer.
 * Mirrors github.js public surface; uses Gitea /api/v1 endpoints.
 *
 * Key differences from GitHub API:
 *   - Auth header: `token <pat>` (not `Bearer`)
 *   - Branch creation: POST /branches with { new_branch_name, old_ref_name }
 *   - No X-GitHub-Api-Version header
 *   - Merge returns 200 with empty body on success (not JSON)
 */

const JSON_HEADERS = { Accept: 'application/json' };

async function giteaRequest(urlPath, config, options = {}) {
  if (!config.giteaToken) throw new Error('GITEA_TOKEN is not configured.');
  const url = `${config.giteaApiBaseUrl}${urlPath}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...JSON_HEADERS,
      Authorization: `token ${config.giteaToken}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gitea API ${res.status} on ${urlPath}: ${body}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

export async function listOwnerRepos(config) {
  try {
    const repos = await giteaRequest(
      `/users/${config.giteaOwner}/repos?limit=${config.giteaRepoScanLimit}`, config
    );
    return repos.map(r => ({
      name: r.name, fullName: r.full_name, description: r.description || '',
      defaultBranch: r.default_branch, language: r.language || 'unknown',
      visibility: r.private ? 'private' : 'public', archived: r.archived || false,
    }));
  } catch (err) {
    return [{
      name: config.giteaOwner, fullName: `${config.giteaOwner}/(unavailable)`,
      description: `Repo listing unavailable: ${err.message}`,
      defaultBranch: 'unknown', language: 'unknown', visibility: 'unknown', archived: false,
    }];
  }
}

async function getFileContent(owner, repo, filePath, ref, config) {
  const encoded = encodeURIComponent(filePath);
  const res = await fetch(
    `${config.giteaApiBaseUrl}/repos/${owner}/${repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`,
    { headers: { ...JSON_HEADERS, Authorization: `token ${config.giteaToken}` } }
  );
  if (res.status === 404) return null;
  if (!res.ok) { const body = await res.text(); throw new Error(`Gitea file ${res.status}: ${body}`); }
  const data = await res.json();
  if (data.encoding !== 'base64' || !data.content) return null;
  return Buffer.from(data.content, 'base64').toString('utf8');
}

export async function inspectRepository(targetRepo, config) {
  const [owner, repo] = targetRepo.split('/');
  if (!owner || !repo) throw new Error('targetRepo must be owner/repo format');
  try {
    const meta = await giteaRequest(`/repos/${owner}/${repo}`, config);
    const [readme, agents, pkg] = await Promise.all([
      getFileContent(owner, repo, 'README.md', meta.default_branch, config),
      getFileContent(owner, repo, 'AGENTS.md', meta.default_branch, config),
      getFileContent(owner, repo, 'package.json', meta.default_branch, config),
    ]);
    return {
      targetRepo, defaultBranch: meta.default_branch,
      language: meta.language || 'unknown', description: meta.description || '',
      readmeSnippet: snippet(readme), agentsSnippet: snippet(agents),
      packageSnippet: snippet(pkg), auditSource: 'gitea-api',
    };
  } catch (err) {
    return {
      targetRepo, defaultBranch: 'main', language: 'unknown',
      description: `Audit fallback: ${err.message}`,
      readmeSnippet: 'not found', agentsSnippet: 'not found',
      packageSnippet: 'not found', auditSource: 'fallback',
    };
  }
}

function snippet(content) {
  if (!content) return 'not found';
  return content.slice(0, 300).replace(/\s+/g, ' ').trim() || 'empty';
}

export async function getBranchSha(owner, repo, branch, config) {
  const data = await giteaRequest(
    `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, config
  );
  return data.commit.id;
}

export async function createBranch(owner, repo, branch, sha, config) {
  // Gitea: POST /branches with { new_branch_name, old_ref_name: <SHA or branch name> }
  return giteaRequest(`/repos/${owner}/${repo}/branches`, config, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_branch_name: branch, old_ref_name: sha }),
  });
}

export async function deleteBranch(owner, repo, branch, config) {
  const res = await fetch(
    `${config.giteaApiBaseUrl}/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
    { method: 'DELETE',
      headers: { ...JSON_HEADERS, Authorization: `token ${config.giteaToken}` } }
  );
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`Delete branch ${res.status}: ${body}`);
  }
}

export async function commitFile(owner, repo, filePath, content, message, branch, config) {
  let sha;
  try {
    const existing = await giteaRequest(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(branch)}`, config
    );
    sha = existing.sha;
  } catch {}

  return giteaRequest(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`, config, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message, branch,
      content: Buffer.from(content, 'utf8').toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });
}

export async function createPullRequest(owner, repo, head, base, title, body, config) {
  const data = await giteaRequest(`/repos/${owner}/${repo}/pulls`, config, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, head, base, body }),
  });
  return { url: data.html_url, number: data.number };
}

export async function listRepoBranches(owner, repo, config, prefix = '') {
  try {
    const branches = await giteaRequest(
      `/repos/${owner}/${repo}/branches?limit=100`, config
    );
    return branches.map(b => b.name).filter(n => !prefix || n.startsWith(prefix));
  } catch {
    return [];
  }
}

export async function mergePullRequest(owner, repo, prNumber, config) {
  return giteaRequest(`/repos/${owner}/${repo}/pulls/${prNumber}/merge`, config, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Do: 'merge',
      MergeTitleField: `bot: merge PR #${prNumber}`,
    }),
  });
}

export async function getPrFiles(owner, repo, prNumber, config) {
  const data = await giteaRequest(
    `/repos/${owner}/${repo}/pulls/${prNumber}/files?limit=100`, config
  );
  if (!Array.isArray(data)) return [];
  return data.map(f => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions || 0,
    deletions: f.deletions || 0,
    changes: (f.additions || 0) + (f.deletions || 0),
    patch: f.patch || '',
  }));
}

export async function postPrComment(owner, repo, prNumber, body, config) {
  return giteaRequest(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, config, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
}
