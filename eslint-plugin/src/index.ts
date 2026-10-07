import { lintMessage, readCatalogue, RULES } from '@curly-message/lint';
import type { Code, Finding } from '@curly-message/lint';
import type { ESLint, Linter, Rule } from 'eslint';
import { version } from '../package.json';

/** What a project tells the rules, under `settings['curly-message']`. */
export type Settings = {
  /**
   * The functions whose first argument is a message, by name or by the
   * property a method is called through: `resolve` by default.
   */
  callees?: string[],
  /**
   * Whether every string a property of an object literal or an array holds is
   * a message, as in a catalogue written as a module. JSON is always read
   * this way.
   */
  catalogue?: boolean,
  /**
   * The locale of every message in the file. A path names none, so where
   * this does not, a message is linted without one.
   */
  locale?: string,
  /** The modifiers the host registers. */
  modifiers?: string[],
  /**
   * Whether the host satisfies the Intl level, as it does where this is not
   * `false`. Where it satisfies Core alone, the modifiers Intl defines are
   * unknown unless it registers them.
   */
  intl?: boolean,
};

type Node = { type: string, range?: [number, number], [key: string]: unknown };

type SourceCode = Rule.RuleContext['sourceCode'];

type Message = { node: Node, text: string, start: number, end: number };

type Report = { code: Code, message: string, start: number, end: number };

const settingsOf = (context: Rule.RuleContext): Settings => (context.settings['curly-message'] ?? {});

const rangeOf = (sourceCode: SourceCode, node: Node): [number, number] => node.range ?? (sourceCode as unknown as { getRange: (node: Node) => [number, number] }).getRange(node);

const stringOf = (node: unknown): string | undefined => {
  const value = node as Node | undefined;

  if (value?.type === 'Literal' && typeof value.value === 'string') return value.value;
  if (value?.type === 'String' && typeof value.value === 'string') return value.value;

  if (value?.type === 'TemplateLiteral' && !(value.expressions as unknown[]).length) {
    return ((value.quasis as Node[])[0].value as { cooked?: string }).cooked ?? undefined;
  }

  return undefined;
};

const nameOf = (callee: Node): string | undefined => {
  if (callee.type === 'Identifier') return callee.name as string;
  if (callee.type !== 'MemberExpression') return undefined;
  if (callee.computed) return stringOf(callee.property);

  return (callee.property as Node).type === 'Identifier' ? (callee.property as Node).name as string : undefined;
};

// Where the code unit at `index` of a string is written in the source. A
// JSON string is read as the catalogue reader reads one, so a finding past an
// escape sequence still points at its own character; a JavaScript string
// that spells nothing with an escape maps one to one; any other one is
// pointed at whole.
const locator = (sourceCode: SourceCode, node: Node, text: string) => {
  const [from, to] = rangeOf(sourceCode, node);
  const raw = sourceCode.text.slice(from, to);

  if (node.type === 'String' && raw.startsWith('"')) {
    const read = readCatalogue(raw);

    if (read.ok && read.strings.length === 1) {
      const [located] = read.strings;

      return (index: number) => from + located.offsetOf(index);
    }
  }

  const inner = raw.slice(1, -1);

  if (!inner.includes('\\') && inner === text) return (index: number) => from + 1 + index;

  return undefined;
};

const isNode = (value: unknown): value is Node => !!value && typeof (value as Node).type === 'string';

// What is not a child of a node in any tree a language hands a rule.
const NOT_CHILDREN = new Set(['loc', 'range', 'parent', 'tokens', 'comments']);

// The children of a node, by the language's visitor keys where its source
// code carries them, as JavaScript's does, and by its properties otherwise,
// as the JSON language's tree needs.
const children = (sourceCode: SourceCode, node: Node): Node[] => {
  const visitorKeys = (sourceCode as { visitorKeys?: Record<string, string[] | undefined> }).visitorKeys;
  const keys = visitorKeys?.[node.type] ?? Object.keys(node).filter((key) => !NOT_CHILDREN.has(key));

  return keys.flatMap((key) => {
    const child: unknown = node[key];

    return (Array.isArray(child) ? child : [child]).filter(isNode);
  });
};

