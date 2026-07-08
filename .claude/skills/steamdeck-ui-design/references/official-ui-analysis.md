# Steam Deck Game Mode UI patterns for decky-music

This reference keeps only the SteamOS patterns that matter for decky-music. It intentionally omits the archive's cross-domain examples because video, reading, file-manager, and store UI guidance can distract future agents from this project's music-specific contract.

## 1. Use Tabs and shelves, not content sidebars

Steam Deck Game Mode is a 7-inch, gamepad-first 10-foot UI. PC-style persistent sidebars waste horizontal space and create awkward focus paths.

For decky-music:

- `/music` top-level navigation is horizontal Tabs switched by `L1/R1`.
- Provider pages own their internal content; they do not share one generic sidebar.
- Personal asset pages use second-level Tabs with counts: favorites, recent, created playlists, collected playlists, cloud, etc.
- Content fills the width under the Tabs.

QAM is different: it is a SteamOS system surface. It remains the right place for provider selection, login/account entry, settings, and project links.

## 2. Focus reveals detail

SteamOS pages keep non-focused content quiet and reveal detail when focus lands.

Apply this to music pages:

- Recommendation shelves can show cover/card first, then reveal title, subtitle, and action hints on focus.
- Dense song lists keep stable columns but use focus highlight for the active row.
- Focused cover/card uses a thin white outline and subtle glow/scale.
- Avoid every card permanently showing all actions; use `X` context menus and page-level actions instead.

## 3. Offload secondary actions to overlays

Do not spend permanent screen space on secondary controls.

For decky-music:

- `X`: song/card context menu, lyrics/comment toggle, radio trash/next where the page owns that override.
- `Y`: normal-page queue overlay; radio pages may override to like/favorite.
- Overlays have an independent focus tree and restore the previous focus on close.
- Queue, context menu, confirmation dialog, and account actions belong in overlays or QAM, not persistent content chrome.

## 4. No fixed bottom player bar

SteamOS virtual keyboard resizes the CEF viewport. Fixed bottom controls get pushed upward and steal space from search/content.

Target decky-music replacement:

- Top Tab status badge: current cover, title marquee, playing state. It is display-only and not focusable.
- `Start`: global play/pause blind operation.
- `Y`: queue overlay on normal pages.
- Now Playing / Smart Radio / Private FM pages: full controls, progress, volume, lyrics/comments.

## 5. Footer Legend is a contract, not custom UI

The footer legend belongs to SteamOS.

- Declare action text through Decky/Steam `Focusable` action-description props.
- Do not draw a fake footer bar.
- Do not assume control of icon style, layout, or the left `STEAM` item.
- Keep text synchronized with focus and mode. If `Y` means queue on one page and like on radio, the legend must change at the same time.

## 6. Button semantics for this project

| Button | Normal meaning | Allowed page override |
| :--- | :--- | :--- |
| A | Confirm/play/enter/search/refresh QR | None. |
| B | Back/close/cancel manual browse | None. |
| X | Context menu | Lyrics/comments toggle; radio trash/next. |
| Y | Queue overlay | Radio like/favorite. |
| Start | Play/pause | None for music pages. |
| View | Reserved | Only after a project-specific spike proves need. |
| L1/R1 | Top page Tabs | Immersive pages should avoid stealing this unless explicitly documented. |
| L2/R2 | Secondary Tabs / long-list paging | Seek/page stepping only if the footer declares it. |
| D-Pad | Focus movement | Lyrics scroll, slider micro-adjustment. |

## 7. Anti-patterns

- Persistent left navigation inside `/music`.
- Bottom fixed MiniPlayer in the target P3 route.
- Custom-drawn footer legend.
- Hover-only menus.
- Showing account avatars, logout, or settings inside main content when QAM can own them.
- Rendering huge result sets into Steam's shared Chromium context.
- Passing cover image bytes through bridge RPC.
