#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolveBinary } from '../src/resolve.js';

try {
  const child = spawn(resolveBinary(), process.argv.slice(2), { stdio: 'inherit', shell: false });
  child.on('error', (error) => { console.error(`weave: ${error.message}`); process.exitCode = 1; });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error(`weave: ${error.message}`);
  process.exitCode = 1;
}
