#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

const dryRun = process.argv.includes('--dry-run');
const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const hooksPath = process.env.CODEX_HOOKS_PATH ?? `${homedir()}/.codex/hooks.json`;
const command = `"${process.execPath}" "${repoRoot}/src/adapters/codex.ts"`;

const hook = {
  hooks: [
    {
      type: 'command',
      command
    }
  ]
};

const config = existsSync(hooksPath)
  ? JSON.parse(readFileSync(hooksPath, 'utf8'))
  : { hooks: {} };

config.hooks ??= {};
config.hooks.UserPromptSubmit ??= [];

const alreadyInstalled = config.hooks.UserPromptSubmit.some((entry) =>
  JSON.stringify(entry).includes('/src/adapters/codex.ts')
);

if (!alreadyInstalled) {
  config.hooks.UserPromptSubmit.push(hook);
}

if (dryRun) {
  console.log(JSON.stringify({ hooksPath, alreadyInstalled, hook }, null, 2));
  process.exit(0);
}

mkdirSync(dirname(hooksPath), { recursive: true });
writeFileSync(hooksPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
console.log(alreadyInstalled ? 'readback-gate Codex hook already installed' : 'readback-gate Codex hook installed');
