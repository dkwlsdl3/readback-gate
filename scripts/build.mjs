import { chmodSync, readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const entryPoints = ['src/cli.ts', 'src/adapters/codex.ts', 'src/install.ts', 'src/dualrun.ts', 'src/dualrun-report.ts', 'src/dualrun-label.ts', 'src/dualrun-worker.ts'];
const binOutputs = ['dist/cli.js', 'dist/adapters/codex.js', 'dist/dualrun.js', 'dist/dualrun-report.js', 'dist/dualrun-label.js', 'dist/dualrun-worker.js'];
const shebang = '#!/usr/bin/env node';

rmSync('dist', { recursive: true, force: true });

await build({
  entryPoints,
  outdir: 'dist',
  outbase: 'src',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  entryNames: '[dir]/[name]',
  logLevel: 'info'
});

for (const file of binOutputs) {
  const firstLine = readFileSync(file, 'utf8').split('\n', 1)[0];
  if (firstLine !== shebang) {
    throw new Error(`${file} is missing the node shebang`);
  }
  chmodSync(file, 0o755);
}
