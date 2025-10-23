# Claude Code Skills - Local Marketplace

This repository contains custom Claude Code skills and plugins for extending Claude's capabilities with specialized domain knowledge and workflows.

## Overview

This is a local Claude Code plugin marketplace that provides custom skills. Currently includes:

- **uv-python-manager**: Standardize Python development using UV - a fast, unified package and project manager

## Important: Claude Code Skills vs Agent Skills

This repository uses **Claude Code Skills**, which are specifically designed for the Claude Code CLI environment. These are different from **Agent Skills** used with the Claude API.

### Key Differences

| Feature | Claude Code Skills | Agent Skills (API) |
|---------|-------------------|-------------------|
| **Environment** | Claude Code CLI | Claude API (code execution) |
| **Invocation** | Model-invoked (Claude decides) | Model-invoked |
| **Tool Permissions** | `allowed-tools` field for granular control | Standard permissions model |
| **Location** | `~/.claude/skills/` or `.claude/skills/` | Container-based |
| **Distribution** | Personal, Project, or Plugin-bundled | Anthropic-managed or custom containers |
| **Format** | SKILL.md with YAML frontmatter | SKILL.md with YAML frontmatter |

### Claude Code Specific Features

- **`allowed-tools` field**: Enables granular permission control, limiting Claude to specified tools without requiring explicit permission requests each time
- **Three discovery sources**: Personal skills, project skills, and plugin-bundled skills
- **Integrated with CLI workflows**: Works seamlessly with local file systems and development environments

## Repository Structure

```
my-skills/
├── README.md                          # This file
├── .claude-plugin/
│   └── marketplace.json               # Marketplace configuration
├── .claude/
│   └── settings.local.json            # Local permissions
└── [plugin-name]/
    ├── .claude-plugin/
    │   └── plugin.json                # Plugin manifest (REQUIRED if strict=true)
    ├── skills/
    │   └── [skill-name]/
    │       └── SKILL.md               # Skill definition (REQUIRED)
    ├── commands/                      # Slash commands (optional)
    ├── agents/                        # Agent definitions (optional)
    └── hooks/                         # Event hooks (optional)
```

## Specifications

### 1. Marketplace Configuration (marketplace.json)

The `marketplace.json` file defines the local plugin marketplace and lists available plugins.

#### Required Fields

```json
{
  "name": "marketplace-name",
  "owner": {
    "name": "Owner Name",
    "email": "owner@example.com"
  },
  "plugins": []
}
```

| Field | Type | Description | Requirements |
|-------|------|-------------|--------------|
| `name` | string | Marketplace identifier | kebab-case, no spaces |
| `owner` | object | Maintainer information | Must contain `name` (required) and `email` (optional) |
| `plugins` | array | List of available plugins | Array of plugin objects |

#### Optional Metadata

```json
{
  "name": "marketplace-name",
  "version": "1.0.0",
  "description": "Marketplace overview",
  "owner": { "name": "Owner Name" },
  "metadata": {
    "pluginRoot": "./plugins/"
  },
  "plugins": []
}
```

#### Plugin Entry Specification

Each plugin in the `plugins` array can have:

**Required:**
- `name` (string): Plugin identifier (kebab-case, no spaces)
- `source` (string or object): Location of the plugin

**Optional:**
- `description` (string): Plugin functionality description
- `version` (string): Semantic version
- `author` (object): Developer information
- `homepage` (string): Documentation URL
- `repository` (string): Source code URL
- `license` (string): SPDX license identifier
- `keywords` (array): Discovery tags
- `category` (string): Classification
- `commands` (string/array): Custom command paths
- `agents` (string/array): Agent file locations
- `hooks` (string/object): Hook configurations
- `mcpServers` (string/object): MCP server setup
- `strict` (boolean): Whether plugin.json validation is required (default: false)

**Source Configuration Types:**

```json
// Relative path (local)
"source": "./plugins/my-plugin"

// GitHub repository
"source": {
  "source": "github",
  "repo": "owner/plugin-repo"
}

// External Git URL
"source": {
  "source": "url",
  "url": "https://gitlab.com/team/plugin.git"
}
```

