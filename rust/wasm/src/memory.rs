/// The most memory the module grows to: two gibibytes, so that an address
/// is below 2^31 and the host reads it as the non-negative number it is.
pub const MAX_MEMORY: usize = 1 << 31;
