#!/usr/bin/env node
import process from 'node:process';
import { run } from './run';

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
