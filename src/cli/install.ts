import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type InstallHost = 'claude-code' | 'codex' | 'cursor';

export interface InstallOptions {
  host?: InstallHost;
  workspace?: string;
  name?: string;
  printOnly?: boolean;
}

export interface InstallResult {
  host: InstallHost;
  name: string;
  workspace: string;
  applied: boolean;
  method: 'cli' | 'config-edit' | 'print-only';
  message: string;
  manualSnippet?: string;
  verificationHint: string;
}

const PACKAGE_NAME = 'novelforge-agent';
const MCP_BIN = 'novelforge-agent-mcp';

function defaultWorkspace(): string {
  return join(homedir(), 'novelforge');
}

function defaultName(): string {
  return 'novelforge';
}

function claudeJsonSnippet(name: string, workspace: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [name]: {
          command: 'npx',
          args: ['-y', '-p', `${PACKAGE_NAME}@latest`, MCP_BIN],
          env: { NOVELFORGE_WORKSPACE: workspace },
        },
      },
    },
    null,
    2
  );
}

function codexTomlSnippet(name: string, workspace: string): string {
  return [
    `[mcp_servers.${name}]`,
    `command = "npx"`,
    `args = ["-y", "-p", "${PACKAGE_NAME}@latest", "${MCP_BIN}"]`,
    ``,
    `[mcp_servers.${name}.env]`,
    `NOVELFORGE_WORKSPACE = "${workspace}"`,
    ``,
  ].join('\n');
}

function cursorSnippet(name: string, workspace: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [name]: {
          command: 'npx',
          args: ['-y', '-p', `${PACKAGE_NAME}@latest`, MCP_BIN],
          env: { NOVELFORGE_WORKSPACE: workspace },
        },
      },
    },
    null,
    2
  );
}

async function ensureWorkspaceDir(workspace: string): Promise<void> {
  await mkdir(workspace, { recursive: true });
  await mkdir(join(workspace, 'novels'), { recursive: true });
}

async function tryClaudeCli(name: string, workspace: string): Promise<{ ok: boolean; output: string; error?: string }> {
  const args = [
    'mcp',
    'add',
    '-s',
    'user',
    '-e',
    `NOVELFORGE_WORKSPACE=${workspace}`,
    name,
    '--',
    'npx',
    '-y',
    '-p',
    `${PACKAGE_NAME}@latest`,
    MCP_BIN,
  ];
  try {
    const { stdout, stderr } = await execFileAsync('claude', args);
    return { ok: true, output: `${stdout}\n${stderr}`.trim() };
  } catch (error) {
    const err = error as Error & { code?: string };
    return { ok: false, output: '', error: err.message };
  }
}

async function applyClaudeCode(name: string, workspace: string, printOnly: boolean): Promise<InstallResult> {
  const snippet = claudeJsonSnippet(name, workspace);
  const verificationHint =
    'In Claude Code, ask the assistant: "list_projects 现在能用吗?". The host should call the list_projects tool and return an empty array.';

  if (printOnly) {
    return {
      host: 'claude-code',
      name,
      workspace,
      applied: false,
      method: 'print-only',
      message:
        'Print-only mode. Run the snippet below or invoke without --print-only to apply automatically.',
      manualSnippet: snippet,
      verificationHint,
    };
  }

  const cli = await tryClaudeCli(name, workspace);
  if (cli.ok) {
    return {
      host: 'claude-code',
      name,
      workspace,
      applied: true,
      method: 'cli',
      message: `Registered via \`claude mcp add\`.\n${cli.output}`,
      verificationHint,
    };
  }
  return {
    host: 'claude-code',
    name,
    workspace,
    applied: false,
    method: 'print-only',
    message:
      `\`claude\` CLI not available (${cli.error ?? 'unknown error'}). Paste the snippet below into ~/.claude.json under "mcpServers", or run \`claude mcp add -s user -e NOVELFORGE_WORKSPACE=${workspace} ${name} -- npx -y -p ${PACKAGE_NAME}@latest ${MCP_BIN}\` after installing Claude Code.`,
    manualSnippet: snippet,
    verificationHint,
  };
}

