#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DualRunSummary, PairVerdict } from './dualrun.ts';

type OutcomeLabel = Extract<PairVerdict, 'gated_better' | 'baseline_better' | 'same' | 'both_bad'>;
type LabelVerdict = OutcomeLabel | 'exclude';

interface LabelRecord {
  pairId: string;
  verdict: LabelVerdict;
  reviewer?: string;
  confidence?: 'low' | 'medium' | 'high';
  notes?: string;
}

interface ReportOptions {
  artifactsRoot: string;
  labelsPath?: string;
  jsonOnly: boolean;
  minLabeled: number;
  requireReady: boolean;
  prepareReviewDir?: string;
}

interface ReportSummary {
  generatedAt: string;
  artifactsRoot: string;
  labelsPath?: string;
  minLabeled: number;
  totals: {
    pairs: number;
    primaryEligible: number;
    primaryIneligible: number;
    labeledPrimary: number;
    unlabeledPrimary: number;
    excludedByLabel: number;
  };
  agents: Record<string, {
    pairs: number;
    primaryEligible: number;
    labeledPrimary: number;
  }>;
  outcomes: Record<OutcomeLabel, number>;
  effect: {
    labeledComparable: number;
    gatedMinusBaseline: number;
    gatedMinusBaselinePct: number | null;
    gatedBetterPct: number | null;
    baselineBetterPct: number | null;
  };
  readyForClaim: boolean;
  blockers: string[];
  reviewQueue: Array<{
    pairId: string;
    summaryPath: string;
    gatedInputPath?: string;
    baselineInputPath?: string;
  }>;
}

interface CliArgs extends ReportOptions {}

const OUTCOME_LABELS: OutcomeLabel[] = ['gated_better', 'baseline_better', 'same', 'both_bad'];
const DEFAULT_ARTIFACTS_ROOT = join(tmpdir(), 'readback-gate-dualrun');

function defaultArtifactsRoot(): string {
  return DEFAULT_ARTIFACTS_ROOT;
}

function findSummaryFiles(root: string): string[] {
  const files: string[] = [];
  if (!existsSync(root)) return files;
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        visit(path);
      } else if (entry === 'summary.json') {
        files.push(path);
      }
    }
  };
  visit(root);
  return files.sort();
}

function readSummary(path: string): DualRunSummary {
  return JSON.parse(readFileSync(path, 'utf8')) as DualRunSummary;
}

function normalizeLabel(value: unknown): LabelVerdict {
  if (
    value === 'gated_better' ||
    value === 'baseline_better' ||
    value === 'same' ||
    value === 'both_bad' ||
    value === 'exclude'
  ) {
    return value;
  }
  throw new Error(`Invalid label verdict: ${String(value)}`);
}

function readLabels(path: string | undefined): Map<string, LabelRecord> {
  const labels = new Map<string, LabelRecord>();
  if (!path) return labels;
  const raw = readFileSync(path, 'utf8');
  for (const [index, line] of raw.split('\n').entries()) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line) as Partial<LabelRecord>;
    if (!parsed.pairId) {
      throw new Error(`${path}:${index + 1} missing pairId`);
    }
    labels.set(parsed.pairId, {
      ...parsed,
      pairId: parsed.pairId,
      verdict: normalizeLabel(parsed.verdict)
    });
  }
  return labels;
}

