import { useEffect, useRef } from "react";
import type { PageType } from "../types";
import type { usePlayer } from "./player";

interface UseSteamInputProps {
  player: ReturnType<typeof usePlayer>;
  currentPage: PageType;
  setCurrentPage: (page: PageType) => void;
}

const DEBOUNCE_MS = 200;

export function useSteamInput({ player, currentPage, setCurrentPage }: UseSteamInputProps) {
  // Refs to avoid closures in event listener
  const playerRef = useRef(player);
  const currentPageRef = useRef(currentPage);
  const lastButtonTimeRef = useRef<Record<number, number>>({});

  useEffect(() => {
    playerRef.current = player;
    currentPageRef.current = currentPage;
  }, [player, currentPage]);

  useEffect(() => {
    /* eslint-disable no-undef */
    // @ts-ignore - SteamClient is global
    if (
      typeof SteamClient === "undefined" ||
      !SteamClient?.Input?.RegisterForControllerInputMessages
    ) {
      return;
    }

    // @ts-ignore
    const unregister = SteamClient.Input.RegisterForControllerInputMessages(
      (_controllerIndex: number, button: number, pressed: boolean) => {
        // Only handle press events
        if (!pressed) return;

        const now = Date.now();
        const lastTime = lastButtonTimeRef.current[button] || 0;
        if (now - lastTime < DEBOUNCE_MS) {
          return;
        }
        lastButtonTimeRef.current[button] = now;

        const p = playerRef.current;
        const page = currentPageRef.current;

        // Only respond if song is loaded
        if (!p.currentSong) return;

        switch (button) {
          case 2: // X - Play/Pause
            p.togglePlay();
            break;
          case 30: // L1 - Prev
            if (p.playlist.length > 1) {
              p.playPrev();
            }
            break;
          case 31: // R1 - Next
            if (p.playlist.length > 1) {
              p.playNext();
            }
            break;
          case 3: // Y - Go to detail
            if (page !== "player" && page !== "login") {
              setCurrentPage("player");
            }
            break;
        }
      }
    );
    /* eslint-enable no-undef */

    return () => {
      unregister?.unregister?.();
    };
  }, []); // Empty dependency array as we use refs
}

