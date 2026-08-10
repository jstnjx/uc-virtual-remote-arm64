import { spawn } from "node:child_process";

function commandText(command, args, redacted = []) {
  const hidden = new Set(redacted.map(String));
  return [command, ...args.map((arg) => hidden.has(String(arg)) ? "***" : String(arg))]
    .map((item) => /\s/.test(item) ? JSON.stringify(item) : item)
    .join(" ");
}

export class ProcessError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "ProcessError";
    this.command = options.command || "";
    this.code = options.code ?? null;
    this.signal = options.signal ?? null;
    this.stdout = options.stdout || "";
    this.stderr = options.stderr || "";
    this.timedOut = Boolean(options.timedOut);
  }
}

export function runProcess(command, args = [], options = {}) {
  const values = args.map((item) => String(item));
  const timeoutMs = Math.max(0, Number(options.timeoutMs || 0));
  const display = commandText(command, values, options.redacted || []);
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const stdout = [];
    const stderr = [];
    const child = spawn(command, values, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
    });
    const finish = (error, result = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener?.("abort", abort);
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => {
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 1000).unref?.();
    };
    options.signal?.addEventListener?.("abort", abort, { once: true });
    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true;
      abort();
    }, timeoutMs) : null;
    child.stdout.on("data", (chunk) => {
      stdout.push(chunk);
      options.onStdout?.(chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      stderr.push(chunk);
      options.onStderr?.(chunk.toString());
    });
    child.once("error", (cause) => finish(new ProcessError(`Unable to run ${display}: ${cause.message}`, {
      command: display, cause
    })));
    child.once("exit", (code, signal) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (options.signal?.aborted) {
        return finish(new ProcessError(`Command aborted: ${display}`, {
          command: display, code, signal, stdout: out, stderr: err
        }));
      }
      if (timedOut) {
        return finish(new ProcessError(`Command timed out after ${timeoutMs} ms: ${display}`, {
          command: display, code, signal, stdout: out, stderr: err, timedOut: true
        }));
      }
      if (code !== 0 && options.rejectOnError !== false) {
        const detail = err.trim() || out.trim() || `exit code ${code}`;
        return finish(new ProcessError(`${display} failed: ${detail}`, {
          command: display, code, signal, stdout: out, stderr: err
        }));
      }
      finish(null, { code: code ?? 0, signal, stdout: out, stderr: err, command: display });
    });
    if (options.input !== undefined) {
      child.stdin.end(typeof options.input === "string" || Buffer.isBuffer(options.input)
        ? options.input
        : String(options.input));
    }
  });
}

export async function commandAvailable(command, runner = runProcess) {
  try {
    await runner("sh", ["-lc", `command -v ${JSON.stringify(command)} >/dev/null 2>&1`], { timeoutMs: 3000 });
    return true;
  } catch {
    return false;
  }
}
