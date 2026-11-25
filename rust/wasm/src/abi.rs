//! The module's edge: what it exports and imports, and every `unsafe` of the
//! crate. A buffer crosses as its address and its length in bytes, and
//! belongs to whichever side holds it last.

#![allow(unsafe_code)]

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::memory::MAX_MEMORY;

const PAGE: usize = 65536;

/// The system's allocator, which grows the memory by what one request
/// lacks: where it grew, half the memory again is taken and given back, for
/// what follows to be cut from, or what is left below the most it grows to
/// where that is less. A host collects its garbage when a memory grows, so
/// a call that grows it a page at a time spends its time there.
struct Growing;

/// How many pages the memory held when it was last seen to have grown.
static PAGES: AtomicUsize = AtomicUsize::new(0);

impl Growing {
    fn grown(&self) {
        let pages = core::arch::wasm32::memory_size(0);

        if pages == PAGES.load(Ordering::Relaxed) {
            return;
        }

        // A page is left for what the allocator keeps beside a block, so
        // that what is taken fits below the most the memory grows to.
        let left = (MAX_MEMORY / PAGE).saturating_sub(pages).saturating_sub(1);

        if let Ok(ahead) = Layout::from_size_align((pages / 2).min(left).saturating_mul(PAGE), 1)
            && ahead.size() > 0
        {
            // SAFETY: the layout has a size, and what it yields is given
            // back unread under the same layout.
            unsafe {
                let reserved = System.alloc(ahead);

                if !reserved.is_null() {
                    System.dealloc(reserved, ahead);
                }
            }
        }

        PAGES.store(core::arch::wasm32::memory_size(0), Ordering::Relaxed);
    }
}

// SAFETY: every block is the system allocator's, under the layout it was
// asked with.
unsafe impl GlobalAlloc for Growing {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        // SAFETY: the caller's contract is `System.alloc`'s.
        let at = unsafe { System.alloc(layout) };

        self.grown();
        at
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        // SAFETY: the caller's contract is `System.alloc_zeroed`'s.
        let at = unsafe { System.alloc_zeroed(layout) };

        self.grown();
        at
    }

    unsafe fn realloc(&self, at: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        // SAFETY: the caller's contract is `System.realloc`'s.
        let at = unsafe { System.realloc(at, layout, size) };

        self.grown();
        at
    }

    unsafe fn dealloc(&self, at: *mut u8, layout: Layout) {
        // SAFETY: the caller's contract is `System.dealloc`'s.
        unsafe { System.dealloc(at, layout) }
    }
}

#[global_allocator]
static ALLOCATOR: Growing = Growing;

#[link(wasm_import_module = "host")]
unsafe extern "C" {
    safe fn plural_rules(tag: *const u8, len: usize, ordinal: u32) -> i32;
    safe fn plural_select(rules: u32, number: f64) -> u32;
    safe fn host(op: u32, text: *const u8, len: usize) -> *mut u8;
}

/// What the host answers for a locale's plural rules of one type: its handle
/// to them shifted past the six bits of the categories they answer, `-1`
/// where it has none, and anything below where it could not tell.
pub fn rules_of(tag: &str, ordinal: bool) -> i32 {
    plural_rules(tag.as_ptr(), tag.len(), u32::from(ordinal))
}

/// The index of the category the host's rules put a number in, and one past
/// the categories where it could not tell.
pub fn select(rules: u32, number: f64) -> u32 {
    plural_select(rules, number)
}

/// What the host answers an operation on a text: a buffer it allocated with
/// [`alloc`], its length in its first four bytes, or nothing where it could
/// not answer.
pub fn ask(op: u32, text: &str) -> Option<Box<[u8]>> {
    let at = host(op, text.as_ptr(), text.len());

    if at.is_null() {
        return None;
    }

    // SAFETY: the host answers with a buffer `alloc` gave it for at least
    // four bytes, the first four holding its whole length, and never uses it
    // again.
    Some(unsafe {
        let len = u32::from_le_bytes(at.cast::<[u8; 4]>().read_unaligned());

        take(at, len as usize)
    })
}

/// # Safety
///
/// `at` is what [`alloc`] or [`give`] returned for `len` bytes, and nothing
/// reads it after this call.
unsafe fn take(at: *mut u8, len: usize) -> Box<[u8]> {
    // SAFETY: the caller's contract is `Box::from_raw`'s.
    unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(at, len)) }
}

