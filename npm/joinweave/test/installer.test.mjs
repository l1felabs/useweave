import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Installer, parseArgs, VERSION } from '../src/installer.js';
import { updateWorkspace } from '../src/update.js';
import { compareVersions } from '../src/github-release.js';
import { censusTree, ManagedMcp, MCP_VERSION, MCP_INTEGRITY, LEGACY_MCP_VERSION, LEGACY_MCP_INTEGRITY } from '../src/managed-mcp.js';

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
    if (args[1] === 'install' && args.includes('--prefix')) {
      const stage = args[args.indexOf('--prefix') + 1];
      const version = JSON.parse(fs.readFileSync(join(stage, 'package.json'))).dependencies['@useweave/mcp'];
      const integrity = version === LEGACY_MCP_VERSION ? LEGACY_MCP_INTEGRITY : MCP_INTEGRITY;
      fs.mkdirSync(join(stage, 'node_modules/@useweave/mcp/bin'), { recursive: true });
      fs.writeFileSync(join(stage, 'node_modules/@useweave/mcp/package.json'), JSON.stringify({ name: '@useweave/mcp', version, bin: { 'weave-mcp': 'bin/weave-mcp.js' } }));
      fs.writeFileSync(join(stage, 'node_modules/@useweave/mcp/bin/weave-mcp.js'), '// fixture MCP entry\n');
      fs.writeFileSync(join(stage, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/@useweave/mcp': { version, resolved: `https://registry.npmjs.org/@useweave/mcp/-/mcp-${version}.tgz`, integrity } } }));
    }
    if (command === 'systemctl' && args.includes('is-active')) return { code: 3, stdout: '', stderr: '' };
    if (command === 'launchctl' && args[0] === 'print') return { code: 113, stdout: '', stderr: 'Bad request.\nCould not find service "com.useweave.node" in domain for user gui: 501\n' };
    return { code: 0, stdout: JSON.stringify({ ok: true, peer_count: 1 }), stderr: '' };
  };
  const settings = { home, weaveHome: join(home, '.weave'), platform, uid: 501, env: { SHELL: '/bin/zsh' }, run, resolveNative: () => source, npmCli: join(scratch, 'npm-cli.js'), sleep: async () => {} };
  return { home, source, commands, installer: () => new Installer(settings), settings };
}
const headless = () => parseArgs(['--yes', '--json', '--no-service']);

test('installer version matches its package metadata', () => {
  assert.equal(VERSION, JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version);
});

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
  assert.equal(merged.mcpServers.weave.command, process.execPath);
  assert.deepEqual(merged.mcpServers.weave.args, [join(installed.workspace, 'tools/mcp-0.2.0/node_modules/@useweave/mcp/bin/weave-mcp.js')]);
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
  assert.equal(JSON.parse(fs.readFileSync(bad.installer().manifestPath)).installerVersion, null);
  let attempts = 0;
  const recovering = fixture(t, { response: (_, args) => args[0] === 'doctor' && ++attempts < 2 ? { code: 1, stdout: '{"ok":false}', stderr: '' } : null });
  assert.equal((await recovering.installer().install(headless())).ok, true);
  assert.equal(attempts, 2);
});

