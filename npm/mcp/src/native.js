import { execFile } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export const MAX_NATIVE_OUTPUT_BYTES = 4 * 1024 * 1024;
export const MAX_WRITE_BYTES = 256 * 1024;

async function executable(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) {
    throw new Error('WEAVE_BINARY must be an absolute executable file path.');
  }
  if (!(await stat(path)).isFile()) {
    throw new Error('The configured Weave binary is not a file.');
  }
  await access(path, constants.X_OK);
  return path;
}

export async function resolveWeaveBinary(env = process.env) {
  if (env.WEAVE_BINARY !== undefined) return executable(env.WEAVE_BINARY);
  const persistent = join(homedir(), '.weave', 'bin', process.platform === 'win32' ? 'weave.exe' : 'weave');
  try {
    return await executable(persistent);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Lazy resolution keeps tools/list usable before the workspace is installed.
  const { resolveBinary } = await import('@useweave/cli');
  return executable(await resolveBinary());
}

function failure(error) {
  return { ok: false, error };
}

function parseOutput(stdout) {
  const result = JSON.parse(stdout);
  if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.ok !== 'boolean') {
    throw new Error('Invalid native result');
  }
  return result;
}

export function createNativeRunner({ env = process.env, binaryResolver = resolveWeaveBinary } = {}) {
  return async (args, { stdin = '', timeoutMs = 30_000, signal } = {}) => {
    if (signal?.aborted) return failure('The Weave request was cancelled.');
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
      return failure('Invalid Weave command arguments.');
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 90_000) {
      return failure('Invalid Weave command timeout.');
    }
    if (typeof stdin !== 'string' || Buffer.byteLength(stdin, 'utf8') > MAX_WRITE_BYTES) {
      return failure('Strand writes must be at most 256 KiB of UTF-8 data.');
    }
    if (env.WEAVE_HOME !== undefined && (!isAbsolute(env.WEAVE_HOME) || env.WEAVE_HOME.includes('\0'))) {
      return failure('WEAVE_HOME must be an absolute directory path.');
    }
    let binary;
    try {
      binary = await binaryResolver(env);
    } catch (error) {
      return failure(error.message || 'Install Weave with npx joinweave before using these tools.');
    }
    return new Promise((resolve) => {
      const child = execFile(binary, ['--json', ...args], {
        env,
        encoding: 'utf8',
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: MAX_NATIVE_OUTPUT_BYTES,
        windowsHide: true,
        signal,
      }, (error, stdout) => {
        if (error?.name === 'AbortError') {
          resolve(failure('The Weave request was cancelled.'));
          return;
        }
        if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          resolve(failure('The Weave result exceeded 4 MiB. Read a smaller strand range.'));
          return;
        }
        if (error?.killed || error?.signal) {
          resolve(failure('The Weave command timed out or was terminated. Check weave node status.'));
          return;
        }
        let result;
        try {
          result = parseOutput(stdout);
        } catch {
          resolve(failure(error ? 'The Weave command failed without a valid JSON result.' : 'The Weave command returned invalid JSON.'));
          return;
        }
        if (error && result.ok) {
          resolve(failure(`The Weave command failed with exit status ${error.code ?? 'unknown'}.`));
          return;
        }
        resolve(result);
      });
      // Inherited MCP stdin would leak the protocol to the CLI. Close the child
      // input explicitly; only the strand append tool supplies data here.
      child.stdin?.on('error', () => {});
      child.stdin?.end(stdin);
    });
  };
}