fn give(bytes: Vec<u8>) -> *mut u8 {
    Box::into_raw(bytes.into_boxed_slice()).cast()
}

/// An answer as twenty-eight bytes: three pairs of a buffer's address and
/// its length, the numbers', the text's and the pages', for the host to
/// [`free`] with this one, then where the next answer of the call is asked
/// for with [`next`], and zero where this one is the last.
fn answer((answer, more): (crate::wire::Answer, Option<Box<crate::Answers>>)) -> *mut u8 {
    let buffers = [answer.numbers, answer.text.into_bytes(), answer.pages];
    let mut header = Vec::with_capacity(28);
    let mut word =
        |word: usize| header.extend(u32::try_from(word).unwrap_or(u32::MAX).to_le_bytes());

    for buffer in buffers {
        let len = buffer.len();

        // An address of wasm32 is four bytes, as a length is.
        word(give(buffer).addr());
        word(len);
    }

    word(more.map_or(0, |more| Box::into_raw(more).addr()));
    give(header)
}

/// A buffer of `len` bytes for the host to write a request or an answer in.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    give(vec![0; len])
}

/// Gives back a buffer the host is done with.
///
/// # Safety
///
/// `at` is a buffer of `len` bytes this module handed the host, which does
/// not read it again.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn free(at: *mut u8, len: usize) {
    // SAFETY: the caller's contract is `take`'s.
    drop(unsafe { take(at, len) });
}

/// # Safety
///
/// `list` is null or what [`push`] returned, and nothing reads it after
/// this call.
unsafe fn list(list: *mut crate::List) -> Option<Box<crate::List>> {
    // SAFETY: the caller's contract is `Box::from_raw`'s.
    (!list.is_null()).then(|| unsafe { Box::from_raw(list) })
}

/// Adds a batch of entries to a list, which it opens where `list` is null,
/// and answers the list, to be handed back with the next batch.
///
/// # Safety
///
/// `list` is null or what this function returned, and the host hands it
/// back once. `at` is what [`alloc`] returned for `len` bytes, and the host
/// does not read it again.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn push(list: *mut crate::List, at: *mut u8, len: usize) -> *mut crate::List {
    // SAFETY: the caller's contract is `list`'s and `take`'s.
    let (list, bytes) = unsafe { (self::list(list), take(at, len)) };

    Box::into_raw(crate::push(list, bytes))
}

/// Adds the last batch of entries to a list, as [`push`] does, and lints
/// it. The answer is written as every answer is, by [`answer`].
///
/// # Safety
///
/// As for [`push`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn entries(list: *mut crate::List, at: *mut u8, len: usize) -> *mut u8 {
    // SAFETY: the caller's contract is `list`'s and `take`'s.
    let (list, bytes) = unsafe { (self::list(list), take(at, len)) };

    answer(crate::entries(list, bytes))
}

/// The next answer of a call.
///
/// # Safety
///
/// `answers` is where an answer said the next one is asked for, and the
/// host asks for it once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn next(answers: *mut crate::Answers) -> *mut u8 {
    // SAFETY: the caller's contract is `Box::from_raw`'s.
    answer(crate::next(unsafe { Box::from_raw(answers) }))
}

macro_rules! export {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        ///
        /// # Safety
        ///
        /// `at` is what [`alloc`] returned for `len` bytes, and the host
        /// does not read it again.
        #[unsafe(no_mangle)]
        pub unsafe extern "C" fn $name(at: *mut u8, len: usize) -> *mut u8 {
            // SAFETY: the caller's contract is `take`'s.
            answer(crate::$name(unsafe { take(at, len) }))
        }
    };
}

export!(
    /// Lints one message.
    message
);
export!(
    /// Reads a catalogue file's text.
    read
);

/// The table of rules.
#[unsafe(no_mangle)]
pub extern "C" fn rules() -> *mut u8 {
    answer(crate::rules())
}

/// Runs the command, and answers its exit code.
///
/// # Safety
///
/// `at` is what [`alloc`] returned for `len` bytes, and the host does not
/// read it again.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn command(at: *mut u8, len: usize) -> i32 {
    // SAFETY: the caller's contract is `take`'s.
    crate::command(unsafe { take(at, len) })
}
