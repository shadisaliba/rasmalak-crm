#!/usr/bin/env node
// Fails when a message id used in src/ is missing from either locale, or when the two
// locales define different key sets. Message files are loaded through the TypeScript
// compiler so the check sees exactly what the app's flatten() produces.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const LOCALES = ['ar', 'en'];

function loadDomain(file) {
  const source = readFileSync(file, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, { module: mod, exports: mod.exports });
  return mod.exports.default ?? mod.exports;
}

function loadLocale(locale) {
  const dir = join(SRC, 'messages', locale);
  const index = readFileSync(join(dir, 'index.ts'), 'utf8');
  const keys = new Set();
  const domains = [];
  // Mirror index.ts: only domains it flattens are visible to the app.
  for (const [, varName, prefix] of index.matchAll(/flatten\((\w+),\s*'([\w-]+)'\)/g)) {
    const importMatch = index.match(new RegExp(`import\\s+${varName}\\s+from\\s+'\\./([\\w-]+)'`));
    if (!importMatch) throw new Error(`${locale}/index.ts flattens ${varName} but does not import it`);
    const messages = loadDomain(join(dir, `${importMatch[1]}.ts`));
    domains.push(prefix);
    for (const key of Object.keys(messages)) keys.add(`${prefix}.${key}`);
  }
  return { keys, domains };
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'messages' && dir === SRC) continue;
      walk(path, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

const locales = Object.fromEntries(LOCALES.map(l => [l, loadLocale(l)]));
const domains = new Set(LOCALES.flatMap(l => locales[l].domains));
const domainPattern = [...domains].map(d => d.replace(/[-]/g, '\\-')).join('|');
const idLiteral = `['"\`]((?:${domainPattern})\\.[\\w.-]+)['"\`]`;
const usagePatterns = [
  new RegExp(`\\bid\\s*[:=]\\s*\\{?\\s*${idLiteral}`, 'g'),        // formatMessage({ id }) and <FormattedMessage id="…" />
  new RegExp(`\\bt\\(\\s*${idLiteral}`, 'g'),                       // t('domain.key', …)
  new RegExp(`\\b\\w*(?:Key|Id)\\s*:\\s*${idLiteral}`, 'g'),        // labelKey: 'domain.key' in config objects
];

const used = new Map();
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  for (const pattern of usagePatterns) {
    for (const match of text.matchAll(pattern)) {
      const id = match[1];
      if (id.endsWith('.')) continue; // template prefix such as `crm.stage.${x}`
      const line = text.slice(0, match.index).split('\n').length;
      if (!used.has(id)) used.set(id, `${relative(ROOT, file)}:${line}`);
    }
  }
}

const problems = [];
for (const [id, where] of [...used].sort()) {
  const missing = LOCALES.filter(l => !locales[l].keys.has(id));
  if (missing.length) problems.push(`missing in ${missing.join(', ')}: ${id}  (${where})`);
}
for (const [a, b] of [['ar', 'en'], ['en', 'ar']]) {
  for (const key of [...locales[a].keys].sort()) {
    if (!locales[b].keys.has(key)) problems.push(`defined in ${a} only: ${key}`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\ncheck-i18n: ${problems.length} problem(s); ${used.size} ids used in ${basename(SRC)}/`);
  process.exit(1);
}
console.log(`check-i18n: ok (${used.size} ids used, ${locales.en.keys.size} keys per locale)`);