function buildReport(options: ReportOptions): ReportSummary {
  const summaryFiles = findSummaryFiles(options.artifactsRoot);
  const summaries = summaryFiles.map((path) => ({ path, summary: readSummary(path) }));
  const labels = readLabels(options.labelsPath);
  const outcomes: Record<OutcomeLabel, number> = {
    gated_better: 0,
    baseline_better: 0,
    same: 0,
    both_bad: 0
  };

  let primaryEligible = 0;
  let labeledPrimary = 0;
  let excludedByLabel = 0;
  const agents: ReportSummary['agents'] = {};
  const reviewQueue: ReportSummary['reviewQueue'] = [];

  for (const item of summaries) {
    const agent = item.summary.agent ?? 'custom';
    agents[agent] ??= { pairs: 0, primaryEligible: 0, labeledPrimary: 0 };
    agents[agent].pairs += 1;
    if (!item.summary.acceptance.primaryEligible) continue;
    primaryEligible += 1;
    agents[agent].primaryEligible += 1;
    const label = labels.get(item.summary.pairId);
    if (!label) {
      reviewQueue.push({
        pairId: item.summary.pairId,
        summaryPath: item.path,
        gatedInputPath: item.summary.branches.gated_visible.inputPath,
        baselineInputPath: item.summary.branches.baseline_replica.inputPath
      });
      continue;
    }
    if (label.verdict === 'exclude') {
      excludedByLabel += 1;
      continue;
    }
    outcomes[label.verdict] += 1;
    labeledPrimary += 1;
    agents[agent].labeledPrimary += 1;
  }

  const labeledComparable = labeledPrimary;
  const gatedMinusBaseline = outcomes.gated_better - outcomes.baseline_better;
  const gatedMinusBaselinePct = labeledComparable === 0 ? null : gatedMinusBaseline / labeledComparable;
  const gatedBetterPct = labeledComparable === 0 ? null : outcomes.gated_better / labeledComparable;
  const baselineBetterPct = labeledComparable === 0 ? null : outcomes.baseline_better / labeledComparable;
  const blockers: string[] = [];

  if (labeledPrimary < options.minLabeled) {
    blockers.push(`labeled_primary=${labeledPrimary}; need at least ${options.minLabeled}`);
  }
  if (primaryEligible === 0) {
    blockers.push('no primary-eligible pairs found');
  }

  return {
    generatedAt: new Date().toISOString(),
    artifactsRoot: options.artifactsRoot,
    labelsPath: options.labelsPath,
    minLabeled: options.minLabeled,
    totals: {
      pairs: summaries.length,
      primaryEligible,
      primaryIneligible: summaries.length - primaryEligible,
      labeledPrimary,
      unlabeledPrimary: primaryEligible - labeledPrimary - excludedByLabel,
      excludedByLabel
    },
    agents,
    outcomes,
    effect: {
      labeledComparable,
      gatedMinusBaseline,
      gatedMinusBaselinePct,
      gatedBetterPct,
      baselineBetterPct
    },
    readyForClaim: blockers.length === 0,
    blockers,
    reviewQueue
  };
}