test('failed installer-only upgrade stays available until successful retry passes doctor', async t => {
  let failing = false;
  const f = fixture(t, { response: (_, args) => failing && args[0] === 'doctor' ? { code: 1, stdout: '{"ok":false,"peer_count":0}', stderr: '' } : null });
  await f.installer().install(headless());
  const owner = f.installer(), receipt = JSON.parse(fs.readFileSync(owner.manifestPath));
  // Model a completed predecessor with unchanged native/MCP component versions.
  receipt.installerVersion = '0.1.3'; fs.writeFileSync(owner.manifestPath, JSON.stringify(receipt));
  const catalog = { version: VERSION, packages: [
    { name: `@useweave/cli-linux-${process.arch}`, version: '0.2.1' },
    { name: '@useweave/mcp', version: '0.2.0' },
  ] };
  const seen = [], discover = async current => {
    seen.push(current);
    return { catalog, available: compareVersions(VERSION, current) > 0 };
  };
  failing = true;
  await assert.rejects(f.installer().install(headless()), { code: 'NATIVE_COMMAND_FAILED' });
  const interrupted = JSON.parse(fs.readFileSync(owner.manifestPath));
  assert.equal(interrupted.installerVersion, '0.1.3');
  assert.deepEqual(interrupted.binary, receipt.binary);
  assert.deepEqual(interrupted.mcpRuntime, receipt.mcpRuntime);
  assert.equal((await updateWorkspace(f.installer(), parseArgs(['update', '--check']), { discover })).available, true);
  failing = false;
  assert.equal((await f.installer().install(headless())).ok, true);
  const completed = fs.readFileSync(owner.manifestPath);
  assert.equal(JSON.parse(completed).installerVersion, VERSION);
  const commands = f.commands.length;
  for (let n = 0; n < 2; n++) {
    const result = await updateWorkspace(f.installer(), parseArgs(['update', '--yes', '--json']), { discover });
    assert.equal(result.available, false); assert.equal(result.applied, false);
  }
  assert.deepEqual(seen, ['0.1.3', VERSION, VERSION]);
  assert.equal(f.commands.length, commands);
  assert.deepEqual(fs.readFileSync(owner.manifestPath), completed);
  assert.equal(fs.existsSync(join(owner.weaveHome, 'updates')), false);
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
  assert.equal(receipt.version, '0.1.0');
  assert.equal(receipt.installerVersion, VERSION);
  assert.equal(receipt.binary.version, '0.1.0');
  assert.equal(receipt.binary.packageVersion, '0.2.1');
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


test('persistent MCP is staged once, pinned, script-free, and retained on modifications', async (t) => {
  const f = fixture(t), stages = [];
  f.settings.stage = ({ id }) => stages.push(id);
  const first = await f.installer().install(headless());
  const entry = first.components.find((c) => c.id === 'mcp').entry;
  assert.equal(fs.existsSync(entry), true);
  await f.installer().install(headless());
  const installs = f.commands.filter((c) => c.args[1] === 'install');
  assert.equal(installs.length, 1);
  assert.ok(installs[0].args.includes('--ignore-scripts'));
  assert.ok(installs[0].args.includes('--bin-links=false'));
  assert.ok(installs[0].args.includes('--omit=optional'));
  assert.ok(installs[0].args.includes('--registry=https://registry.npmjs.org'));
  assert.deepEqual(stages.slice(0, 6), ['runtime', 'identity', 'node', 'mcp', 'clients', 'verify']);
  fs.appendFileSync(entry, '// local change\n');
  await assert.rejects(f.installer().install(headless()), { code: 'UNMANAGED_MCP_RUNTIME' });
  const removed = await f.installer().uninstall(parseArgs(['uninstall', '--yes']));
  assert.equal(removed.ok, false);
  assert.equal(fs.existsSync(entry), true);
});

test('npm failure never promotes a partial MCP runtime or reports ready', async (t) => {
  const f = fixture(t, { response: (_, args) => args[1] === 'install' ? { code: 1, stdout: '', stderr: 'failure' } : null });
  await assert.rejects(f.installer().install(headless()), { code: 'MCP_INSTALL_FAILED' });
  assert.equal(fs.existsSync(join(f.home, '.weave/tools/mcp-0.2.0')), false);
  assert.deepEqual(fs.readdirSync(join(f.home, '.weave/tools')), []);
  assert.equal(fs.existsSync(join(f.home, '.weave/bin/weave')), true);
  assert.equal(f.commands.some((c) => c.args[0] === 'doctor'), false);
});

test('--no-mcp skips the managed server and client prompts without invented inventory', async (t) => {
  const f = fixture(t);
  const result = await f.installer().install(parseArgs(['--yes', '--no-service', '--no-mcp']));
  assert.equal(f.commands.some((c) => c.args[1] === 'install'), false);
  assert.equal(result.components.find((c) => c.id === 'mcp').status, 'skipped');
  assert.deepEqual(result.mcpClients, []);
});

test('explicit consent migrates owned legacy MCP definitions; headless does not', async (t) => {
  for (const client of ['cursor', 'codex']) {
    const f = fixture(t), owner = f.installer();
    await owner.install(headless());
    const definition = owner.clientDefinition(client), legacy = owner.legacyMcpDefinition();
    fs.mkdirSync(join(definition.path, '..'), { recursive: true });
    const receipt = JSON.parse(fs.readFileSync(owner.manifestPath, 'utf8'));
    if (client === 'cursor') {
      fs.writeFileSync(definition.path, JSON.stringify({ mcpServers: { weave: legacy, other: { command: 'keep' } } }));
      receipt.mcp[client] = { ...definition, spec: legacy };
    } else {
      const block = owner.mcpTomlBlock(legacy);
      fs.writeFileSync(definition.path, 'model = "keep"\n' + block);
      receipt.mcp[client] = { ...definition, block };
    }
    fs.writeFileSync(owner.manifestPath, JSON.stringify(receipt));
    const before = fs.readFileSync(definition.path);
    await f.installer().install(headless());
    assert.deepEqual(fs.readFileSync(definition.path), before);
    await f.installer().install(parseArgs(['--yes', '--no-service', `--mcp-client=${client}`]));
    assert.ok(fs.readFileSync(definition.path, 'utf8').includes('weave-mcp.js'));
    assert.equal((await f.installer().uninstall(parseArgs(['uninstall', '--yes']))).ok, true);
    assert.ok(fs.readFileSync(definition.path, 'utf8').includes('keep'));
  }
});

test('runtime census rejects foreign trees, added files and symlinks without deleting them', async (t) => {
  const f = fixture(t);
  await f.installer().install(headless());
  const runtime = join(f.home, '.weave/tools/mcp-0.2.0');
  fs.writeFileSync(join(runtime, 'unrelated'), 'preserve');
  await assert.rejects(f.installer().install(headless()), { code: 'UNMANAGED_MCP_RUNTIME' });
  const removed = await f.installer().uninstall(parseArgs(['uninstall', '--yes']));
  assert.equal(removed.ok, false);
  assert.equal(fs.readFileSync(join(runtime, 'unrelated'), 'utf8'), 'preserve');
  fs.unlinkSync(join(runtime, 'unrelated'));
  fs.symlinkSync(f.source, join(runtime, 'foreign-link'));
  await assert.rejects(f.installer().install(headless()), { code: 'UNSAFE_MCP_TREE' });
  assert.equal(fs.readFileSync(f.source, 'utf8'), '#!/bin/sh\nexit 0\n');
});

test('an interrupted MCP atomic commit recovers its exact journaled stage and preserves mismatches', async (t) => {
  const f = fixture(t), owner = f.installer();
  await owner.install(headless());
  const receipt = JSON.parse(fs.readFileSync(owner.manifestPath, 'utf8'));
  const runtime = owner.mcpRuntime.path, stage = join(runtime, '..', '.mcp-00000000-0000-0000-0000-000000000000.staging');
  fs.renameSync(runtime, stage);
  receipt.mcpRuntime.staging = stage;
  fs.writeFileSync(owner.manifestPath, JSON.stringify(receipt));
  const restored = await f.installer().install(headless());
  assert.equal(restored.ok, true);
  assert.equal(fs.existsSync(stage), false);
  assert.equal(f.commands.filter((c) => c.args[1] === 'install').length, 1);
  assert.equal(JSON.parse(fs.readFileSync(owner.manifestPath, 'utf8')).mcpRuntime.staging, undefined);
  fs.renameSync(runtime, stage);
  fs.appendFileSync(join(stage, 'node_modules/@useweave/mcp/bin/weave-mcp.js'), '// modified');
  fs.writeFileSync(owner.manifestPath, JSON.stringify(receipt));
  await assert.rejects(f.installer().install(headless()), { code: 'UNMANAGED_MCP_RUNTIME' });
  assert.equal(fs.existsSync(stage), true);
});


test('intact owned MCP entries survive Node relocation and explicitly migrate or uninstall', async (t) => {
  for (const client of ['cursor', 'codex']) {
    for (const migrate of [false, true]) {
      const f = fixture(t);
      f.settings.nodePath = join(f.home, 'node-20/bin/node');
      await f.installer().install(parseArgs(['--yes', '--no-service', `--mcp-client=${client}`]));
      const config = f.installer().clientDefinition(client).path, original = fs.readFileSync(config);
      f.settings.nodePath = join(f.home, 'node-24/bin/node');
      await f.installer().install(headless());
      assert.deepEqual(fs.readFileSync(config), original, 'Node upgrade alone is not client-edit consent');
      if (migrate) {
        await f.installer().install(parseArgs(['--yes', '--no-service', `--mcp-client=${client}`]));
        assert.ok(fs.readFileSync(config, 'utf8').includes('node-24/bin/node'));
        assert.equal(fs.readFileSync(config, 'utf8').includes('node-20/bin/node'), false);
      }
      assert.equal((await f.installer().uninstall(parseArgs(['uninstall', '--yes']))).ok, true);
      assert.equal(fs.readFileSync(config, 'utf8').includes('weave-mcp.js'), false);
    }
  }
});

test('unconfirmed npm termination retains the live-child lock and stage rather than cleaning underneath it', async (t) => {
  const f = fixture(t, { response: (_, args) => args[1] === 'install'
    ? { code: 1, stdout: '', stderr: '', terminationConfirmed: false, childPid: process.pid } : null });
  await assert.rejects(f.installer().install(headless()), { code: 'CHILD_TERMINATION_UNCONFIRMED' });
  const lockPath = join(f.home, '.weave/.joinweave-install.lock');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.deepEqual(lock.children, [process.pid]);
  const stages = fs.readdirSync(join(f.home, '.weave/tools'));
  assert.equal(stages.length, 1);
  assert.match(stages[0], /^\.mcp-.*\.staging$/);
  assert.equal(fs.existsSync(join(f.home, '.weave/tools', stages[0], 'package.json')), true);
  lock.pid = 2147483647; // Dead parent, but its recorded child is still live.
  fs.writeFileSync(lockPath, JSON.stringify(lock));
  await assert.rejects(f.installer().install(headless()), { code: 'INSTALL_LOCKED' });
});

test('readiness cancellation does not sleep or retry after an interrupted native child', async (t) => {
  const controller = new AbortController(); let sleeps = 0;
  const f = fixture(t, { response: (_, args) => {
    if (args[0] !== 'doctor') return null;
    controller.abort();
    return { code: 1, stdout: '', stderr: '', terminationConfirmed: true };
  } });
  f.settings.signal = controller.signal;
  f.settings.sleep = async () => { sleeps++; };
  await assert.rejects(f.installer().install(headless()), { code: 'INSTALL_INTERRUPTED' });
  assert.equal(sleeps, 0);
  assert.equal(f.commands.filter((c) => c.args[0] === 'doctor').length, 1);
  assert.equal(fs.existsSync(join(f.home, '.weave/.joinweave-install.lock')), false);
});


function legacyLargeReceipt(f, owner = f.installer()) {
  const runtime = owner.mcpRuntime.path;
  // A real dependency tree has enough file ownership records to exceed the
  // native parser limit. This deterministic fixture exercises that same shape.
  const bulk = join(runtime, 'fixture-module');
  fs.mkdirSync(bulk);
  for (let i = 0; i < 650; i++) fs.writeFileSync(join(bulk, `module-${String(i).padStart(4, '0')}-${'x'.repeat(55)}.js`), `fixture ${i}`);
  const receipt = JSON.parse(fs.readFileSync(owner.manifestPath, 'utf8'));
  receipt.installerVersion = '0.1.2';
  receipt.mcpRuntime.files = censusTree(runtime);
  delete receipt.mcpRuntime.census;
  fs.unlinkSync(owner.mcpRuntime.censusPath);
  const bytes = JSON.stringify(receipt, null, 2) + '\n';
  assert.ok(Buffer.byteLength(bytes) > 64 * 1024);
  fs.writeFileSync(owner.manifestPath, bytes);
  return { owner, runtime, bulk, bytes };
}

test('0.1.2 oversized MCP receipt migrates before native ownership validation and removes safely', async (t) => {
  const f = fixture(t, { response: (_, args) => {
    const path = join(f.home, '.weave/.joinweave-install.json');
    if (['node', 'doctor'].includes(args[0]) && fs.existsSync(path) && fs.statSync(path).size > 64 * 1024) return { code: 1, stdout: '{"ok":false,"error":"service ownership receipt exceeds native64KiB limit"}', stderr: '' };
    return null;
  } });
  await f.installer().install(headless());
  const old = legacyLargeReceipt(f);
  fs.writeFileSync(join(f.home, '.weave/retained-history'), 'keep');
  assert.equal((await f.installer().install(headless())).ok, true);
  const compact = JSON.parse(fs.readFileSync(old.owner.manifestPath, 'utf8'));
  assert.equal(compact.mcpRuntime.files, undefined);
  assert.ok(fs.statSync(old.owner.manifestPath).size < 64 * 1024);
  assert.equal(compact.version, '0.1.0');
  assert.equal(compact.binary.version, '0.1.0');
  assert.equal(compact.binary.packageVersion, '0.2.1');
  assert.equal(fs.statSync(old.owner.mcpRuntime.censusPath).mode & 0o777, 0o600);
  assert.equal((await f.installer().uninstall(parseArgs(['uninstall', '--yes']))).ok, true);
  assert.equal(fs.existsSync(old.runtime), false);
  assert.equal(fs.existsSync(old.owner.mcpRuntime.censusPath), false);
  assert.equal(fs.readFileSync(join(f.home, '.weave/retained-history'), 'utf8'), 'keep');
});

test('legacy oversized uninstall retains modified MCP files and their hash-bound census', async (t) => {
  const f = fixture(t); await f.installer().install(headless());
  const old = legacyLargeReceipt(f), changed = join(old.runtime, 'node_modules/@useweave/mcp/bin/weave-mcp.js');
  fs.appendFileSync(changed, '// retain my edit');
  const result = await f.installer().uninstall(parseArgs(['uninstall', '--yes']));
  assert.equal(result.ok, false);
  assert.ok(result.warnings.some((value) => value.includes('MCP runtime')));
  assert.ok(fs.readFileSync(changed, 'utf8').includes('retain my edit'));
  assert.ok(fs.statSync(old.owner.manifestPath).size < 64 * 1024);
  assert.equal(fs.existsSync(old.owner.mcpRuntime.censusPath), true);
});

test('census tampering or a foreign migration destination is refused without overwrite', async (t) => {
  const f = fixture(t); await f.installer().install(headless());
  const old = legacyLargeReceipt(f), before = fs.readFileSync(old.owner.manifestPath);
  fs.writeFileSync(old.owner.mcpRuntime.censusPath, 'foreign', { mode: 0o600 });
  await assert.rejects(f.installer().install(headless()), { code: 'UNMANAGED_MCP_CENSUS' });
  assert.deepEqual(fs.readFileSync(old.owner.manifestPath), before);
  assert.equal(fs.readFileSync(old.owner.mcpRuntime.censusPath, 'utf8'), 'foreign');
  fs.unlinkSync(old.owner.mcpRuntime.censusPath);
  await f.installer().install(headless());
  fs.appendFileSync(old.owner.mcpRuntime.censusPath, ' ');
  await assert.rejects(f.installer().install(headless()), { code: 'MODIFIED_MCP_CENSUS' });
  assert.equal(fs.existsSync(old.runtime), true);
});


test('durable MCP removal recovers the exact crash after runtime and census unlink', async (t) => {
  for (const action of ['uninstall', 'install']) {
    const f = fixture(t); await f.installer().install(headless());
    const owner = f.installer(); owner.loadManifest();
    const save = owner.saveManifest.bind(owner);
    owner.saveManifest = () => {
      if (!owner.manifest.mcpRuntime) throw new Error('simulated crash after both unlinks, before final receipt write');
      save();
    };
    assert.throws(() => owner.mcpRuntime.remove(), /simulated crash/);
    assert.equal(fs.existsSync(owner.mcpRuntime.path), false);
    assert.equal(fs.existsSync(owner.mcpRuntime.censusPath), false);
    const journal = JSON.parse(fs.readFileSync(owner.manifestPath));
    assert.equal(journal.mcpRuntime.removing, true);
    const result = action === 'install' ? await f.installer().install(headless()) : await f.installer().uninstall(parseArgs(['uninstall', '--yes']));
    assert.equal(result.ok, true);
    if (action === 'install') {
      assert.equal(fs.existsSync(owner.mcpRuntime.entry), true);
      assert.equal(JSON.parse(fs.readFileSync(owner.manifestPath)).mcpRuntime.removing, undefined);
    } else assert.equal(fs.existsSync(owner.manifestPath), false);
  }
});

test('removal journal never substitutes for missing or modified census beside a surviving runtime', async (t) => {
  for (const state of ['missing', 'modified']) {
    const f = fixture(t); await f.installer().install(headless());
    const owner = f.installer(); owner.loadManifest();
    owner.manifest.mcpRuntime.removing = true; owner.saveManifest();
    if (state === 'missing') fs.unlinkSync(owner.mcpRuntime.censusPath);
    else fs.appendFileSync(owner.mcpRuntime.censusPath, ' ');
    await assert.rejects(f.installer().install(headless()), { code: state === 'missing' ? 'MISSING_MCP_CENSUS' : 'MODIFIED_MCP_CENSUS' });
    assert.equal(fs.existsSync(owner.mcpRuntime.entry), true);
    assert.equal(JSON.parse(fs.readFileSync(owner.manifestPath)).mcpRuntime.removing, true);
  }
});

// Construct the published 0.1.3 ownership shape with its actual 0.1.0 MCP pin.
// No installed client or operator workspace is used by these isolated fixtures.
async function installLegacy(f, clients = [], { service = false } = {}) {
  const owner = f.installer();
  owner.mcpRuntime = new ManagedMcp(owner, { version: LEGACY_MCP_VERSION });
  await owner.install(parseArgs(['--yes', ...(service ? [] : ['--no-service']), ...clients.flatMap((client) => ['--mcp-client', client])]));
  const receipt = JSON.parse(fs.readFileSync(owner.manifestPath));
  receipt.installerVersion = '0.1.3';
  receipt.binary.version = '0.1.0';
  delete receipt.binary.packageVersion;
  fs.writeFileSync(owner.manifestPath, JSON.stringify(receipt, null, 2) + '\n');
  // The new package has different executable bytes, while Rust --version may
  // remain 0.1.0. Upgrade ownership must rely on the package pin and exact hash.
  fs.writeFileSync(f.source, '#!/bin/sh\n# API2 fixture\nexit 0\n');
  return owner;
}

test('0.1.3 upgrade retains identity, data, old MCP and unconsented JSON/TOML clients', async (t) => {
  const f = fixture(t), old = await installLegacy(f, ['cursor', 'codex']);
  const identity = join(old.weaveHome, 'identity-fixture'), data = join(old.weaveHome, 'strand-fixture');
  fs.writeFileSync(identity, 'private identity fixture', { mode: 0o600 });
  fs.writeFileSync(data, 'retained strand fixture');
  const clients = ['cursor', 'codex'].map((client) => old.clientDefinition(client).path);
  const before = clients.map((path) => fs.readFileSync(path));
  const oldFiles = censusTree(old.mcpRuntime.path), oldCensus = fs.readFileSync(old.mcpRuntime.censusPath);
  const commandStart = f.commands.length;
  const result = await f.installer().install(headless());
  assert.equal(result.ok, true);
  assert.deepEqual(result.mcpClientsNeedingUpdate.sort(), ['codex', 'cursor']);
  clients.forEach((path, i) => assert.deepEqual(fs.readFileSync(path), before[i]));
  assert.deepEqual(censusTree(old.mcpRuntime.path), oldFiles);
  assert.deepEqual(fs.readFileSync(old.mcpRuntime.censusPath), oldCensus);
  assert.equal(fs.readFileSync(identity, 'utf8'), 'private identity fixture');
  assert.equal(fs.statSync(identity).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(data, 'utf8'), 'retained strand fixture');
  const receipt = JSON.parse(fs.readFileSync(old.manifestPath));
  assert.equal(receipt.version, '0.1.0');
  assert.equal(receipt.binary.version, '0.1.0');
  assert.equal(receipt.binary.packageVersion, '0.2.1');
  assert.equal(receipt.mcpRuntime.version, MCP_VERSION);
  assert.equal(receipt.previousMcpRuntime.version, LEGACY_MCP_VERSION);
  assert.equal(receipt.previousMcpRuntime.files, undefined);
  assert.ok(fs.statSync(old.manifestPath).size < 64 * 1024);
  const commands = f.commands.slice(commandStart);
  assert.deepEqual(commands[0].args, ['node', 'stop', '--json']);
  assert.deepEqual(commands[1].args, ['init', '--json']);
  assert.ok(commands.some(({ args }) => args.join(' ') === 'node start --json'));
});

test('consented upgrade migrates only exact owned clients; uninstall removes both runtimes', async (t) => {
  const f = fixture(t);
  fs.mkdirSync(join(f.home, '.cursor'));
  fs.writeFileSync(join(f.home, '.cursor/mcp.json'), '{"mcpServers":{"other":{"command":"keep"}},"theme":"keep"}');
  fs.mkdirSync(join(f.home, '.codex'));
  fs.writeFileSync(join(f.home, '.codex/config.toml'), 'model = "keep"\n');
  const old = await installLegacy(f, ['cursor', 'codex']);
  const result = await f.installer().install(parseArgs(['--yes', '--no-service', '--mcp-client=cursor,codex']));
  assert.deepEqual(result.mcpClientsNeedingUpdate, []);
  const config = JSON.parse(fs.readFileSync(join(f.home, '.cursor/mcp.json')));
  assert.deepEqual(config.mcpServers.weave.args, [f.installer().mcpRuntime.entry]);
  assert.equal(config.mcpServers.other.command, 'keep');
  assert.ok(fs.readFileSync(join(f.home, '.codex/config.toml'), 'utf8').includes('mcp-0.2.0'));
  assert.equal((await f.installer().uninstall(parseArgs(['uninstall', '--yes']))).ok, true);
  for (const path of [old.mcpRuntime.path, old.mcpRuntime.censusPath, f.installer().mcpRuntime.path, f.installer().mcpRuntime.censusPath]) assert.equal(fs.existsSync(path), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(join(f.home, '.cursor/mcp.json'))), { mcpServers: { other: { command: 'keep' } }, theme: 'keep' });
  assert.ok(fs.readFileSync(join(f.home, '.codex/config.toml'), 'utf8').includes('model = "keep"'));
});

test('failed new MCP download keeps the working legacy server and recovers without redownloading it', async (t) => {
  let failDownload = false;
  const f = fixture(t, { response: (_, args) => failDownload && args[1] === 'install' ? { code: 1, stdout: '', stderr: 'fixture download failed' } : null });
  const old = await installLegacy(f, ['cursor']);
  const path = old.clientDefinition('cursor').path, config = fs.readFileSync(path), census = fs.readFileSync(old.mcpRuntime.censusPath);
  failDownload = true;
  await assert.rejects(f.installer().install(headless()), { code: 'MCP_INSTALL_FAILED' });
  assert.deepEqual(fs.readFileSync(path), config);
  assert.deepEqual(fs.readFileSync(old.mcpRuntime.censusPath), census);
  assert.equal(fs.existsSync(old.mcpRuntime.entry), true);
  const interrupted = JSON.parse(fs.readFileSync(old.manifestPath));
  assert.equal(interrupted.mcpRuntime, undefined);
  assert.equal(interrupted.previousMcpRuntime.version, LEGACY_MCP_VERSION);
  assert.deepEqual(fs.readdirSync(join(old.weaveHome, 'tools')).sort(), ['mcp-0.1.0', 'mcp-0.1.0.census.json']);
  failDownload = false;
  assert.equal((await f.installer().install(headless())).ok, true);
  assert.equal(f.commands.filter(({ args }) => args[1] === 'install').length, 3, 'one old install, one failed new download, one retry');
  assert.deepEqual(fs.readFileSync(path), config);
});

test('crash after durable legacy retention resumes from the previous receipt', async (t) => {
  const f = fixture(t), old = await installLegacy(f, ['cursor']);
  const owner = f.installer(); owner.loadManifest();
  const save = owner.saveManifest.bind(owner);
  owner.saveManifest = () => {
    save();
    if (owner.manifest.previousMcpRuntime && !owner.manifest.mcpRuntime) throw new Error('fixture interruption after preserving legacy runtime');
  };
  await assert.rejects(owner.mcpRuntime.install(), /fixture interruption/);
  assert.equal(fs.existsSync(old.mcpRuntime.entry), true);
  assert.equal((await f.installer().install(headless())).ok, true);
  assert.equal(f.commands.filter(({ args }) => args[1] === 'install').length, 2);
});

test('modified legacy runtime and foreign new runtime are preserved during upgrade', async (t) => {
  for (const conflict of ['legacy-edit', 'foreign-new']) {
    const f = fixture(t), old = await installLegacy(f, ['cursor']);
    const config = old.clientDefinition('cursor').path, before = fs.readFileSync(config);
    const path = conflict === 'legacy-edit' ? old.mcpRuntime.entry : join(f.installer().mcpRuntime.path, 'foreign');
    if (conflict === 'foreign-new') fs.mkdirSync(f.installer().mcpRuntime.path);
    fs.writeFileSync(path, 'retain local work');
    await assert.rejects(f.installer().install(headless()), { code: 'UNMANAGED_MCP_RUNTIME' });
    assert.equal(fs.readFileSync(path, 'utf8'), 'retain local work');
    assert.deepEqual(fs.readFileSync(config), before);
    assert.equal(fs.existsSync(old.mcpRuntime.censusPath), true);
  }
});

test('modified legacy client blocks its migration and preserves both runtime trees on uninstall', async (t) => {
  const f = fixture(t), old = await installLegacy(f, ['cursor']);
  const path = old.clientDefinition('cursor').path;
  const config = JSON.parse(fs.readFileSync(path)); config.mcpServers.weave.command = 'my-local-server';
  fs.writeFileSync(path, JSON.stringify(config));
  const before = fs.readFileSync(path);
  await assert.rejects(f.installer().install(parseArgs(['--yes', '--no-service', '--mcp-client=cursor'])), { code: 'MCP_ENTRY_CONFLICT' });
  assert.deepEqual(fs.readFileSync(path), before);
  const removed = await f.installer().uninstall(parseArgs(['uninstall', '--yes']));
  assert.equal(removed.ok, false);
  assert.deepEqual(fs.readFileSync(path), before);
  assert.equal(fs.existsSync(old.mcpRuntime.entry), true);
  assert.equal(fs.existsSync(f.installer().mcpRuntime.entry), true);
});

test('current installer can uninstall a retained 0.1.3 installation without downloading an upgrade', async (t) => {
  const f = fixture(t), old = await installLegacy(f, ['cursor', 'codex']);
  fs.writeFileSync(join(old.weaveHome, 'retained-strand'), 'keep');
  assert.equal((await f.installer().uninstall(parseArgs(['uninstall', '--yes']))).ok, true);
  assert.equal(f.commands.filter(({ args }) => args[1] === 'install').length, 1);
  assert.equal(fs.existsSync(old.mcpRuntime.path), false);
  assert.equal(fs.existsSync(old.mcpRuntime.censusPath), false);
  assert.equal(fs.readFileSync(join(old.weaveHome, 'retained-strand'), 'utf8'), 'keep');
});

test('0.1.2 legacy MCP receipt compacts before native upgrade and retains both census bindings', async (t) => {
  const f = fixture(t, { response: (command, args) => {
    if (command === join(f.home, '.weave/bin/weave')) assert.ok(fs.statSync(join(f.home, '.weave/.joinweave-install.json')).size < 64 * 1024, `native command ${args[0]} must never see an oversized ownership receipt`);
    return null;
  } });
  const old = await installLegacy(f, ['cursor']);
  legacyLargeReceipt(f, old);
  assert.equal((await f.installer().install(headless())).ok, true);
  const receipt = JSON.parse(fs.readFileSync(old.manifestPath));
  assert.equal(receipt.mcpRuntime.version, MCP_VERSION);
  assert.equal(receipt.previousMcpRuntime.version, LEGACY_MCP_VERSION);
  assert.equal(receipt.previousMcpRuntime.files, undefined);
  assert.equal(fs.statSync(old.mcpRuntime.censusPath).mode & 0o777, 0o600);
});

test('upgrade shutdown failure preserves old executable, service definition and receipt', async (t) => {
  for (const managed of [false, true]) {
    let stopFails = false;
    const f = fixture(t, { response: (command, args) => {
      if (!stopFails) return null;
      if (managed && command === 'systemctl' && args.includes('is-active')) return { code: 0, stdout: 'active', stderr: '' };
      if (!managed && args.join(' ') === 'node stop --json') return { code: 1, stdout: '', stderr: 'unowned daemon' };
      return null;
    } });
    const old = await installLegacy(f, [], { service: managed });
    const binary = fs.readFileSync(old.binary), receipt = fs.readFileSync(old.manifestPath);
    const definition = managed ? JSON.parse(receipt).service.path : null;
    const serviceBytes = definition && fs.readFileSync(definition);
    stopFails = true;
    await assert.rejects(f.installer().install(headless()), { code: managed ? 'SERVICE_STOP_FAILED' : 'NATIVE_COMMAND_FAILED' });
    assert.deepEqual(fs.readFileSync(old.binary), binary);
    assert.deepEqual(fs.readFileSync(old.manifestPath), receipt);
    if (definition) assert.deepEqual(fs.readFileSync(definition), serviceBytes);
  }
});

async function interruptedBinaryUpgrade(f, phase) {
  const owner = f.installer(), save = owner.saveManifest.bind(owner);
  owner.saveManifest = () => {
    if (phase === 'after-rename' && !owner.manifest.binaryUpgrade && owner.manifest.binary?.packageVersion === '0.2.1') {
      throw new Error('fixture crash after binary replacement, before receipt save');
    }
    save();
    if (phase === 'before-rename' && owner.manifest.binaryUpgrade) throw new Error('fixture crash after durable upgrade intent');
  };
  await assert.rejects(owner.install(headless()), /fixture crash/);
  const journal = JSON.parse(fs.readFileSync(owner.manifestPath));
  assert.match(journal.binaryUpgrade.fromSha256, /^[a-f0-9]{64}$/);
  assert.match(journal.binaryUpgrade.toSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(journal.binaryUpgrade.fromSha256, journal.binaryUpgrade.toSha256);
  assert.equal(journal.binaryUpgrade.packageVersion, '0.2.1');
  assert.equal(journal.binary.sha256, journal.binaryUpgrade.fromSha256);
  assert.equal(journal.service, null);
  return journal;
}

test('binary upgrade intent recovers both sides of rename through reinstall or uninstall', async (t) => {
  for (const phase of ['before-rename', 'after-rename']) {
    for (const action of ['install', 'uninstall']) {
      const f = fixture(t), old = await installLegacy(f, ['cursor']);
      fs.writeFileSync(join(old.weaveHome, 'identity-fixture'), 'keep');
      await interruptedBinaryUpgrade(f, phase);
      const result = action === 'install'
        ? await f.installer().install(headless())
        : await f.installer().uninstall(parseArgs(['uninstall', '--yes']));
      assert.equal(result.ok, true);
      assert.equal(fs.readFileSync(join(old.weaveHome, 'identity-fixture'), 'utf8'), 'keep');
      if (action === 'install') {
        assert.deepEqual(fs.readFileSync(old.binary), fs.readFileSync(f.source));
        const receipt = JSON.parse(fs.readFileSync(old.manifestPath));
        assert.equal(receipt.binaryUpgrade, undefined);
        assert.equal(receipt.binary.version, '0.1.0');
        assert.equal(receipt.binary.packageVersion, '0.2.1');
        assert.equal(receipt.version, '0.1.0');
      } else assert.equal(fs.existsSync(old.binary), false);
    }
  }
});

test('pending binary replacement refuses a third hash and changed package bytes without overwriting', async (t) => {
  for (const tamper of ['installed', 'source']) {
    const f = fixture(t), old = await installLegacy(f);
    await interruptedBinaryUpgrade(f, 'after-rename');
    const changed = tamper === 'installed' ? old.binary : f.source;
    fs.writeFileSync(changed, 'foreign replacement');
    const binary = fs.readFileSync(old.binary), receipt = fs.readFileSync(old.manifestPath);
    await assert.rejects(f.installer().install(headless()), { code: tamper === 'installed' ? 'UNMANAGED_BINARY' : 'INVALID_MANIFEST' });
    assert.deepEqual(fs.readFileSync(old.binary), binary);
    assert.deepEqual(fs.readFileSync(old.manifestPath), receipt);
    if (tamper === 'installed') {
      await assert.rejects(f.installer().uninstall(parseArgs(['uninstall', '--yes'])), { code: 'UNMANAGED_BINARY' });
      assert.deepEqual(fs.readFileSync(old.binary), binary);
      assert.deepEqual(fs.readFileSync(old.manifestPath), receipt);
    }
  }
});

test('managed upgrade preserves service changes made during shutdown', async (t) => {
  let changeDuringStop = false, definition;
  const f = fixture(t, { response: (command, args) => {
    if (changeDuringStop && command === 'systemctl' && args.includes('disable') && args.includes('--now')) fs.appendFileSync(definition, '# concurrent local edit\n');
    return null;
  } });
  const old = await installLegacy(f, [], { service: true });
  const receipt = fs.readFileSync(old.manifestPath), binary = fs.readFileSync(old.binary);
  definition = JSON.parse(receipt).service.path;
  changeDuringStop = true;
  await assert.rejects(f.installer().install(headless()), { code: 'CONCURRENT_EDIT' });
  assert.deepEqual(fs.readFileSync(old.binary), binary);
  assert.deepEqual(fs.readFileSync(old.manifestPath), receipt);
  assert.ok(fs.readFileSync(definition, 'utf8').endsWith('# concurrent local edit\n'));
});
