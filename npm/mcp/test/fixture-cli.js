#!/usr/bin/env node
// Test boundary only. This fixture never claims network or replication proof.
let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;
const mode = process.env.WEAVE_MCP_FIXTURE_MODE;
if (mode === 'timeout') {
  setTimeout(() => {}, 60_000);
} else if (mode === 'invalid') {
  process.stdout.write('This is not JSON\n');
} else if (mode === 'oversize') {
  process.stdout.write('x'.repeat(5 * 1024 * 1024));
} else if (mode === 'failure') {
  process.stdout.write(JSON.stringify({ ok: false, error: 'Fixture node is stopped.' }) + '\n');
  process.exitCode = 7;
} else if (mode === 'lying-exit') {
  process.stdout.write(JSON.stringify({ ok: true }) + '\n');
  process.exitCode = 9;
} else {
  process.stdout.write(JSON.stringify({ ok: true, fixture: true, args: process.argv.slice(2), stdin }) + '\n');
}
