#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { Installer, InstallError, VERSION, parseArgs } from '../src/installer.js';
import { TerminalPresenter, installationSummary } from '../src/terminal.js';

const jsonRequested = process.argv.slice(2).includes('--json');
const controller = new AbortController();
let prompt, presenter, interrupted;
const interrupt = (signal) => {
  interrupted ||= signal;
  presenter?.finish();
  controller.abort();
};
const onInt = () => interrupt('SIGINT'), onTerm = () => interrupt('SIGTERM');
try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    const usage = 'joinweave [uninstall|update] [--yes] [--json] [--no-animation] [--no-service] [--no-mcp] [--path] [--mcp-client CLIENT] [--purge]\n\nupdate --check --json verifies the stable GitHub release; update --yes applies an authenticated release.\nupdate --prefetch downloads verified archives without applying; --watch repeats in this process.\nupdate --status reads the last background result. Stop --watch with Ctrl-C; WEAVE_NO_UPDATE=1 disables it.\nInstalls native CLI, local identity, peer node, workspace and a persistent MCP server.\n--yes installs headlessly; PATH and MCP client edits require --path and --mcp-client.\nClients: claude-desktop, claude-code, cursor, codex; one and bridge provide manual setup.\n--no-mcp skips the MCP server and client setup. --no-animation disables terminal motion.\n--no-service starts a detached node. Uninstall keeps your data; --purge removes ~/.weave data.\n';
    console.log(options.json ? JSON.stringify({ ok: true, version: VERSION, usage }) : usage);
  } else if (options.version) console.log(options.json ? JSON.stringify({ ok: true, version: VERSION }) : VERSION);
  else {
    if (!options.yes && !options.json && !process.stdin.isTTY && options.action === 'install') throw new InstallError('INTERACTION_REQUIRED', 'For unattended installation use --yes. MCP client and PATH edits still need explicit flags.');
    presenter = new TerminalPresenter({ json: options.json, noAnimation: options.noAnimation });
    if (!options.yes && !options.json && process.stdin.isTTY) prompt = createInterface({ input: process.stdin, output: process.stderr });
    process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
    prompt?.once('SIGINT', onInt);
    const installer = new Installer({
      resolveNative: options.action === 'install' ? (await import('@useweave/cli')).resolveBinary : undefined,
      signal: controller.signal,
      confirm: async (question) => {
        if (!prompt) return false;
        presenter.pause();
        try { return /^y(?:es)?$/i.test((await prompt.question(`${question} [y/N] `, { signal: controller.signal })).trim()); }
        finally { if (!controller.signal.aborted) presenter.resume(); }
      },
      stage: (stage) => {
        if (controller.signal.aborted) throw new InstallError('INSTALL_INTERRUPTED', 'Installation interrupted. Your identity and recoverable installed components were preserved; rerun to continue.');
        presenter.stage(stage);
      },
      progress: (message) => presenter.progress(message),
    });
    const result = await installer[options.action](options);
    presenter.finish();
    if (options.json) console.log(JSON.stringify(result));
    else if (options.action === 'install') {
      console.log(`\n${installationSummary(result)}\n`);
      for (const manual of result.manualMcpClients) console.log(`${manual.client}: add this MCP server in the client's settings:\n${JSON.stringify({ weave: manual.server }, null, 2)}\n`);
    } else if (options.action === 'update') {
      if (result.watchStopped) console.log('Automatic release checking is stopped.');
      else if (result.prefetched) console.log(`Verified Weave ${result.version} archives are ready. Run joinweave update to apply them.`);
      else if (options.status) console.log(JSON.stringify(result, null, 2));
      else console.log(result.applied ? `Weave updated to ${result.version}.` : result.available ? `Weave ${result.version} is available. Run joinweave update to apply it.` : `Weave ${result.version} is current.`);
      if (result.recoveryPath) console.log(`Recovery files: ${result.recoveryPath}`);
    } else {
      console.log(result.ok ? `Weave uninstalled. ${result.dataRetained ? 'Your data is preserved.' : 'Workspace data removed.'} Your ~/Weave folder is preserved.` : 'Uninstall preserved modified files.');
      for (const warning of result.warnings) console.error(warning);
    }
    if (!result.ok) process.exitCode = 1;
  }
} catch (error) {
  presenter?.finish();
  const result = { ok: false, error: interrupted
    ? { code: 'INSTALL_INTERRUPTED', message: 'Installation interrupted. Your identity and recoverable installed components were preserved; rerun to continue.' }
    : { code: error.code || 'INSTALL_FAILED', message: error.message } };
  if (jsonRequested) console.log(JSON.stringify(result));
  else console.error(`joinweave: ${result.error.message}`);
  process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : 1;
} finally {
  presenter?.finish(); prompt?.close();
  process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
}
