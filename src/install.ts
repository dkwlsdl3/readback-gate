import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { normalizeMode } from './core/modes.ts';
import type { Mode } from './core/types.ts';

export type InstallTarget = 'codex' | 'claude';

export interface InstallOptions {
  targets: InstallTarget[];
  mode: Mode;
  threshold: number;
  dualRunCapture: boolean;
  dryRun: boolean;
  uninstall: boolean;
  nodePath: string;
  adapterPath: string;
  codexHooksPath: string;
  claudeSettingsPath: string;
}

export interface InstallResult {
  target: InstallTarget;
  path: string;
  changed: boolean;
  installed: boolean;
  action: 'install' | 'already-installed' | 'uninstall' | 'already-absent';
  command: string;
  dryRun: boolean;
}

type JsonObject = Record<string, unknown>;

const DEFAULT_MODE: Mode = 'inject';
const DEFAULT_THRESHOLD = 70;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function commandNeedsRemoval(value: unknown): boolean {
  return typeof value === 'string' && (
    value.includes('readback-gate') ||
    /(?:dist|src)[/\\]adapters[/\\]codex\.(?:js|ts)/.test(value)
  );
}

function hookCommand(hook: unknown): string | undefined {
  if (!isObject(hook)) return undefined;
  return typeof hook.command === 'string' ? hook.command : undefined;
}

function hasReadbackGateHook(entry: unknown): boolean {
  if (!isObject(entry)) return false;
  const hooks = entry.hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some((hook) => commandNeedsRemoval(hookCommand(hook)));
}

function withoutReadbackGateHooks(entry: unknown): unknown | undefined {
  if (!isObject(entry)) return entry;
  const hooks = entry.hooks;
  if (!Array.isArray(hooks)) return entry;
  const nextHooks = hooks.filter((hook) => !commandNeedsRemoval(hookCommand(hook)));
  if (nextHooks.length === 0) return undefined;
  return { ...entry, hooks: nextHooks };
}

function hasInstalledCommand(entries: unknown[]): boolean {
  return entries.some((entry) => hasReadbackGateHook(entry));
}

function makeHook(command: string): JsonObject {
  return {
    hooks: [
      {
        type: 'command',
        command
      }
    ]
  };
}

function makeClaudeHook(command: string): JsonObject {
  return {
    matcher: '*',
    hooks: [
      {
        type: 'command',
        command
      }
    ]
  };
}

function applyEnv(command: string, envVars: Record<string, string | undefined>): string {
  const env: string[] = [];
  for (const [key, value] of Object.entries(envVars)) {
    if (value !== undefined) env.push(`${key}=${value}`);
  }
  return env.length === 0 ? command : `${env.join(' ')} ${command}`;
}

