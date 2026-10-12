#!/usr/bin/env node
import { StdioServerTransport, serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from '../src/server.js';

// The SDK owns framing, initialization, negotiation and cancellation. stdout is
// exclusively the MCP protocol, including when the native CLI fails.
const handle = serveStdio(() => createServer(), {
  transport: new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 1024 * 1024,
  }),
  onerror: (error) => process.stderr.write(`Weave MCP: ${error.message}\n`),
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    handle.close().catch((error) => {
      process.stderr.write(`Weave MCP shutdown: ${error.message}\n`);
      process.exitCode = 1;
    });
  });
}
