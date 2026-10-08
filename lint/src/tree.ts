import { cst } from '@curly-message/parser';
import type { Cst } from '@curly-message/parser';

/** A name as the message writes it: unescaped, where it stands. */
export type Named = { name: string, start: number, end: number };

/** A segment that names a key, `default` included, and its value if any. */
export type Segment = Named & { value?: Cst.OptionValue };

export type Placeholder = {
  node: Cst.Placeholder,
  /** How deep it is written: 1 in the message, 2 in an option value of one. */
  depth: number,
  /** Absent where the placeholder names no key. */
  key?: Named,
  /** Absent where the placeholder names no modifier. */
  modifier?: Named,
  /** The segments that name a key, in the order they are written. */
  segments: Segment[],
};

/** Everything a rule reads off a message. */
export type Tree = {
  message: string,
  placeholders: Placeholder[],
  /** Text where a placeholder could have opened: the message's and the option values'. */
  texts: Cst.Text[],
  escapes: Cst.Escape[],
};

const named = ({ name, start, end }: Cst.Name): Named => ({ name, start, end });

/** Reads a message, however deep it nests. */
export const read = (message: string): Tree => {
  const placeholders: Placeholder[] = [];
  const texts: Cst.Text[] = [];
  const escapes: Cst.Escape[] = [];

  /**
   * Reads what a placeholder names, and answers its option values: the spans
   * it holds, still to read.
   */
  const placeholder = (node: Cst.Placeholder, depth: number): Cst.OptionValue[] => {
    const read: Placeholder = { node, depth, segments: [] };
    const values: Cst.OptionValue[] = [];

    // Read in source order, so the placeholder is listed before any it holds.
    placeholders.push(read);

    for (const part of node.nodes) {
      if (part.type === 'key') {
        if (part.name) read.key = named(part);
      } else if (part.type === 'modifier') {
        if (part.name) read.modifier = named(part);
      } else if (part.type === 'option-key') {
        // A segment that names no key is dropped, as resolution drops it.
        if (part.name) read.segments.push(named(part));
        else read.segments.push({ name: '', start: part.start, end: part.end });
      } else if (part.type === 'option-value') {
        const segment = read.segments.at(-1);

        if (segment) segment.value = part;
        values.push(part);
      }

      if ('nodes' in part && part.type !== 'option-value') {
        for (const inner of part.nodes) if (inner.type === 'escape') escapes.push(inner);
      }
    }

    read.segments = read.segments.filter((segment) => segment.name);

    return values;
  };

  // The spans still to read, the one being read last: a stack of its own
  // rather than the call stack, which a message nested deep enough outgrows.
  const pending = [{ nodes: cst(message).nodes, next: 0, depth: 1 }];

  while (pending.length) {
    const span = pending[pending.length - 1];

    if (span.next === span.nodes.length) {
      pending.pop();
      continue;
    }

    const node = span.nodes[span.next];

    span.next += 1;

    if (node.type === 'text') texts.push(node);
    else if (node.type === 'escape') escapes.push(node);
    else {
      const values = placeholder(node, span.depth);

      // The first value is read first, and the rest of the span after all.
      for (let index = values.length - 1; index >= 0; index -= 1) pending.push({ nodes: values[index].nodes, next: 0, depth: span.depth + 1 });
    }
  }

  escapes.sort((a, b) => a.start - b.start);

  return { message, placeholders, texts, escapes };
};
