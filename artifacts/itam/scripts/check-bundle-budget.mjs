#!/usr/bin/env node
/**
 * Bundle budget gate (Phase 3).
 *
 * Fails the build if the production bundle grows past agreed limits, so
 * the "one giant download" problem cannot creep back in as features are
 * added. Run after `vite build`:
 *
 *   node scripts/check-bundle-budget.mjs
 *
 * Budgets are gzip sizes (what browsers actually download):
 *  - entry chunk:       the JS every visitor downloads at startup
 *  - any single chunk:  no individual lazy chunk may balloon either
 *  - total JS:          the whole app (all routes combined)
 *
 * If a budget is intentionally raised, update the numbers here in the
 * same commit that causes the growth, with the reason in the message.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const assetsDir = join(distDir, "assets");

const BUDGETS = {
  entryGzipKb: 260,
  chunkGzipKb: 300,
  totalGzipKb: 950,
};

const kb = (bytes) => bytes / 1024;

let entryFile = null;
try {
  const html = readFileSync(join(distDir, "index.html"), "utf8");
  const match = html.match(/src="[^"]*\/assets\/([^"]+\.js)"/);
  if (match) entryFile = match[1];
} catch {
  console.error("✗ dist/index.html not found — run the production build first.");
  process.exit(1);
}

const chunks = [];
let totalGzip = 0;
for (const file of readdirSync(assetsDir)) {
  if (!file.endsWith(".js")) continue;
  const raw = readFileSync(join(assetsDir, file));
  const gzipKb = kb(gzipSync(raw, { level: 9 }).length);
  chunks.push({ file, gzipKb, rawKb: kb(statSync(join(assetsDir, file)).size) });
  totalGzip += gzipKb;
}
chunks.sort((a, b) => b.gzipKb - a.gzipKb);

const entry = chunks.find((c) => c.file === entryFile);
const failures = [];

console.log("Bundle budget check");
console.log("───────────────────");
if (entry) {
  console.log(`Entry chunk  ${entry.file}: ${entry.gzipKb.toFixed(1)} kB gzip (budget ${BUDGETS.entryGzipKb} kB)`);
  if (entry.gzipKb > BUDGETS.entryGzipKb) {
    failures.push(`entry chunk is ${entry.gzipKb.toFixed(1)} kB gzip, over the ${BUDGETS.entryGzipKb} kB budget`);
  }
} else {
  failures.push("could not identify the entry chunk from dist/index.html");
}
for (const c of chunks.slice(0, 5)) {
  console.log(`Chunk        ${c.file}: ${c.gzipKb.toFixed(1)} kB gzip`);
  if (c.gzipKb > BUDGETS.chunkGzipKb) {
    failures.push(`chunk ${c.file} is ${c.gzipKb.toFixed(1)} kB gzip, over the ${BUDGETS.chunkGzipKb} kB per-chunk budget`);
  }
}
console.log(`Total JS     ${chunks.length} chunks: ${totalGzip.toFixed(1)} kB gzip (budget ${BUDGETS.totalGzipKb} kB)`);
if (totalGzip > BUDGETS.totalGzipKb) {
  failures.push(`total JS is ${totalGzip.toFixed(1)} kB gzip, over the ${BUDGETS.totalGzipKb} kB budget`);
}

if (failures.length) {
  console.error("\n✗ Bundle budget exceeded:");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("  Split the offending code (route/dynamic import) or raise the budget in scripts/check-bundle-budget.mjs with justification.");
  process.exit(1);
}
console.log("\n✓ Bundle within budget");
