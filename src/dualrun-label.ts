#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

type BranchArm = 'gated_visible' | 'baseline_replica';
type BlindVerdict = 'arm_a_better' | 'arm_b_better' | 'same' | 'both_bad' | 'exclude';
type LabelVerdict = 'gated_better' | 'baseline_better' | 'same' | 'both_bad' | 'exclude';
type Confidence = 'low' | 'medium' | 'high';

interface ManifestEntry {
  pairId: string;
  armA: BranchArm;
  armB: BranchArm;
}

interface LabelerOutput {
  verdict: BlindVerdict;
  confidence?: Confidence;
  notes?: string;
}

interface CliArgs {
  reviewDir: string;
  labelsPath: string;
  labelerCommand: string;
  reviewer: string;
  auditPath?: string;
  limit: number;
  jsonOnly: boolean;
  overwrite: boolean;
}

interface LabelSummary {
  reviewDir: string;
  labelsPath: string;
  auditPath?: string;
  processed: number;
  labeled: number;
  skipped: number;
  failed: number;
  auditRecommended: number;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href ||
    fileURLToPath(import.meta.url) === resolve(entry);
}

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = {
    reviewer: 'ai-labeler',
    limit: Number.MAX_SAFE_INTEGER,
    jsonOnly: false,
    overwrite: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--review-dir') {
      args.reviewDir = resolve(argv[++index]);
    } else if (arg.startsWith('--review-dir=')) {
      args.reviewDir = resolve(arg.slice('--review-dir='.length));
    } else if (arg === '--labels') {
      args.labelsPath = resolve(argv[++index]);
    } else if (arg.startsWith('--labels=')) {
      args.labelsPath = resolve(arg.slice('--labels='.length));
    } else if (arg === '--labeler-cmd') {
      args.labelerCommand = argv[++index];
    } else if (arg.startsWith('--labeler-cmd=')) {
      args.labelerCommand = arg.slice('--labeler-cmd='.length);
    } else if (arg === '--reviewer') {
      args.reviewer = argv[++index];
    } else if (arg.startsWith('--reviewer=')) {
      args.reviewer = arg.slice('--reviewer='.length);
    } else if (arg === '--audit') {
      args.auditPath = resolve(argv[++index]);
    } else if (arg.startsWith('--audit=')) {
      args.auditPath = resolve(arg.slice('--audit='.length));
    } else if (arg === '--limit') {
      args.limit = Number(argv[++index]);
    } else if (arg.startsWith('--limit=')) {
      args.limit = Number(arg.slice('--limit='.length));
    } else if (arg === '--overwrite') {
      args.overwrite = true;
    } else if (arg === '--json') {
      args.jsonOnly = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!args.reviewDir || !args.labelsPath || !args.labelerCommand) {
    throw new Error('Usage: readback-gate-dual-run-label --review-dir <dir> --labels <labels.jsonl> --labeler-cmd "<cmd>" [--audit <audit.jsonl>] [--limit N] [--overwrite] [--json]');
  }
  if (!Number.isFinite(args.limit) || args.limit < 1) {
    throw new Error('--limit must be a positive number');
  }
  return args as CliArgs;
}

function readManifest(reviewDir: string): Map<string, ManifestEntry> {
  const path = join(reviewDir, 'manifest.private.json');
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as ManifestEntry[];
  return new Map(parsed.map((entry) => [entry.pairId, entry]));
}

function readExistingLabels(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  const ids = new Set<string>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line) as { pairId?: string };
    if (parsed.pairId) ids.add(parsed.pairId);
  }
  return ids;
}

function pairDirs(reviewDir: string): string[] {
  return readdirSync(reviewDir)
    .map((entry) => join(reviewDir, entry))
    .filter((path) => statSync(path).isDirectory())
    .sort();
}

function buildLabelerPrompt(pairId: string, armAInput: string, armBInput: string): string {
  return [
    'You are labeling a blinded A/B comparison for an AI coding-agent prompt experiment.',
    'Do not infer which arm is the treatment. Judge only the visible behavior and artifacts.',
    'Return exactly one JSON object with fields:',
    '{"verdict":"arm_a_better|arm_b_better|same|both_bad|exclude","confidence":"low|medium|high","notes":"short reason"}',
    '',
    'Use exclude for missing artifacts, auth failures, command failures, or non-comparable outputs.',
    'Prefer same when the difference would not matter to a user.',
    '',
    `pairId: ${pairId}`,
    '',
    '## arm_a',
    armAInput,
    '',
    '## arm_b',
    armBInput,
    ''
  ].join('\n');
}

