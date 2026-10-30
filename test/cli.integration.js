'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const cli = path.resolve(__dirname, '../bin/cli.js');
let passed = 0;
function scenario(name, fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-commit-test-'));
  const env = { ...process.env, CLI_LITERAL: 'EXPANDED_BY_SHELL', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(cwd, 'empty.gitconfig') };
  fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
  const git = (...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8' });
  try {
    git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'commit.gpgsign', 'false');
    const hooks = path.join(cwd, 'hooks'); fs.mkdirSync(hooks); git('config', 'core.hooksPath', hooks.replace(/\\/g, '/'));
    git('commit', '--allow-empty', '-qm', 'fixture seed');
    const head = git('rev-parse', 'HEAD');
    const stage = (file = 'example.js') => { fs.writeFileSync(path.join(cwd, file), 'const value = 1;\n'); git('add', '--', file); return file; };
    fn({ run, git, head, stage, hooks }); passed++; console.log(`  ✓ ${name}`);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}
scenario('JSON dry-run is parseable and preserves staged filenames', ({ run, stage, git, head }) => {
  const file = stage('研究 notes.js'); const r = run('--json', '--dry-run'); assert.strictEqual(r.status, 0, r.stderr); assert.deepStrictEqual(JSON.parse(r.stdout).files, [file]); assert.strictEqual(git('rev-parse', 'HEAD'), head);
});
scenario('empty index produces a JSON object', ({ run }) => {
  const r = run('--json'); assert.strictEqual(r.status, 0); assert.deepStrictEqual(JSON.parse(r.stdout).files, []);
});
scenario('hooks run by default and no-verify actually bypasses them', ({ run, stage, hooks, git, head }) => {
  stage(); const hook = path.join(hooks, 'pre-commit'); fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const blocked = run('--yes', '--message', 'fix: blocked fixture'); assert.notStrictEqual(blocked.status, 0); assert.strictEqual(git('rev-parse', 'HEAD'), head);
  const allowed = run('--yes', '--no-verify', '--message', 'fix: bypass fixture'); assert.strictEqual(allowed.status, 0, allowed.stderr); assert.strictEqual(git('log', '-1', '--format=%s'), 'fix: bypass fixture');
});
scenario('commit message contents remain literal', ({ run, stage, git }) => {
  stage(); const message = 'fix: preserve "quotes", %CLI_LITERAL% and $(printf literal)'; const r = run('--yes', '--message', message); assert.strictEqual(r.status, 0, r.stderr); assert.strictEqual(git('log', '-1', '--format=%s'), message);
});
console.log(`${passed} CLI integration scenarios passed`);
