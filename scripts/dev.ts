// npm run dev: the page on a local server; app.js is rebuilt whenever a source changes, with the
// commit the checkout is at when the server starts.
import * as esbuild from 'esbuild';
import { buildCommit, bundle, WEB } from './build.ts';

const context = await esbuild.context({ ...bundle(buildCommit() ?? null), outdir: WEB, write: false, sourcemap: 'inline' });
await context.watch();
const port = process.env.PORT === undefined ? 8000 : Number(process.env.PORT);
const { hosts, port: actual } = await context.serve({ servedir: WEB, port, host: '127.0.0.1' });
console.log(`Skill Atlas: http://${hosts[0]}:${actual}/`);
