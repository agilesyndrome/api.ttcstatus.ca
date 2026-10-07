// The pre-flight execution engine. Takes the checks selected by the CLI,
// makes sure their tools are installed, runs them (in parallel by default,
// like the old pre-flight, so one failure never hides the others), classifies
// each run's time against its baseline, records new baselines, clears
// one-time skips and hands everything to a renderer.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import process from 'node:process';
import { ROOT, roundBaseline, saveConfig } from './config.mjs';
import { classifyTiming } from './ui.mjs';

const runningChildren = new Set();

/** SIGINT support: let the CLI abort every running check at once. */
export function killRunningChildren() {
  for (const child of runningChildren) {
    child.kill('SIGINT');
    setTimeout(() => child.kill('SIGKILL'), 1000).unref?.();
  }
}

/** `{bin:tsc}` → the platform-correct node_modules binary path. */
export function resolveCommand(command) {
  return command.replace(/\{bin:([a-z0-9@/_-]+)\}/gi, (_, name) => binPath(name));
}

function binPath(name) {
  const base = join(ROOT, 'node_modules', '.bin', name);
  if (process.platform === 'win32') {
    return existsSync(`${base}.cmd`) ? `${base}.cmd` : base;
  }
  return base;
}

/** Children inherit our environment plus the tools directory on PATH. */
function childEnv({ toolsDir, colorful }) {
  const env = {
    ...process.env,
    PATH: `${join(ROOT, toolsDir)}${delimiter}${process.env.PATH ?? ''}`,
  };
  // Keep child tools as colorful as the board itself, but never fight NO_COLOR.
  if (colorful && !process.env.NO_COLOR) env.FORCE_COLOR = '1';
  return env;
}

/**
 * Run one shell command. Output is captured always, and streamed line-by-line
 * through `onLine` for headless logs. Resolves with { code, output, seconds }.
 */
