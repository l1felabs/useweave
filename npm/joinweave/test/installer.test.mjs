import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Installer, parseArgs } from '../src/installer.js';

function fixture(t, { platform = 'linux', response, homeName = 'home with spaces' } = {}) {
  const scratch = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'joinweave-test-')));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const home = join(scratch, homeName), source = join(scratch, 'weave');
  fs.mkdirSync(home);
  fs.writeFileSync(source, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const commands = [];
  const run = async (command, args, options) => {
    commands.push({ command, args, options });
    if (response) { const value = await response(command, args, options); if (value) return value; }
    if (command === 'systemctl' && args.includes('is-active')) return { code: 3, stdout: '', stderr: '' };
    if (command === 'launchctl' && args[0] === 'print') return { code: 113, stdout: '', stderr: 'Bad request.\nCould not find service "com.useweave.node" in domain for user gui: 501\n' };
    return { code: 0, stdout: JSON.stringify({ ok: true, peer_count: 1 }), stderr: '' };
  };
  const settings = { home, weaveHome: join(home, '.weave'), platform, uid: 501, env: { SHELL: '/bin/zsh' }, run, resolveNative: () => source, sleep: async () => {} };
  return { home, source, commands, installer: () => new Installer(settings), settings };
}
const headless = () => parseArgs(['--yes', '--json', '--no-service']);

test('headless rerun preserves user data and never edits detected clients or PATH', async (t) => {
  const f = fixture(t), config = join(f.home, '.cursor', 'mcp.json');
  fs.mkdirSync(join(f.home, '.cursor'));
  const original = '{"mcpServers":{"other":{"command":"existing"}},"theme":"dark"}\n';
  fs.writeFileSync(config, original);
  const first = await f.installer().install(headless());
  fs.writeFileSync(join(first.workspace, 'retained-data'), 'mine');
  const second = await f.installer().install(headless());
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(second.service, { managed: false, running: true });
  assert.equal(fs.readFileSync(config, 'utf8'), original);
  assert.equal(fs.existsSync(join(f.home, '.zshrc')), false);
  assert.equal(fs.readFileSync(join(first.workspace, 'retained-data'), 'utf8'), 'mine');
  assert.ok(f.commands.some((c) => c.args.join(' ') === 'node start --json'));
  assert.ok(f.commands.every((c) => c.options.env.WEAVE_HOME === first.workspace));
});

