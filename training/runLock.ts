import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
  type BigIntStats,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export interface RunLock {
  release(): void;
}

interface FileIdentity {
  dev: bigint;
  ino: bigint;
}

function fileIdentity(stats: BigIntStats): FileIdentity {
  return { dev: stats.dev, ino: stats.ino };
}

function sameFile(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function canonicalRepositoryIdentity(repositoryRoot: string): string {
  const root = resolve(repositoryRoot);
  const commonDir = execFileSync(
    'git',
    ['rev-parse', '--git-common-dir'],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  ).trim();
  if (commonDir.length === 0) {
    throw new Error(`git returned an empty common directory for ${root}`);
  }
  const absoluteCommonDir = isAbsolute(commonDir) ? commonDir : resolve(root, commonDir);
  const real = realpathSync.native(absoluteCommonDir).replaceAll('\\', '/');
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

function lockPathFor(repositoryIdentity: string): string {
  const digest = createHash('sha256').update(repositoryIdentity).digest('hex');
  return join(tmpdir(), `tetris-trainer-${digest}.lock`);
}

function currentEntry(
  lockPath: string,
): { identity: FileIdentity; contents: string } | null {
  let descriptor: number;
  try {
    descriptor = openSync(lockPath, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    return {
      identity: fileIdentity(fstatSync(descriptor, { bigint: true })),
      contents: readFileSync(descriptor, 'utf8'),
    };
  } finally {
    closeSync(descriptor);
  }
}

export function acquireRunLock(repositoryRoot: string): RunLock {
  const repositoryIdentity = canonicalRepositoryIdentity(repositoryRoot);
  const lockPath = lockPathFor(repositoryIdentity);
  const ownerNonce = randomUUID();
  const contents = `${JSON.stringify({
    ownerNonce,
    pid: process.pid,
    repositoryIdentity,
  })}\n`;
  let descriptor: number;
  try {
    descriptor = openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(
        `training repository is already locked by another trainer: ${repositoryIdentity}`,
      );
    }
    throw error;
  }
  const createdIdentity = fileIdentity(fstatSync(descriptor, { bigint: true }));

  try {
    writeFileSync(descriptor, contents, 'utf8');
  } catch (error) {
    try {
      const entry = currentEntry(lockPath);
      if (entry !== null && sameFile(entry.identity, createdIdentity)) unlinkSync(lockPath);
    } finally {
      closeSync(descriptor);
    }
    throw error;
  }

  let closed = false;
  let unlinked = false;
  let complete = false;

  const cleanup = (suppressErrors: boolean) => {
    if (complete) return;
    let cleanupError: unknown = null;

    if (!unlinked) {
      try {
        const entry = currentEntry(lockPath);
        if (entry === null) {
          unlinked = true;
        } else if (
          !sameFile(entry.identity, createdIdentity) ||
          entry.contents !== contents
        ) {
          throw new Error(
            `trainer lock ownership changed before release: ${lockPath}`,
          );
        } else {
          unlinkSync(lockPath);
          unlinked = true;
        }
      } catch (error) {
        cleanupError = error;
      }
    }

    if (!closed) {
      try {
        closeSync(descriptor);
        closed = true;
      } catch (error) {
        if (cleanupError === null) cleanupError = error;
      }
    }

    if (closed && unlinked) {
      complete = true;
      process.off('exit', onExit);
    }
    if (!suppressErrors && cleanupError !== null) throw cleanupError;
  };
  const onExit = () => cleanup(true);
  process.once('exit', onExit);

  return {
    release() {
      cleanup(false);
    },
  };
}
