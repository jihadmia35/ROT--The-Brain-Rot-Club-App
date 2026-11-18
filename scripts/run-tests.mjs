import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const ROOT = process.cwd();
const moduleCache = new Map();

function resolveTsFile(fromDir, specifier) {
  const base = path.resolve(fromDir, specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return c;
    }
  }
  throw new Error(`Cannot resolve module '${specifier}' from '${fromDir}'`);
}

function loadTsModule(filePath) {
  const normalized = path.normalize(filePath);
  if (moduleCache.has(normalized)) {
    return moduleCache.get(normalized).exports;
  }

  const source = fs.readFileSync(normalized, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: normalized,
  });

  const mod = { exports: {} };
  moduleCache.set(normalized, mod);

  const customRequire = (specifier) => {
    if (specifier.startsWith('.')) {
      const target = resolveTsFile(path.dirname(normalized), specifier);
      return loadTsModule(target);
    }
    throw new Error(`External module '${specifier}' is not supported in pure domain unit tests`);
  };

  const wrapper = vm.runInThisContext(
    `(function(exports, require, module, __filename, __dirname) { ${transpiled.outputText}\n})`,
    { filename: normalized }
  );
  wrapper(mod.exports, customRequire, mod, normalized, path.dirname(normalized));
  return mod.exports;
}

async function main() {
  const testDir = path.join(ROOT, 'src', 'utils', '__tests__');
  const harnessFile = path.join(ROOT, 'src', 'utils', 'testHarness.ts');
  const testFiles = fs
    .readdirSync(testDir)
    .filter((name) => name.endsWith('.test.ts'))
    .sort()
    .map((name) => path.join(testDir, name));

  for (const testFile of testFiles) {
    loadTsModule(testFile);
  }
  const harness = loadTsModule(harnessFile);
  const tests = harness.getRegisteredTests();

  let passed = 0;
  let failed = 0;

  for (const t of tests) {
    try {
      await t.fn();
      console.log(`✔ ${t.name}`);
      passed++;
    } catch (err) {
      console.error(`✖ ${t.name}`);
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`\nTests summary: ${passed} passed, ${failed} failed (${tests.length} total).`);
  if (failed > 0) {
    process.exit(1);
  }
}

main();
