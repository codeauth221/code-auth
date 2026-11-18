/** CodeAuthentic dashboard patch verification: syntax and structural safety checks.
 * Run with Node from an extracted patch folder: node .\VERIFY_DASHBOARD_PERFORMANCE.mjs <project-root>
 * TypeScript is resolved from the target project's node_modules; no internet needed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(process.argv[2] ?? '.');
const requireProject = createRequire(join(root, 'package.json'));
const ts = requireProject('typescript');
const read = (name) => readFileSync(join(root, name), 'utf8');
const app = read('src/App.tsx');
const dashboard = read('src/components/InstructorDashboard.tsx');

for (const [path, source] of [['src/App.tsx',app], ['src/components/InstructorDashboard.tsx',dashboard]]) {
  const output = ts.transpileModule(source, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  });
  const errors = (output.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${path}: ${errors.map(e => ts.flattenDiagnosticMessageText(e.messageText, '\n')).join('; ')}`);
}
console.log('[PASS] Both React modules parse and transpile');
assert.match(app, /subscribeToLobbyUpdates\([\s\S]*?authToken, \[observedLobbyKey\]/);
assert.doesNotMatch(app, /lobbyIdsKey\.split\(','\)/);
console.log('[PASS] At most one selected-lobby socket subscription');
assert.match(app, /socketConnected \? 30_000 : 15_000/);
assert.match(app, /socketConnected \? 90_000 : 30_000/);
assert.doesNotMatch(app, /hasRecentUnfinishedAnalysis \? 5_000/);
console.log('[PASS] Adaptive fallback polling is less aggressive');
assert.match(app, /if \(!document\.hidden\) void refreshDashboardData\(\)/);
assert.match(app, /document\.addEventListener\('visibilitychange'/);
assert.match(app, /currentView !== 'instructor'/);
console.log('[PASS] Hidden and student views avoid full dashboard polling');
assert.match(app, /onActiveLobbyChange=\{setObservedLobbyId\}/);
assert.match(dashboard, /onActiveLobbyChange\(activeLobby\?\.id \?\? null\)/);
assert.match(dashboard, /void onRefresh\(\)/);
console.log('[PASS] Selection propagates and manual lobby switching refreshes');
assert.match(dashboard, /const AnalysisTiming = React\.memo/);
assert.doesNotMatch(dashboard, /setClockNowMs/);
assert.match(dashboard, /setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 1000\)/);
assert.match(dashboard, /Worked for/);
console.log('[PASS] Elapsed timers update in isolated components; saved durations preserved');
console.log('PASS: Dashboard performance patch structural checks completed.');
