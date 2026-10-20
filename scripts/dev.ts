// npm run dev: the page on a local server; app.js is rebuilt whenever a source changes.
import * as esbuild from 'esbuild';
import { bundle, WEB } from './build.ts';

const context = await esbuild.context({ ...bundle, outdir: WEB, write: false, sourcemap: 'inline' });
await context.watch();
const port = process.env.PORT === undefined ? 8000 : Number(process.env.PORT);
const { hosts, port: actual } = await context.serve({ servedir: WEB, port, host: '127.0.0.1' });
console.log(`Skill Atlas: http://${hosts[0]}:${actual}/`);
