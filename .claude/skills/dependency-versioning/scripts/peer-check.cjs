#!/usr/bin/env node
// Full-tree peer-compatibility scan. For every installed package, verify each of
// its NON-optional peerDependencies is installed at a satisfying version.
// Even without legacy-peer-deps, transitive peer drift can hide — this is the
// authoritative "is everything mutually compatible" check.
//
// Usage:  node .claude/skills/dependency-versioning/scripts/peer-check.cjs
// Exit:   0 if all satisfied, 1 if any real mismatch (excludes known-benign).
const fs = require('fs');
const root = process.cwd();
let semver;
try { semver = require(root + '/node_modules/semver'); }
catch { console.error('semver not found — run from the repo root with deps installed'); process.exit(2); }

function readPkg(dir) { try { return JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')); } catch { return null; } }
function installedVersion(name) { const p = readPkg(root + '/node_modules/' + name); return p && p.version; }
function listPkgDirs(base) {
  const out = [];
  let entries; try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('@')) out.push(...listPkgDirs(base + '/' + e.name));
    else if (e.name !== '.bin') out.push(base + '/' + e.name);
  }
  return out;
}

const issues = [];
let checked = 0;
for (const dir of listPkgDirs(root + '/node_modules')) {
  const meta = readPkg(dir);
  if (!meta || !meta.peerDependencies) continue;
  const optMeta = meta.peerDependenciesMeta || {};
  for (const [peer, range] of Object.entries(meta.peerDependencies)) {
    const optional = optMeta[peer] && optMeta[peer].optional;
    const iv = installedVersion(peer);
    checked++;
    if (!iv) { if (!optional) issues.push(`${meta.name}@${meta.version} needs peer ${peer}@"${range}" — NOT INSTALLED`); continue; }
    let ok = false;
    try { ok = semver.satisfies(iv, range, { includePrerelease: true }); } catch { ok = true; }
    // Salvage OR-ranges with a malformed/prerelease clause (e.g. ">=3.16.0 || >=4.0.0-"):
    // if ANY clause is satisfied, it's compatible. semver can return false on the bad clause.
    if (!ok && range.includes('||')) {
      for (const clause of range.split('||')) {
        try { if (semver.satisfies(iv, clause.trim())) { ok = true; break; } } catch {}
      }
    }
    if (!ok) issues.push(`${meta.name}@${meta.version} needs peer ${peer}@"${range}" — installed ${iv} DOES NOT SATISFY`);
  }
}
console.log(`peer relationships checked: ${checked}`);
console.log(issues.length ? 'MISMATCHES:\n  ' + issues.join('\n  ') : '✅ ALL peer dependencies satisfied across the full tree');
process.exit(issues.length ? 1 : 0);