**Example marketplace.json:**

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "my-skills",
  "version": "1.0.0",
  "description": "My custom Claude Code skills",
  "owner": {
    "name": "Your Name"
  },
  "plugins": [
    {
      "name": "my-plugin",
      "description": "Plugin description",
      "source": "./my-plugin"
    }
  ]
}
```

### 2. Plugin Manifest (plugin.json)

The `plugin.json` file can be located in one of two places within each plugin directory:
- **Recommended**: `.claude-plugin/plugin.json` (official specification)
- **Alternate**: `plugin.json` at plugin root (also supported)

#### Required Fields

Only **one** field is required:

```json
{
  "name": "plugin-name"
}
```

#### Complete Schema

```json
{
  "name": "plugin-name",
  "version": "1.2.0",
  "description": "Brief plugin description",
  "author": {
    "name": "Author Name",
    "email": "author@example.com",
    "url": "https://github.com/author"
  },
  "homepage": "https://docs.example.com/plugin",
  "repository": "https://github.com/author/plugin",
  "license": "MIT",
  "keywords": ["keyword1", "keyword2"],
  "components": {
    "skills": ["skill-name"],
    "commands": ["command-name"],
    "agents": ["agent-name"]
  },
  "commands": ["./custom/commands/special.md"],
  "agents": "./custom/agents/",
  "hooks": "./config/hooks.json",
  "mcpServers": "./mcp-config.json"
}
```

#### Field Specifications

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ Yes | Unique identifier (kebab-case, no spaces) |
| `version` | string | No | Semantic version (e.g., "1.2.0") |
| `description` | string | No | Plugin's primary function |
| `author` | object | No | Developer info (name, email, url) |
| `homepage` | string | No | Documentation link |
| `repository` | string | No | Source code URL |
| `license` | string | No | License type (MIT, Apache-2.0, etc.) |
| `keywords` | array | No | Discovery and categorization tags |
| `components` | object | No | Lists available skills, commands, agents |
| `commands` | string/array | No | Custom command file paths |
| `agents` | string/array | No | Agent definition paths |
| `hooks` | string/object | No | Hook configuration |
| `mcpServers` | string/object | No | MCP configuration |

#### Path Validation Rules

1. All custom paths must be **relative** and start with `./`
2. Custom paths **supplement**—not replace—default directories
3. Multiple paths acceptable as arrays for commands and agents
4. Use `${CLAUDE_PLUGIN_ROOT}` environment variable for dynamic path resolution

#### Directory Structure

```
plugin-root/
├── .claude-plugin/
│   └── plugin.json              (Recommended location)
├── plugin.json                  (Alternate: at root, also works)
├── skills/                      (Default location)
│   └── skill-name/
│       └── SKILL.md
├── commands/                    (Default location)
├── agents/                      (Default location)
├── hooks/                       (Optional)
└── scripts/                     (Optional)
```

**Note**: While the official specification recommends `.claude-plugin/plugin.json`, placing `plugin.json` at the plugin root also works with Claude Code. All other directories (commands/, agents/, skills/, hooks/) must be at the plugin root.

### 3. Claude Code Skill Definition (SKILL.md)

Claude Code Skills are **model-invoked** capabilities—Claude autonomously decides when to use them based on relevance to user requests, unlike slash commands which are user-invoked.

Each skill requires a `SKILL.md` file with YAML frontmatter followed by markdown content.

#### Required Structure

```markdown
---
name: skill-name
description: Brief description of what this Skill does and when to use it
---

# Skill Name

## Instructions
[Clear, step-by-step guidance for Claude to follow]

## Examples
[Concrete examples of using this Skill]
```

#### Frontmatter Requirements

| Field | Type | Max Length | Requirements |
|-------|------|------------|--------------|
| `name` | string | 64 chars | Lowercase letters, numbers, hyphens only |
| `description` | string | 1024 chars | Non-empty, required. Should include both what the Skill does AND when Claude should use it (critical for discovery) |

#### Optional Frontmatter - Claude Code Specific

```yaml
---
name: skill-name
description: What it does and when to use it
allowed-tools: Read, Grep, Glob
---
```

**`allowed-tools` field (Claude Code only):**
- Restricts which tools Claude can use when this skill is active
- Specify tools as a comma-separated list (e.g., `Read, Grep, Glob`)
- When specified, Claude gains unrestricted access to ONLY those tools
- Without this field, Claude requests permission for each tool use following standard permissions
- Enables granular permission control without explicit permission requests each time

**Example restrictive skill:**

```yaml
---
name: safe-file-reader
description: Read files without modifications. Use for read-only file access.
allowed-tools: Read, Grep, Glob
---
```

#### Content Guidelines

**Key Principles:**

1. **Keep Skills Focused**: Each Skill should address one primary capability rather than broad functionality

2. **Write Clear Descriptions**: Include specific use cases and trigger words for discovery
   - Claude loads additional files progressively when needed to manage context efficiently
   - The description is **critical for discovery**—it should include both functionality and usage triggers

3. **Progressive Disclosure**: Supporting files alongside SKILL.md are loaded only when needed
   - `reference.md` - optional documentation
   - `examples.md` - optional examples
   - `scripts/` - utility scripts
   - `templates/` - reusable templates

**File Organization:**

- Keep SKILL.md focused and concise
- Use **progressive disclosure**: main file points to detailed resources
- Claude loads referenced files only when contextually necessary

**Example Structure:**

```markdown
---
name: processing-pdfs
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.
---

