// npm run build: the web page as static files in dist/, for any static host. Relative paths, so
// it works at /<repo>/ on GitHub Pages too.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { parseGitHubUrl } from '../src/core/github.ts';
import type { Commit } from '../src/web/app.ts';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const WEB = join(ROOT, 'web');

/**
 * The commit the checkout in `cwd` is at, on GitHub: GitHub Actions' repository, or the origin remote's.
 * Undefined when there is no commit or no GitHub repository.
 */
export function buildCommit(cwd = ROOT, env: NodeJS.ProcessEnv = process.env): Commit | undefined {
  const git = (...args: string[]) => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return undefined;
    }
  };
  const sha = git('rev-parse', '--verify', '--quiet', 'HEAD^{commit}');
  if (!sha) return undefined;
  let repository = env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}` : undefined;
  if (!repository) {
    // git@github.com:owner/repo.git as github.com/owner/repo.git.
    const name = parseGitHubUrl(git('remote', 'get-url', 'origin')?.replace(/^git@github\.com:/i, 'github.com/') ?? '');
    if (!name) return undefined;
    repository = `https://github.com/${name.owner}/${name.repo}`;
  }
  return { sha, url: `${repository}/commit/${sha}` };
}

/** How src/web/main.ts becomes app.js: one file, for the browser, with the commit it is built from. */
export function bundle(commit: Commit | null): esbuild.BuildOptions {
  return {
    entryPoints: { app: join(ROOT, 'src/web/main.ts') },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'warning',
    define: { BUILD_COMMIT: JSON.stringify(commit) },
  };
}

/** The page in `outdir`, linked to `commit`: this checkout's by default; null, no link. */
export async function build(outdir = join(ROOT, 'dist'), commit: Commit | null = buildCommit() ?? null) {
  mkdirSync(outdir, { recursive: true });
  await esbuild.build({ ...bundle(commit), outdir, minify: true, sourcemap: true });
  for (const file of ['index.html', 'style.css']) copyFileSync(join(WEB, file), join(outdir, file));
}

if (import.meta.main) {
  await build();
  console.log('dist/: index.html, app.js, style.css');
}
