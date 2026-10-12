#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { Installer, VERSION, parseArgs } from '../src/installer.js';

const jsonRequested = process.argv.slice(2).includes('--json');
let prompt;
try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    const usage = 'joinweave [uninstall] [--yes] [--json] [--no-service] [--no-mcp] [--path] [--mcp-client CLIENT] [--purge]\n\n--yes installs headlessly; PATH and MCP edits require --path and --mcp-client.\nClients: claude-desktop, claude-code, cursor, codex; one and bridge provide manual setup.\n--no-service starts a detached node. Uninstall keeps your data; --purge removes ~/.weave data.\n';
    console.log(options.json ? JSON.stringify({ ok: true, version: VERSION, usage }) : usage);
  } else if (options.version) console.log(options.json ? JSON.stringify({ ok: true, version: VERSION }) : VERSION);
  else {
    if (!options.yes && !options.json && !process.stdin.isTTY && options.action === 'install') throw Object.assign(new Error('For unattended installation use --yes. MCP and PATH edits still need explicit flags.'), { code: 'INTERACTION_REQUIRED' });
    if (!options.yes && !options.json && process.stdin.isTTY) prompt = createInterface({ input: process.stdin, output: process.stderr });
    const installer = new Installer({
      resolveNative: options.action === 'install' ? (await import('@useweave/cli')).resolveBinary : undefined,
      confirm: async (question) => prompt ? /^y(?:es)?$/i.test((await prompt.question(`${question} [y/N] `)).trim()) : false,
      progress: (message) => { if (!options.json) console.error(`✓ ${message}`); },
    });
    const result = await installer[options.action](options);
    if (options.json) console.log(JSON.stringify(result));
    else if (options.action === 'install') {
      console.log(`\nWeave is ready.\nWorkspace: ${result.shared}\nTry: ${result.pathAdded ? 'weave doctor' : `${result.binary} doctor`}\n`);
      for (const manual of result.manualMcpClients) console.log(`${manual.client}: add this MCP server in the client's settings:\n${JSON.stringify({ weave: manual.server }, null, 2)}\n`);
    }
    else {
      console.log(result.ok ? `Weave uninstalled. ${result.dataRetained ? 'Your data is preserved.' : 'Workspace data removed.'} Your ~/Weave folder is preserved.` : 'Uninstall preserved modified files.');
      for (const warning of result.warnings) console.error(warning);
    }
    if (!result.ok) process.exitCode = 1;
  }
} catch (error) {
  const result = { ok: false, error: { code: error.code || 'INSTALL_FAILED', message: error.message } };
  if (jsonRequested) console.log(JSON.stringify(result));
  else console.error(`joinweave: ${error.message}`);
  process.exitCode = 1;
} finally { prompt?.close(); }
