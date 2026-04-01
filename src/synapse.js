/**
 * synapse.js
 * Recursive Self-Awareness: Fetches recent commits to update the bot's own internal logic context.
 */

export class SynapseManager {
  constructor(config) {
    this.config = config;
    this.selfRepo = 'via-decide/GN8R';
  }

  /**
   * Fetch latest 15 commits to build context on what the bot can do.
   */
  async fetchSelfHistory() {
    const [owner, repo] = this.selfRepo.split('/');
    const url = `${this.config.githubApiBaseUrl}/repos/${owner}/${repo}/commits?per_page=15`;
    
    try {
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${this.config.githubToken}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (!res.ok) return `(Context Fetcher Error: ${res.status})`;
      
      const commits = await res.json();
      const history = commits.map(c => `- ${c.commit.message.split('\n')[0]} (${c.commit.author.name})`).join('\n');
      
      return `Bot's Own Recent Evolution (Latest 15 commits):\n${history}`;
    } catch (err) {
      return `(Context Fetcher Error: ${err.message})`;
    }
  }

  /**
   * Build a system-level knowledge context specifically about bot's tools.
   */
  async buildAwarenessContext() {
    const history = await this.fetchSelfHistory();
    const skills = [
        '- PR Controller: can open and manage pull requests',
        '- Context Fetcher: can read repo files and structure',
        '- Synthesis Engine: uses Gemini 1.5 Pro for code production',
        '- Planning Engine: uses Gemini 1.5 Flash for intent deconstruction'
    ];
    
    return [
      `🤖 SELF-AWARENESS PROTOCOL`,
      `You are the Antigravity Synthesis Orchestrator (v3.0.0-beast).`,
      `Your current capabilities derived from your codebase evolution:`,
      ...skills,
      '',
      history,
      '',
      `Use these superpowers to execute complex repo-aware tasks with minimal human friction.`
    ].join('\n');
  }
}
