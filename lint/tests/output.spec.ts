import { describe, expect, it } from 'vitest';
import { output } from '../src/output';

const failure = (code: string | undefined, message = `${code}: failed`) => Object.assign(new Error(message), { code });

// One stream of the command, with every call it makes recorded: a pipe or a
// terminal, or with `file`, a regular file whose writes `writeSync` answers,
// each recorded as `text` where it is handed a string, and otherwise as the
// byte it starts at.
const setup = ({ file = false, throws, takes = [] }: { file?: boolean, throws?: Error, takes?: (number | Error)[] } = {}) => {
  const listeners: ((error: Error) => void)[] = [];
  const written: string[] = [];
  const bytes: number[] = [];
  const notes: string[] = [];
  const handed: (string | number)[] = [];
  let faults = 0;
  let calls = 0;

  const write = output({
    stream: {
      write: (text) => {
        if (throws) throw throws;

        written.push(text);
      },
      on: (_, listener) => listeners.push(listener),
    },
    fd: 7,
    writeSync: (fd: number, data: string | Uint8Array, from?: number, size?: number) => {
      const offset = from ?? 0;
      const buffer = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      const length = size ?? buffer.length;
      const take = takes[calls] ?? length;

      calls += 1;
      handed.push(typeof data === 'string' ? 'text' : offset);
      expect(fd).toBe(7);

      if (take instanceof Error) throw take;

      bytes.push(...buffer.subarray(offset, offset + Math.min(take, length)));

      return Math.min(take, length);
    },
    fstat: (fd) => ({ isFile: () => fd === 7 && file }),
    note: (text) => notes.push(text),
    fault: () => { faults += 1; },
  });

  const emit = (error: Error) => listeners.forEach((listener) => listener(error));

  return { write, emit, written, notes, handed, file: () => new TextDecoder().decode(new Uint8Array(bytes)), counts: () => ({ faults, calls }) };
};

describe('the output of the command', () => {
  it('writes a pipe or a terminal through its stream', () => {
    const { write, written, file, counts } = setup();

    write('a\n');
    write('b\n');

    expect(written).toEqual(['a\n', 'b\n']);
    expect(file()).toBe('');
    expect(counts()).toEqual({ faults: 0, calls: 0 });
  });

  it('writes a regular file each text in one call where the file takes it whole', () => {
    const { write, written, notes, handed, file, counts } = setup({ file: true });

    write('\u010de\u0161tina\n');
    write('');
    write('ok\n');

    expect(file()).toBe('\u010de\u0161tina\nok\n');
    expect(handed).toEqual(['text', 'text']);
    expect(written).toEqual([]);
    expect(notes).toEqual([]);
    expect(counts()).toEqual({ faults: 0, calls: 2 });
  });

  it('writes a regular file to its last byte, past short writes, going on from the byte each stopped at', () => {
    const { write, written, notes, handed, file, counts } = setup({ file: true, takes: [3, 1, 2] });

    write('\u010de\u0161tina\n');
    write('ok\n');

    expect(file()).toBe('\u010de\u0161tina\nok\n');
    expect(handed).toEqual(['text', 3, 4, 6, 'text']);
    expect(written).toEqual([]);
    expect(notes).toEqual([]);
    expect(counts()).toEqual({ faults: 0, calls: 5 });
  });

  it('says where a regular file stops taking the report, as a full disk does, and writes no more', () => {
    const { write, notes, file, counts } = setup({ file: true, takes: [4, failure('ENOSPC', 'ENOSPC: no space left on device, write')] });

    write('report\n');
    write('more\n');

    expect(file()).toBe('repo');
    expect(notes).toEqual(['Cannot write the report: ENOSPC: no space left on device, write\n']);
    expect(counts()).toEqual({ faults: 1, calls: 2 });
  });

  it('counts a regular file that takes nothing as a fault, and does not try it again', () => {
    const { write, notes, counts } = setup({ file: true, takes: [0] });

    write('report\n');

    expect(notes).toEqual(['Cannot write the report: wrote 0 of 7 bytes\n']);
    expect(counts()).toEqual({ faults: 1, calls: 1 });

    const after = setup({ file: true, takes: [2, 0] });

    after.write('report\n');

    expect(after.notes).toEqual(['Cannot write the report: wrote 2 of 7 bytes\n']);
    expect(after.counts()).toEqual({ faults: 1, calls: 2 });
  });

  it('writes through the stream where the descriptor cannot be told', () => {
    const written: string[] = [];
    const write = output({
      stream: { write: (text) => written.push(text), on: () => undefined },
      fd: 1,
      writeSync: () => { throw new Error('not reached'); },
      fstat: () => { throw failure('EBADF'); },
      fault: () => { throw new Error('not reached'); },
    });

    write('a\n');

    expect(written).toEqual(['a\n']);
  });

  it.each(['EPIPE', 'ECONNRESET', 'EOF', 'EAGAIN'])('ends the report silently where the stream reports its reader gone with %s', (code) => {
    const { write, emit, written, notes, counts } = setup();

    write('a\n');
    emit(failure(code));
    write('b\n');

    expect(written).toEqual(['a\n']);
    expect(notes).toEqual([]);
    expect(counts().faults).toBe(0);
  });

  it.each(['EPIPE', 'ECONNRESET'])('ends the report silently where a write throws %s', (code) => {
    const { write, notes, counts } = setup({ throws: failure(code) });

    write('a\n');
    write('b\n');

    expect(notes).toEqual([]);
    expect(counts().faults).toBe(0);
  });

  // EAGAIN thrown is a pipe that is full, its reader still there, and EOF
  // means a closed pipe only where libuv reports it.
  it.each(['EAGAIN', 'EOF', 'EBADF', 'EIO', 'ENOSPC', undefined])('says where a write throws %s, and writes no more', (code) => {
    const { write, notes, counts } = setup({ throws: failure(code, 'thrown') });

    write('a\n');
    write('b\n');

    expect(notes).toEqual(['Cannot write the report: thrown\n']);
    expect(counts().faults).toBe(1);
  });

  it.each(['EBADF', 'EIO', 'ENOSPC', undefined])('says where the stream reports %s, and writes no more', (code) => {
    const { write, emit, written, notes, counts } = setup();

    emit(failure(code, 'emitted'));
    emit(failure('EPIPE'));
    write('a\n');

    expect(written).toEqual([]);
    expect(notes).toEqual(['Cannot write the report: emitted\n']);
    expect(counts().faults).toBe(1);
  });

  it('counts only the first failure', () => {
    const { emit, notes, counts } = setup();

    emit(failure('EPIPE'));
    emit(failure('EBADF'));

    expect(notes).toEqual([]);
    expect(counts().faults).toBe(0);
  });
});
