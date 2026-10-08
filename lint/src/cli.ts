#!/usr/bin/env node
import { fstatSync, writeSync } from 'node:fs';
import process from 'node:process';
import { output } from './output';
import { run } from './run';

let faulted = false;

const fault = () => {
  faulted = true;
  process.exitCode = 2;
};

const err = output({ stream: process.stderr, fd: 2, writeSync, fstat: fstatSync, fault });
const out = output({ stream: process.stdout, fd: 1, writeSync, fstat: fstatSync, note: err, fault });
const code = await run(process.argv.slice(2), { cwd: process.cwd(), out, err });

process.exitCode = faulted ? 2 : code;
