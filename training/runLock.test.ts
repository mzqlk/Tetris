import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireRunLock, type RunLock } from './runLock';

const dirs: string[] = [];
const locks: RunLock[] = [];

const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tetris-run-lock-test-'));
  dirs.push(dir);
  return dir;
};

const repository = () => {
  const root = temp();
  execFileSync('git', ['init', '--quiet', root]);
  return root;
};

const windowsShortPath = (path: string): string | null => {
  const script = `
$source = @'
using System.Text;
using System.Runtime.InteropServices;
public static class TetrisShortPathNative {
  [DllImport("kernel32.dll", EntryPoint = "GetShortPathNameW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern uint GetShortPathNameW(string longPath, StringBuilder shortPath, uint bufferLength);
}
'@
Add-Type -TypeDefinition $source
$buffer = New-Object System.Text.StringBuilder 32768
$length = [TetrisShortPathNative]::GetShortPathNameW($env:LONG_PATH, $buffer, [uint32]$buffer.Capacity)
if ($length -gt 0) { [Console]::Out.Write($buffer.ToString()) }
`;
  const result = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', env: { ...process.env, LONG_PATH: path } },
  ).trim();
  return result.length === 0 ? null : result;
};

const acquire = (repositoryRoot: string): RunLock => {
  const lock = acquireRunLock(repositoryRoot);
  locks.push(lock);
  return lock;
};

const normalized = (value: string) => value.replaceAll('\\', '/').toLowerCase();

const findOwnedLockPath = (repositoryRoot: string): string => {
  const owner = normalized(realpathSync.native(repositoryRoot));
  const matches = readdirSync(tmpdir())
    .filter((name) => name.startsWith('tetris-trainer-') && name.endsWith('.lock'))
    .map((name) => join(tmpdir(), name))
    .filter((path) => {
      try {
        return normalized(readFileSync(path, 'utf8')).includes(owner);
      } catch {
        return false;
      }
    });
  expect(matches).toHaveLength(1);
  return matches[0];
};

const waitForFile = async (path: string): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const stopHolder = async (child: ChildProcess, stopPath: string): Promise<void> => {
  writeFileSync(stopPath, 'stop');
  if (child.exitCode === null) await once(child, 'exit');
};

afterEach(() => {
  for (const lock of locks.splice(0).reverse()) {
    try {
      lock.release();
    } catch {
      // Ownership-loss tests intentionally make the old handle unreleasable.
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('acquireRunLock', () => {
  it('rejects a second owner for the same repository', () => {
    const root = repository();
    const first = acquire(root);
    try {
      expect(() => acquire(root)).toThrow(/already locked|another trainer/i);
    } finally {
      first.release();
    }
  });

  it.each([
    ['junction', 'junction' as const],
    ['symbolic link', 'dir' as const],
  ])('maps a repository %s to the same lock identity', (_label, type) => {
    const root = repository();
    const alias = join(temp(), 'repository-alias');
    symlinkSync(root, alias, type);
    const first = acquire(root);
    const bypass: { current: RunLock | null } = { current: null };
    try {
      expect(() => {
        bypass.current = acquire(alias);
      }).toThrow(/already locked|another trainer/i);
    } finally {
      bypass.current?.release();
      first.release();
    }
  });

  it.runIf(process.platform === 'win32')(
    'maps a real Win32 8.3 repository path to the same lock identity',
    ({ skip }) => {
      const root = realpathSync.native(repository());
      const short = windowsShortPath(root);
      if (short === null || normalized(short) === normalized(root)) {
        return skip('the test volume does not expose a distinct 8.3 short path');
      }
      expect(short).toMatch(/~/);

      const first = acquire(root);
      const bypass: { current: RunLock | null } = { current: null };
      try {
        expect(() => {
          bypass.current = acquire(short);
        }).toThrow(/already locked|another trainer/i);
      } finally {
        bypass.current?.release();
        first.release();
      }
    },
  );

  it('allows different repositories to be locked concurrently', () => {
    const first = acquire(repository());
    const second = acquire(repository());
    try {
      expect(first).not.toBe(second);
    } finally {
      second.release();
      first.release();
    }
  });

  it('does not unlink a replacement lock owned by another trainer', () => {
    const root = repository();
    const first = acquire(root);
    const firstPath = findOwnedLockPath(root);
    const orphanPath = join(temp(), 'original-owner.lock');
    renameSync(firstPath, orphanPath);
    const second = acquire(root);
    const replacementContents = readFileSync(firstPath);

    try {
      expect(() => first.release()).toThrow(/ownership|owner|replaced/i);
      expect(readFileSync(firstPath)).toEqual(replacementContents);
      expect(() => acquire(root)).toThrow(/already locked|another trainer/i);
    } finally {
      try {
        first.release();
      } catch {
        // The replaced path deliberately remains owned by `second`.
      }
      second.release();
    }
  });

  it('does not unlink its path after the owner nonce changes', () => {
    const root = repository();
    const lock = acquire(root);
    const lockPath = findOwnedLockPath(root);
    writeFileSync(lockPath, 'different-owner-nonce\n');

    expect(() => lock.release()).toThrow(/ownership|owner|nonce/i);
    expect(readFileSync(lockPath, 'utf8')).toBe('different-owner-nonce\n');
    rmSync(lockPath, { force: true });
  });

  it.runIf(process.platform === 'win32')(
    'retries unlink after a temporary Windows sharing violation',
    async () => {
      const root = repository();
      const lock = acquire(root);
      const lockPath = findOwnedLockPath(root);
      const controlDir = temp();
      const readyPath = join(controlDir, 'ready');
      const stopPath = join(controlDir, 'stop');
      const script = [
        "$stream = [IO.File]::Open($env:LOCK_PATH, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)",
        "[IO.File]::WriteAllText($env:READY_PATH, 'ready')",
        'while (-not [IO.File]::Exists($env:STOP_PATH)) { Start-Sleep -Milliseconds 10 }',
        '$stream.Dispose()',
      ].join('; ');
      const holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        env: {
          ...process.env,
          LOCK_PATH: lockPath,
          READY_PATH: readyPath,
          STOP_PATH: stopPath,
        },
        stdio: 'ignore',
      });

      try {
        await waitForFile(readyPath);
        expect(() => lock.release()).toThrow(/EPERM|EBUSY|permission|unlink/i);
      } finally {
        await stopHolder(holder, stopPath);
      }

      lock.release();
      const reacquired = acquire(root);
      reacquired.release();
    },
  );

  it('permits reacquisition after an idempotent release', () => {
    const root = repository();
    const first = acquire(root);
    first.release();
    first.release();

    const second = acquire(root);
    second.release();
  });
});
