import { Buffer } from 'node:buffer';

export type Output = {
  stream: {
    write: (text: string) => unknown,
    on: (event: 'error', listener: (error: Error) => void) => unknown,
  },
  fd: number,
  writeSync: {
    (fd: number, text: string): number,
    (fd: number, buffer: Uint8Array, offset: number, length: number): number,
  },
  fstat: (fd: number) => { isFile: () => boolean },
  // Where a report lost from this stream is said.
  note?: (text: string) => void,
  fault: () => void,
};

// A reader gone, as `head` leaves a pipe. Libuv reports a closed pipe on
// Windows as EOF or EAGAIN, and only through the stream's `error` event: thrown
// from a write, EAGAIN is a full pipe whose reader is still there.
const GONE = new Set(['EPIPE', 'ECONNRESET']);
const GONE_BY_EVENT = new Set([...GONE, 'EOF', 'EAGAIN']);

const codeOf = (error: unknown) => (error as { code?: unknown } | undefined)?.code;

const isFile = ({ fd, fstat }: Output) => {
  try {
    return fstat(fd).isFile();
  } catch {
    return false;
  }
};

// Writes to one stream until its first failure, and writes nothing after it.
// A reader gone ends the report and leaves the exit code to the lint; any
// other failure is a fault, said through `note`. A regular file is written
// with `writeSync` up to its last byte, so a disk that fills mid-write throws
// on the call after the short one, where Node's stream writes a file once and
// ignores how much of it was taken. A text is encoded only past a short write,
// to go on from the byte it stopped at.
export const output = (options: Output) => {
  const { stream, fd, writeSync, note, fault } = options;
  let open = true;

  const fail = (error: unknown, gone: Set<unknown>) => {
    if (!open) return;

    open = false;

    if (gone.has(codeOf(error))) return;

    fault();
    note?.(`Cannot write the report: ${error instanceof Error ? error.message : String(error)}\n`);
  };

  const encoder = new TextEncoder();
  const write = isFile(options)
    ? (text: string) => {
      const length = Buffer.byteLength(text);
      let bytes: Uint8Array | undefined;

      for (let at = 0; at < length;) {
        const written = at ? writeSync(fd, bytes ??= encoder.encode(text), at, length - at) : writeSync(fd, text);

        if (written <= 0) throw new Error(`wrote ${at} of ${length} bytes`);

        at += written;
      }
    }
    : (text: string) => {
      stream.write(text);
    };

  stream.on('error', (error) => fail(error, GONE_BY_EVENT));

  return (text: string) => {
    if (!open) return;

    try {
      write(text);
    } catch (error) {
      fail(error, GONE);
    }
  };
};
