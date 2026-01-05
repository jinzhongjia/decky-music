/**
 * 全屏播放器手柄快捷键 Hook
 */

import { useEffect, useRef } from "react";
import { NAV_ITEMS } from "./navItems";
import type { FullscreenPageType } from "./types";
import type { UsePlayerReturn } from "../../hooks/player";

/**
 * 使用手柄快捷键
 */
export function useFullscreenGamepad(
  player: UsePlayerReturn,
  currentPage: FullscreenPageType,
  navigateToPage: (page: FullscreenPageType) => void
): void {
  // 保存最新状态到 ref，用于手柄快捷键回调
  const playerRef = useRef(player);
  const currentPageRef = useRef(currentPage);

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

        const p = playerRef.current;
        const page = currentPageRef.current;

        switch (button) {
          case 2: // X - 播放/暂停
            if (p.currentSong) p.togglePlay();
            break;
          case 30: // L1 - 上一曲
            if (p.playlist.length > 1) p.playPrev();
            break;
          case 31: // R1 - 下一曲
            if (p.playlist.length > 1) p.playNext();
            break;
          case 28: // LT - 底部导航左切换
          case 29: { // RT - 底部导航右切换
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