# PDF Processing

Quick start guide here...

For detailed information, see [reference.md](reference.md)
```

#### Naming Convention

Use **gerund form** (verb + -ing): `processing-pdfs`, `analyzing-spreadsheets`, `managing-deployments`

Avoid vague terms like "helper" or reserved words containing "anthropic" or "claude."

#### Description Best Practices

The description must be **specific and actionable** for effective skill discovery.

**Writing Effective Descriptions:**
- Include both **capability statements** and **trigger conditions** users would mention naturally
- Use specific terminology that matches how users would request the functionality

**Examples:**

✅ **Effective**: "Analyze Excel spreadsheets, create pivot tables, and generate charts. Use when working with Excel files, spreadsheets, or analyzing tabular data in .xlsx format."

❌ **Ineffective**: "Helps with documents" (too vague for discovery)

✅ **Effective**: "Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction."

❌ **Ineffective**: "Helps with PDFs"

#### YAML Syntax Validation

- Opening `---` must appear on line 1
- Closing `---` must precede Markdown content
- **No tabs**; use spaces for indentation
- Quoted strings for values containing special characters

#### File Path Requirements

- Personal: `~/.claude/skills/my-skill/SKILL.md`
- Project: `.claude/skills/my-skill/SKILL.md`
- Use forward slashes (Unix-style) in all referenced paths

#### Common Debugging Issues

If Claude doesn't use your Skill, verify:

1. **Description specificity**: Vague descriptions hinder discovery
2. **File path correctness**: Ensure SKILL.md is in the correct location
3. **Valid YAML syntax**: Check frontmatter formatting
4. **Correct directory**: Skills must be in `~/.claude/skills/` or `.claude/skills/`
5. **Conflicting Skills**: Use distinct trigger terminology in each Skill's description

#### Quality Checklist

- ✅ Description is specific and actionable
- ✅ Description includes trigger terms users would naturally mention
- ✅ Name uses lowercase letters, numbers, hyphens only (max 64 chars)
- ✅ YAML frontmatter is valid (spaces, not tabs)
- ✅ File paths use forward slashes
- ✅ Skill is focused on one primary capability
- ✅ Supporting files are referenced with Markdown links
- ✅ Tested with your team to verify activation
- ✅ Version history documented if applicable

### 4. Skill Discovery & Directory Structure

Claude Code Skills are discovered from three sources:

1. **Personal Skills** (`~/.claude/skills/`) - Individual use across all projects
2. **Project Skills** (`.claude/skills/`) - Team sharing via git
3. **Plugin Skills** - Bundled with plugins, automatically available when installed

#### Personal Skills (Individual Use)

Located at `~/.claude/skills/`:

```
~/.claude/skills/skill-name/
├── SKILL.md                    (required)
├── reference.md                (optional)
├── examples.md                 (optional)
├── scripts/                    (optional)
│   ├── helper.py
│   └── utils.sh
└── templates/                  (optional)
    └── config.json
```

#### Project Skills (Team Sharing)

Located at `.claude/skills/` in project root:

```
project-root/.claude/skills/skill-name/
├── SKILL.md                    (required)
├── reference.md                (optional)
├── examples.md                 (optional)
├── scripts/                    (optional)
│   └── helper.py
└── templates/                  (optional)
    └── template.txt
```

**Project Skills are checked into git** and automatically available to team members when they pull changes.

#### Plugin Skills (Distribution)

Bundled with plugins in `[plugin-name]/skills/`:

```
plugin-name/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── skill-name/
        ├── SKILL.md            (required)
        └── [supporting files]  (optional)