export function runCommand(command, { env, onLine } = {}) {
  const started = performance.now();
  return new Promise((resolveResult) => {
    const child = spawn(resolveCommand(command), {
      shell: true,
      cwd: ROOT,
      env: env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    runningChildren.add(child);
    const chunks = [];
    let pending = '';
    const feed = (chunk) => {
      chunks.push(chunk);
      if (!onLine) return;
      pending += chunk.toString('utf8');
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        onLine(pending.slice(0, newline).replace(/\r$/, ''));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    const finish = (code, extraOutput = '') => {
      runningChildren.delete(child);
      resolveResult({
        code,
        output: Buffer.concat(chunks).toString('utf8') || extraOutput,
        seconds: (performance.now() - started) / 1000,
      });
    };
    child.on('error', (error) => finish(127, String(error)));
    child.on('close', (code) => {
      if (pending) onLine?.(pending.replace(/\r$/, ''));
      finish(code ?? 1);
    });
  });
}

async function probeTool(spec, env) {
  if (!spec?.probe) return true; // no probe configured: assume it exists
  const result = await runCommand(spec.probe, { env });
  return result.code === 0;
}

/**
 * Execute the selected checks.
 *
 * Returns { exitCode, results, wallSeconds, savedConfig } — the CLI decides
 * the process exit code and prints any final hints.
 */
export async function execute({
  config,
  checks,
  flags = {},
  renderer,
  recordBaselines = false,
}) {
  const started = performance.now();
  const tolerance = config.baselineTolerancePct ?? 30;
  const env = childEnv({
    toolsDir: config.toolsDir ?? '.tools',
    colorful: renderer.paint?.enabled === true,
  });

  const states = checks.map((check) => ({
    check,
    index: check.index,
    status: 'pending',
    seconds: null,
    code: null,
    output: '',
    baseline: config.baselines?.seconds?.[check.id] ?? null,
    pct: null,
    verdict: null,
    reason: null,
    error: null,
  }));

  renderer.header({
    project: flags.project ?? 'pre-flight',
    total: flags.totalChecks ?? checks.length,
    selected: checks.length,
    parallel: config.parallel !== false && !flags.serial,
    baselineDate: config.baselines?.recordedAt?.slice(0, 10) ?? 'none yet',
    tolerancePct: tolerance,
  });

  // ---- 1. Tools: probe, then install anything missing ------------------
  const neededTools = [...new Set(checks.flatMap((check) => check.tools ?? []))];
  const missingTools = [];
  for (const tool of neededTools) {
    const spec = config.tools?.[tool];
    if (!spec) continue; // a tool with no entry is assumed already present
    if (await probeTool(spec, env)) continue;
    if (flags.noInstall) {
      missingTools.push(tool);
      renderer.phase(`${tool} not installed (--no-install)`);
      continue;
    }
    renderer.phase(`installing ${tool} ${spec.version ?? ''}…`);
    const install = await runCommand(spec.install, {
      env,
      onLine: (line) => renderer.streamLine?.(tool, line),
    });
    if (install.code === 0 && (await probeTool(spec, env))) {
      renderer.phase(`${tool} ${spec.version ?? ''} installed`);
    } else {
      missingTools.push(tool);
      renderer.phase(`${tool} install failed`);
      renderer.output?.({
        check: { id: tool },
        index: 0,
        code: 1,
        output: install.output,
      });
    }
  }
  for (const state of states) {
    const missing = (state.check.tools ?? []).filter((tool) =>
      missingTools.includes(tool),
    );
    if (missing.length) {
      state.status = 'failed';
      state.error = `tool unavailable: ${missing.join(', ')} — try \`./pre-flight install\``;
    }
  }

  // ---- 2. One-time skips: consumed by this run --------------------------
  let configDirty = false;
  if (!flags.noSkip) {
    for (const state of states) {
      if (state.check.skipNext) {
        state.status = 'skipped';
        state.reason = 'one-time skip';
        config.checks[state.check.id].skipNext = false;
        configDirty = true;
      }
    }
  }

  // ---- 3. Run ------------------------------------------------------------
  renderer.startBoard(states);

  const runOne = async (state) => {
    if (state.status !== 'pending') return;
    state.status = 'running';
    state.startedAt = performance.now();
    renderer.update?.();
    // --quiet buffers output instead of streaming it; failures print at the end.
    const stream = renderer.streamLine && !flags.quiet;
    const onLine = stream
      ? (line) => renderer.streamLine(state.check.id, line)
      : undefined;
    const result = state.check.command
      ? await runCommand(state.check.command, { env, onLine })
      : { code: 1, output: 'No command configured for this check.', seconds: 0 };
    state.seconds = result.seconds;
    state.code = result.code;
    state.output = result.output;
    state.status = result.code === 0 ? 'passed' : 'failed';
    if (state.status === 'passed') {
      Object.assign(state, classifyTiming(state.seconds, state.baseline, tolerance));
    }
    renderer.update?.();
    renderer.checkDone?.(state);
  };

  const runnable = states.filter((state) => state.status === 'pending');
  if (config.parallel !== false && !flags.serial) {
    await Promise.all(runnable.map((state) => runOne(state)));
  } else {
    for (const state of runnable) await runOne(state);
  }

  renderer.endBoard();

  // ---- 4. Baselines ------------------------------------------------------
  let baselinesDirty = false;
  for (const state of states) {
    if (state.status !== 'passed') continue;
    const existing = config.baselines.seconds[state.check.id];
    if (recordBaselines || existing == null) {
      const rounded = roundBaseline(state.seconds);
      if (existing !== rounded) {
        config.baselines.seconds[state.check.id] = rounded;
        baselinesDirty = true;
      }
    }
  }
  if (
    recordBaselines &&
    states.some((state) => state.status === 'failed' && state.baseline)
  ) {
    renderer.phase('failed checks kept their old baselines');
  }
  if (baselinesDirty) {
    config.baselines.recordedAt = new Date().toISOString();
    renderer.phase(
      recordBaselines
        ? 'baselines re-recorded in security.json'
        : 'new baselines recorded',
    );
  }
  if (configDirty || baselinesDirty) {
    try {
      await saveConfig(config);
    } catch (error) {
      renderer.phase(`could not update security.json: ${error.message}`);
    }
  }

  // ---- 5. Reports --------------------------------------------------------
  const showOutput = flags.quiet ? (state) => state.status === 'failed' : () => true;
  if (renderer.output) {
    for (const state of states) {
      if (showOutput(state)) renderer.output(state);
    }
  }
  const wallSeconds = (performance.now() - started) / 1000;
  renderer.summary(states, { wallSeconds, tolerancePct: tolerance });

  return {
    exitCode: states.some((state) => state.status === 'failed') ? 1 : 0,
    results: states,
    wallSeconds,
  };
}
