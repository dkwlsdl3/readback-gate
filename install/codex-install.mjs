#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const distInstall = resolve(new URL('..', import.meta.url).pathname, 'dist/install.js');
const sourceInstall = resolve(new URL('..', import.meta.url).pathname, 'src/install.ts');
const installModule = await import(pathToFileURL(existsSync(distInstall) ? distInstall : sourceInstall).href);

try {
  const options = installModule.parseInstallArgs(['--codex', ...process.argv.slice(2)], import.meta.url);
  const results = installModule.runInstall(options);
  console.log(JSON.stringify({ results }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