function parseLabelerOutput(stdout: string): LabelerOutput {
  const trimmed = stdout.trim();
  const candidate = trimmed.startsWith('{')
    ? trimmed
    : trimmed.match(/\{[\s\S]*\}/)?.[0] ?? '';
  if (!candidate) throw new Error('labeler did not return a JSON object');
  const parsed = JSON.parse(candidate) as Partial<LabelerOutput>;
  if (
    parsed.verdict !== 'arm_a_better' &&
    parsed.verdict !== 'arm_b_better' &&
    parsed.verdict !== 'same' &&
    parsed.verdict !== 'both_bad' &&
    parsed.verdict !== 'exclude'
  ) {
    throw new Error(`invalid blind verdict: ${String(parsed.verdict)}`);
  }
  const confidence = parsed.confidence === 'low' || parsed.confidence === 'medium' || parsed.confidence === 'high'
    ? parsed.confidence
    : 'medium';
  return {
    verdict: parsed.verdict,
    confidence,
    notes: typeof parsed.notes === 'string' ? parsed.notes : ''
  };
}

function mapVerdict(verdict: BlindVerdict, manifest: ManifestEntry): LabelVerdict {
  if (verdict === 'same' || verdict === 'both_bad' || verdict === 'exclude') return verdict;
  const winner = verdict === 'arm_a_better' ? manifest.armA : manifest.armB;
  return winner === 'gated_visible' ? 'gated_better' : 'baseline_better';
}

function appendJsonl(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
}

function shouldAudit(output: LabelerOutput, mapped: LabelVerdict): boolean {
  return output.confidence === 'low' || mapped === 'exclude' || mapped === 'both_bad';
}

function labelReviewPack(options: CliArgs): LabelSummary {
  const manifest = readManifest(options.reviewDir);
  const existing = options.overwrite ? new Set<string>() : readExistingLabels(options.labelsPath);
  let processed = 0;
  let labeled = 0;
  let skipped = 0;
  let failed = 0;
  let auditRecommended = 0;

  for (const dir of pairDirs(options.reviewDir)) {
    if (processed >= options.limit) break;
    const pairId = dir.split('/').at(-1) ?? '';
    const manifestEntry = manifest.get(pairId);
    if (!manifestEntry) continue;
    if (existing.has(pairId)) {
      skipped += 1;
      continue;
    }
    processed += 1;

    try {
      const armAInput = readFileSync(join(dir, 'arm_a_input.txt'), 'utf8');
      const armBInput = readFileSync(join(dir, 'arm_b_input.txt'), 'utf8');
      const prompt = buildLabelerPrompt(pairId, armAInput, armBInput);
      const result = spawnSync(process.env.SHELL ?? '/bin/sh', ['-lc', options.labelerCommand], {
        input: prompt,
        encoding: 'utf8',
        env: {
          ...process.env,
          READBACK_GATE_DISABLE: '1',
          READBACK_GATE_DUALRUN_CAPTURE: '0'
        },
        maxBuffer: 16 * 1024 * 1024
      });
      if (result.status !== 0) {
        throw new Error(result.stderr?.trim() || result.stdout?.trim() || `labeler exited with code ${result.status}`);
      }
      const output = parseLabelerOutput(result.stdout ?? '');
      const mapped = mapVerdict(output.verdict, manifestEntry);
      const record = {
        pairId,
        verdict: mapped,
        reviewer: options.reviewer,
        confidence: output.confidence,
        notes: output.notes,
        blindVerdict: output.verdict
      };
      appendJsonl(options.labelsPath, record);
      labeled += 1;
      if (shouldAudit(output, mapped)) {
        auditRecommended += 1;
        if (options.auditPath) appendJsonl(options.auditPath, { ...record, reason: 'low_confidence_or_noncomparable' });
      }
    } catch (error) {
      failed += 1;
      auditRecommended += 1;
      if (options.auditPath) {
        appendJsonl(options.auditPath, {
          pairId,
          verdict: 'exclude',
          reviewer: options.reviewer,
          confidence: 'low',
          notes: error instanceof Error ? error.message : String(error),
          reason: 'labeler_failed'
        });
      }
    }
  }

  return {
    reviewDir: options.reviewDir,
    labelsPath: options.labelsPath,
    auditPath: options.auditPath,
    processed,
    labeled,
    skipped,
    failed,
    auditRecommended
  };
}

if (isMainModule()) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const summary = labelReviewPack(args);
    if (args.jsonOnly) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`readback-gate dual-run labeler: ${summary.reviewDir}`);
      console.log(`processed: ${summary.processed}`);
      console.log(`labeled: ${summary.labeled}`);
      console.log(`skipped: ${summary.skipped}`);
      console.log(`failed: ${summary.failed}`);
      console.log(`audit recommended: ${summary.auditRecommended}`);
      console.log(`labels: ${summary.labelsPath}`);
      if (summary.auditPath) console.log(`audit: ${summary.auditPath}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
