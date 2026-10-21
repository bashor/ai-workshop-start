// The page's entry: the app in this window, over live GitHub. Bundled into app.js by scripts/build.ts.
import { mountApp, type Commit } from './app.ts';

/** The commit the page is built from: put in by scripts/build.ts. */
declare const BUILD_COMMIT: Commit | null;

mountApp(window, { fetch: (url, init) => fetch(url, init), commit: BUILD_COMMIT ?? undefined });
