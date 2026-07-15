---
name: steamdeck-ui-design
description: Project-specific Steam Deck Game Mode UI rules for decky-music. Use when designing, implementing, or reviewing the `/music` Decky route, provider pages, QAM entry points, gamepad focus behavior, Footer Legend text, or UI mockups.
---

# Steam Deck UI Design for decky-music

Use this skill for decky-music UI work. It is adapted from `steamdeck-ui-design-skill.zip` and intentionally narrowed to this project.

## Project source of truth

Read these before changing UI behavior:

- `docs/DESIGN.md` §6: architecture-level UI constraints.
- `docs/ui-design/specs/steam-deck-ui-rules.md`: shared visual, focus, button, Footer Legend, and host-safety contract.
- `docs/ui-design/specs/qq-ui.md`: QQ provider page rules.
- `docs/ui-design/specs/ncm-ui.md`: NCM provider page rules.
- `docs/ROADMAP.md`: current P3+ implementation order.

## Adjustments from the upstream skill

The upstream archive contained broad 10-foot UI guidance. For this repo, apply these corrections:

1. **No sidebars means no persistent sidebars inside `/music` content.** QAM itself is a SteamOS side panel and remains valid for provider selection, login, settings, and project links.
2. **Footer Legend is system-rendered.** Do not draw a custom footer bar. Use `Focusable` action-description props; Steam renders icon style, layout, and the left `STEAM` item.
3. **No bottom fixed MiniPlayer in the target P3 UI.** Soft keyboard resize pushes fixed bottom bars upward. Use the Tab status badge, `Start` blind play/pause, `Y` queue overlay, and Now Playing / radio pages for full controls.
4. **View is reserved.** Do not bind `View` to multi-select or playback controls unless a real project need is validated. It is not part of the P3 required path.
5. **Cross-domain examples are out of scope.** Video, reading, file-manager, and store patterns are not part of this project skill; use only the music-plugin rules below.

## Core layout contract

- `/music` uses top horizontal provider Tabs and full-width content.
- QQ pages: 推荐 / 搜索 / 我的音乐 / 智能电台 / 正在播放.
- NCM pages: 发现 / 私人 FM / 搜索 / 我的 / 正在播放.
- SteamOS global chrome is system-owned: search, notifications, Wi-Fi, battery, time, avatar. Do not draw or focus it.
- Put provider logo, top Tabs, `L1/R1` hints, and the current-track status badge in the content header row.
- Personal asset pages use the Steam library pattern: second-level Tabs with counts plus full-width list/grid content.
- Search pages must survive soft-keyboard resize without overlapping or fixed-bottom controls.

## Focus and gamepad contract

Every interactive element must be reachable by gamepad focus.

| Button | decky-music meaning |
| :--- | :--- |
| A | Confirm, play, enter detail, submit search, refresh QR. |
| B | Back, close overlay, cancel manual lyric/comment browsing. |
| X | Context menu; NCM lyrics/comment toggle; radio page may override for trash/next. |
| Y | Queue overlay on normal pages; radio pages may override for like/favorite. |
| Start | Global play/pause blind operation. Hide the hint when queue is empty or backend is unavailable. |
| View | Reserved; do not use for required flows. |
| L1/R1 | Top-level provider page switching. |
| L2/R2 | Secondary Tabs or long-list paging. |
| D-Pad / left stick | Focus roaming; lyrics manual scroll; slider micro-adjustment. |
| Steam / QAM | System reserved, never bind. |

Hard rules:

- Wrap all clickable rows, cards, buttons, and sliders in `Focusable` or a Decky component that participates in the focus tree.
- Use `MAINTAIN_X` for grids and multi-column layouts.
- No hover-only, touch-only, hidden click zones, or pointer-only affordances.
- Overlays have their own focus tree and restore the previous focus on close.
- Footer Legend text must match the current focus and mode in the same state update.

## Visual contract

- Use near-black SteamOS-style backgrounds.
- Use Steam blue `#1a9fff` as the main interaction color.
- Use QQ green / NCM red only for brand accents and like-state highlights.
- Cover art is the card; avoid phone-app rounded containers.
- Focus state: thin white outline close to the element, subtle glow/scale.
- List focus: horizontal grey gradient with optional Steam-blue left rail.
- Cover images load from CDN thumbnails with an `onError` placeholder; never send image bytes through bridge RPC.

## Host-safety contract

Steam UI and plugin UI share one Chromium context. A plugin bug must not freeze Steam.

- Catch all async handlers, timers, RPC calls, and event callbacks.
- Treat malformed backend events as data to ignore, not as render-time assumptions.
- Limit list rendering with pagination or virtualization.
- Clean timers, event listeners, routes, and overlays on unmount.
- Do not monkey-patch Steam globals or write project globals.
- Do not expose URL, cookie, credential, or raw provider secrets to UI logs.

## Verification checklist

Before considering UI work done:

- Pure gamepad flow works: enter `/music`, switch Tabs, search/open content, play, pause/resume, open/close queue, open/close context menu.
- Soft keyboard does not push a fixed player bar over content.
- Footer Legend shows only currently executable actions.
- Backend down, malformed data, empty lists, and network errors render recoverable states.
- Steam UI remains responsive; worst case only decky-music shows an error boundary.