function quoteShell(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function buildHookCommand(
  nodePath: string,
  adapterPath: string,
  mode = DEFAULT_MODE,
  threshold = DEFAULT_THRESHOLD,
  extraEnv: Record<string, string | undefined> = {}
): string {
  return applyEnv(`${quoteShell(nodePath)} ${quoteShell(adapterPath)}`, {
    ...(mode !== DEFAULT_MODE ? { READBACK_GATE_MODE: mode } : {}),
    ...(threshold !== DEFAULT_THRESHOLD ? { READBACK_GATE_THRESHOLD: String(threshold) } : {}),
    ...extraEnv
  });
}

function targetHookCommand(options: InstallOptions, target: InstallTarget): string {
  return buildHookCommand(options.nodePath, options.adapterPath, options.mode, options.threshold, options.dualRunCapture
    ? {
        READBACK_GATE_DUALRUN_CAPTURE: '1',
        READBACK_GATE_DUALRUN_AGENT: target
      }
    : {});
}

function replaceReadbackGateHooks(entry: unknown, command: string): unknown {
  if (!isObject(entry)) return entry;
  const hooks = entry.hooks;
  if (!Array.isArray(hooks)) return entry;
  if (!hooks.some((hook) => commandNeedsRemoval(hookCommand(hook)))) return entry;
  return {
    ...entry,
    hooks: [
      ...hooks.filter((hook) => !commandNeedsRemoval(hookCommand(hook))),
      { type: 'command', command }
    ]
  };
}

export function transformCodexHooksConfig(config: unknown, command: string, uninstall = false): JsonObject {
  const source = isObject(config) ? config : {};
  const sourceHooks = isObject(source.hooks) ? source.hooks : {};
  const userPromptSubmit = Array.isArray(sourceHooks.UserPromptSubmit)
    ? sourceHooks.UserPromptSubmit
    : [];

  const nextUserPromptSubmit = uninstall
    ? userPromptSubmit.map(withoutReadbackGateHooks).filter((entry) => entry !== undefined)
    : hasInstalledCommand(userPromptSubmit)
      ? userPromptSubmit.map((entry) => replaceReadbackGateHooks(entry, command))
      : [...userPromptSubmit, makeHook(command)];

  return {
    hooks: {
      ...sourceHooks,
      UserPromptSubmit: nextUserPromptSubmit
    }
  };
}

export function transformClaudeSettingsConfig(config: unknown, command: string, uninstall = false): JsonObject {
  const source = isObject(config) ? config : {};
  const hooks = isObject(source.hooks) ? source.hooks : {};
  const userPromptSubmit = Array.isArray(hooks.UserPromptSubmit)
    ? hooks.UserPromptSubmit
    : [];

  let nextUserPromptSubmit: unknown[];
  if (uninstall) {
    nextUserPromptSubmit = userPromptSubmit
      .map(withoutReadbackGateHooks)
      .filter((entry) => entry !== undefined);
  } else if (hasInstalledCommand(userPromptSubmit)) {
    nextUserPromptSubmit = userPromptSubmit.map((entry) => replaceReadbackGateHooks(entry, command));
  } else {
    const matcherIndex = userPromptSubmit.findIndex((entry) =>
      isObject(entry) && entry.matcher === '*' && Array.isArray(entry.hooks)
    );
    if (matcherIndex === -1) {
      nextUserPromptSubmit = [...userPromptSubmit, makeClaudeHook(command)];
    } else {
      nextUserPromptSubmit = userPromptSubmit.map((entry, index) => {
        if (index !== matcherIndex || !isObject(entry) || !Array.isArray(entry.hooks)) return entry;
        return {
          ...entry,
          hooks: [
            ...entry.hooks,
            {
              type: 'command',
              command
            }
          ]
        };
      });
    }
  }

  return {
    ...source,
    hooks: {
      ...hooks,
      UserPromptSubmit: nextUserPromptSubmit
    }
  };
}

function parseJsonFile(path: string): { config: unknown; indent: number } {
  if (!existsSync(path)) return { config: {}, indent: 2 };
  const raw = readFileSync(path, 'utf8');
  const indentMatch = raw.match(/\n( +)"/);
  return {
    config: raw.trim() ? JSON.parse(raw) : {},
    indent: indentMatch?.[1].length ?? 2
  };
}

function writeJsonFile(path: string, config: unknown, indent: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, indent)}\n`, 'utf8');
}

function configsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function defaultCodexHooksPath(): string {
  return process.env.READBACK_GATE_CODEX_HOOKS_PATH ?? `${homedir()}/.codex/hooks.json`;
}

export function defaultClaudeSettingsPath(): string {
  return process.env.READBACK_GATE_CLAUDE_SETTINGS_PATH ?? `${homedir()}/.claude/settings.json`;
}

export function resolveInstalledCodexAdapterPath(moduleUrl = import.meta.url): string {
  const modulePath = fileURLToPath(moduleUrl);
  const moduleDir = dirname(modulePath);
  const moduleFile = basename(modulePath);
  if (moduleDir.endsWith('/dist')) return resolve(moduleDir, 'adapters/codex.js');
  if (moduleDir.endsWith('/src')) return resolve(moduleDir, '../dist/adapters/codex.js');
  if (moduleFile === 'codex-install.mjs') return resolve(moduleDir, '../dist/adapters/codex.js');
  return resolve(moduleDir, 'dist/adapters/codex.js');
}

export function detectTargets(codexHooksPath: string, claudeSettingsPath: string): InstallTarget[] {
  const targets: InstallTarget[] = [];
  if (existsSync(codexHooksPath)) targets.push('codex');
  if (existsSync(claudeSettingsPath)) targets.push('claude');
  return targets.length === 0 ? ['codex'] : targets;
}

export function parseInstallArgs(argv: string[], moduleUrl = import.meta.url): InstallOptions {
  const explicitTargets = new Set<InstallTarget>();
  let mode: Mode = DEFAULT_MODE;
  let threshold = DEFAULT_THRESHOLD;
  let dualRunCapture = false;
  let dryRun = false;
  let uninstall = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--codex') {
      explicitTargets.add('codex');
    } else if (arg === '--claude') {
      explicitTargets.add('claude');
    } else if (arg === '--mode') {
      mode = normalizeMode(argv[++index]);
    } else if (arg.startsWith('--mode=')) {
      mode = normalizeMode(arg.slice('--mode='.length));
    } else if (arg === '--threshold') {
      threshold = Number(argv[++index]);
    } else if (arg.startsWith('--threshold=')) {
      threshold = Number(arg.slice('--threshold='.length));
    } else if (arg === '--dual-run-capture') {
      dualRunCapture = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--uninstall') {
      uninstall = true;
    } else {
      throw new Error(`Unknown install option: ${arg}`);
    }
  }

  if (!Number.isFinite(threshold)) {
    throw new Error('--threshold must be a number');
  }

  const codexHooksPath = defaultCodexHooksPath();
  const claudeSettingsPath = defaultClaudeSettingsPath();
  const targets = explicitTargets.size > 0
    ? [...explicitTargets]
    : detectTargets(codexHooksPath, claudeSettingsPath);

  return {
    targets,
    mode,
    threshold,
    dualRunCapture,
    dryRun,
    uninstall,
    nodePath: realpathSync(process.execPath),
    adapterPath: resolveInstalledCodexAdapterPath(moduleUrl),
    codexHooksPath,
    claudeSettingsPath
  };
}

export function runInstall(options: InstallOptions): InstallResult[] {
  return options.targets.map((target) => {
    const command = targetHookCommand(options, target);
    const path = target === 'codex' ? options.codexHooksPath : options.claudeSettingsPath;
    const { config, indent } = parseJsonFile(path);
    const nextConfig = target === 'codex'
      ? transformCodexHooksConfig(config, command, options.uninstall)
      : transformClaudeSettingsConfig(config, command, options.uninstall);
    const changed = !configsEqual(config, nextConfig);

    if (changed && !options.dryRun) {
      writeJsonFile(path, nextConfig, indent);
    }

    return {
      target,
      path,
      changed,
      installed: !options.uninstall && (!options.dryRun || !changed),
      action: options.uninstall
        ? (changed ? 'uninstall' : 'already-absent')
        : (changed ? 'install' : 'already-installed'),
      command,
      dryRun: options.dryRun
    };
  });
}
