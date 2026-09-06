import type { D2FileSystem } from './d2Evidence';

export interface MemoryFsCall {
  readonly op: 'readFile' | 'writeFileSync' | 'fsyncFile' | 'rename' | 'appendLine'
  | 'readdir' | 'mkdirp' | 'exists' | 'openExclusive' | 'unlink';
  readonly path: string;
}

export interface MemoryFs extends D2FileSystem {
  readonly calls: readonly MemoryFsCall[];
  readonly files: ReadonlyMap<string, string>;
  snapshot(): Record<string, string>;
}

/**
 * In-memory `D2FileSystem` for evidence tests.  `failOn` injects a throw at a
 * chosen operation so a process death can be simulated between the temp write
 * and the rename, which is the only window in which a partially written
 * receipt could otherwise appear.
 */
export function makeMemoryFs(options: {
  readonly seed?: Readonly<Record<string, string>>;
  readonly failOn?: MemoryFsCall['op'];
  readonly failOnPathSuffix?: string;
} = {}): MemoryFs {
  const files = new Map<string, string>(Object.entries(options.seed ?? {}));
  const dirs = new Set<string>();
  const calls: MemoryFsCall[] = [];

  const record = (op: MemoryFsCall['op'], path: string): void => {
    calls.push({ op, path });
    if (options.failOn === op
      && (options.failOnPathSuffix === undefined || path.endsWith(options.failOnPathSuffix))) {
      throw new Error(`injected failure: ${op} ${path}`);
    }
  };

  return {
    calls,
    files,
    snapshot: () => Object.fromEntries(files),
    readFile(path) {
      record('readFile', path);
      return files.get(path) ?? null;
    },
    writeFileSync(path, data) {
      record('writeFileSync', path);
      files.set(path, data);
    },
    fsyncFile(path) {
      record('fsyncFile', path);
    },
    rename(from, to) {
      record('rename', from);
      const data = files.get(from);
      if (data === undefined) throw new Error(`rename of missing file: ${from}`);
      files.delete(from);
      files.set(to, data);
    },
    appendLine(path, line) {
      record('appendLine', path);
      files.set(path, (files.get(path) ?? '') + line + '\n');
    },
    readdir(path) {
      record('readdir', path);
      const prefix = path.endsWith('/') ? path : `${path}/`;
      return [...files.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length))
        .filter((rest) => !rest.includes('/'))
        .sort();
    },
    mkdirp(path) {
      record('mkdirp', path);
      dirs.add(path);
    },
    exists(path) {
      record('exists', path);
      return files.has(path) || dirs.has(path);
    },
    openExclusive(path, data) {
      record('openExclusive', path);
      if (files.has(path)) return false;
      files.set(path, data);
      return true;
    },
    unlink(path) {
      record('unlink', path);
      files.delete(path);
    },
  };
}
