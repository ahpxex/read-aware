import { expect, test } from 'bun:test';
import ts from 'typescript';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkFoliateTypes } from '../scripts/foliate-checks';

test('engine gate rejects contextual any, generic defaults, double casts and suppressions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'foliate-types-'));
  try {
    const path = join(directory, 'fixture.ts');
    writeFileSync(path, `
      export const bad: any = 1;
      export const map = new Map();
      export const promise = Promise.reject().catch(error => error);
      export const cast = 1 as unknown as string;
      // @ts-ignore
      export const suppressed: string = 1;
      export const good: unknown = JSON.parse('{}');
      export const typed = Promise.reject().catch((error: unknown): unknown => error);
    `);
    const program = ts.createProgram([path], { strict: true, target: ts.ScriptTarget.ESNext, types: [], skipLibCheck: true });
    const source = program.getSourceFile(path);
    if (!source) throw new Error('Missing type-check fixture');
    const diagnostics = checkFoliateTypes(program, [source]);
    const messages = diagnostics.map(item => String(item.messageText));
    expect(messages.some(message => message.includes('explicit any'))).toBe(true);
    expect(messages.some(message => message.includes('Map<any, any>'))).toBe(true);
    expect(messages.some(message => message.includes('inferred any: any'))).toBe(true);
    expect(messages.some(message => message.includes('double assertion'))).toBe(true);
    expect(messages.some(message => message.includes('suppressed'))).toBe(true);
    const names = diagnostics.map(item => source.text.slice(item.start ?? 0, (item.start ?? 0) + (item.length ?? 0)));
    expect(names).not.toContain('good');
    expect(names).not.toContain('typed');
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 30000);
