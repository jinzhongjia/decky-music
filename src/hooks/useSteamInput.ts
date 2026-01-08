import { useEffect, useRef } from "react";
import type { PageType } from "../types";
import type { usePlayer } from "../features/player";
import { setActiveInputSource, isInputSourceActive } from "../utils/inputManager";

/** 防抖间隔（毫秒） */
const DEBOUNCE_INTERVAL = 300;

interface UseSteamInputProps {
  player: ReturnType<typeof usePlayer>;
  currentPage: PageType;
  setCurrentPage: (page: PageType) => void;
}

export function useSteamInput({ player, currentPage, setCurrentPage }: UseSteamInputProps) {
  const playerRef = useRef(player);
  const currentPageRef = useRef(currentPage);
  const lastPressTimeRef = useRef<Record<number, number>>({});

  useEffect(() => {
    playerRef.current = player;
    currentPageRef.current = currentPage;
  }, [player, currentPage]);

  useEffect(() => {
    setActiveInputSource("sidebar");

    // @ts-ignore
    // eslint-disable-next-line no-undef
    if (typeof SteamClient === "undefined" || !SteamClient?.Input?.RegisterForControllerInputMessages) {
      return;
    }

    // @ts-ignore
    // eslint-disable-next-line no-undef
    const unregister = SteamClient.Input.RegisterForControllerInputMessages(
      (_controllerIndex: number, button: number, pressed: boolean) => {
        if (!pressed) return;
        if (!isInputSourceActive("sidebar")) return;

        // 防抖检查
        const now = Date.now();
        const lastPress = lastPressTimeRef.current[button] || 0;
        if (now - lastPress < DEBOUNCE_INTERVAL) return;
        lastPressTimeRef.current[button] = now;

        const p = playerRef.current;
        const page = currentPageRef.current;

        if (!p.currentSong) return;

        switch (button) {
          case 2: // X
            p.togglePlay();
            break;
          case 30: // L1
            if (p.playlist.length > 1) p.playPrev();
            break;
          case 31: // R1
            if (p.playlist.length > 1) p.playNext();
            break;
          case 3: // Y
            if (page !== "player" && page !== "login") setCurrentPage("player");
            break;
        }
      }
    );

    return () => {
      setActiveInputSource("fullscreen");
      unregister?.unregister?.();
    };
  }, [setCurrentPage]);
}
