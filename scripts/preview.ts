// node scripts/preview.ts publish | remove: a pull request's preview of the web page, in
// .pr-preview/<N>/ of the gh-pages branch, and the comment on the pull request linking it.
// See spec/preview.md. Run in a checkout whose `origin` can be pushed to, as the workflow's.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Where the preview goes: the checkout, its remote, the branch, the pull request. */
export interface Target {
  cwd: string;
  pr: number;
  remote?: string;
  branch?: string;
  /** Called before each push; the tests move the remote there. */
  beforePush?: () => void;
}

/** The first line of the comment: how the comment is found again. */
export const MARKER = '<!-- skill-atlas-preview -->';

const ATTEMPTS = 5;
const BOT = { name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com' };

const directory = (pr: number) => `.pr-preview/${pr}`;

/** `dist` in .pr-preview/<N>/ of the branch, in place of what was there. */
export function publish(target: Target & { dist: string; sha: string }): 'published' | 'unchanged' {
  const dist = resolve(target.cwd, target.dist);
  const files = walk(dist).map((path) => relative(dist, path).split(sep).join('/'));
  return update(target, `Preview ${directory(target.pr)} at ${target.sha.slice(0, 7)}`, (git, base) => {
    const blobs = git(['hash-object', '-w', '--stdin-paths'], files.map((file) => join(dist, file)).join('\n')).split('\n');
    const entries = files.map((file, i) => `100644 ${blobs[i]}\t${directory(target.pr)}/${file}`);
    if (!base || git(['ls-files', '--cached', '--', '.nojekyll']) === '') {
      entries.push(`100644 ${git(['hash-object', '-w', '--stdin'], '')}\t.nojekyll`);
    }
    git(['update-index', '--index-info'], `${entries.join('\n')}\n`);
    return true;
  }) ? 'published' : 'unchanged';
}

/** .pr-preview/<N>/ gone from the branch; nothing when it is not there. */
export function remove(target: Target): 'removed' | 'absent' {
  return update(target, `Remove ${directory(target.pr)}`, (_, base) => base !== undefined) ? 'removed' : 'absent';
}

/**
 * The branch, with .pr-preview/<N>/ cleared and then `fill`ed, pushed as a new commit on top of it.
 * False when that changes nothing, or `fill` says so. Fetched and done again when someone pushed meanwhile.
 */
function update(target: Target, message: string, fill: (git: Git, base: string | undefined) => boolean): boolean {
  const { cwd, pr, remote = 'origin', branch = 'gh-pages' } = target;
  const work = mkdtempSync(join(tmpdir(), 'skill-atlas-preview-'));
  const env = {
    ...process.env,
    GIT_INDEX_FILE: join(work, 'index'),
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? BOT.name,
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? BOT.email,
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? BOT.name,
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? BOT.email,
  };
  const git: Git = (args, input) => execFileSync('git', args, { cwd, env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const local = `refs/preview/${branch}`;
  try {
    for (let attempt = 1; ; attempt++) {
      let base: string | undefined;
      if (git(['ls-remote', '--heads', remote, `refs/heads/${branch}`]) !== '') {
        git(['fetch', '--quiet', '--no-tags', '--depth=1', remote, `+refs/heads/${branch}:${local}`]);
        base = git(['rev-parse', local]);
        git(['read-tree', base]);
      } else {
        git(['read-tree', '--empty']);
      }
      git(['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '--', directory(pr)]);
      if (!fill(git, base)) return false;
      const tree = git(['write-tree']);
      if (base && tree === git(['rev-parse', `${base}^{tree}`])) return false;
      const commit = git(['commit-tree', tree, ...(base ? ['-p', base] : []), '-m', message]);
      target.beforePush?.();
      try {
        git(['push', '--quiet', remote, `${commit}:refs/heads/${branch}`]);
        return true;
      } catch (error) {
        // Rejected: someone pushed meanwhile. Again, on top of theirs.
        if (attempt === ATTEMPTS) throw error;
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

type Git = (args: string[], input?: string) => string;

/** Every file under `path`. */
function walk(path: string): string[] {
  return readdirSync(path)
    .sort()
    .flatMap((name) => {
      const child = join(path, name);
      return statSync(child).isDirectory() ? walk(child) : [child];
    });
}

/** How to call the GitHub API: the fetch, the token, the API's URL. */
export interface Api {
  fetch?: Fetch;
  token?: string;
  api?: string;
}

function request({ fetch = globalThis.fetch, token, api = 'https://api.github.com' }: Api) {
  return (path: string, init: { method?: string; body?: unknown } = {}) =>
    fetch(`${api}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
}

/** The Pages site: its URL, and whether it serves the gh-pages branch at its root. */
export interface Site {
  url: string;
  ready: boolean;
}

/** The repository's Pages site, from the GitHub API; else where GitHub would put it, not ready. */
export async function pagesSite(repository: string, api: Api = {}): Promise<Site> {
  const response = await request(api)(`/repos/${repository}/pages`);
  if (response.ok) {
    const site = (await response.json()) as { html_url: string; build_type?: string; source?: { branch?: string; path?: string } | null };
    const ready = site.build_type !== 'workflow' && site.source?.branch === 'gh-pages' && site.source.path === '/';
    return { url: site.html_url.endsWith('/') ? site.html_url : `${site.html_url}/`, ready };
  }
  const [owner, repo] = repository.toLowerCase().split('/');
  return { url: repo === `${owner}.github.io` ? `https://${owner}.github.io/` : `https://${owner}.github.io/${repo}/`, ready: false };
}

/** The comment's text, for the preview published or removed. */
export function commentBody({ state, pr, site, sha }: { state: 'published' | 'removed'; pr: number; site: Site; sha: string }): string {
  if (state === 'removed') return `${MARKER}\n**Preview** of the Web UI removed: the pull request was closed.\n`;
  const lines = [
    MARKER,
    `**Preview** of the Web UI for this pull request: ${site.url}${directory(pr)}/`,
    '',
    `At ${sha.slice(0, 7)}. Updated on each push; removed when the pull request is closed or merged.`,
  ];
  if (!site.ready) {
    lines.push(
      '',
      "> GitHub Pages doesn't serve the `gh-pages` branch yet, so the link doesn't work yet. Once, in the repository's " +
        '*Settings → Pages*: *Deploy from a branch*, `gh-pages`, `/ (root)`.',
    );
  }
  return `${lines.join('\n')}\n`;
}

/** The pull request's comment that starts with MARKER: edited to `body`, or created. */
export async function comment(repository: string, pr: number, body: string, api: Api = {}): Promise<void> {
  const call = request(api);
  const check = async (response: Response, what: string) => {
    if (!response.ok) throw new Error(`GitHub answered ${response.status} to ${what}: ${await response.text()}`);
    return response;
  };
  for (let page = 1; ; page++) {
    const response = await check(await call(`/repos/${repository}/issues/${pr}/comments?per_page=100&page=${page}`), 'listing the comments');
    const comments = (await response.json()) as { id: number; body?: string }[];
    const found = comments.find((existing) => existing.body?.startsWith(MARKER));
    if (found) {
      await check(await call(`/repos/${repository}/issues/comments/${found.id}`, { method: 'PATCH', body: { body } }), 'editing the comment');
      return;
    }
    if (comments.length < 100) break;
  }
  await check(await call(`/repos/${repository}/issues/${pr}/comments`, { method: 'POST', body: { body } }), 'creating the comment');
}

if (import.meta.main) {
  const command = process.argv[2];
  const need = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  const repository = need('GITHUB_REPOSITORY');
  const pr = Number(need('PR_NUMBER'));
  const api: Api = { token: process.env.GITHUB_TOKEN, api: process.env.GITHUB_API_URL };
  const target: Target = { cwd: process.cwd(), pr };
  if (command === 'publish') {
    const sha = need('PR_SHA');
    const result = publish({ ...target, dist: process.env.DIST ?? 'dist', sha });
    const site = await pagesSite(repository, api);
    await comment(repository, pr, commentBody({ state: 'published', pr, site, sha }), api);
    console.log(`${result}: ${site.url}${directory(pr)}/${site.ready ? '' : ' (GitHub Pages does not serve gh-pages yet)'}`);
  } else if (command === 'remove') {
    const result = remove(target);
    if (result === 'removed') {
      await comment(repository, pr, commentBody({ state: 'removed', pr, site: await pagesSite(repository, api), sha: '' }), api);
    }
    console.log(`${result}: ${directory(pr)}/`);
  } else {
    console.error('usage: node scripts/preview.ts publish | remove');
    process.exit(1);
  }
}