async function applyCodex(name: string, workspace: string, printOnly: boolean): Promise<InstallResult> {
  const snippet = codexTomlSnippet(name, workspace);
  const configPath = join(homedir(), '.codex', 'config.toml');
  const verificationHint =
    'In Codex CLI, ask the assistant: "list_projects 现在能用吗?". The host should call the list_projects tool and return an empty array.';

  if (printOnly) {
    return {
      host: 'codex',
      name,
      workspace,
      applied: false,
      method: 'print-only',
      message: `Print-only mode. Append the snippet below to ${configPath}.`,
      manualSnippet: snippet,
      verificationHint,
    };
  }

  try {
    await mkdir(dirname(configPath), { recursive: true });
    let existing = '';
    try {
      existing = await readFile(configPath, 'utf8');
    } catch {
      existing = '';
    }
    if (existing.includes(`[mcp_servers.${name}]`)) {
      return {
        host: 'codex',
        name,
        workspace,
        applied: false,
        method: 'config-edit',
        message: `Section [mcp_servers.${name}] already exists in ${configPath}. Edit it manually if you want to change settings.`,
        manualSnippet: snippet,
        verificationHint,
      };
    }
    const next = existing.endsWith('\n') || existing === '' ? existing : `${existing}\n`;
    await writeFile(configPath, `${next}\n${snippet}`, 'utf8');
    return {
      host: 'codex',
      name,
      workspace,
      applied: true,
      method: 'config-edit',
      message: `Appended [mcp_servers.${name}] to ${configPath}.`,
      verificationHint,
    };
  } catch (error) {
    return {
      host: 'codex',
      name,
      workspace,
      applied: false,
      method: 'print-only',
      message: `Could not write ${configPath}: ${(error as Error).message}. Append the snippet manually.`,
      manualSnippet: snippet,
      verificationHint,
    };
  }
}

async function applyCursor(name: string, workspace: string, printOnly: boolean): Promise<InstallResult> {
  const snippet = cursorSnippet(name, workspace);
  return {
    host: 'cursor',
    name,
    workspace,
    applied: false,
    method: 'print-only',
    message:
      'Cursor: open Settings → Tools & Integrations → MCP, click "Add new MCP server", and paste the snippet below.',
    manualSnippet: snippet,
    verificationHint:
      'In Cursor, the agent should be able to call the list_projects tool from the novelforge MCP server.',
  };
}

export async function runInstall(options: InstallOptions): Promise<InstallResult> {
  const host: InstallHost = options.host ?? 'claude-code';
  const workspace = resolve(options.workspace ?? defaultWorkspace());
  const name = options.name ?? defaultName();
  const printOnly = options.printOnly ?? false;

  if (!printOnly) {
    await ensureWorkspaceDir(workspace);
  }

  switch (host) {
    case 'claude-code':
      return applyClaudeCode(name, workspace, printOnly);
    case 'codex':
      return applyCodex(name, workspace, printOnly);
    case 'cursor':
      return applyCursor(name, workspace, printOnly);
    default:
      throw new Error(`Unknown host: ${host}. Use claude-code | codex | cursor.`);
  }
}

export function formatInstallResult(result: InstallResult): string {
  const parts: string[] = [];
  parts.push(`Host:        ${result.host}`);
  parts.push(`MCP name:    ${result.name}`);
  parts.push(`Workspace:   ${result.workspace}`);
  parts.push(`Applied:     ${result.applied ? 'yes' : 'no'} (${result.method})`);
  parts.push('');
  parts.push(result.message);
  if (result.manualSnippet) {
    parts.push('');
    parts.push('--- Snippet ---');
    parts.push(result.manualSnippet);
    parts.push('---------------');
  }
  parts.push('');
  parts.push(`Verify: ${result.verificationHint}`);
  return parts.join('\n');
}
