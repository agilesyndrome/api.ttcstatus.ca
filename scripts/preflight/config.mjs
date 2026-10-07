// security.json: the project's pre-flight configuration. Everything the
// board runs is declared here — commands, groups, per-check enable state,
// one-time skips, tool installs and baseline times. The file is meant to be
// read and edited by humans; `./pre-flight` commands (on/off/skip/baseline)
// rewrite it in place so you never have to fix JSON syntax by hand.
//
// Defaults below are the template `./pre-flight init` writes. The committed
// file overrides them, and any fields it omits fall back to these values.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CONFIG_PATH = join(ROOT, 'security.json');
export const CONFIG_NAME = 'security.json';

export class PreFlightError extends Error {
  constructor(message, { exitCode = 2 } = {}) {
    super(message);
    this.exitCode = exitCode;
  }
}

// One command per route on the board. `{bin:name}` resolves to the local
// node_modules binary on any platform (Windows .cmd shims included).
export function defaultConfig() {
  return {
    $schema: './scripts/preflight/security.schema.json',
    version: 1,
    // "auto" renders the pretty board on a TTY and plain logs everywhere
    // else (CI, pipes). true/false force a style for every run.
    pretty: 'auto',
    // Run checks at the same time (default, matches the old pre-flight) or
    // one at a time (`--serial`) when debugging a machine under load.
    parallel: true,
    // "auto": failures print full output, passes print a short tail.
    // "always": everything. "quiet": failures only, no output panels.
    output: 'auto',
    // A run is only flagged "delayed" when it exceeds its baseline time by
    // more than this percentage. Delays never fail the run.
    baselineTolerancePct: 30,
    // Where installable tools (gitleaks) are placed. Added to PATH for
    // every check command. Keep this out of git.
    toolsDir: '.tools',
    tools: {
      gitleaks: {
        // Probe: a cheap command that succeeds when the tool is present.
        probe: 'gitleaks version',
        // Install: run automatically when the probe fails. This one works
        // on Linux, macOS and Windows — it detects the platform, downloads
        // the pinned release, verifies the SHA-256 and extracts it.
        install: 'node scripts/preflight/install-gitleaks.mjs',
        // Pinned release; upgrade by editing this and the digests below.
        version: '8.30.1',
        // Optional per-platform SHA-256 digests of the release archives.
        // Missing platforms fall back to the release's checksums.txt.
        sha256: {
          'linux-x64': '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
          'linux-arm64':
            'e4a487ee7ccd7d3a7f7ec08567610aa3606637dab9242103b3aee62570fb4b080',
          'darwin-x64':
            'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709',
          'darwin-arm64':
            'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5',
          'windows-x64':
            'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e',
          'windows-arm64':
            'b95f5e4f5c425cedca7ee203d9afd29597e693c4924a12ed42f970537c72cc0f',
        },
      },
    },
    checks: {
      secrets: {
        label: 'Secret scan · working tree',
        group: 'check',
        command: 'node scripts/preflight/gitleaks-tree.mjs',
        tools: ['gitleaks'],
      },
      'secrets-history': {
        label: 'Secret scan · git history',
        group: 'check',
        command:
          'gitleaks git . --redact --no-banner -v --config scripts/preflight/gitleaks.toml',
        tools: ['gitleaks'],
      },
      boundaries: {
        label: 'Module boundaries',
        group: 'check',
        command: 'node scripts/checks/check-boundaries.mjs',
      },
      typecheck: {
        label: 'Type check',
        group: 'check',
        command: '{bin:tsc} --noEmit',
        aliases: ['types'],
      },
      lint: {
        label: 'Lint',
        group: 'check',
        command: '{bin:eslint} .',
      },
      format: {
        label: 'Format check',
        group: 'check',
        command: '{bin:prettier} --check .',
        aliases: ['format:check'],
      },
      test: {
        label: 'Unit tests',
        group: 'check',
        command: 'node --test --test-isolation=none tests/*/*.test.mjs',
      },
      'build-ui': {
        label: 'Build React UI',
        group: 'build',
        command: '{bin:vite} build',
        aliases: ['build:ui'],
      },
      'build-viewer': {
        label: 'Build standalone viewer',
        group: 'build',
        command: 'node scripts/build/build-viewer.mjs',
        aliases: ['build:viewer'],
      },
    },
    baselines: { recordedAt: null, seconds: {} },
  };
}

