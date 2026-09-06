import ts from 'typescript';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { checkFoliateTypes } from './foliate-checks';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(web, 'foliate-js/src');
const output = resolve(web, 'public/foliate-js');
const configPath = resolve(web, 'tsconfig.foliate.json');
const formatHost: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: name => name,
  getCurrentDirectory: () => web,
  getNewLine: () => '\n',
};
const report = (diagnostics: readonly ts.Diagnostic[]) => {
  if (diagnostics.length) process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost));
};
const check = process.argv.includes('--check');
const watch = process.argv.includes('--watch');

function build(program: ts.Program): boolean {
  const options = program.getCompilerOptions();
  if (!options.strict || options.noImplicitAny === false || options.strictNullChecks === false || options.noEmit) {
    console.error('Foliate requires strict typing and checked JavaScript emission.');
    return false;
  }
  const files = program.getSourceFiles().filter(file => {
    const path = relative(source, file.fileName);
    return !path.startsWith('..') && !path.startsWith('/');
  });
  const diagnostics = [...ts.getPreEmitDiagnostics(program), ...checkFoliateTypes(program, files)];
  report(diagnostics);
  if (diagnostics.length) return false;
  const generated = new Map<string, string>();
  const emitted = program.emit(undefined, (file, text) => generated.set(resolve(file), text));
  report(emitted.diagnostics);
  if (emitted.emitSkipped || emitted.diagnostics.length) return false;
  if (!generated.size || [...generated.keys()].some(file => relative(output, file).startsWith('..'))) {
    console.error('Refusing to update an empty or out-of-tree Foliate build.');
    return false;
  }
  let matches = true;
  for (const [file, text] of generated) {
    const prior = ts.sys.readFile(file);
    if (prior === text) continue;
    if (check) { console.error('Stale or missing generated module: ' + relative(web, file)); matches = false; }
    else { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); }
  }
  // Top-level JS is exclusively generated. vendor/ remains byte-for-byte untouched.
  for (const entry of readdirSync(output, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const file = resolve(output, entry.name);
    if (generated.has(file)) continue;
    if (check) { console.error('Orphaned generated module: ' + relative(web, file)); matches = false; }
    else unlinkSync(file);
  }
  if (matches) console.log('Foliate: strict types, no any, ' + generated.size + ' static modules' + (check ? ' verified.' : ' built.'));
  return matches;
}

if (watch) {
  const host = ts.createWatchCompilerHost(configPath, {}, ts.sys, ts.createSemanticDiagnosticsBuilderProgram,
    diagnostic => report([diagnostic]), diagnostic => report([diagnostic]));
  host.afterProgramCreate = builder => { build(builder.getProgram()); };
  ts.createWatchProgram(host);
} else {
  const config = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, 'utf8'));
  if (config.error) { report([config.error]); process.exit(1); }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web);
  report(parsed.errors);
  if (parsed.errors.length || !build(ts.createProgram(parsed.fileNames, parsed.options))) process.exit(1);
}
