// The decisions in spec/web.md, Publishing: the GitHub Actions workflow that puts the page on GitHub
// Pages, read as GitHub reads it, and checked against package.json and npm run build.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';
import { ROOT } from '../scripts/build.ts';

const WORKFLOW = join(ROOT, '.github/workflows/pages.yml');

type Step = { uses?: string; run?: string; with?: Record<string, unknown> };
type Job = {
  needs?: string | string[];
  permissions?: Record<string, string>;
  environment?: { name: string; url?: string };
  steps: Step[];
};
type Workflow = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, Job>;
};

const workflow = (): Workflow => parse(readFileSync(WORKFLOW, 'utf8'));
const steps = (w: Workflow) => Object.values(w.jobs).flatMap((job) => job.steps);
const action = (step: Step) => step.uses?.split('@')[0];
/** The jobs in the order GitHub runs them: each one after the jobs it needs. */
const ordered = (w: Workflow) => {
  const done: string[] = [];
  const visit = (name: string) => {
    if (done.includes(name)) return;
    const needs = w.jobs[name].needs ?? [];
    for (const need of Array.isArray(needs) ? needs : [needs]) visit(need);
    done.push(name);
  };
  for (const name of Object.keys(w.jobs)) visit(name);
  return done.flatMap((name) => w.jobs[name].steps);
};
const index = (list: Step[], test: (step: Step) => boolean) => {
  const found = list.findIndex(test);
  assert.notEqual(found, -1);
  return found;
};

test('publishing: a GitHub Actions workflow', () => {
  assert.ok(existsSync(WORKFLOW), '.github/workflows/pages.yml');
  assert.ok(Object.keys(workflow().jobs).length > 0);
});

test('publishing: republished after each push to main, or by hand; no other branch, no pull request', () => {
  const { on } = workflow();
  assert.deepEqual(Object.keys(on).sort(), ['push', 'workflow_dispatch']);
  assert.deepEqual(on.push, { branches: ['main'] });
});

test('publishing: only when npm ci, the typecheck and the tests pass, then npm run build', () => {
  const w = workflow();
  const list = ordered(w);
  const run = (command: string) => index(list, (step) => step.run === command);
  const deploy = index(list, (step) => action(step) === 'actions/deploy-pages');
  assert.ok(run('npm ci') < run('npm run typecheck'));
  assert.ok(run('npm run typecheck') < run('npm test'));
  assert.ok(run('npm test') < run('npm run build'));
  assert.ok(run('npm run build') < deploy);
  // A failed step stops its job, and a job that needs it is skipped: nothing is published.
  for (const step of list) assert.equal((step as { 'continue-on-error'?: boolean })['continue-on-error'], undefined);
  for (const job of Object.values(w.jobs)) assert.equal((job as { if?: string }).if, undefined);

  // The commands are the project's own.
  const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts;
  for (const script of ['typecheck', 'test', 'build']) assert.ok(scripts[script], script);
  const setup = list.find((step) => action(step) === 'actions/setup-node');
  assert.equal(String(setup?.with?.['node-version']), '24');
});

test('publishing: dist/, the output of npm run build, nothing else', () => {
  const upload = steps(workflow()).filter((step) => action(step) === 'actions/upload-pages-artifact');
  assert.equal(upload.length, 1);
  assert.equal(upload[0].with?.path, 'dist/');
  // npm run build writes to dist/ unless told otherwise.
  assert.match(readFileSync(join(ROOT, 'scripts/build.ts'), 'utf8'), /outdir = join\(ROOT, 'dist'\)/);
});

test('publishing: to the github-pages environment, its URL the published page', () => {
  const w = workflow();
  const [deploy] = Object.values(w.jobs).filter((job) => job.steps.some((step) => action(step) === 'actions/deploy-pages'));
  assert.equal(deploy.environment?.name, 'github-pages');
  assert.match(deploy.environment?.url ?? '', /steps\.\w+\.outputs\.page_url/);
});

test('publishing: one at a time, a newer push waits, the running one not cancelled', () => {
  const { concurrency } = workflow();
  assert.ok(concurrency.group);
  assert.doesNotMatch(concurrency.group, /github\.ref|github\.sha/);
  assert.equal(concurrency['cancel-in-progress'], false);
});

test('publishing: only the permissions it needs, reading the repository, writing Pages, the ID token', () => {
  const w = workflow();
  assert.deepEqual(w.permissions, { contents: 'read', pages: 'write', 'id-token': 'write' });
  for (const job of Object.values(w.jobs)) assert.equal(job.permissions, undefined);
});
