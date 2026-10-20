// npm run build: the web page as static files in dist/, for any static host. Relative paths, so
// it works at /<repo>/ on GitHub Pages too.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const WEB = join(ROOT, 'web');

/** How src/web/main.ts becomes app.js: one file, for the browser. */
export const bundle: esbuild.BuildOptions = {
  entryPoints: { app: join(ROOT, 'src/web/main.ts') },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'warning',
};

export async function build(outdir = join(ROOT, 'dist')) {
  mkdirSync(outdir, { recursive: true });
  await esbuild.build({ ...bundle, outdir, minify: true, sourcemap: true });
  for (const file of ['index.html', 'style.css']) copyFileSync(join(WEB, file), join(outdir, file));
}

if (import.meta.main) {
  await build();
  console.log('dist/: index.html, app.js, style.css');
}
