// The ./pre-flight command line. Everything funnels into one of these:
//
//   ./pre-flight [run] [names…]      full board (checks + builds)
//   ./pre-flight check [names…]      checks only, or the named routes
//   ./pre-flight precommit           fix commands (prettier --write), then the board
//   ./pre-flight status              every route: SKIP/ON/OFF, baseline, tools
//   ./pre-flight skip <names…>       skip routes on the NEXT run only
//   ./pre-flight on|off <names…>     flip routes in security.json
//   ./pre-flight baseline [names…]   re-record baseline times
//   ./pre-flight install [names…]    install tools (gitleaks) for routes
//   ./pre-flight init                write a fresh security.json
//
// On Windows the same commands run as `node pre-flight …`.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import {
  CONFIG_NAME,
  CONFIG_PATH,
  PreFlightError,
  ROOT,
  defaultConfig,
  findCheck,
  loadConfig,
  mergeConfig,
  resolveChecks,
  saveConfig,
} from './config.mjs';
import { execute, killRunningChildren, runCommand } from './run.mjs';
import { Board, PlainLog, createPaint, detectModes, fmtSecs } from './ui.mjs';

const COMMANDS = [
  'run',
  'check',
  'precommit',
  'status',
  'list',
  'skip',
  'on',
  'off',
  'baseline',
  'install',
  'init',
  'help',
];

function parseArgs(argv) {
  const flags = { names: [] };
  let command = null;
  for (const arg of argv) {
    if (arg === '--check-only') flags.checkOnly = true;
    else if (arg === '-v' || arg === '--verbose') flags.verbose = true;
    else if (arg === '--quiet') flags.quiet = true;
    else if (arg === '--serial') flags.serial = true;
    else if (arg === '--no-install') flags.noInstall = true;
    else if (arg === '--no-skip') flags.noSkip = true;
    else if (arg === '--pretty') flags.pretty = true;
    else if (arg === '--plain') flags.plain = true;
    else if (arg === '--force') flags.force = true;
    else if (arg === '--help' || arg === '-h') command ??= 'help';
    else if (arg.startsWith('-')) throw new PreFlightError(`Unknown flag: ${arg}`);
    else if (command === null && COMMANDS.includes(arg)) command = arg;
    else if (command === null) {
      // `./pre-flight lint` is shorthand for `./pre-flight check lint`.
      command = 'check';
      flags.names.push(arg);
    } else flags.names.push(arg);
  }
  return {
    command: command ?? (flags.checkOnly ? 'check' : 'run'),
    flags,
  };
}

function createRenderer(flags, config) {
  const { interactive, color } = detectModes(flags, config);
  const paint = createPaint(color);
  const outputMode = flags.verbose
    ? 'always'
    : flags.quiet
      ? 'quiet'
      : (config.output ?? 'auto');
  return interactive ? new Board({ paint, outputMode }) : new PlainLog({ paint });
}

async function projectName() {
  try {
    return (
      JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).name ?? 'pre-flight'
    );
  } catch {
    return 'pre-flight';
  }
}

/** Turn CLI names into checks; unknown names get a helpful error. */
function resolveNames(checks, names) {
  const selected = [];
  for (const name of names) {
    if (name === 'all') {
      selected.push(...checks);
      continue;
    }
    const check = findCheck(checks, name);
    if (!check) {
      throw new PreFlightError(
        `Unknown check "${name}". Known routes: ${checks.map((check) => check.id).join(', ')}`,
      );
    }
    selected.push(check);
  }
  return [...new Map(selected.map((check) => [check.id, check])).values()];
}

function selectChecks(command, names, checks) {
  if (names.length) return resolveNames(checks, names);
  if (command === 'check')
    return checks.filter((check) => check.enabled && check.group === 'check');
  return checks.filter((check) => check.enabled);
}

