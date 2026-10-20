// The last updated date in spec/analysis.md and spec/cli.md: the CLI's `updated` line, with GitHub
// answering from recordings, and a local directory's dates from git, in repositories made here.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { run } from '../src/commands.ts';
import type { Fetch } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { nodeContext } from '../src/node.ts';
import { CLI } from './helpers.ts';
import { COMMIT, record } from './web-helpers.ts';

const SKILL = (name: string) => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n# ${name}\n`;

/** `skill-atlas scan <input>`, as the CLI runs it without a token, with GitHub answering from `recording`. */
async function atlas(input: string, recording: Recording = {}) {
  const requests: string[] = [];
  const answer = replay(recording);
  const fetch: Fetch = (url, init) => {
    requests.push(url);
    return answer(url, init);
  };
  const stdout: string[] = [];
  const stderr: string[] = [];
  const context = nodeContext({ fetch, env: {}, print: (text) => stdout.push(text), error: (text) => stderr.push(text) });
  const code = await run(['scan', input], context);
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n'), requests };
}

const blob = (id: string, path: string) => `  https://github.com/${id}/blob/${COMMIT}/${path}`;

test('GitHub: `updated <date>` under the link, the last commit that changed the skill’s directory, up to the scanned commit', async () => {
  const recording = record('Acme/tools', {
    '.claude/skills/build/SKILL.md': SKILL('build'),
    '.claude/skills/build/scripts/run.sh': 'echo\n',
    '.claude/skills/deploy/SKILL.md': SKILL('deploy'),
  }, { '.claude/skills/build': '2026-09-01T08:00:00Z', '.claude/skills/deploy': '2025-12-31T12:00:00Z' });
  const scanned = await atlas('https://github.com/Acme/tools', recording);
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.equal(scanned.stderr, '');
  assert.equal(
    scanned.stdout,
    [
      'Acme/tools · 2 skills',
      'build — The build skill.',
      blob('Acme/tools', '.claude/skills/build/SKILL.md'),
      '  updated 2026-09-01',
      'deploy — The deploy skill.',
      blob('Acme/tools', '.claude/skills/deploy/SKILL.md'),
      '  updated 2025-12-31',
    ].join('\n'),
  );
  // One request per skill: its directory, at the scanned commit.
  const dates = scanned.requests.filter((url) => url.includes('/commits?'));
  assert.deepEqual(dates.sort(), [
    `https://api.github.com/repos/Acme/tools/commits?sha=${COMMIT}&path=.claude/skills/build&per_page=1`,
    `https://api.github.com/repos/Acme/tools/commits?sha=${COMMIT}&path=.claude/skills/deploy&per_page=1`,
  ]);
});

test('the date in UTC, from the committer’s date', async () => {
  const recording = record('Acme/late', { '.claude/skills/late/SKILL.md': SKILL('late') }, { '.claude/skills/late': '2026-10-14T23:30:00-02:00' });
  const scanned = await atlas('github.com/Acme/late', recording);
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.match(scanned.stdout, /\n {2}updated 2026-10-15$/);
});

test('copies: the date of the path listed', async () => {
  const recording = record('Acme/copies', {
    '.claude/skills/style/SKILL.md': SKILL('style'),
    '.github/skills/style/SKILL.md': SKILL('style'),
  }, { '.claude/skills/style': '2026-03-03T10:00:00Z', '.github/skills/style': '2026-04-04T10:00:00Z' });
  const scanned = await atlas('github.com/Acme/copies', recording);
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.equal(
    scanned.stdout,
    [
      'Acme/copies · 1 skill',
      'style — The style skill.',
      blob('Acme/copies', '.claude/skills/style/SKILL.md'),
      '  updated 2026-03-03',
      '  also in .github/skills/style/SKILL.md',
    ].join('\n'),
  );
});

test('no commit for the directory → no `updated` line, no warning', async () => {
  const recording = record('Acme/none', { '.claude/skills/none/SKILL.md': SKILL('none') }, { '.claude/skills/none': null });
  const scanned = await atlas('github.com/Acme/none', recording);
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.equal(scanned.stderr, '');
  assert.doesNotMatch(scanned.stdout, /updated/);
});

