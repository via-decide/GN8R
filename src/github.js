/**
 * github.js — Full GitHub API layer (ported from Simba v2)
 */

const JSON_HEADERS = { Accept: 'application/vnd.github+json' };

async function githubRequest(urlPath, config, options = {}) {
  if (!config.githubToken) throw new Error('GITHUB_TOKEN is not configured.');
  const url = `${config.githubApiBaseUrl}${urlPath}`;
  const res = await fetch(url, {
    headers: {
      ...JSON_HEADERS,
      Authorization: `Bearer ${config.githubToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} on ${urlPath}: ${body}`);
  }
  return res.json();
}

export async function listOwnerRepos(config) {
  try {
    const repos = await githubRequest(
      `/users/${config.githubOwner}/repos?per_page=${config.githubRepoScanLimit}&sort=updated`, config
    ).catch(() =>
      githubRequest(`/orgs/${config.githubOwner}/repos?per_page=${config.githubRepoScanLimit}&sort=updated`, config)
    );
    return repos.map(r => ({
      name: r.name, fullName: r.full_name, description: r.description || '',
      defaultBranch: r.default_branch, language: r.language || 'unknown',
      visibility: r.private ? 'private' : 'public', archived: r.archived,
    }));
  } catch (err) {
    return [{ name: config.githubOwner, fullName: `${config.githubOwner}/(unavailable)`,
      description: `Repo listing unavailable: ${err.message}`,
      defaultBranch: 'unknown', language: 'unknown', visibility: 'unknown', archived: false }];
  }
}

async function getFileContent(owner, repo, filePath, ref, config) {
  const encoded = encodeURIComponent(filePath);
  const res = await fetch(
    `${config.githubApiBaseUrl}/repos/${owner}/${repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`,
    { headers: { ...JSON_HEADERS, Authorization: `Bearer ${config.githubToken}`, 'X-GitHub-Api-Version': '2022-11-28' } }
  );
  if (res.status === 404) return null;
  if (!res.ok) { const body = await res.text(); throw new Error(`GitHub file ${res.status}: ${body}`); }
  const data = await res.json();
  if (data.encoding !== 'base64' || !data.content) return null;
  return Buffer.from(data.content, 'base64').toString('utf8');
}

export async function inspectRepository(targetRepo, config) {
  const [owner, repo] = targetRepo.split('/');
  if (!owner || !repo) throw new Error('targetRepo must be owner/repo format');
  try {
    const meta = await githubRequest(`/repos/${owner}/${repo}`, config);
    const [readme, agents, pkg] = await Promise.all([
      getFileContent(owner, repo, 'README.md', meta.default_branch, config),
      getFileContent(owner, repo, 'AGENTS.md', meta.default_branch, config),
      getFileContent(owner, repo, 'package.json', meta.default_branch, config),
    ]);
    return {
      targetRepo, defaultBranch: meta.default_branch,
      language: meta.language || 'unknown', description: meta.description || '',
      readmeSnippet: snippet(readme), agentsSnippet: snippet(agents),
      packageSnippet: snippet(pkg), auditSource: 'github-api',
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
  const data = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, config);
  return data.object.sha;
}

export async function createBranch(owner, repo, branch, sha, config) {
  return githubRequest(`/repos/${owner}/${repo}/git/refs`, config, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
}

export async function deleteBranch(owner, repo, branch, config) {
  const res = await fetch(
    `${config.githubApiBaseUrl}/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
    { method: 'DELETE',
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${config.githubToken}`, 'X-GitHub-Api-Version': '2022-11-28' } }
  );
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`Delete branch ${res.status}: ${body}`);
  }
}

export async function commitFile(owner, repo, filePath, content, message, branch, config) {
  let sha;
  try {
    const existing = await githubRequest(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(branch)}`, config
    );
    sha = existing.sha;
  } catch {}

  return githubRequest(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`, config, {
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
  const data = await githubRequest(`/repos/${owner}/${repo}/pulls`, config, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, head, base, body }),
  });
  return { url: data.html_url, number: data.number };
}

export async function listRepoBranches(owner, repo, config, prefix = '') {
  try {
    const branches = await githubRequest(
      `/repos/${owner}/${repo}/branches?per_page=100`, config
    );
    return branches.map(b => b.name).filter(n => !prefix || n.startsWith(prefix));
  } catch {
    return [];
  }
}
