use std::io;
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(crate) fn checked_seek(base: u64, offset: i64) -> io::Result<u64> {
    base.checked_add_signed(offset)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid seek"))
}

pub(crate) fn arg(flag: &str) -> Option<String> {
    let mut args = std::env::args();
    while let Some(a) = args.next() {
        if a == flag {
            return args.next();
        }
    }
    None
}
