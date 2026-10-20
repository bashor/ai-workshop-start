// The page's entry: the app in this window, over live GitHub. Bundled into app.js by scripts/build.ts.
import { mountApp } from './app.ts';

mountApp(window, { fetch: (url, init) => fetch(url, init) });
