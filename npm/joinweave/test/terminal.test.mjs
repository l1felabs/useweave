import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fabricFrame, TerminalPresenter, installationSummary } from '../src/terminal.js';

class Screen extends EventEmitter {
  constructor(columns = 80, rows = 36, tty = true) { super(); this.columns = columns; this.rows = rows; this.isTTY = tty; this.output = ''; }
  write(text) { this.output += text; }
}
function clock() {
  const pending = new Map(); let id = 0, unrefs = 0;
  return { pending, get unrefs() { return unrefs; }, setInterval(fn) { const timer = { id: ++id, unref() { unrefs++; } }; pending.set(timer, fn); return timer; }, clearInterval(timer) { pending.delete(timer); } };
}
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replaceAll('\r', '');

test('woven geometry has deterministic depth, phase motion and bounded ASCII dimensions', () => {
  for (const width of [24, 38, 80, 120]) {
    const frame = fabricFrame(width, 22, 11, 2, false);
    assert.deepEqual(frame, fabricFrame(width, 22, 11, 2, false));
    assert.equal(frame.length, 22);
    assert.ok(frame.every((line) => line.length === Math.min(width, 88) && /^[\x20-\x7e]+$/.test(line)));
    assert.ok(frame.join('').includes('#'));
    assert.notDeepEqual(frame, fabricFrame(width, 22, 40, 2, false));
  }
  assert.notDeepEqual(fabricFrame(80, 22, 11, 1, true), fabricFrame(80, 22, 11, 5, true));
});

test('TTY animation uses actual stages and restores cursor/timers/listeners around consent and final cleanup', () => {
  const stream = new Screen(), timers = clock();
  const presenter = new TerminalPresenter({ stream, env: { TERM: 'xterm-256color' }, timers });
  presenter.stage({ id: 'mcp', label: 'Installing the persistent MCP server' });
  assert.equal(timers.pending.size, 1);
  assert.equal(timers.unrefs, 1);
  assert.equal(stream.listenerCount('resize'), 1);
  assert.ok(stream.output.includes('\x1b[?25l'));
  assert.ok(plain(stream.output).includes('Installing the persistent MCP server'));
  assert.equal(plain(stream.output).includes('100%'), false);
  presenter.progress('Installed the MCP server');
  presenter.pause();
  assert.equal(timers.pending.size, 0);
  assert.ok(stream.output.endsWith('\x1b[0m\x1b[?25h'));
  const paused = stream.output;
  stream.emit('resize');
  assert.equal(stream.output, paused);
  presenter.resume();
  assert.equal(timers.pending.size, 1);
  presenter.finish(); presenter.finish(); presenter.resume();
  assert.equal(timers.pending.size, 0);
  assert.equal(stream.listenerCount('resize'), 0);
  assert.ok(stream.output.endsWith('\x1b[0m\x1b[?25h'));
});

test('JSON emits no output, events, cursor controls or timers even on a TTY', () => {
  const stream = new Screen(), timers = clock();
  const presenter = new TerminalPresenter({ stream, timers, json: true });
  presenter.stage({ id: 'verify', label: 'Verifying connectivity' });
  presenter.progress('Verified connectivity');
  presenter.pause(); presenter.resume(); presenter.finish();
  assert.equal(stream.output, '');
  assert.equal(timers.pending.size, 0);
  assert.equal(stream.listenerCount('resize'), 0);
});

test('nonTTY, TERM=dumb and opt-out provide readable progress without escape sequences or motion', () => {
  for (const settings of [{ tty: false }, { env: { TERM: 'dumb' } }, { noAnimation: true }]) {
    const stream = new Screen(80, 36, settings.tty ?? true), timers = clock();
    const presenter = new TerminalPresenter({ stream, timers, env: { TERM: 'xterm', ...settings.env }, ...settings });
    presenter.stage({ id: 'runtime', label: 'Installing the native runtime' });
    presenter.progress('Installed Weave'); presenter.finish();
    assert.ok(stream.output.includes('Installing the native runtime'));
    assert.ok(stream.output.includes('Installed Weave'));
    assert.equal(stream.output.includes('\x1b'), false);
    assert.equal(timers.pending.size, 0);
  }
});

test('NO_COLOR disables color, narrow resize never wraps generated lines, and labels cannot inject controls', () => {
  const stream = new Screen(80), timers = clock();
  const presenter = new TerminalPresenter({ stream, timers, env: { TERM: 'xterm', NO_COLOR: '' } });
  presenter.stage({ id: 'node', label: 'Starting\x1b[2J\nnode' });
  assert.equal(stream.output.includes('\x1b[38;'), false);
  stream.columns = 32; stream.rows = 18; stream.output = '';
  stream.emit('resize');
  assert.ok(plain(stream.output).split('\n').every((line) => line.length <= 31));
  stream.columns = 12; stream.rows = 3; stream.output = '';
  stream.emit('resize');
  assert.ok(plain(stream.output).split('\n').every((line) => line.length <= 11));
  assert.equal(presenter.height, 1);
  const upward = [...stream.output.matchAll(/\x1b\[(\d+)A/g)].map((match) => Number(match[1]));
  assert.ok(upward.every((rows) => rows <= 2), 'tiny-terminal cleanup must stay inside its visible owned region');
  assert.ok((stream.output.match(/\n/g) || []).length <= 3, 'cleanup must not scroll a tall blank frame');
  presenter.finish();
});

test('summary reflects actual installed/skipped components and consent rather than promising desktop or registration', () => {
  const text = installationSummary({ binary: '/a b/weave', workspace: '/a b/.weave', shared: '/a b/Weave', pathAdded: false, mcpClients: [], components: [
    { id: 'runtime', name: 'Native CLI', version: '0.1.0', status: 'installed' },
    { id: 'node', name: 'Peer node', status: 'running', managed: false },
    { id: 'mcp', name: 'Agent MCP server', version: '0.1.0', status: 'skipped' },
  ] });
  assert.ok(text.includes('Agent MCP server 0.1.0  /  skipped'));
  assert.ok(text.includes('none configured; consent is required'));
  assert.ok(text.includes("'/a b/weave' node status --json"));
  assert.ok(text.includes('(detached)'));
  assert.ok(text.includes('No account or desktop app was installed.'));
});
