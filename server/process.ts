import { execFile, spawn } from "node:child_process";

export const COMMAND_TIMEOUT_MS = 15_000;
export const COMMAND_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
export const IMAGE_TIMEOUT_MS = 10_000;
export const IMAGE_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export class GitHubCommandError extends Error {
  public constructor(
    public readonly file: string,
    public readonly args: readonly string[],
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly causeCode: string | number | undefined,
    message = `${file} exited unsuccessfully`,
  ) {
    super(message);
    this.name = "GitHubCommandError";
  }
}

export class CommandLaunchError extends Error {
  public constructor(
    public readonly file: string,
    public readonly args: readonly string[],
    public readonly causeCode: string | number | undefined,
    message = `${file} could not be launched`,
  ) {
    super(message);
    this.name = "CommandLaunchError";
  }
}

export type CommandRunner = (file: string, args: readonly string[]) => Promise<string>;
export type BufferCommandRunner = (file: string, args: readonly string[]) => Promise<Buffer>;
export type CommandLauncher = (file: string, args: readonly string[]) => Promise<void>;

interface ExecFailure extends Error {
  code?: string | number;
  killed?: boolean;
  stderr?: Buffer | string;
  stdout?: Buffer | string;
}

function failureText(value: Buffer | string | undefined): string {
  if (value === undefined) return "";
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}

export function runCommand(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        encoding: "utf8",
        maxBuffer: COMMAND_MAX_BUFFER_BYTES,
        shell: false,
        timeout: COMMAND_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout);
          return;
        }

        const failure = error as ExecFailure;
        reject(
          new GitHubCommandError(
            file,
            args,
            failureText(failure.stdout ?? stdout),
            failureText(failure.stderr ?? stderr),
            failure.code,
            failure.killed ? `${file} timed out` : error.message,
          ),
        );
      },
    );
  });
}

/**
 * Windows exposes some CLIs, such as the VS Code `code` command, as `.cmd`
 * shims. Node cannot execute a `.cmd` shim on its own, so those go through the
 * command processor with the command and every argument kept as separate argv
 * entries; a single shell string would corrupt paths containing backslashes.
 * Everything else runs the target directly.
 */
function shellInvocation(file: string, args: readonly string[]): {
  readonly args: string[];
  readonly command: string;
} {
  if (process.platform !== "win32") return { args: [...args], command: file };
  return { args: ["/d", "/s", "/c", file, ...args], command: process.env.ComSpec ?? "cmd.exe" };
}

/**
 * Launches a GUI command a user is waiting on, such as the VS Code CLI. The
 * command's own output is ignored; only a failure to launch or a non-zero exit
 * rejects.
 */
export function launchCommand(file: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const invocation = shellInvocation(file, args);

    const child = spawn(invocation.command, invocation.args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    const stderr: Buffer[] = [];
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      reject(new CommandLaunchError(file, args, error.code, error.message));
    });
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const detail = Buffer.concat(stderr).toString("utf8").trim();
      reject(
        new CommandLaunchError(
          file,
          args,
          code ?? undefined,
          detail.length > 0 ? detail : `${file} exited unsuccessfully`,
        ),
      );
    });
  });
}

/**
 * Runs a command through the same shim handling as `launchCommand` but returns
 * its stdout, for CLIs that report state instead of opening something.
 */
export function runShellCommand(file: string, args: readonly string[]): Promise<string> {
  const invocation = shellInvocation(file, args);
  return new Promise((resolve, reject) => {
    execFile(
      invocation.command,
      invocation.args,
      {
        encoding: "utf8",
        maxBuffer: COMMAND_MAX_BUFFER_BYTES,
        shell: false,
        timeout: COMMAND_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout);
          return;
        }

        const failure = error as ExecFailure;
        const detail = failureText(failure.stderr ?? stderr).trim();
        reject(
          new CommandLaunchError(
            file,
            args,
            failure.code,
            failure.killed ? `${file} timed out` : detail.length > 0 ? detail : error.message,
          ),
        );
      },
    );
  });
}

export function runBufferCommand(file: string, args: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        encoding: "buffer",
        maxBuffer: IMAGE_MAX_BUFFER_BYTES,
        shell: false,
        timeout: IMAGE_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout);
          return;
        }

        const failure = error as ExecFailure;
        reject(
          new GitHubCommandError(
            file,
            args,
            failureText(failure.stdout ?? stdout),
            failureText(failure.stderr ?? stderr),
            failure.code,
            failure.killed ? `${file} timed out` : error.message,
          ),
        );
      },
    );
  });
}

export function mapGhFailure(error: unknown): string {
  if (!(error instanceof GitHubCommandError)) {
    return error instanceof Error ? error.message : "GitHub request failed.";
  }

  const detail = `${error.message}\n${error.stderr}`;
  if (error.causeCode === "ENOENT") {
    return "GitHub CLI (gh) is not installed on the Paseo daemon host. Install it there and reload the plugin.";
  }
  if (/authenticat|bad credentials|HTTP 401|not logged in|login required|gh auth login/i.test(detail)) {
    return "GitHub CLI is not authenticated. Run gh auth login on the Paseo daemon machine.";
  }
  if (/not mergeable|mergeable state|protected branch|required status check/i.test(detail)) {
    return "GitHub cannot merge this pull request yet. Check for conflicts, failing checks, or review requirements.";
  }
  if (/rate.?limit|API rate limit exceeded|HTTP 429/i.test(detail)) {
    return "GitHub rate limit reached. Keep the existing panel data and try refreshing later.";
  }
  if (/timed out|ETIMEDOUT/i.test(detail)) {
    return "GitHub request timed out on the Paseo daemon host.";
  }
  if (/maxBuffer|stdout maxBuffer length exceeded/i.test(detail)) {
    return "GitHub returned more data than the panel can safely process.";
  }

  const stderr = error.stderr.trim();
  return stderr.length > 0 ? `GitHub request failed: ${stderr}` : "GitHub request failed.";
}

export function asMappedGhError(error: unknown): Error {
  return new Error(mapGhFailure(error), { cause: error });
}