```

**Plugin Skills are automatically available** when the plugin is installed—no additional registration needed.

## Usage

### Installing the Local Marketplace

1. Add this marketplace to Claude Code:
   ```bash
   /plugin marketplace add /Users/rob/.claude/my-skills
   ```

2. List available plugins:
   ```bash
   /plugin marketplace list
   ```

3. Install a plugin from this marketplace:
   ```bash
   /plugin install uv-python-manager@my-skills
   ```

### Creating a New Skill

1. Create a new skill directory:
   ```bash
   mkdir -p your-plugin/skills/your-skill-name
   ```

2. Create the SKILL.md file:
   ```bash
   cat > your-plugin/skills/your-skill-name/SKILL.md << 'EOF'
   ---
   name: your-skill-name
   description: What it does and when to use it (include both!)
   ---

   # Your Skill Name

   ## Instructions
   Step-by-step guidance for Claude...

   ## Examples
   Concrete examples...
   EOF
   ```

3. Add the skill to your plugin's `plugin.json`:
   ```json
   {
     "name": "your-plugin",
     "components": {
       "skills": ["your-skill-name"]
     }
   }
   ```

4. Update marketplace.json if adding a new plugin

### Validating Your Plugin

```bash
# Validate plugin structure and syntax
claude plugin validate /path/to/your-plugin

# Test the skill
/plugin install your-plugin@my-skills
# Claude will now have access to your skill
```

### Permissions

Skills can be configured in `.claude/settings.local.json` to control permission prompts:

```json
{
  "permissions": {
    "allow": [
      "Skill(uv-python-manager)"
    ],
    "deny": [],
    "ask": []
  }
}
```

## Best Practices

### Skill Development

1. **Keep skills focused**: Each Skill should address one primary capability
2. **Write clear descriptions**: Include specific use cases and trigger words for discovery
3. **Test with your team**: Verify the Skill activates as expected
4. **Use specific terminology**: Match how users would naturally request the functionality
5. **Progressive disclosure**: Link to detailed docs rather than embedding everything
6. **Consistent naming**: Use gerund form (verb + -ing)
7. **Document versions**: Track changes in your SKILL.md if applicable
8. **Verify YAML syntax**: Use spaces, not tabs for indentation

### Plugin Development

1. **Validate early**: Use `claude plugin validate .` frequently
2. **Version properly**: Use semantic versioning
3. **Document well**: Include clear descriptions and examples
4. **Keep paths relative**: All paths in plugin.json must start with `./`
5. **Test locally**: Use local marketplace for iteration before publishing
6. **Commit wisely**: Include plugin.json and SKILL.md, exclude generated files

### Marketplace Management

1. **Organize logically**: Group related plugins
2. **Version tracking**: Keep marketplace version in sync with changes
3. **Clear ownership**: Maintain accurate owner information
4. **Regular validation**: Test plugin installations periodically

## Technical Requirements

- **Claude Code version**: 1.0 or later
- **YAML syntax**: Use spaces, not tabs for indentation
- **File encoding**: UTF-8
- **Line endings**: LF (Unix-style) preferred
- **Path separators**: Forward slashes (`/`) only, not backslashes

## Resources

### Official Documentation

**Claude Code Skills (this repository):**
- [Claude Code Skills](https://docs.claude.com/en/docs/claude-code/skills) - Primary reference for this repository
- [Claude Code Plugins](https://docs.claude.com/en/docs/claude-code/plugins.md) - Plugin system overview
- [Plugins Reference](https://docs.claude.com/en/docs/claude-code/plugins-reference.md) - Technical specifications
- [Plugin Marketplaces](https://docs.claude.com/en/docs/claude-code/plugin-marketplaces.md) - Marketplace configuration

**Agent Skills (API-based, different from this repository):**
- [Agent Skills Overview](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview)
- [Agent Skills Quickstart](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/quickstart)
- [Agent Skills Best Practices](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices)

### Schema References

- Marketplace schema: `https://anthropic.com/claude-code/marketplace.schema.json`

### Additional Resources

- Claude Docs: [https://docs.claude.com](https://docs.claude.com)
- Agent Skills Cookbook (API-based): [GitHub](https://github.com/anthropics/agent-skills-cookbook)

## License

See individual plugin licenses. Default: MIT

## Contributing

To contribute a new skill or plugin:

1. Fork this repository
2. Create your skill following the specifications above
3. Test thoroughly using the local marketplace
4. Submit a pull request with clear documentation

---

**Last Updated**: 2025-10-24
**Specifications Version**: Claude Code 1.0+
