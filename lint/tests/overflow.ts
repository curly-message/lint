import { cst } from '@curly-message/parser';

// A message nested past what the parser's `cst` walks on the runtime the
// suite runs on. How deep a call stack goes is the runtime's to decide, so
// the depth is found by doubling until `cst` overflows, not assumed.
const find = (): string => {
  for (let depth = 1024; depth <= 2 ** 20; depth *= 2) {
    const message = `${'{{v; a:'.repeat(depth)}x${'}}'.repeat(depth)}`;

    try {
      cst(message);
    } catch (error) {
      if (error instanceof RangeError) return message;
      throw error;
    }
  }

  throw new Error('`cst` read a message nested 2^20 levels deep without overflowing');
};

let found: string | undefined;

export const overflowing = () => (found ??= find());

// Reading a message that deep takes seconds on a runtime whose stack goes
// deep, where the default timeout would end the test before it asserts.
export const DEEP = { timeout: 60_000 };