async function runBoard({ config, command, flags }) {
  const checks = resolveChecks(config);
  const selected = selectChecks(command, flags.names, checks);
  if (!selected.length) {
    throw new PreFlightError('No checks selected — see `./pre-flight status`.', {
      exitCode: 1,
    });
  }
  const renderer = createRenderer(flags, config);
  const onInterrupt = () => {
    renderer.close();
    killRunningChildren();
    process.exit(130);
  };
  process.once('SIGINT', onInterrupt);
  try {
    const result = await execute({
      config,
      checks: selected,
      flags: { ...flags, project: await projectName(), totalChecks: checks.length },
      renderer,
      recordBaselines: command === 'baseline',
    });
    return result.exitCode;
  } finally {
    process.off('SIGINT', onInterrupt);
    renderer.close();
  }
}

/** One route's display state: SKIP, ON or OFF (fixed width in the table). */
function routeState(check, paint) {
  if (check.enabled === false) return { text: 'OFF', style: paint.dim, bullet: '○' };
  if (check.skipNext)
    return { text: 'SKIP · next run', style: paint.yellow, bullet: '●' };
  return { text: 'ON', style: paint.green, bullet: '●' };
}

/**
 * The pre-commit hook entry point. Runs the auto-fix commands declared in
 * security.json (`precommit.fix`) — prettier --write and friends — so the
 * working tree is formatted before the format route checks it, then runs
 * the full board exactly like `./pre-flight`.
 */
async function commandPrecommit(config, flags) {
  const fixCommands = config.precommit?.fix ?? [];
  const renderer = createRenderer(flags, config);
  renderer.phase(
    fixCommands.length
      ? `precommit: ${fixCommands.length} fix command(s) from ${CONFIG_NAME}, then the full board`
      : `precommit: no fix commands in ${CONFIG_NAME}, going straight to the board`,
  );
  for (const command of fixCommands) {
    renderer.phase(`fix: ${command}`);
    const result = await runCommand(command, {
      onLine: (line) => renderer.streamLine?.('fix', line),
    });
    if (result.code !== 0) {
      renderer.phase(`fix command failed: ${command}`);
      renderer.output?.({
        check: { id: 'fix' },
        index: 0,
        code: result.code,
        output: result.output,
      });
      return 1;
    }
  }
  return runBoard({ config, command: 'run', flags });
}

async function commandStatus(config, flags) {
  const checks = resolveChecks(config);
  const paint = createPaint(detectModes(flags, config).color);
  const idWidth = Math.max('route'.length, ...checks.map((check) => check.id.length)) + 2;
  const stateWidth = 17;
  console.log('');
  console.log(
    `  ${paint.bold('●  PRE-FLIGHT STATUS')}  ${paint.dim(`· ${await projectName()} · ${CONFIG_NAME}`)}`,
  );
  console.log('');
  console.log(
    `  ${'route'.padEnd(idWidth)}${'group'.padEnd(8)}${'state'.padEnd(stateWidth)}${paint.dim('baseline   tools')}`,
  );
  for (const check of checks) {
    const state = routeState(check, paint);
    const bullet = paint.hue(check.index)(state.bullet);
    const baseline = config.baselines?.seconds?.[check.id];
    const tools = (check.tools ?? [])
      .map((tool) => `${tool} ${config.tools?.[tool]?.version ?? ''}`.trim())
      .join(', ');
    console.log(
      `  ${bullet} ${paint.hue(check.index)(check.id.padEnd(idWidth))}${check.group.padEnd(8)}${state.style(state.text.padEnd(stateWidth))}${paint.dim((baseline != null ? fmtSecs(baseline) : '—').padEnd(10))} ${paint.dim(tools || '—')}`,
    );
  }
  // What the next invocation will actually run, accounting for OFF routes
  // and pending one-time skips.
  const willRun = (group) =>
    checks.filter(
      (check) =>
        check.enabled !== false &&
        !check.skipNext &&
        (group ? check.group === group : true),
    ).length;
  const recordedAt = config.baselines?.recordedAt?.slice(0, 10) ?? 'none yet';
  console.log('');
  console.log(
    `  ${paint.dim(`baselines ${recordedAt} · tolerance ±${config.baselineTolerancePct ?? 30}% · ${config.parallel !== false ? 'parallel' : 'serial'}`)}`,
  );
  console.log(
    `  ${paint.dim('next run:')} ${paint.bold(`${willRun()}/${checks.length}`)} ${paint.dim('routes on the full board ·')} ${paint.bold(`${willRun('check')}`)} ${paint.dim('via ./pre-flight check')}`,
  );
  console.log(
    `  ${paint.dim('manage:')} ${paint.cyan('./pre-flight on|off|skip <route>')} ${paint.dim('·')} ${paint.cyan('./pre-flight baseline')}`,
  );
  console.log('');
  return 0;
}

