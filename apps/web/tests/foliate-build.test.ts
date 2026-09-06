import { expect, test } from 'bun:test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('clean Foliate check/build needs no tracked runtime and preserves vendor assets', () => {
  const web = fileURLToPath(new URL('..', import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), 'foliate-build-'));
  const source = join(directory, 'foliate-js/src');
  const output = join(directory, 'public/foliate-js');
  const scripts = join(directory, 'scripts');
  const run = (...args: string[]) => Bun.spawnSync([process.execPath, join(scripts, 'build-foliate.ts'), ...args], {
    cwd: directory,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const succeeds = (...args: string[]) => {
    const result = run(...args);
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
  };
  try {
    mkdirSync(source, { recursive: true });
    mkdirSync(scripts);
    symlinkSync(join(web, 'node_modules'), join(directory, 'node_modules'), 'dir');
    for (const name of ['build-foliate.ts', 'foliate-checks.ts'])
      copyFileSync(join(web, 'scripts', name), join(scripts, name));
    copyFileSync(join(web, 'tsconfig.foliate.json'), join(directory, 'tsconfig.foliate.json'));
    const path = join(source, 'fixture.ts');
    writeFileSync(path, 'export const value: number = 42;\n');

    succeeds('--check');
    expect(existsSync(output)).toBe(false);
    succeeds();
    const generated = join(output, 'fixture.js');
    const expected = readFileSync(generated, 'utf8');
    expect(expected).toContain('export const value = 42;');

    mkdirSync(join(output, 'vendor'));
    const vendor = join(output, 'vendor', 'library.js');
    const license = join(output, 'LICENSE');
    writeFileSync(vendor, 'upstream distribution');
    writeFileSync(license, 'upstream license');
    writeFileSync(join(output, 'orphan.js'), 'stale generated output');
    writeFileSync(generated, 'stale runtime');
    succeeds('--check');
    expect(readFileSync(generated, 'utf8')).toBe('stale runtime');
    succeeds();
    expect(readFileSync(generated, 'utf8')).toBe(expected);
    expect(readdirSync(output).sort()).toEqual(['LICENSE', 'fixture.js', 'vendor']);
    expect(readFileSync(vendor, 'utf8')).toBe('upstream distribution');
    expect(readFileSync(license, 'utf8')).toBe('upstream license');

    writeFileSync(path, 'export const value: any = 42;\n');
    for (const args of [['--check'], []]) {
      const result = run(...args);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain('Engine contracts must not use explicit any');
    }
    expect(readFileSync(generated, 'utf8')).toBe(expected);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
