// Rendering for the pre-flight board. Two renderers share one interface:
//
//   Board     the interactive "departure board": colored route bullets, a
//             spinner while a check runs, live times, and a summary with
//             each check's time as +/- % of its baseline.
//   PlainLog  headless mode (CI, pipes, `pretty: false`): no ANSI, no
//             redraws, no fun — just prefixed log lines that stream while
//             checks run, plus a plain summary.
//
// Mode is detected from the TTY, the CI environment and security.json, and
// can be forced with --pretty / --plain. Colors additionally honor NO_COLOR
// and FORCE_COLOR.

import process from 'node:process';

const RESET = '\x1b[0m';
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const TICK_MS = 90;

// Route bullet colors, one per check, loosely inspired by subway line hues.
const PALETTE = [214, 48, 111, 170, 202, 85, 213, 118, 39, 178, 140, 249];

export function detectModes(flags = {}, config = {}, stream = process.stdout) {
  const env = process.env;
  const headlessEnv = Boolean(env.CI) || env.TERM === 'dumb';
  const tty = stream.isTTY === true;
  const configured = config.pretty ?? 'auto';
  let interactive = tty && !headlessEnv;
  if (configured === true) interactive = true;
  if (configured === false) interactive = false;
  if (flags.plain) interactive = false;
  if (flags.pretty) interactive = true;
  const color = (interactive || Boolean(env.FORCE_COLOR)) && !env.NO_COLOR;
  return { interactive, color };
}

export function createPaint(color) {
  const wrap = (open) => (text) => (color ? open + String(text) + RESET : String(text));
  return {
    enabled: color,
    bold: wrap('\x1b[1m'),
    dim: wrap('\x1b[2m'),
    red: wrap('\x1b[31m'),
    green: wrap('\x1b[32m'),
    yellow: wrap('\x1b[33m'),
    blue: wrap('\x1b[34m'),
    magenta: wrap('\x1b[35m'),
    cyan: wrap('\x1b[36m'),
    hue: (index) => wrap(`\x1b[38;5;${PALETTE[index % PALETTE.length]}m`),
  };
}

export const fmtSecs = (seconds) => `${seconds.toFixed(1)}s`;

export const fmtPct = (pct) =>
  pct == null ? '' : `${pct > 0 ? '+' : ''}${Math.round(pct)}%`;

// Compare a run against its baseline. Anything within the configured
// tolerance is "on time"; slower runs are flagged but never fail the run —
// the point is to notice drift over the years, not to punish a noisy laptop.
export function classifyTiming(seconds, baseline, tolerancePct) {
  if (baseline == null || baseline <= 0) return { pct: null, verdict: 'unmeasured' };
  const pct = (seconds / baseline - 1) * 100;
  if (pct >= 100) return { pct, verdict: 'way-behind' };
  if (pct > tolerancePct) return { pct, verdict: 'delayed' };
  if (pct < -tolerancePct) return { pct, verdict: 'early' };
  return { pct, verdict: 'on-time' };
}

const VERDICTS = {
  'on-time': { label: 'on time', style: 'green' },
  early: { label: 'early', style: 'green' },
  delayed: { label: 'delayed', style: 'yellow' },
  'way-behind': { label: 'way behind', style: 'red' },
  unmeasured: { label: 'new baseline', style: 'dim' },
};

export function verdictFor(verdict) {
  return VERDICTS[verdict] ?? VERDICTS.unmeasured;
}