// The strings a file holds as messages: the first argument of a call named
// in `callees`, every string a property or an array holds where the file is
// a catalogue, and every string a JSON document holds.
const messagesOf = (sourceCode: SourceCode, settings: Settings): Message[] => {
  const callees = settings.callees ?? ['resolve'];
  const messages: Message[] = [];
  const root = sourceCode.ast as unknown as Node;
  const json = root.type === 'Document';

  const add = (node: unknown) => {
    const text = stringOf(node);

    if (text === undefined) return;

    const [start, end] = rangeOf(sourceCode, node as Node);

    messages.push({ node: node as Node, text, start, end });
  };

  const walk = (node: Node) => {
    if (json && node.type === 'Document') add(node.body);
    if (json && (node.type === 'Member' || node.type === 'Element')) add(node.value);
    if (!json && settings.catalogue && node.type === 'Property') add(node.value);
    if (!json && settings.catalogue && node.type === 'ArrayExpression') for (const element of node.elements as unknown[]) add(element);

    if (!json && node.type === 'CallExpression') {
      const name = nameOf(node.callee as Node);

      if (name && callees.includes(name)) add((node.arguments as Node[])[0]);
    }

    for (const child of children(sourceCode, node)) walk(child);
  };

  walk(root);

  return messages;
};

// Every rule reads the same findings, so a file is linted once, however many
// of the rules are on.
const linted = new WeakMap<object, Map<string, Report[]>>();

const reportsOf = (context: Rule.RuleContext): Report[] => {
  const { sourceCode } = context;
  const settings = settingsOf(context);
  const cacheKey = JSON.stringify(settings);
  const byFile = linted.get(sourceCode) ?? new Map<string, Report[]>();

  linted.set(sourceCode, byFile);

  const cached = byFile.get(cacheKey);

  if (cached) return cached;

  const reports: Report[] = [];

  for (const { node, text, start, end } of messagesOf(sourceCode, settings)) {
    const at = locator(sourceCode, node, text);

    for (const found of lintMessage(text, { locale: settings.locale, modifiers: settings.modifiers, intl: settings.intl })) {
      reports.push({ code: found.code, message: found.message, ...span(found, at, start, end) });
    }
  }

  byFile.set(cacheKey, reports);

  return reports;
};

const span = (found: Finding, at: ((index: number) => number) | undefined, start: number, end: number) => (at ? { start: at(found.start), end: at(found.end) } : { start, end });

// Each rule is the library's, and the library's README has a heading for each.
const DOCS = 'https://github.com/curly-message/lint/blob/main/lint/README.md';

const ruleOf = (code: Code, severity: string, description: string): Rule.RuleModule => ({
  meta: {
    type: severity === 'error' ? 'problem' : 'suggestion',
    docs: { description, url: `${DOCS}#${code}` },
    messages: { finding: '{{text}}' },
    schema: [],
  },
  create: (context) => {
    const report = () => {
      for (const { code: found, message, start, end } of reportsOf(context)) {
        if (found !== code) continue;

        context.report({
          loc: { start: context.sourceCode.getLocFromIndex(start), end: context.sourceCode.getLocFromIndex(end) },
          messageId: 'finding',
          data: { text: message },
        });
      }
    };

    return { 'Program:exit': report, 'Document:exit': report };
  },
});

// The rules that read one message: those a catalogue alone decides need
// every locale at once, which a linter handed one file at a time never has.
const PER_MESSAGE = RULES.filter(({ scope }) => scope !== 'catalogue');

const recommended: Linter.Config = {
  name: '@curly-message/recommended',
  rules: Object.fromEntries(PER_MESSAGE.map(({ code, severity }) => [`@curly-message/${code}`, severity === 'error' ? 'error' : 'warn'])),
};

const plugin: Omit<ESLint.Plugin, 'configs'> & { configs: { recommended: Linter.Config } } = {
  meta: { name: '@curly-message/eslint-plugin', version },
  rules: Object.fromEntries(PER_MESSAGE.map(({ code, severity, description }) => [code, ruleOf(code, severity, description)])),
  configs: { recommended },
};

recommended.plugins = { '@curly-message': plugin };

export default plugin;
