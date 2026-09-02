#!/usr/bin/env node
// Transitive-cascade 7-day check. Diffs package-lock.json against a git ref
// (default HEAD), then for EVERY package whose resolved version changed, fetches
// its publish date and flags any version younger than 7 days.
//
// This catches the trap where bumping one hub package (e.g. `next`) silently
// re-resolves transitives — including shipped native modules — up to a <7-day
// batch release that no direct `npm install` named.
//
// Usage:   node .claude/skills/dependency-versioning/scripts/age-scan.cjs [gitRef]
// Example: node .claude/skills/dependency-versioning/scripts/age-scan.cjs HEAD
// Exit:    0 if no <7-day change, 1 if any version <7 days old.
const fs = require('fs');
const { execFileSync } = require('child_process');
const root = process.cwd();
const ref = process.argv[2] || 'HEAD';

const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // published on/before this = safe

function lockPackages(json) { try { return JSON.parse(json).packages || {}; } catch { return {}; } }
const cur = lockPackages(fs.readFileSync(root + '/package-lock.json', 'utf8'));
let base = {};
try { base = lockPackages(execFileSync('git', ['show', `${ref}:package-lock.json`], { cwd: root, maxBuffer: 1e9 }).toString()); }
catch { console.error(`could not read package-lock.json at ${ref}`); process.exit(2); }

const nameOf = k => k.replace(/.*node_modules\//, '');
const keys = new Set([...Object.keys(cur), ...Object.keys(base)]);
const changed = {}; // name -> newVersion
for (const k of keys) {
  if (!k.includes('node_modules/')) continue;
  const a = base[k] && base[k].version, b = cur[k] && cur[k].version;
  if (b && a !== b) changed[nameOf(k)] = b;
}
const entries = Object.entries(changed);
if (!entries.length) { console.log('no resolved-version changes vs ' + ref); process.exit(0); }

console.log(`checking publish dates of ${entries.length} changed packages (safe = on/before ${cutoff.toISOString().slice(0, 10)})\n`);
let violations = 0;
for (const [name, ver] of entries) {
  let date = '?';
  try {
    const t = JSON.parse(execFileSync('npm', ['view', name, 'time', '--json'], { maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
    date = (t[ver] || '').slice(0, 10);
  } catch {}
  const young = date && date !== '?' && new Date(date) > cutoff;
  if (young) violations++;
  console.log(`  ${name}@${ver}  ${date || '?'}  ${young ? '<<< <7 DAYS — pin to newest-safe via overrides' : 'safe'}`);
}
console.log(`\n<7-day violations: ${violations}`);
process.exit(violations ? 1 : 0);