// Visual width of a rendered row (all glyphs used are single-width).
const ANSI_SEQUENCE = /\x1b\[[0-9;]*[A-Za-z]/;

function lineWidth(row) {
  return [...row.replace(new RegExp(ANSI_SEQUENCE.source, 'g'), '')].length;
}

// Cut a rendered line to the terminal width without slicing escape
// sequences in half; ptys that report no/absurd width get 120 columns.
function truncateToColumns(text, columns) {
  const width = columns && columns >= 40 ? columns : 120;
  const limit = Math.max(20, width - 1);
  let visible = 0;
  let out = '';
  let colored = false;
  for (let i = 0; i < text.length; i++) {
    const rest = text.slice(i);
    const match = ANSI_SEQUENCE.exec(rest);
    if (text[i] === '\x1b' && match?.index === 0) {
      out += match[0];
      colored = true;
      i += match[0].length - 1;
      continue;
    }
    if (visible >= limit) return colored ? `${out}${RESET}` : out;
    const chars = String.fromCodePoint(text.codePointAt(i));
    out += chars;
    visible += chars.length;
    i += chars.length - 1;
  }
  return text;
}

function box(top, bottom, lines) {
  const width = Math.max(...lines.map(lineWidth));
  const edge = '─'.repeat(width + 2);
  const body = lines.map((line) => `│ ${line}${' '.repeat(width - lineWidth(line))} │`);
  return [`${top}${edge}${bottom}`, ...body, `└${edge}┘`];
}

/** Live departure board for TTYs. */
export class Board {
  constructor({ paint, out = process.stdout, spinner = true, outputMode = 'auto' }) {
    this.paint = paint;
    this.out = out;
    this.spinner = spinner && paint.enabled;
    this.outputMode = outputMode;
    this.rows = 0;
    this.frame = 0;
    this.timer = null;
    this.hiddenCursor = false;
  }

  write(text) {
    // Truncate per physical line so box borders and blank separators
    // survive even on narrow terminals.
    this.out.write(
      text
        .split('\n')
        .map((line) => truncateToColumns(line, this.out.columns))
        .join('\n'),
    );
  }

  header({ project, total, selected, parallel, baselineDate, tolerancePct }) {
    const { dim, bold } = this.paint;
    const lines = box('┌', '┐', [
      `${bold('●  PRE-FLIGHT BOARD')}  ${dim('·')}  ${project}`,
      `${dim(`${selected}/${total} checks · ${parallel ? 'parallel' : 'serial'} · baselines ${baselineDate} · ±${tolerancePct}%`)}`,
    ]);
    this.write(`\n${lines.join('\n')}\n\n`);
  }

  phase(text) {
    // One-off status line (install progress etc.) printed above the board.
    const { cyan: line } = this.paint;
    this.write(`${line(`◆ ${text}`)}\n`);
  }

  startBoard(states) {
    this.states = states;
    if (this.spinner) {
      this.out.write('\x1b[?25l');
      this.hiddenCursor = true;
      this.timer = setInterval(() => this.#repaint(), TICK_MS);
      this.timer.unref?.();
    }
    this.#repaint();
  }

  update() {
    this.#repaint();
  }

  #row(state) {
    const { paint } = this;
    const name = paint.hue(state.index)(state.check.id.padEnd(17));
    const bullet = paint.hue(state.index)(state.check.enabled === false ? '○' : '●');
    let status;
    switch (state.status) {
      case 'pending':
        status = paint.dim('· waiting');
        break;
      case 'running':
        status = `${paint.cyan(this.spinner ? SPINNER[this.frame % SPINNER.length] : '›')} ${paint.cyan('scanning')}`;
        break;
      case 'skipped':
        status = paint.dim(`○ skipped${state.reason ? ` (${state.reason})` : ''}`);
        break;
      case 'passed': {
        status = `${paint.green('✔')} ${paint.green(fmtSecs(state.seconds))}`;
        break;
      }
      case 'failed':
        status = `${paint.red('✖')} ${paint.red(state.seconds != null ? fmtSecs(state.seconds) : 'failed')}`;
        break;
      default:
        status = paint.dim(state.status);
    }
    let detail = '';
    if (state.status === 'passed' || state.status === 'failed') {
      if (state.error) detail = paint.red(state.error);
      else if (state.pct != null) {
        const verdict = verdictFor(state.verdict);
        const styled = paint[verdict.style](`${verdict.label} ${fmtPct(state.pct)}`);
        detail = `${paint.dim('vs')} ${paint.dim(fmtSecs(state.baseline))}  ${styled}`;
      } else if (state.status === 'passed') {
        detail = paint.dim(verdictFor('unmeasured').label);
      }
    } else if (state.status === 'running' && state.seconds != null) {
      detail = paint.dim(fmtSecs(state.seconds));
    }
    return `  ${bullet} ${name}${status}  ${detail}`;
  }

  #repaint() {
    if (!this.states) return;
    if (this.rows) {
      this.write(`\x1b[${this.rows}A`);
    }
    const rows = this.states.map((state) => `${this.#row(state)}\n`);
    for (const row of rows) this.write(`\x1b[2K${row}`);
    this.rows = rows.length;
    this.frame += 1;
  }

  endBoard() {
    if (this.timer) clearInterval(this.timer);
    this.#repaint();
    if (this.hiddenCursor) {
      this.out.write('\x1b[?25h');
      this.hiddenCursor = false;
    }
  }

  // Full output for failures; a short dim tail for passing checks that said
  // something. `--verbose` shows everything, `--quiet` shows failures only.
  output(result) {
    const lines = result.output.trimEnd ? result.output.trimEnd().split('\n') : [];
    const meaningful = lines.filter((line) => line.trim() !== '');
    if (meaningful.length === 0) return;
    const { dim, hue } = this.paint;
    const symbol = result.code === 0 ? '✔' : '✖';
    const title = hue(result.index)(
      `${symbol} ${result.check.id} ${dim(`─ output ${result.code === 0 ? '(tail)' : ''}`)}`,
    );
    let shown = meaningful;
    if (result.code === 0 && this.outputMode === 'auto') shown = meaningful.slice(-4);
    const cap = 120;
    if (shown.length > cap) {
      shown = [
        ...shown.slice(0, 8),
        dim(`  … ${shown.length - 48} lines hidden — rerun with --verbose …`),
        ...shown.slice(-40),
      ];
    }
    this.write(`\n  ${title}\n`);
    for (const line of shown) this.write(`  ${dim(line)}\n`);
  }

  summary(results, { wallSeconds, tolerancePct }) {
    const { paint } = this;
    const counts = { passed: 0, failed: 0, skipped: 0, delayed: 0 };
    for (const result of results) {
      if (result.status === 'skipped') counts.skipped += 1;
      else if (result.status === 'failed') counts.failed += 1;
      else {
        counts.passed += 1;
        if (['delayed', 'way-behind'].includes(result.verdict)) counts.delayed += 1;
      }
    }
    this.write(`\n${'─'.repeat(60)}\n`);
    const parts = [
      `${paint.green(`${counts.passed} passed`)}`,
      counts.delayed && paint.yellow(`${counts.delayed} delayed`),
      counts.failed && paint.red(`${counts.failed} failed`),
      counts.skipped && paint.dim(`${counts.skipped} skipped`),
      paint.dim(`wall ${fmtSecs(wallSeconds)}`),
    ].filter(Boolean);
    this.write(`  ${parts.join(paint.dim(' · '))}\n`);
    if (counts.failed) {
      const failed = results.filter((result) => result.status === 'failed');
      this.write(
        `  ${paint.red('✖ SERVICE DISRUPTION — failed:')} ${paint.red(failed.map((r) => r.check.id).join(', '))}\n\n`,
      );
    } else {
      this.write(
        `  ${paint.green('✔ ALL ROUTES CLEAR')}${paint.dim(` · tolerance ±${tolerancePct}% vs baselines`)}\n\n`,
      );
    }
  }

  close() {
    if (this.hiddenCursor) {
      this.out.write('\x1b[?25h');
      this.hiddenCursor = false;
    }
    if (this.timer) clearInterval(this.timer);
  }
}