async function commandList(config) {
  for (const check of resolveChecks(config)) {
    console.log(`${check.id.padEnd(17)} ${check.label} [${check.group}]`);
  }
  return 0;
}

/** Shared implementation for `skip`, `on` and `off`. */
async function commandSetState(
  config,
  names,
  { field, value, message, clearSkipNext = false },
) {
  const checks = resolveChecks(config);
  if (!names.length) {
    throw new PreFlightError(
      `Which routes? Usage: ./pre-flight ${value ? 'on' : 'off'} <route> — e.g. \`./pre-flight skip test\``,
    );
  }
  const selected = resolveNames(checks, names);
  const clearedSkips = [];
  for (const check of selected) {
    config.checks[check.id][field] = value;
    if (clearSkipNext && config.checks[check.id].skipNext) {
      config.checks[check.id].skipNext = false;
      clearedSkips.push(check.id);
    }
  }
  await saveConfig(config);
  for (const check of selected) {
    console.log(`  ● ${check.id}: ${message(check)}`);
  }
  if (clearedSkips.length) {
    console.log(`  ● pending one-time skip cancelled for: ${clearedSkips.join(', ')}`);
  }
  return 0;
}

async function commandInstall(config, names, flags) {
  const checks = resolveChecks(config);
  const tools = names.length
    ? [...new Set(resolveNames(checks, names).flatMap((check) => check.tools ?? []))]
    : Object.keys(config.tools ?? {});
  if (!tools.length) {
    console.log('  Nothing to install — no tools are configured.');
    return 0;
  }
  const renderer = createRenderer(flags, config);
  renderer.header({
    project: await projectName(),
    total: checks.length,
    selected: tools.length,
    parallel: false,
    baselineDate: config.baselines?.recordedAt?.slice(0, 10) ?? 'none yet',
  });
  let failed = 0;
  for (const tool of tools) {
    const spec = config.tools?.[tool];
    if (!spec?.install) {
      renderer.phase(`${tool}: no install configured`);
      continue;
    }
    const probe = spec.probe ? await runCommand(spec.probe) : { code: 1 };
    if (probe.code === 0) {
      renderer.phase(`${tool} already installed`);
      continue;
    }
    renderer.phase(`installing ${tool} ${spec.version ?? ''}…`);
    const install = await runCommand(spec.install, {
      onLine: (line) => renderer.streamLine?.(tool, line),
    });
    if (install.code === 0) {
      renderer.phase(`${tool} ${spec.version ?? ''} installed`);
    } else {
      failed += 1;
      renderer.phase(`${tool} install FAILED`);
      renderer.output?.({
        check: { id: tool },
        index: 0,
        code: 1,
        output: install.output,
      });
    }
  }
  return failed ? 1 : 0;
}

async function commandInit(flags) {
  if (existsSync(CONFIG_PATH) && !flags.force) {
    throw new PreFlightError(
      `${CONFIG_NAME} already exists — use --force to overwrite it.`,
    );
  }
  await saveConfig(mergeConfig({}));
  console.log(`  ✔ Wrote ${CONFIG_NAME} (project defaults, no baselines yet).`);
  console.log('    Next: ./pre-flight            # run the board and record baselines');
  console.log(
    '          ./pre-flight install    # pull down gitleaks for the secret scans',
  );
  return 0;
}

