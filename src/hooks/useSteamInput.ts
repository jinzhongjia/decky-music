import { useEffect, useRef } from "react";
import type { PageType } from "../types";
import type { usePlayer } from "../features/player";
import { setActiveInputSource, isInputSourceActive } from "../utils/inputManager";

interface UseSteamInputProps {
  player: ReturnType<typeof usePlayer>;
  currentPage: PageType;
  setCurrentPage: (page: PageType) => void;
}

export function useSteamInput({ player, currentPage, setCurrentPage }: UseSteamInputProps) {
  const playerRef = useRef(player);
  const currentPageRef = useRef(currentPage);

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