test('explicit consent merges MCP and PATH; uninstall removes only owned entries', async (t) => {
  const f = fixture(t), config = join(f.home, '.cursor', 'mcp.json');
  fs.mkdirSync(join(f.home, '.cursor'));
  fs.writeFileSync(config, JSON.stringify({ mcpServers: { other: { command: 'existing' } }, userPreference: 'keep' }));
  fs.writeFileSync(join(f.home, '.zshrc'), 'export MY_SETTING=keep\n');
  const installed = await f.installer().install(parseArgs(['--yes', '--no-service', '--path', '--mcp-client', 'cursor']));
  const merged = JSON.parse(fs.readFileSync(config, 'utf8'));
  assert.equal(merged.userPreference, 'keep');
  assert.equal(merged.mcpServers.other.command, 'existing');
  assert.deepEqual(merged.mcpServers.weave.args, ['--yes', '@useweave/mcp@0.1.0']);
  assert.equal(merged.mcpServers.weave.env.WEAVE_BINARY, installed.binary);
  fs.writeFileSync(join(installed.workspace, 'identity-test'), 'retain');
  fs.writeFileSync(join(installed.shared, 'shared-strand'), 'retain');
  const removed = await f.installer().uninstall(parseArgs(['uninstall', '--yes']));
  assert.equal(removed.ok, true);
  assert.equal(fs.existsSync(installed.binary), false);
  assert.equal(fs.readFileSync(join(installed.workspace, 'identity-test'), 'utf8'), 'retain');
  assert.equal(fs.readFileSync(join(installed.shared, 'shared-strand'), 'utf8'), 'retain');
  assert.equal(fs.readFileSync(join(f.home, '.zshrc'), 'utf8'), 'export MY_SETTING=keep\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(config, 'utf8')), { mcpServers: { other: { command: 'existing' } }, userPreference: 'keep' });
  assert.ok(fs.readdirSync(join(f.home, '.cursor')).some((p) => p.startsWith('mcp.json.joinweave-backup-')));
});

test('refuses unmanaged or modified installed binaries even with an old receipt', async (t) => {
  const f = fixture(t), bin = join(f.home, '.weave/bin/weave');
  fs.mkdirSync(join(f.home, '.weave/bin'), { recursive: true });
  fs.writeFileSync(bin, 'foreign binary');
  await assert.rejects(f.installer().install(headless()), { code: 'UNMANAGED_BINARY' });
  assert.equal(fs.readFileSync(bin, 'utf8'), 'foreign binary');
  fs.unlinkSync(bin);
  await f.installer().install(headless());
  fs.writeFileSync(bin, 'modified after install');
  await assert.rejects(f.installer().install(headless()), { code: 'UNMANAGED_BINARY' });
  assert.equal(fs.readFileSync(bin, 'utf8'), 'modified after install');
});

test('refuses symlinked workspace and app config without changing targets', async (t) => {
  const f = fixture(t), elsewhere = join(f.home, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere, join(f.home, '.weave'));
  await assert.rejects(f.installer().install(headless()), { code: 'UNSAFE_SYMLINK' });
  fs.unlinkSync(join(f.home, '.weave'));
  fs.mkdirSync(join(f.home, '.cursor'));
  const foreign = join(elsewhere, 'foreign.json');
  fs.writeFileSync(foreign, '{}');
  fs.symlinkSync(foreign, join(f.home, '.cursor/mcp.json'));
  await assert.rejects(f.installer().install(parseArgs(['--yes', '--no-service', '--mcp-client', 'cursor'])), { code: 'UNSAFE_SYMLINK' });
  assert.equal(fs.readFileSync(foreign, 'utf8'), '{}');
});

test('doctor failure cannot produce success, and readiness can recover', async (t) => {
  const bad = fixture(t, { response: (_, args) => args[0] === 'doctor' ? { code: 1, stdout: '{"ok":false,"peer_count":0}', stderr: '' } : null });
  await assert.rejects(bad.installer().install(headless()), { code: 'NATIVE_COMMAND_FAILED' });
  assert.equal(bad.commands.filter((c) => c.args[0] === 'doctor').length, 10);
  let attempts = 0;
  const recovering = fixture(t, { response: (_, args) => args[0] === 'doctor' && ++attempts < 2 ? { code: 1, stdout: '{"ok":false}', stderr: '' } : null });
  assert.equal((await recovering.installer().install(headless())).ok, true);
  assert.equal(attempts, 2);
});

test('malformed or conflicting client configs are preserved', async (t) => {
  const f = fixture(t), config = join(f.home, '.cursor/mcp.json');
  fs.mkdirSync(join(f.home, '.cursor'));
  fs.writeFileSync(config, '{bad');
  await assert.rejects(f.installer().install(parseArgs(['--yes', '--no-service', '--mcp-client=cursor'])), { code: 'INVALID_CLIENT_CONFIG' });
  assert.equal(fs.readFileSync(config, 'utf8'), '{bad');
  const foreign = '{"mcpServers":{"weave":{"command":"foreign"}}}';
  fs.writeFileSync(config, foreign);
  await assert.rejects(f.installer().install(parseArgs(['--yes', '--no-service', '--mcp-client=cursor'])), { code: 'MCP_ENTRY_CONFLICT' });
  assert.equal(fs.readFileSync(config, 'utf8'), foreign);
});

test('uninstall preserves MCP entries modified after installation', async (t) => {
  const f = fixture(t);
  await f.installer().install(parseArgs(['--yes', '--no-service', '--mcp-client=cursor']));
  const config = join(f.home, '.cursor/mcp.json'), value = JSON.parse(fs.readFileSync(config, 'utf8'));
  value.mcpServers.weave.command = 'my-replacement';
  fs.writeFileSync(config, JSON.stringify(value));
  const result = await f.installer().uninstall(parseArgs(['uninstall', '--yes']));
  assert.equal(result.ok, false);
  assert.equal(JSON.parse(fs.readFileSync(config, 'utf8')).mcpServers.weave.command, 'my-replacement');
  assert.ok(result.warnings.some((warning) => warning.includes('modified cursor')));
});

test('native service uses persistent binary, environment and user-level scope', async (t) => {
  for (const platform of ['linux', 'darwin']) {
    const f = fixture(t, { platform });
    f.settings.env.WEAVE_DHT_BOOTSTRAP = '/dns4/seed.weave.earth/tcp/4001/p2p/peerA\n/dns4/seed2.weave.earth/tcp/4001/p2p/peerB';
    f.settings.env.WEAVE_DHT_PORT = '4002';
    f.settings.env.WEAVE_REPLICATION_ADVERTISE_ADDR = '136.67.40.146:4003';
    const result = await f.installer().install(parseArgs(['--yes', '--json']));
    const receipt = JSON.parse(fs.readFileSync(join(result.workspace, '.joinweave-install.json'), 'utf8'));
    const definition = fs.readFileSync(receipt.service.path, 'utf8');
    assert.ok(definition.includes(result.binary));
    assert.ok(definition.includes('WEAVE_HOME'));
    assert.ok(definition.includes('WEAVE_DHT_PORT'));
    assert.ok(definition.includes('136.67.40.146:4003'));
    assert.ok(definition.includes('/p2p/peerA,/dns4/seed2'));
    assert.ok(definition.includes(join(result.workspace, 'logs/node.log')));
    assert.equal(fs.statSync(join(result.workspace, 'logs/node.log')).mode & 0o777, 0o600);
    if (platform === 'darwin') assert.ok(definition.includes('<key>SuccessfulExit</key><false/>'));
    else assert.ok(definition.includes('Restart=on-failure'));
    assert.equal(result.service.managed, true);
    assert.ok(f.commands.some((c) => platform === 'linux' ? c.command === 'systemctl' && c.args.includes('--user') && c.args.includes('enable') : c.command === 'launchctl' && c.args[0] === 'bootstrap' && c.args[1] === 'gui/501'));
    assert.equal((await f.installer().uninstall(parseArgs(['uninstall', '--yes']))).ok, true);
    assert.equal(fs.existsSync(receipt.service.path), false);
  }
});

test('service stop failure preserves the executable and service receipt', async (t) => {
  let refusing = false;
  const f = fixture(t, { response: (command, args) => refusing && command === 'systemctl' && args.includes('is-active') ? { code: 0, stdout: '', stderr: '' } : null });
  const installed = await f.installer().install(parseArgs(['--yes']));
  refusing = true;
  await assert.rejects(f.installer().uninstall(parseArgs(['uninstall', '--yes'])), { code: 'SERVICE_STOP_FAILED' });
  assert.equal(fs.existsSync(installed.binary), true);
});

test('launchd teardown waits for deregistration before removing managed files', async (t) => {
  let stopping = false, checks = 0, installed, definition;
  const f = fixture(t, { platform: 'darwin', response: (command, args) => {
    if (!stopping || command !== 'launchctl' || args[0] !== 'print') return null;
    assert.equal(fs.existsSync(installed.binary), true);
    assert.equal(fs.existsSync(definition), true);
    if (++checks < 3) return { code: 0, stdout: 'state = running', stderr: '' };
    return null;
  } });
  installed = await f.installer().install(parseArgs(['--yes']));
  const receipt = JSON.parse(fs.readFileSync(join(installed.workspace, '.joinweave-install.json'), 'utf8'));
  assert.equal(receipt.version, '0.1.1');
  assert.equal(receipt.binary.version, '0.1.0');
  definition = receipt.service.path;
  const retained = join(installed.workspace, 'retained-strand');
  fs.writeFileSync(retained, 'keep');
  stopping = true;
  const result = await f.installer().uninstall(parseArgs(['uninstall', '--yes']));
  assert.equal(result.ok, true);
  assert.equal(checks, 3);
  assert.equal(fs.existsSync(installed.binary), false);
  assert.equal(fs.existsSync(definition), false);
  assert.equal(fs.readFileSync(retained, 'utf8'), 'keep');
});

test('persistent launchd registration reaches a bounded failure without deleting data', async (t) => {
  let stopping = false, clock = 0;
  const f = fixture(t, { platform: 'darwin', response: (command, args) => stopping && command === 'launchctl' && args[0] === 'print'
    ? { code: 0, stdout: 'state = running', stderr: '' } : null });
  f.settings.now = () => clock;
  f.settings.sleep = async (ms) => { clock += ms; };
  const installed = await f.installer().install(parseArgs(['--yes']));
  const receiptPath = join(installed.workspace, '.joinweave-install.json');
  const receipt = fs.readFileSync(receiptPath);
  const definition = JSON.parse(receipt).service.path;
  const retained = join(installed.workspace, 'retained-strand');
  fs.writeFileSync(retained, 'keep');
  stopping = true;
  await assert.rejects(f.installer().uninstall(parseArgs(['uninstall', '--yes'])), { code: 'SERVICE_STOP_FAILED' });
  assert.equal(clock, 10_000);
  assert.equal(fs.existsSync(installed.binary), true);
  assert.equal(fs.existsSync(definition), true);
  assert.deepEqual(fs.readFileSync(receiptPath), receipt);
  assert.equal(fs.readFileSync(retained, 'utf8'), 'keep');
});

test('launchd command time consumes the shutdown budget and late absence preserves files', async (t) => {
  let stopping = false, clock = 0, checks = 0;
  const f = fixture(t, { platform: 'darwin', response: (command, args, options) => {
    if (!stopping || command !== 'launchctl') return null;
    if (args[0] === 'bootout') {
      assert.equal(options.timeout, 10_000);
      clock += 6_000;
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'print') {
      assert.equal(options.timeout, checks === 0 ? 4_000 : 2_900);
      if (++checks === 1) {
        clock += 1_000;
        return { code: 0, stdout: 'state = running', stderr: '' };
      }
      clock += 3_000;
      return { code: 113, stdout: '', stderr: 'Could not find service "com.useweave.node" in domain for user gui: 501' };
    }
    return null;
  } });
  f.settings.now = () => clock;
  f.settings.sleep = async (ms) => { clock += ms; };
  const installed = await f.installer().install(parseArgs(['--yes']));
  const receiptPath = join(installed.workspace, '.joinweave-install.json');
  const receipt = fs.readFileSync(receiptPath);
  const definition = JSON.parse(receipt).service.path;
  stopping = true;
  await assert.rejects(f.installer().uninstall(parseArgs(['uninstall', '--yes'])), { code: 'SERVICE_STOP_FAILED' });
  assert.equal(checks, 2);
  assert.equal(fs.existsSync(installed.binary), true);
  assert.equal(fs.existsSync(definition), true);
  assert.deepEqual(fs.readFileSync(receiptPath), receipt);
});

test('unknown service shutdown preserves the binary and managed definition', async (t) => {
  for (const platform of ['linux', 'darwin']) {
    let unknown = false;
    const f = fixture(t, { platform, response: (command, args) => {
      if (unknown && (command === 'systemctl' && args.includes('is-active') || command === 'launchctl' && args[0] === 'print')) {
        return { code: 1, stdout: '', stderr: 'User service session is unavailable' };
      }
      return null;
    } });
    const installed = await f.installer().install(parseArgs(['--yes']));
    const receiptPath = join(installed.workspace, '.joinweave-install.json');
    const receipt = fs.readFileSync(receiptPath, 'utf8');
    const definition = JSON.parse(receipt).service.path;
    unknown = true;
    await assert.rejects(f.installer().uninstall(parseArgs(['uninstall', '--yes'])), { code: 'SERVICE_STOP_UNKNOWN' });
    assert.equal(fs.existsSync(installed.binary), true);
    assert.equal(fs.existsSync(definition), true);
    assert.equal(fs.readFileSync(receiptPath, 'utf8'), receipt);
  }
});

test('Codex merge preserves unrelated tables and rejects foreign weave tables', async (t) => {
  const f = fixture(t), config = join(f.home, '.codex/config.toml');
  fs.mkdirSync(join(f.home, '.codex'));
  const original = 'model = "existing"\n\n[mcp_servers.other]\ncommand = "other"\n';
  fs.writeFileSync(config, original);
  await f.installer().install(parseArgs(['--yes', '--no-service', '--mcp-client=codex']));
  assert.ok(fs.readFileSync(config, 'utf8').includes(original));
  assert.equal((await f.installer().uninstall(parseArgs(['uninstall', '--yes']))).ok, true);
  assert.ok(fs.readFileSync(config, 'utf8').startsWith(original));
  fs.writeFileSync(config, '[mcp_servers."weave"]\ncommand = "foreign"\n');
  await assert.rejects(f.installer().install(parseArgs(['--yes', '--no-service', '--mcp-client=codex'])), { code: 'MCP_ENTRY_CONFLICT' });
});

test('purge removes only dedicated workspace and preserves visible shared files', async (t) => {
  const f = fixture(t), installed = await f.installer().install(headless());
  fs.writeFileSync(join(installed.shared, 'retain'), 'mine');
  const result = await f.installer().uninstall(parseArgs(['uninstall', '--yes', '--purge']));
  assert.equal(result.dataRetained, false);
  assert.equal(fs.existsSync(installed.workspace), false);
  assert.equal(fs.readFileSync(join(installed.shared, 'retain'), 'utf8'), 'mine');
});

test('flags keep unattended app-config consent explicit', () => {
  assert.deepEqual(parseArgs(['--yes', '--json']).mcpClients, []);
  assert.equal(parseArgs(['--yes']).path, false);
  assert.deepEqual(parseArgs(['--yes', '--mcp-client=cursor,codex']).mcpClients, ['cursor', 'codex']);
  assert.throws(() => parseArgs(['--yes', '--no-mcp', '--mcp-client=cursor']), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => parseArgs(['--purge']), { code: 'INVALID_ARGUMENT' });
});

test('systemd directives preserve literal dollar signs and escape percent specifiers', async (t) => {
  const f = fixture(t, { homeName: 'home with spaces $value 20%' });
  const installed = await f.installer().install(parseArgs(['--yes']));
  const unit = fs.readFileSync(join(f.home, '.config/systemd/user/weave-node.service'), 'utf8');
  const escaped = installed.workspace.replaceAll('%', '%%');
  assert.ok(unit.includes(`Environment="WEAVE_HOME=${escaped}"`));
  assert.ok(unit.includes(`WorkingDirectory=${escaped}\n`));
  assert.ok(unit.includes(`StandardOutput=append:${escaped}/logs/node.log\n`));
  assert.ok(unit.includes(`ExecStart="${installed.binary.replaceAll('%', '%%').replaceAll('$', '$$')}" node run`));
  assert.equal((await f.installer().uninstall(parseArgs(['uninstall', '--yes']))).ok, true);
});

test('systemd parses real managed units with ordinary, spaced and percent paths', {
  skip: process.platform !== 'linux' || process.env.WEAVE_VERIFY_SYSTEMD !== '1',
}, async (t) => {
  const execFile = promisify(execFileCallback);
  for (const homeName of ['ordinary-home', 'home with spaces', 'home 50% $literal']) {
    const f = fixture(t, { homeName });
    const result = await f.installer().install(parseArgs(['--yes']));
    const receipt = JSON.parse(fs.readFileSync(join(result.workspace, '.joinweave-install.json'), 'utf8'));
    await execFile('systemd-analyze', ['verify', receipt.service.path]);
  }
});

test('tampered Codex receipt cannot remove unrelated content', async (t) => {
  const f = fixture(t);
  await f.installer().install(parseArgs(['--yes', '--no-service', '--mcp-client=codex']));
  const receiptPath = join(f.home, '.weave/.joinweave-install.json');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  receipt.mcp.codex.block = '# >>> joinweave managed MCP >>>\nmodel = "my-model"\n# <<< joinweave managed MCP <<<\n';
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  const config = join(f.home, '.codex/config.toml'), original = fs.readFileSync(config, 'utf8');
  await assert.rejects(f.installer().uninstall(parseArgs(['uninstall', '--yes'])), { code: 'INVALID_MANIFEST' });
  assert.equal(fs.readFileSync(config, 'utf8'), original);
});

test('One and Bridge configuration remains manual, including explicit headless consent', async (t) => {
  const f = fixture(t);
  fs.mkdirSync(join(f.home, '.one'));
  fs.mkdirSync(join(f.home, '.bridge'));
  fs.writeFileSync(join(f.home, '.one/config.json'), '{"existing":true}');
  const installed = await f.installer().install(parseArgs(['--yes', '--no-service', '--mcp-client=one,bridge']));
  assert.ok(installed.detectedMcpClients.includes('one'));
  assert.ok(installed.detectedMcpClients.includes('bridge'));
  assert.deepEqual(installed.manualMcpClients.map((client) => client.status), ['manual-setup-required', 'manual-setup-required']);
  assert.equal(fs.readFileSync(join(f.home, '.one/config.json'), 'utf8'), '{"existing":true}');
  assert.deepEqual(installed.mcpClients, []);
});

test('JSON CLI mode returns one parseable result for help and argument failures', async () => {
  const executable = fileURLToPath(new URL('../bin/joinweave.js', import.meta.url));
  const run = promisify(execFileCallback);
  const help = await run(process.execPath, [executable, '--help', '--json']);
  assert.equal(help.stderr, '');
  assert.equal(help.stdout.trim().split('\n').length, 1);
  assert.equal(JSON.parse(help.stdout).ok, true);
  try {
    await run(process.execPath, [executable, '--unknown', '--json']);
    assert.fail('invalid argument must fail');
  } catch (error) {
    assert.equal(error.code, 1);
    assert.equal(error.stderr, '');
    assert.equal(error.stdout.trim().split('\n').length, 1);
    assert.equal(JSON.parse(error.stdout).error.code, 'INVALID_ARGUMENT');
  }
});
