#!/usr/bin/env node
// The Node client: stdout and stderr. Nothing is stored.
import { run } from './commands.ts';
import { nodeContext } from './node.ts';

process.exitCode = await run(
  process.argv.slice(2),
  nodeContext({ fetch, env: process.env, print: (text) => console.log(text), error: (text) => console.error(text) }),
);
