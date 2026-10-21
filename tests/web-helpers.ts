// The web page in jsdom, as a browser opens it, with GitHub answering from recordings.
import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import type { Fetch } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { mountApp, type Commit } from '../src/web/app.ts';
import { FIXTURE, lastCommit } from './helpers.ts';

export const PAGE = fileURLToPath(new URL('../web/index.html', import.meta.url));
export const ORIGIN = 'https://atlas.test/';

/** The commit every recorded repository is at. */
export const COMMIT = '5ab6270ab772d113e8ad52ebfcaa0109c522ae00';

/** When every recorded skill was last updated, unless `record` is told otherwise. */
export const UPDATED = '2026-10-14T09:30:00Z';

/** A file's text, or a symbolic link to `link`. */
export type File = string | { link: string };

/**
 * What GitHub answers, without a token, for a repository `id` with these files; each SKILL.md's
 * directory last updated at `updated[directory]`, UPDATED by default, or never if null.
 */
export function record(id: string, files: Record<string, File>, updated: Record<string, string | null> = {}): Recording {
  const recording: Recording = {
    [`https://api.github.com/repos/${id}`]: { status: 200, body: { full_name: id, default_branch: 'main' } },
    [`https://api.github.com/repos/${id}/commits/main`]: { status: 200, body: { sha: COMMIT } },
    [`https://api.github.com/repos/${id}/git/trees/${COMMIT}?recursive=1`]: {
      status: 200,
      body: {
        truncated: false,
        tree: Object.entries(files).map(([path, file]) => ({
          path,
          type: 'blob',
          mode: typeof file === 'string' ? '100644' : '120000',
          sha: '0'.repeat(40),
        })),
      },
    },
  };
  for (const [path, file] of Object.entries(files)) {
    const text = typeof file === 'string' ? file : file.link;
    recording[`https://raw.githubusercontent.com/${id}/${COMMIT}/${path}`] = { status: 200, body: text };
    if (path.split('/').at(-1) !== 'SKILL.md') continue;
    const directory = path.split('/').slice(0, -1).join('/');
    Object.assign(recording, lastCommit(id, COMMIT, directory, updated[directory] === null ? undefined : (updated[directory] ?? UPDATED)));
  }
  return recording;
}

/** What GitHub lists, without a token, for an organization `org` with these repositories, 100 a page. */
export function recordOrganization(org: string, names: string[]): Recording {
  const recording: Recording = {};
  // The last page has fewer than 100: an empty one when they divide evenly.
  for (let page = 1, repositories: string[] = []; page === 1 || repositories.length === 100; page++) {
    repositories = names.slice((page - 1) * 100, page * 100);
    recording[`https://api.github.com/orgs/${org}/repos?per_page=100&page=${page}`] = {
      status: 200,
      body: repositories.map((name) => ({ name, full_name: `${org}/${name}`, default_branch: 'main' })),
    };
  }
  return recording;
}

/** ./fixture, as GitHub would answer it for `id`. */
export function recordFixture(id: string): Recording {
  const files: Record<string, File> = {};
  const walk = (directory: string, prefix: string) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) files[`${prefix}${name}`] = { link: readlinkSync(path) };
      else if (stat.isDirectory()) walk(path, `${prefix}${name}/`);
      else files[`${prefix}${name}`] = readFileSync(path, 'utf8');
    }
  };
  walk(FIXTURE, '');
  return record(id, files);
}

/** Where the page saves the token, in local storage. */
export const TOKEN_KEY = 'skill-atlas.token';

/**
 * The page at `?<query>`, mounted; every GitHub request it makes is in `requests`, its Authorization in `authorizations`.
 * `storage`: local storage as the page finds it, such as another page's, for a reload; `'unavailable'`: it throws.
 * `commit`: the commit the page was built from.
 */
export function openPage(
  query: string,
  recording: Recording,
  options: { fetch?: Fetch; storage?: Record<string, string> | 'unavailable'; commit?: Commit } = {},
) {
  const dom = new JSDOM(readFileSync(PAGE, 'utf8'), { url: `${ORIGIN}${query}` });
  const window = dom.window;
  const { storage } = options;
  if (storage === 'unavailable') {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new window.DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  } else if (storage) {
    for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
  }
  const requests: string[] = [];
  const authorizations: { url: string; authorization: string | undefined }[] = [];
  const answer = options.fetch ?? replay(recording);
  mountApp(window as unknown as Window, {
    commit: options.commit,
    fetch: (url, init) => {
      requests.push(url);
      authorizations.push({ url, authorization: init?.headers?.Authorization });
      return answer(url, init);
    },
  });
  const document = window.document;
  const $ = (selector: string) => document.querySelector<HTMLElement>(selector);
  const $$ = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
  return {
    window,
    document,
    requests,
    authorizations,
    $,
    $$,
    /** The page URL's query parameter. */
    param: (name: string) => new URL(window.location.href).searchParams.get(name),
    /** Types `text` into the field at the top and presses Scan. */
    scan(text: string) {
      ($('#repo') as HTMLInputElement).value = text;
      $('#scan')!.click();
    },
    /** Saves `text` as the token: Add token, or Change token, then types it into the token field and presses Save. */
    token(text: string) {
      $('#add-token')!.click();
      ($('#token') as HTMLInputElement).value = text;
      $('#save-token')!.click();
    },
    /** Presses `key` in the token field. */
    press(key: string) {
      $('#token')!.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
    },
    /** Whether the element is shown: there, and neither it nor a parent hidden. */
    shown(selector: string) {
      for (let element = $(selector); element; element = element.parentElement) if (element.hidden) return false;
      return $(selector) !== null;
    },
    /** Types `text` into the filter above the skills, as typing does: an input event. */
    filter(text: string) {
      const filter = $('#filter') as HTMLInputElement;
      filter.value = text;
      filter.dispatchEvent(new window.Event('input', { bubbles: true }));
    },
    /** The highlighted parts in the left panel: the text of each mark, by the class of its parent. */
    marks: (part: 'name' | 'description') => $$(`#skills li .${part} mark`).map((element) => element.textContent),
    /** The skill names in the left panel. */
    names: () => $$('#skills li .name').map((element) => element.textContent),
    /** The badges in the left panel: the number of each repository's skills. */
    badges: () => $$('#skills li .badge').map((element) => element.textContent),
    /** Clicks the `index`-th skill, or repository, in the left panel. */
    pick: (index: number) => $$('#skills li button')[index].click(),
    /** Waits until `check` is true. */
    async until(check: () => unknown, what = 'the page') {
      for (let waited = 0; waited < 2000; waited += 5) {
        if (check()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error(`timed out waiting for ${what}:\n${document.body.textContent?.replace(/\s+/g, ' ')}`);
    },
  };
}
