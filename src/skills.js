/**
 * src/skills.js
 * Named-workflow registry for repetitive task templates.
 */

const BUILTIN_SKILLS = {
  'readme-gen': {
    description: 'Generate a README.md for a project',
    outputType: 'md',
    promptTemplate: 'Write a complete README.md for a project called {{input}}. Include: overview, features, installation, usage, and contributing sections.'
  },
  'sql-migration': {
    description: 'Generate a SQL migration file',
    outputType: 'sql',
    promptTemplate: 'Generate a SQL migration file for: {{input}}. Include up/down migrations with comments.'
  },
  'tool-spec': {
    description: 'Generate a decide.engine-tools config.json + spec',
    outputType: 'json',
    promptTemplate: 'Generate a complete decide.engine-tools config.json and one-page spec for a tool called {{input}}. Follow the engine-tools schema: id, name, description, category, audience, inputs, outputs, tags.'
  }
};

export class SkillsManager {
  constructor(stateEngine) {
    this.se = stateEngine;
  }

  /**
   * Register a new skill
   * @param {string|number} chatId
   * @param {string} name
   * @param {Object} skillData
   */
  async define(chatId, name, { description, outputType, promptTemplate }) {
    const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    await this.se.upsertSkills(chatId, (skills) => {
      skills[slug] = {
        description: description || `Custom skill: ${slug}`,
        outputType: outputType || 'md',
        promptTemplate,
        updatedAt: new Date().toISOString()
      };
      return skills;
    });
    return slug;
  }

  /**
   * Run a skill by name, returns { description, outputType } ready for runUserPipeline
   * @param {string|number} chatId
   * @param {string} name
   * @param {string} input
   */
  async invoke(chatId, name, input = '') {
    const slug = name.toLowerCase();
    const userSkills = await this.se.getSkills(chatId);
    const skill = BUILTIN_SKILLS[slug] || userSkills[slug];

    if (!skill) throw new Error(`Skill "${name}" not found.`);

    let prompt = skill.promptTemplate;
    if (prompt.includes('{{input}}')) {
      prompt = prompt.replace(/{{input}}/g, input || 'unnamed project');
    } else if (input) {
      prompt = `${prompt}\n\nInput context: ${input}`;
    }

    return {
      description: prompt,
      outputType: skill.outputType || 'md'
    };
  }

  /**
   * List all skills for this user
   * @param {string|number} chatId
   */
  async list(chatId) {
    const userSkills = await this.se.getSkills(chatId);
    return {
      builtins: BUILTIN_SKILLS,
      user: userSkills
    };
  }

  /**
   * Remove a user-defined skill
   * @param {string|number} chatId
   * @param {string} name
   */
  async remove(chatId, name) {
    const slug = name.toLowerCase();
    if (BUILTIN_SKILLS[slug]) throw new Error('Built-in skills cannot be deleted.');

    await this.se.upsertSkills(chatId, (skills) => {
      delete skills[slug];
      return skills;
    });
  }

  /**
   * Format skill list for Telegram
   * @param {string|number} chatId
   */
  async format(chatId) {
    const { builtins, user } = await this.list(chatId);
    const lines = ['🛠️ *Available Skills*'];

    lines.push('\n*Built-in:*');
    for (const [name, s] of Object.entries(builtins)) {
      lines.push(`• \`${name}\`: ${s.description}`);
    }

    const userKeys = Object.keys(user);
    if (userKeys.length > 0) {
      lines.push('\n*Your Skills:*');
      for (const [name, s] of Object.entries(user)) {
        lines.push(`• \`${name}\`: ${s.description.slice(0, 50)}${s.description.length > 50 ? '...' : ''}`);
      }
    }

    lines.push('\nUse `/skill run <name> [input]` to execute.');
    return lines.join('\n');
  }
}
