use std::ops::Range;

use curly_message_parser::{Children, NodeKind, NodeRef, cst};

/// A name as the message writes it: unescaped, and where it stands.
#[derive(Clone, Debug)]
pub(crate) struct Named {
    pub name: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Clone, Debug)]
pub(crate) struct Placeholder {
    pub start: usize,
    pub end: usize,
    /// How deep it is written: 1 in the message, 2 in an option value of one.
    pub depth: usize,
    /// Absent where the placeholder names no key.
    pub key: Option<Named>,
    /// Absent where the placeholder names no modifier.
    pub modifier: Option<Named>,
    /// The segments that name a key, in the order they are written.
    pub segments: Vec<Named>,
}

impl Placeholder {
    /// Where a finding about the selection points: the modifier, or the
    /// placeholder where it names none.
    pub fn at(&self) -> (usize, usize) {
        self.modifier
            .as_ref()
            .map_or((self.start, self.end), |modifier| {
                (modifier.start, modifier.end)
            })
    }

    /// The segments that name another key than `default`.
    pub fn choices(&self) -> impl Iterator<Item = &Named> {
        self.segments
            .iter()
            .filter(|segment| segment.name != "default")
    }
}

/// An escape sequence, and whether it cancels a structural meaning.
#[derive(Clone, Debug)]
pub(crate) struct Escape {
    pub span: Range<usize>,
    pub cancels: bool,
}

/// Everything a rule reads off a message, located by bytes of its text.
#[derive(Clone, Debug, Default)]
pub(crate) struct Tree {
    pub placeholders: Vec<Placeholder>,
    /// Text where a placeholder could have opened: the message's and the
    /// option values'.
    pub texts: Vec<Range<usize>>,
    pub escapes: Vec<Escape>,
}

fn named(node: &NodeRef<'_>) -> Option<Named> {
    let name = node.name().filter(|name| !name.is_empty())?;
    let span = node.span();

    Some(Named {
        name: name.to_owned(),
        start: span.start,
        end: span.end,
    })
}

fn escape(node: &NodeRef<'_>) -> Escape {
    Escape {
        span: node.span(),
        cancels: node.cancels().unwrap_or(false),
    }
}

/// Reads what a placeholder names into `tree`, and answers its option
/// values: the spans it holds, still to read.
fn placeholder<'t>(node: &NodeRef<'t>, depth: usize, tree: &mut Tree) -> Vec<NodeRef<'t>> {
    let span = node.span();
    let mut read = Placeholder {
        start: span.start,
        end: span.end,
        depth,
        key: None,
        modifier: None,
        segments: Vec::new(),
    };
    let mut values = Vec::new();

    for part in node.children() {
        match part.kind() {
            NodeKind::Key => read.key = named(&part).or(read.key),
            NodeKind::Modifier => read.modifier = named(&part).or(read.modifier),
            // A segment that names no key is dropped, as resolution drops it.
            NodeKind::OptionKey => read.segments.extend(named(&part)),
            NodeKind::OptionValue => {
                values.push(part);
                continue;
            }
            _ => {}
        }

        tree.escapes.extend(
            part.children()
                .filter(|inner| inner.kind() == NodeKind::Escape)
                .map(|inner| escape(&inner)),
        );
    }

    // Listed before any placeholder its option values hold, in source order.
    tree.placeholders.push(read);

    values
}

#[cfg(test)]
thread_local! {
    /// How many messages were read.
    pub(crate) static READ: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// Reads a message, however deep it nests.
pub(crate) fn read(message: &str) -> Tree {
    #[cfg(test)]
    READ.with(|read| read.set(read.get().saturating_add(1)));

    let parsed = cst(message);
    let mut tree = Tree::default();
    // The spans still to read, the one being read last: a stack of its own
    // rather than the call stack, which a message nested deep enough outgrows.
    let mut pending: Vec<(Children<'_>, usize)> = vec![(parsed.root().children(), 1)];

    while let Some((nodes, depth)) = pending.last_mut() {
        let depth = *depth;
        let Some(node) = nodes.next() else {
            pending.pop();
            continue;
        };

        match node.kind() {
            NodeKind::Text => tree.texts.push(node.span()),
            NodeKind::Escape => tree.escapes.push(escape(&node)),
            NodeKind::Placeholder => {
                let values = placeholder(&node, depth, &mut tree);

                // The first value is read first, and the rest of the span
                // after all.
                for value in values.iter().rev() {
                    pending.push((value.children(), depth.saturating_add(1)));
                }
            }
            _ => {}
        }
    }

    tree.escapes.sort_by_key(|escape| escape.span.start);

    tree
}
