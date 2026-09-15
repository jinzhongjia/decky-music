//! Process-local credential snapshots and metadata; bridge remains the persistence owner.
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as SyncMutex};

use ncm_api_rs::{create_client, ApiClient};
use tokio::sync::{mpsc, Mutex};

pub use crate::deadline::with_timeout;
use crate::device::{self, Device};
use crate::provider_commands::playlists::PlaylistCache;

pub type Out = mpsc::UnboundedSender<String>;

pub struct Session {
    pub credential: Option<String>,
    pub uid: Mutex<Option<String>>,
}

tokio::task_local! { pub static SESSION: Arc<Session>; }

pub struct State {
    pub client: ApiClient,
    session: SyncMutex<Arc<Session>>,
    pub playlists: Mutex<PlaylistCache>,
    pub library_revision: AtomicU64,
    device: Device,
}

impl State {
    pub fn new(state_dir: Option<&str>) -> Self {
        Self {
            client: create_client(None),
            session: SyncMutex::new(Arc::new(Session {
                credential: None,
                uid: Mutex::new(None),
            })),
            playlists: Mutex::new(PlaylistCache::default()),
            library_revision: AtomicU64::new(0),
            device: device::load(state_dir),
        }
    }

    pub fn session(&self) -> Arc<Session> {
        SESSION
            .try_with(Arc::clone)
            .unwrap_or_else(|_| self.live_session())
    }

    pub fn live_session(&self) -> Arc<Session> {
        Arc::clone(&self.session.lock().unwrap())
    }

    pub fn is_current(&self, session: &Arc<Session>) -> bool {
        Arc::ptr_eq(&self.session.lock().unwrap(), session)
    }

    pub fn replace_credential(
        &self,
        credential: Option<String>,
        expected: Option<&Arc<Session>>,
    ) -> bool {
        self.replace_credential_with(credential, expected, || {})
    }

    pub fn replace_credential_with(
        &self,
        credential: Option<String>,
        expected: Option<&Arc<Session>>,
        publish: impl FnOnce(),
    ) -> bool {
        let mut session = self.session.lock().unwrap();
        if expected.is_some_and(|old| !Arc::ptr_eq(&session, old)) {
            return false;
        }
        *session = Arc::new(Session {
            credential,
            uid: Mutex::new(None),
        });
        self.library_revision.fetch_add(1, Ordering::Relaxed);
        publish();
        true
    }

    pub fn publish_response(
        &self,
        expected: Option<&Arc<Session>>,
        out: &Out,
        id: u64,
        response: String,
    ) {
        let session = self.session.lock().unwrap();
        let response = if expected.is_some_and(|old| !Arc::ptr_eq(&session, old)) {
            crate::protocol::err(id, crate::protocol::ErrorCode::Superseded, "superseded")
        } else {
            response
        };
        let _ = out.send(response);
    }

    pub async fn cookie(&self) -> Option<String> {
        let pins = self.device.cookie_pins();
        Some(match self.credential().await {
            Some(c) => format!("{pins}; {c}"),
            None => pins,
        })
    }

    pub fn device_pins(&self) -> Option<String> {
        Some(self.device.cookie_pins())
    }

    pub async fn credential(&self) -> Option<String> {
        self.session().credential.clone()
    }

    /// Invalidate on entry and on exit, including cancellation/timeout. A scan begun
    /// during a mutation cannot leave a reusable pre-mutation page behind.
    pub fn library_mutation(&self) -> LibraryMutation<'_> {
        self.library_revision.fetch_add(1, Ordering::Relaxed);
        LibraryMutation(&self.library_revision)
    }
}

pub struct LibraryMutation<'a>(&'a AtomicU64);
impl Drop for LibraryMutation<'_> {
    fn drop(&mut self) {
        self.0.fetch_add(1, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests;