/** Headless renderer: plain prefixed logs, streamed as they arrive. */
export class PlainLog {
  constructor({ paint, out = process.stdout }) {
    this.paint = paint;
    this.out = out;
  }

  write(text) {
    this.out.write(text);
  }

  header({ project, total, selected, parallel, baselineDate }) {
    this.write(
      `pre-flight: ${project} — ${selected}/${total} checks, ${parallel ? 'parallel' : 'serial'}, baselines ${baselineDate}\n`,
    );
  }

  phase(text) {
    this.write(`pre-flight: ${text}\n`);
  }

  streamLine(checkId, line) {
    if (line === '') return;
    this.streamed = true;
    const { dim } = this.paint;
    this.write(`${dim(`[${checkId}]`)} ${line}\n`);
  }

  startBoard() {}

  update() {}

  endBoard() {}

  checkDone(result) {
    const paint = this.paint;
    const parts = [`pre-flight: ${result.check.id}`];
    if (result.status === 'skipped') {
      parts.push(paint.dim(`skipped (${result.reason ?? 'one-time skip'})`));
    } else if (result.status === 'failed') {
      parts.push(paint.red(result.error ? result.error : 'FAILED'));
    } else {
      parts.push(paint.green('PASS'), paint.dim(fmtSecs(result.seconds)));
      if (result.pct != null) {
        parts.push(
          paint.dim(`baseline ${fmtSecs(result.baseline)}, ${fmtPct(result.pct)}`),
        );
      } else {
        parts.push(paint.dim('no baseline yet — recording one'));
      }
    }
    this.write(`${parts.join(' ')}\n`);
  }

  // Quiet mode buffers instead of streaming; failures dump their output here.
  output(result) {
    if (this.streamed || result.status !== 'failed') return;
    const text = `${result.output}`.trimEnd();
    if (!text) return;
    const { dim } = this.paint;
    for (const line of text.split('\n'))
      this.write(`${dim(`[${result.check.id}]`)} ${line}\n`);
  }

  summary(results, { wallSeconds }) {
    const paint = this.paint;
    const failed = results.filter((result) => result.status === 'failed');
    const delayed = results.filter(
      (result) =>
        result.status === 'passed' && ['delayed', 'way-behind'].includes(result.verdict),
    );
    const skipped = results.filter((result) => result.status === 'skipped');
    this.write(
      `pre-flight: ${results.length - failed.length - skipped.length} passed` +
        (delayed.length ? `, ${delayed.length} slower than baseline` : '') +
        (skipped.length ? `, ${skipped.length} skipped` : '') +
        (failed.length ? `, ${failed.length} FAILED` : '') +
        ` in ${fmtSecs(wallSeconds)}\n`,
    );
    for (const result of delayed) {
      this.write(
        `pre-flight: ${paint.yellow(`${result.check.id} ${fmtPct(result.pct)} vs baseline ${fmtSecs(result.baseline)}`)}\n`,
      );
    }
    if (failed.length) {
      this.write(
        `pre-flight: failed: ${failed.map((result) => result.check.id).join(', ')}\n`,
      );
    }
  }

  close() {}
}
