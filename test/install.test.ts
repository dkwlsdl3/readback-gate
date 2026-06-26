import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildHookCommand,
  transformClaudeSettingsConfig,
  transformCodexHooksConfig
} from '../src/install.ts';

const command = buildHookCommand('/usr/bin/node', '/pkg/dist/adapters/codex.js');

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'readback-gate-install-'));
}

test('transformCodexHooksConfig installs into an empty config with hooks as the only top-level key', () => {
  const config = transformCodexHooksConfig({}, command);

  assert.deepEqual(Object.keys(config), ['hooks']);
  assert.deepEqual(config, {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command
            }
          ]
        }
      ]
    }
  });
});

test('transformCodexHooksConfig preserves existing hooks and removes unknown top-level keys', () => {
  const config = transformCodexHooksConfig({
    state: {},
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: 'echo start' }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo existing' }] }]
    }
  }, command);

  assert.equal('state' in config, false);
  assert.deepEqual(config.hooks, {
    SessionStart: [{ hooks: [{ type: 'command', command: 'echo start' }] }],
    UserPromptSubmit: [
      { hooks: [{ type: 'command', command: 'echo existing' }] },
      { hooks: [{ type: 'command', command }] }
    ]
  });
});

test('transformCodexHooksConfig is idempotent when readback-gate is already installed', () => {
  const input = {
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command }] }]
    }
  };

  assert.deepEqual(transformCodexHooksConfig(input, command), input);
});

test('transformClaudeSettingsConfig installs into matcher star and preserves existing settings', () => {
  const config = transformClaudeSettingsConfig({
    model: 'opus',
    hooks: {
      UserPromptSubmit: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: 'echo existing' }]
        }
      ]
    }
  }, command);

  assert.deepEqual(config, {
    model: 'opus',
    hooks: {
      UserPromptSubmit: [
        {
          matcher: '*',
          hooks: [
            { type: 'command', command: 'echo existing' },
            { type: 'command', command }
          ]
        }
      ]
    }
  });
});

test('transformClaudeSettingsConfig creates matcher star when no Claude hook exists', () => {
  const config = transformClaudeSettingsConfig({ permissions: { allow: [] } }, command);

  assert.deepEqual(config, {
    permissions: { allow: [] },
    hooks: {
      UserPromptSubmit: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command }]
        }
      ]
    }
  });
});

test('transformClaudeSettingsConfig is idempotent when readback-gate is already installed', () => {
  const input = {
    hooks: {
      UserPromptSubmit: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command }]
        }
      ]
    }
  };

  assert.deepEqual(transformClaudeSettingsConfig(input, command), input);
});

test('install --dry-run does not write fixture files', () => {
  const dir = tempDir();
  const codexPath = join(dir, 'codex-hooks.json');

  const output = execFileSync(process.execPath, ['src/cli.ts', 'install', '--codex', '--dry-run'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      READBACK_GATE_CODEX_HOOKS_PATH: codexPath
    }
  });

  assert.equal(existsSync(codexPath), false);
  assert.match(output, /"dryRun": true/);
});

test('install writes Codex and Claude fixture configs through env overrides', () => {
  const dir = tempDir();
  const codexPath = join(dir, 'codex-hooks.json');
  const claudePath = join(dir, 'claude-settings.json');
  writeFileSync(codexPath, JSON.stringify({ hooks: { UserPromptSubmit: [] } }, null, 4), 'utf8');
  writeFileSync(claudePath, JSON.stringify({ permissions: { allow: [] } }, null, 2), 'utf8');

  execFileSync(process.execPath, ['src/cli.ts', 'install', '--codex', '--claude'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      READBACK_GATE_CODEX_HOOKS_PATH: codexPath,
      READBACK_GATE_CLAUDE_SETTINGS_PATH: claudePath
    }
  });

  const codex = JSON.parse(readFileSync(codexPath, 'utf8'));
  const claude = JSON.parse(readFileSync(claudePath, 'utf8'));

  assert.deepEqual(Object.keys(codex), ['hooks']);
  assert.equal(codex.hooks.UserPromptSubmit.length, 1);
  assert.match(codex.hooks.UserPromptSubmit[0].hooks[0].command, /dist\/adapters\/codex\.js/);
  assert.equal(claude.permissions.allow.length, 0);
  assert.equal(claude.hooks.UserPromptSubmit[0].matcher, '*');
  assert.match(claude.hooks.UserPromptSubmit[0].hooks[0].command, /dist\/adapters\/codex\.js/);

  execFileSync(process.execPath, ['src/cli.ts', 'install'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      READBACK_GATE_CODEX_HOOKS_PATH: codexPath,
      READBACK_GATE_CLAUDE_SETTINGS_PATH: claudePath
    }
  });

  assert.equal(JSON.parse(readFileSync(codexPath, 'utf8')).hooks.UserPromptSubmit.length, 1);
  assert.equal(JSON.parse(readFileSync(claudePath, 'utf8')).hooks.UserPromptSubmit[0].hooks.length, 1);
});

test('install --dual-run-capture updates existing hooks with target-specific capture env', () => {
  const dir = tempDir();
  const codexPath = join(dir, 'codex-hooks.json');
  const claudePath = join(dir, 'claude-settings.json');
  writeFileSync(codexPath, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command }] }] } }, null, 2), 'utf8');
  writeFileSync(claudePath, JSON.stringify({ hooks: { UserPromptSubmit: [{ matcher: '*', hooks: [{ type: 'command', command }] }] } }, null, 2), 'utf8');

  execFileSync(process.execPath, ['src/cli.ts', 'install', '--codex', '--claude', '--dual-run-capture'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      READBACK_GATE_CODEX_HOOKS_PATH: codexPath,
      READBACK_GATE_CLAUDE_SETTINGS_PATH: claudePath
    }
  });

  const codexCommand = JSON.parse(readFileSync(codexPath, 'utf8')).hooks.UserPromptSubmit[0].hooks[0].command;
  const claudeCommand = JSON.parse(readFileSync(claudePath, 'utf8')).hooks.UserPromptSubmit[0].hooks[0].command;
  assert.match(codexCommand, /READBACK_GATE_DUALRUN_CAPTURE=1/);
  assert.match(codexCommand, /READBACK_GATE_DUALRUN_AGENT=codex/);
  assert.match(claudeCommand, /READBACK_GATE_DUALRUN_CAPTURE=1/);
  assert.match(claudeCommand, /READBACK_GATE_DUALRUN_AGENT=claude/);
});
