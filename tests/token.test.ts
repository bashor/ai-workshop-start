// The --token option in spec/cli.md: the token every GitHub API request carries, checked on the
// requests the CLI makes, with GitHub answering from recordings.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { run } from '../src/commands.ts';
import type { Fetch } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { nodeContext } from '../src/node.ts';
import { atlas, CLI, EXAMPLE_COMMIT, EXAMPLE_UPDATED, FIXTURE, lastCommit } from './helpers.ts';

const SKILL = '.claude/skills/commits/SKILL.md';

/** JetBrains/example, with and without a token: through code search and through the tree. */
const EXAMPLE: Recording = {
  'https://api.github.com/repos/JetBrains/example': { status: 200, body: { full_name: 'JetBrains/example', default_branch: 'main' } },
  'https://api.github.com/repos/JetBrains/example/commits/main': { status: 200, body: { sha: EXAMPLE_COMMIT } },
  'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/example&per_page=100&page=1': {
    status: 200,
    body: { total_count: 1, items: [{ path: SKILL }] },
  },
  [`https://api.github.com/repos/JetBrains/example/git/trees/${EXAMPLE_COMMIT}?recursive=1`]: {
    status: 200,
    body: { truncated: false, tree: [{ path: SKILL, mode: '100644', type: 'blob', sha: 'a' }] },
  },
  [`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/${SKILL}`]: {
    status: 200,
    body: '---\nname: commits\ndescription: Write commit messages the way this repository does. Use for every commit.\n---\n# Commits\n',
  },
  ...lastCommit('JetBrains/example', EXAMPLE_COMMIT, '.claude/skills/commits', EXAMPLE_UPDATED),
};

const OUTPUT = [
  'JetBrains/example · 1 skill',
  'commits — Write commit messages the way this repository does.',
  `  https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/${SKILL}`,
  '  updated 2026-10-14',
].join('\n');

/** `skill-atlas <args>` with the given environment; every request with its Authorization header. */
async function atlasWith(args: string[], env: Record<string, string | undefined> = {}, recording = EXAMPLE) {
  const requests: { url: string; authorization: string | undefined }[] = [];
  const answer = replay(recording);
  const fetch: Fetch = (url, init) => {
    requests.push({ url, authorization: init?.headers?.Authorization });
    return answer(url, init);
  };
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, nodeContext({ fetch, env, print: (text) => stdout.push(text), error: (text) => stderr.push(text) }));
  const api = requests.filter((request) => request.url.startsWith('https://api.github.com/'));
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n'), requests, api };
}

const usage = (await atlas(['scan'])).stderr;

for (const [form, args] of [
  ['--token <token>', ['scan', '--token', 'secret', 'github.com/JetBrains/example']],
  ['--token=<token>', ['scan', '--token=secret', 'github.com/JetBrains/example']],
  ['after the URL', ['scan', 'github.com/JetBrains/example', '--token', 'secret']],
] as const) {
  test(`${form}: every GitHub API request carries the token`, async () => {
    const scanned = await atlasWith([...args]);
    assert.equal(scanned.code, 0, scanned.stderr);
    assert.equal(scanned.stdout, OUTPUT);
    // With a token, skills are found through code search.
    assert.deepEqual(
      scanned.api.map((request) => request.url),
      [
        'https://api.github.com/repos/JetBrains/example',
        'https://api.github.com/repos/JetBrains/example/commits/main',
        'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/example&per_page=100&page=1',
        // The skill's last update.
        `https://api.github.com/repos/JetBrains/example/commits?sha=${EXAMPLE_COMMIT}&path=.claude/skills/commits&per_page=1`,
      ],
    );
    for (const request of scanned.api) assert.equal(request.authorization, 'Bearer secret', request.url);
  });
}

test('--token is used instead of GITHUB_TOKEN', async () => {
  const scanned = await atlasWith(['scan', '--token', 'option', 'github.com/JetBrains/example'], { GITHUB_TOKEN: 'environment' });
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.ok(scanned.api.length > 0);
  for (const request of scanned.api) assert.equal(request.authorization, 'Bearer option', request.url);
});

test('no --token → GITHUB_TOKEN, if set', async () => {
  const scanned = await atlasWith(['scan', 'github.com/JetBrains/example'], { GITHUB_TOKEN: 'environment' });
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.ok(scanned.api.length > 0);
  for (const request of scanned.api) assert.equal(request.authorization, 'Bearer environment', request.url);
});

test('neither --token nor GITHUB_TOKEN → no token, the skills found through the tree', async () => {
  for (const env of [{}, { GITHUB_TOKEN: '' }]) {
    const scanned = await atlasWith(['scan', 'github.com/JetBrains/example'], env);
    assert.equal(scanned.code, 0, scanned.stderr);
    assert.equal(scanned.stdout, OUTPUT);
    assert.ok(scanned.api.some((request) => request.url.includes('/git/trees/')));
    for (const request of scanned.requests) assert.equal(request.authorization, undefined, request.url);
  }
});

test('--token with no value, an empty one, or twice → the usage, exit code 1, no request', async () => {
  for (const args of [
    ['scan', 'github.com/JetBrains/example', '--token'],
    ['scan', '--token', '', 'github.com/JetBrains/example'],
    ['scan', '--token=', 'github.com/JetBrains/example'],
    ['scan', '--token', 'a', '--token', 'b', 'github.com/JetBrains/example'],
    ['scan', '--token', 'a', '--token=b', 'github.com/JetBrains/example'],
  ]) {
    const scanned = await atlasWith(args, { GITHUB_TOKEN: 'environment' });
    assert.equal(scanned.code, 1, args.join(' '));
    assert.equal(scanned.stdout, '');
    assert.equal(scanned.stderr, usage);
    assert.deepEqual(scanned.requests, []);
  }
  assert.match(usage, /^Usage: skill-atlas scan \[--token <token>\] <GitHub URL \| directory>$/);
});

test('GitHub rejects the --token → a message naming it, exit code 1', async () => {
  const rejected: Recording = {
    'https://api.github.com/repos/JetBrains/example': { status: 401, body: { message: 'Bad credentials' } },
  };
  const scanned = await atlasWith(['scan', '--token', 'wrong', 'github.com/JetBrains/example'], { GITHUB_TOKEN: 'environment' }, rejected);
  assert.equal(scanned.code, 1);
  assert.equal(scanned.stderr, 'GitHub rejected the token given with --token');

  // The same answer for GITHUB_TOKEN names GITHUB_TOKEN.
  const fromEnvironment = await atlasWith(['scan', 'github.com/JetBrains/example'], { GITHUB_TOKEN: 'wrong' }, rejected);
  assert.equal(fromEnvironment.code, 1);
  assert.equal(fromEnvironment.stderr, 'GitHub rejected the token in GITHUB_TOKEN');
});

test('a local directory: --token accepted and ignored, no GitHub request', async () => {
  const scanned = await atlasWith(['scan', '--token', 'secret', FIXTURE]);
  const plain = await atlas(['scan', FIXTURE]);
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.equal(scanned.stdout, plain.stdout);
  assert.deepEqual(scanned.requests, []);
});

test('the CLI takes --token', () => {
  const plain = spawnSync(process.execPath, [CLI, 'scan', FIXTURE], { encoding: 'utf8' });
  const scanned = spawnSync(process.execPath, [CLI, 'scan', '--token', 'secret', FIXTURE], { encoding: 'utf8' });
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.equal(scanned.stdout, plain.stdout);

  const missing = spawnSync(process.execPath, [CLI, 'scan', FIXTURE, '--token'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr, `${usage}\n`);
});