function copyIfPresent(source: string | undefined, target: string): void {
  if (!source || !existsSync(source)) return;
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

function writePublicSummary(summaryPath: string, target: string): void {
  const summary = readSummary(summaryPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify({
    pairId: summary.pairId,
    agent: summary.agent,
    promptHash: summary.promptHash,
    contextFidelity: summary.contextFidelity,
    contextSource: summary.contextSource,
    treatmentApplied: summary.treatmentApplied,
    score: summary.score,
    acceptance: summary.acceptance
  }, null, 2)}\n`, 'utf8');
}

function prepareBlindReview(report: ReportSummary, outDir: string): void {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const manifest: Array<{
    pairId: string;
    armA: 'gated_visible' | 'baseline_replica';
    armB: 'gated_visible' | 'baseline_replica';
  }> = [];

  for (const item of report.reviewQueue) {
    const swap = Number.parseInt(item.pairId.slice(-1), 16) % 2 === 1;
    const armA = swap ? 'baseline_replica' : 'gated_visible';
    const armB = swap ? 'gated_visible' : 'baseline_replica';
    const pairDir = join(outDir, item.pairId);
    mkdirSync(pairDir, { recursive: true });
    writePublicSummary(item.summaryPath, join(pairDir, 'summary.public.json'));
    copyIfPresent(armA === 'gated_visible' ? item.gatedInputPath : item.baselineInputPath, join(pairDir, 'arm_a_input.txt'));
    copyIfPresent(armB === 'gated_visible' ? item.gatedInputPath : item.baselineInputPath, join(pairDir, 'arm_b_input.txt'));
    writeFileSync(join(pairDir, 'label.json'), `${JSON.stringify({
      pairId: item.pairId,
      verdict: 'same',
      reviewer: '',
      confidence: 'medium',
      notes: ''
    }, null, 2)}\n`, 'utf8');
    manifest.push({ pairId: item.pairId, armA, armB });
  }

  writeFileSync(join(outDir, 'manifest.private.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeFileSync(join(outDir, 'README.md'), [
    '# readback-gate dual-run blind review',
    '',
    'Review each pair directory without opening manifest.private.json.',
    'Compare arm_a_input.txt and arm_b_input.txt, then edit label.json.',
    'Allowed blind verdicts: arm_a_better, arm_b_better, same, both_bad, exclude.',
    'Convert blind labels to gated/baseline labels only after review.',
    ''
  ].join('\n'), 'utf8');
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    artifactsRoot: defaultArtifactsRoot(),
    jsonOnly: false,
    minLabeled: 30,
    requireReady: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--artifacts-root') {
      args.artifactsRoot = resolve(argv[++index]);
    } else if (arg.startsWith('--artifacts-root=')) {
      args.artifactsRoot = resolve(arg.slice('--artifacts-root='.length));
    } else if (arg === '--labels') {
      args.labelsPath = resolve(argv[++index]);
    } else if (arg.startsWith('--labels=')) {
      args.labelsPath = resolve(arg.slice('--labels='.length));
    } else if (arg === '--min-labeled') {
      args.minLabeled = Number(argv[++index]);
    } else if (arg.startsWith('--min-labeled=')) {
      args.minLabeled = Number(arg.slice('--min-labeled='.length));
    } else if (arg === '--prepare-review') {
      args.prepareReviewDir = resolve(argv[++index]);
    } else if (arg.startsWith('--prepare-review=')) {
      args.prepareReviewDir = resolve(arg.slice('--prepare-review='.length));
    } else if (arg === '--require-ready') {
      args.requireReady = true;
    } else if (arg === '--json') {
      args.jsonOnly = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(args.minLabeled) || args.minLabeled < 0) {
    throw new Error('--min-labeled must be a non-negative number');
  }
  return args;
}

function printText(report: ReportSummary): void {
  console.log(`readback-gate dual-run report: ${report.artifactsRoot}`);
  console.log(`pairs: ${report.totals.pairs}`);
  console.log(`primary eligible: ${report.totals.primaryEligible}`);
  console.log(`labeled primary: ${report.totals.labeledPrimary}`);
  console.log(`unlabeled primary: ${report.totals.unlabeledPrimary}`);
  for (const [agent, counts] of Object.entries(report.agents).sort(([left], [right]) => left.localeCompare(right))) {
    console.log(`agent ${agent}: pairs=${counts.pairs} primary=${counts.primaryEligible} labeled=${counts.labeledPrimary}`);
  }
  console.log(`gated better: ${report.outcomes.gated_better}`);
  console.log(`baseline better: ${report.outcomes.baseline_better}`);
  console.log(`same: ${report.outcomes.same}`);
  console.log(`both bad: ${report.outcomes.both_bad}`);
  console.log(`gated-baseline delta: ${report.effect.gatedMinusBaseline}`);
  console.log(`ready for claim: ${report.readyForClaim ? 'yes' : 'no'}`);
  for (const blocker of report.blockers) {
    console.log(`blocker: ${blocker}`);
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href ||
    fileURLToPath(import.meta.url) === resolve(entry);
}

if (isMainModule()) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = buildReport(args);
    if (args.prepareReviewDir) {
      prepareBlindReview(report, args.prepareReviewDir);
    }
    if (args.jsonOnly) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printText(report);
      if (args.prepareReviewDir) {
        console.log(`review pack: ${relative(process.cwd(), args.prepareReviewDir) || basename(args.prepareReviewDir)}`);
      }
    }
    if (args.requireReady && !report.readyForClaim) {
      process.exit(2);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