test('the request fails, the rate limit too → the skills without the date, one warning per reason, the scan goes on', async () => {
  const files = {
    '.claude/skills/a/SKILL.md': SKILL('a'),
    '.claude/skills/b/SKILL.md': SKILL('b'),
    '.claude/skills/c/SKILL.md': SKILL('c'),
    '.claude/skills/d/SKILL.md': SKILL('d'),
  };
  const commits = (directory: string) => `https://api.github.com/repos/Acme/failing/commits?sha=${COMMIT}&path=${directory}&per_page=1`;
  const limited = { status: 403, body: { message: 'API rate limit exceeded for 192.0.2.1.' } };
  const recording: Recording = {
    ...record('Acme/failing', files),
    [commits('.claude/skills/a')]: limited,
    [commits('.claude/skills/b')]: limited,
    [commits('.claude/skills/c')]: { status: 500, body: { message: 'Server Error' } },
  };
  const scanned = await atlas('github.com/Acme/failing', recording);
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.equal(
    scanned.stdout,
    [
      'Acme/failing · 4 skills',
      'a — The a skill.',
      blob('Acme/failing', '.claude/skills/a/SKILL.md'),
      'b — The b skill.',
      blob('Acme/failing', '.claude/skills/b/SKILL.md'),
      'c — The c skill.',
      blob('Acme/failing', '.claude/skills/c/SKILL.md'),
      'd — The d skill.',
      blob('Acme/failing', '.claude/skills/d/SKILL.md'),
      '  updated 2026-10-14',
    ].join('\n'),
  );
  assert.equal(
    scanned.stderr,
    [
      'warning: last updated not known for 2 skills: GitHub rate limit reached; set GITHUB_TOKEN',
      `warning: last updated not known for 1 skill: GitHub answered 500 for ${commits('.claude/skills/c')}: Server Error`,
    ].join('\n'),
  );
});

/** A new git repository in a temporary directory; `commit` commits everything at `date`. */
function repository(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'skill-atlas-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (args: string[], date?: string) =>
    execFileSync('git', args, {
      cwd: root,
      env: { ...process.env, GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: date ?? '2020-01-01T00:00:00Z' },
    });
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  return {
    root,
    write(path: string, text: string) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), text);
    },
    commit(date: string) {
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'change'], date);
    },
  };
}

test('a local directory: the last commit from git that changed the skill’s directory, uncommitted changes not counted', async (t) => {
  const repo = repository(t);
  repo.write('.claude/skills/build/SKILL.md', SKILL('build'));
  repo.write('.claude/skills/deploy/SKILL.md', SKILL('deploy'));
  repo.commit('2026-01-02T10:00:00Z');
  // A file next to the SKILL.md changes the skill; the committer's date, in UTC.
  repo.write('.claude/skills/build/scripts/run.sh', 'echo\n');
  repo.commit('2026-05-06T23:30:00-02:00');
  // Not committed: not counted.
  repo.write('.claude/skills/deploy/SKILL.md', SKILL('deploy').replace('The deploy skill.', 'Deploys.'));

  const scanned = await atlas(repo.root);
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.equal(scanned.stderr, '');
  const lines = scanned.stdout.split('\n');
  assert.deepEqual(lines.filter((line) => !line.startsWith('  file://')), [
    `${lines[0].split(' ')[0]} · 2 skills`,
    'build — The build skill.',
    '  updated 2026-05-07',
    'deploy — Deploys.',
    '  updated 2026-01-02',
  ]);
  assert.deepEqual(scanned.requests, []);
});

test('a local directory: never committed, or not in git → no date, no warning', async (t) => {
  const repo = repository(t);
  repo.write('.claude/skills/old/SKILL.md', SKILL('old'));
  repo.commit('2026-01-02T10:00:00Z');
  repo.write('.claude/skills/new/SKILL.md', SKILL('new'));
  const inGit = await atlas(repo.root);
  assert.equal(inGit.code, 0, inGit.stderr);
  assert.equal(inGit.stderr, '');
  assert.deepEqual(inGit.stdout.split('\n').filter((line) => line.startsWith('  updated')), ['  updated 2026-01-02']);
  assert.match(inGit.stdout, /^new — The new skill\.\n {2}file:\S+\nold/m);

  const plain = mkdtempSync(join(tmpdir(), 'skill-atlas-plain-'));
  t.after(() => rmSync(plain, { recursive: true, force: true }));
  mkdirSync(join(plain, '.claude/skills/plain'), { recursive: true });
  writeFileSync(join(plain, '.claude/skills/plain/SKILL.md'), SKILL('plain'));
  // Outside any repository, even when the temporary directory is in one.
  const scanned = spawnSync(process.execPath, [CLI, 'scan', plain], { encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() } });
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.equal(scanned.stderr, '');
  assert.doesNotMatch(scanned.stdout, /updated/);
  assert.match(scanned.stdout, /^plain-\w+ · 1 skill\nplain — The plain skill\.\n {2}file:\S+\n$/);
});