async function commandHelp() {
  let config;
  try {
    config = await loadConfig();
  } catch {
    config = defaultConfig();
  }
  const checks = resolveChecks(config);
  const paint = createPaint(detectModes({}, config).color);
  const windows = platform() === 'win32';
  const line = (text) => console.log(`  ${text}`);
  console.log('');
  line(
    paint.bold('●  PRE-FLIGHT') + paint.dim(`  · one board for every check in this repo`),
  );
  console.log('');
  line(paint.cyan('USAGE'));
  line(`${'./pre-flight'.padEnd(34)}run the full board (checks + builds)`);
  line(`${'./pre-flight check'.padEnd(34)}run checks only, skipping build routes`);
  line(`${'./pre-flight check lint test'.padEnd(34)}run specific routes by name`);
  line(
    `${'./pre-flight precommit'.padEnd(34)}fix commands (prettier --write), then the board`,
  );
  line(`${'./pre-flight status'.padEnd(34)}each route: SKIP/ON/OFF, baseline and tools`);
  line(
    `${'./pre-flight baseline [routes…]'.padEnd(34)}re-record baseline times on this machine`,
  );
  line(
    `${'./pre-flight skip <routes…>'.padEnd(34)}skip routes on the NEXT run only, then re-arm`,
  );
  line(
    `${'./pre-flight on|off <routes…>'.padEnd(34)}enable/disable routes (on cancels a skip)`,
  );
  line(
    `${'./pre-flight install [routes…]'.padEnd(34)}install tools a route needs (gitleaks)`,
  );
  line(`${'./pre-flight init'.padEnd(34)}write a fresh security.json`);
  console.log('');
  line(paint.cyan('FLAGS'));
  line(`${'--check-only'.padEnd(34)}alias for \`check\``);
  line(`${'--serial'.padEnd(34)}one route at a time`);
  line(`${'--no-install'.padEnd(34)}never auto-install missing tools`);
  line(`${'--no-skip'.padEnd(34)}ignore one-time skips for this run`);
  line(`${'--verbose'.padEnd(34)}full output from passing routes too`);
  line(`${'--quiet'.padEnd(34)}failures only`);
  line(
    `${'--pretty | --plain'.padEnd(34)}force board style or plain logs (auto by default)`,
  );
  console.log('');
  line(paint.cyan('ROUTES'));
  for (const check of checks) {
    line(
      paint.hue(check.index)('●') + ` ${check.id.padEnd(16)} ${paint.dim(check.label)}`,
    );
  }
  console.log('');
  line(paint.dim('Times are compared against the baselines in security.json; a route'));
  line(
    paint.dim(
      'more than ±' +
        (config.baselineTolerancePct ?? 30) +
        '% off its baseline is flagged delayed.',
    ),
  );
  line(paint.dim('Headless runs (CI, pipes) print plain logs automatically.'));
  if (windows) line(paint.dim('On Windows run commands as `node pre-flight …`.'));
  console.log('');
  return 0;
}

async function main(argv) {
  const { command, flags } = parseArgs(argv);
  switch (command) {
    case 'help':
      return commandHelp();
    case 'init':
      return commandInit(flags);
    case 'status':
      return commandStatus(await loadConfig(), flags);
    case 'list':
      return commandList(await loadConfig());
    case 'skip':
      return commandSetState(await loadConfig(), flags.names, {
        field: 'skipNext',
        value: true,
        message: () => `skipped on the next run only — it re-arms itself afterwards`,
      });
    case 'on':
      return commandSetState(await loadConfig(), flags.names, {
        field: 'enabled',
        value: true,
        // "on" means "make this route run", so it also cancels a pending
        // one-time skip — the supported way to undo `./pre-flight skip`.
        clearSkipNext: true,
        message: () => `enabled — back on the board`,
      });
    case 'off':
      return commandSetState(await loadConfig(), flags.names, {
        field: 'enabled',
        value: false,
        message: (check) => `disabled — ./pre-flight on ${check.id} to bring it back`,
      });
    case 'install':
      return commandInstall(await loadConfig(), flags.names, flags);
    case 'precommit':
      return commandPrecommit(await loadConfig(), flags);
    case 'run':
    case 'check':
    case 'baseline':
      return runBoard({ config: await loadConfig(), command, flags });
    default:
      throw new PreFlightError(`Unknown command: ${command}`);
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof PreFlightError) {
    console.error(`pre-flight: ${error.message}`);
    process.exitCode = error.exitCode ?? 2;
  } else {
    console.error(error);
    process.exitCode = 1;
  }
}
