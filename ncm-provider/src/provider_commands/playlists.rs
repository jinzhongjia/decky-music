//! Raw-offset windows preserve upstream order before created/favorite classification.
use std::collections::VecDeque;
use std::future::Future;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Weak};
use std::time::Duration;

use ncm_api_rs::Query;
use serde_json::{json, Value};
use tokio::time::Instant;

use super::{call, current_uid, id_string, invalid, paging};
use crate::content::playlist_brief;
use crate::protocol::{self, ErrorCode};
use crate::state::{Session, State};

pub(super) const WINDOW: usize = 100;
const MAX_WINDOWS: usize = 32;
const MAX_BYTES: usize = 2 * 1024 * 1024;
const TTL: Duration = Duration::from_secs(60);

struct Entry {
    created: bool,
    brief: Value,
}

pub(super) struct Window {
    entries: Arc<[Entry]>,
    end: bool,
    bytes: usize,
}

impl Window {
    fn from_body(body: &Value, uid: &str) -> Result<Self, ()> {
        let raw = body["playlist"].as_array().ok_or(())?;
        if raw.len() > WINDOW {
            return Err(());
        }
        let entries: Arc<[Entry]> = raw
            .iter()
            .map(|p| Entry {
                created: id_string(&p["creator"]["userId"]) == uid,
                brief: playlist_brief(p),
            })
            .collect();
        let bytes = entries.iter().map(|p| p.brief.to_string().len()).sum();
        Ok(Self {
            entries,
            bytes,
            end: raw.len() < WINDOW || body["more"] == false,
        })
    }
}

#[derive(Default)]
pub(crate) struct PlaylistCache {
    session: Weak<Session>,
    revision: u64,
    uid: String,
    started: Option<Instant>,
    windows: VecDeque<(usize, Arc<Window>)>,
    bytes: usize,
}

impl PlaylistCache {
    fn prepare(&mut self, session: &Arc<Session>, revision: u64, uid: &str, now: Instant) {
        let same = self
            .session
            .upgrade()
            .is_some_and(|old| Arc::ptr_eq(&old, session));
        if !same
            || self.revision != revision
            || self.uid != uid
            || self
                .started
                .is_none_or(|start| now.duration_since(start) >= TTL)
        {
            self.windows.clear();
            self.bytes = 0;
            self.session = Arc::downgrade(session);
            self.revision = revision;
            self.uid = uid.to_owned();
            self.started = Some(now);
        }
    }

    fn get(&self, offset: usize) -> Option<Arc<Window>> {
        self.windows
            .iter()
            .find(|(at, _)| *at == offset)
            .map(|(_, page)| Arc::clone(page))
    }

    fn insert(&mut self, offset: usize, page: Arc<Window>) {
        if page.bytes > MAX_BYTES {
            return;
        }
        while self.windows.len() >= MAX_WINDOWS || self.bytes + page.bytes > MAX_BYTES {
            if let Some((_, old)) = self.windows.pop_front() {
                self.bytes -= old.bytes;
            }
        }
        self.bytes += page.bytes;
        self.windows.push_back((offset, page));
    }

    async fn page<F, Fut>(
        &mut self,
        created: bool,
        offset: usize,
        limit: usize,
        mut fetch: F,
    ) -> Result<Vec<Value>, String>
    where
        F: FnMut(usize) -> Fut,
        Fut: Future<Output = Result<Window, String>>,
    {
        let mut raw_offset = 0;
        let mut matched = 0;
        let mut result = Vec::with_capacity(limit);
        loop {
            let page = match self.get(raw_offset) {
                Some(page) => page,
                None => {
                    let page = Arc::new(fetch(raw_offset).await?);
                    self.insert(raw_offset, Arc::clone(&page));
                    page
                }
            };
            for item in page.entries.iter().filter(|item| item.created == created) {
                if matched >= offset {
                    result.push(item.brief.clone());
                }
                matched += 1;
                if result.len() == limit {
                    return Ok(result);
                }
            }
            if page.end {
                return Ok(result);
            }
            raw_offset += WINDOW;
        }
    }
}

async fn classified(state: &State, id: u64, args: &Value, created: bool) -> String {
    let Ok((limit, offset)) = paging(args) else {
        return invalid(id);
    };
    let result = classified_page(state, id, created, offset, limit).await;
    match result {
        Ok(playlists) => protocol::ok(id, json!({ "playlists": playlists })),
        Err(error) => error,
    }
}

async fn classified_page(
    state: &State,
    id: u64,
    created: bool,
    offset: usize,
    limit: usize,
) -> Result<Vec<Value>, String> {
    let (uid, cookie) = current_uid(state, id).await?;
    let session = state.session();
    let revision = state.library_revision.load(Ordering::Relaxed);
    let mut cache = state.playlists.lock().await;
    cache.prepare(&session, revision, &uid, Instant::now());
    let result = cache
        .page(created, offset, limit, |raw_offset| {
            let q = Query::new()
                .param("uid", &uid)
                .param("limit", &WINDOW.to_string())
                .param("offset", &raw_offset.to_string())
                .cookie(&cookie);
            let uid = &uid;
            async move {
                let response = call(state.client.user_playlist(&q), id).await?;
                Window::from_body(&response.body, uid)
                    .map_err(|_| protocol::err(id, ErrorCode::ProviderError, "provider_error"))
            }
        })
        .await?;
    if !state.is_current(&session) || state.library_revision.load(Ordering::Relaxed) != revision {
        return Err(protocol::err(id, ErrorCode::Superseded, "superseded"));
    }
    Ok(result)
}

pub async fn created_playlists(state: &State, id: u64, args: &Value) -> String {
    classified(state, id, args, true).await
}

pub async fn fav_playlists(state: &State, id: u64, args: &Value) -> String {
    classified(state, id, args, false).await
}

#[cfg(test)]
mod tests;
