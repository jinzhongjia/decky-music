/**
 * 全屏播放器手柄快捷键 Hook
 */

import { useEffect, useRef } from "react";
import { NAV_ITEMS } from "./navItems";
import type { FullscreenPageType } from "./types";
import type { UsePlayerReturn } from "../../hooks/player";

const DEBOUNCE_MS = 200;

export function useFullscreenGamepad(
  player: UsePlayerReturn,
  currentPage: FullscreenPageType,
  navigateToPage: (page: FullscreenPageType) => void
): void {
  const playerRef = useRef(player);
  const currentPageRef = useRef(currentPage);
  const lastButtonTimeRef = useRef<Record<number, number>>({});

  useEffect(() => {
    playerRef.current = player;
    currentPageRef.current = currentPage;
  }, [player, currentPage]);

  useEffect(() => {
    // @ts-ignore
    // eslint-disable-next-line no-undef
    if (typeof SteamClient === 'undefined' || !SteamClient?.Input?.RegisterForControllerInputMessages) {
      return;
    }

    // @ts-ignore
    // eslint-disable-next-line no-undef
    const unregister = SteamClient.Input.RegisterForControllerInputMessages(
      (_controllerIndex: number, button: number, pressed: boolean) => {
        if (!pressed) return;

        const now = Date.now();
        const lastTime = lastButtonTimeRef.current[button] || 0;
        if (now - lastTime < DEBOUNCE_MS) {
          return;
        }
        lastButtonTimeRef.current[button] = now;

        const p = playerRef.current;
        const page = currentPageRef.current;

        switch (button) {
          case 2: // X
            if (p.currentSong) p.togglePlay();
            break;
          case 30: // L1
            if (p.playlist.length > 1) p.playPrev();
            break;
          case 31: // R1
            if (p.playlist.length > 1) p.playNext();
            break;
          case 28: // LT
          case 29: { // RT
            const activeId = page === 'playlist-detail' ? 'playlists' : page;
            const currentIndex = NAV_ITEMS.findIndex((item) => item.id === activeId);
            if (currentIndex === -1) break;
            const delta = button === 28 ? -1 : 1;
            const nextIndex =
              (currentIndex + delta + NAV_ITEMS.length) % NAV_ITEMS.length;
            navigateToPage(NAV_ITEMS[nextIndex].id as FullscreenPageType);
            break;
          }
        }
      }
    );

    return () => {
      unregister?.unregister?.();
    };
  }, [navigateToPage]);
}

