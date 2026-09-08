import { execFile } from "node:child_process";

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

export type CommandRunner = (file: string, args: readonly string[]) => Promise<string>;
export type BufferCommandRunner = (file: string, args: readonly string[]) => Promise<Buffer>;

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
  if (/auth(?:entication)?|not logged|login required|HTTP 401/i.test(detail)) {
    return "GitHub CLI is not authenticated. Run gh auth login on the Paseo daemon machine.";
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