const CHECK_DEFAULTS = {
  label: undefined, // falls back to the check id
  group: 'check',
  enabled: true,
  skipNext: false,
  command: undefined,
  aliases: [],
  tools: [],
};

/** Normalized check objects: defaults filled in, id and list index attached. */
export function resolveChecks(config) {
  const entries = Object.entries(config.checks ?? {});
  return entries.map(([id, spec], index) => ({
    id,
    index,
    label: spec?.label ?? id,
    group: spec?.group ?? CHECK_DEFAULTS.group,
    enabled: spec?.enabled ?? CHECK_DEFAULTS.enabled,
    skipNext: spec?.skipNext ?? CHECK_DEFAULTS.skipNext,
    command: spec?.command,
    aliases: spec?.aliases ?? CHECK_DEFAULTS.aliases,
    tools: spec?.tools ?? CHECK_DEFAULTS.tools,
  }));
}

/** Find a check by id, alias or old npm-script-style name. */
export function findCheck(checks, name) {
  const normalized = name.toLowerCase();
  return (
    checks.find(
      (check) =>
        check.id.toLowerCase() === normalized ||
        check.aliases.some((alias) => alias.toLowerCase() === normalized),
    ) ?? null
  );
}

export async function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    throw new PreFlightError(
      `${CONFIG_NAME} not found — run \`./pre-flight init\` to create it ` +
        `(on Windows: \`node pre-flight init\`), or restore it from git.`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  } catch (error) {
    throw new PreFlightError(`${CONFIG_NAME} is not valid JSON: ${error.message}`);
  }
  return mergeConfig(parsed);
}

/** Merge the project file over the defaults so missing fields never crash. */
export function mergeConfig(file) {
  const defaults = defaultConfig();
  const merged = { ...defaults, ...file };
  merged.tools = { ...defaults.tools, ...(file.tools ?? {}) };
  for (const [tool, spec] of Object.entries(merged.tools)) {
    merged.tools[tool] = { ...(defaults.tools[tool] ?? {}), ...spec };
  }
  merged.checks = {};
  for (const id of new Set([
    ...Object.keys(defaults.checks),
    ...Object.keys(file.checks ?? {}),
  ])) {
    // Defaults never set enabled/skipNext, so the file stays authoritative
    // for check state; everything else falls back to the template.
    merged.checks[id] = { ...defaults.checks[id], ...(file.checks?.[id] ?? {}) };
  }
  merged.baselines = {
    recordedAt: file.baselines?.recordedAt ?? null,
    seconds: { ...(file.baselines?.seconds ?? {}) },
  };
  return merged;
}

/**
 * Write config back, formatted exactly like `prettier --write` would, so the
 * board's own format check never breaks after a skip/on/off/baseline write.
 * (Prettier collapses short JSON arrays; JSON.stringify never does.)
 */
export async function saveConfig(config) {
  const ordered = {
    $schema: config.$schema,
    ...Object.fromEntries(
      Object.entries(config).filter(
        ([key]) => key !== '$schema' && key !== 'checks' && key !== 'baselines',
      ),
    ),
    checks: config.checks,
    baselines: config.baselines,
  };
  let text = JSON.stringify(ordered, null, 2);
  try {
    const prettier = await import('prettier');
    const options = await prettier.resolveConfig(CONFIG_PATH);
    text = await prettier.format(text, { ...options, filepath: CONFIG_PATH });
  } catch {
    // Prettier unavailable (bare checkout): plain JSON is still valid, and
    // the format check itself could not run anyway.
    text = `${text}\n`;
  }
  await writeFile(CONFIG_PATH, text, 'utf8');
}

/** Round to one decimal so baselines stay short and diff-friendly. */
export const roundBaseline = (seconds) => Math.round(seconds * 10) / 10;
