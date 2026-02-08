import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { checkQrStatus } from "../api";

export type QrPollingStatus = "scanned" | "success" | "timeout" | "refused";

interface UseQrStatusPollingOptions {
  mountedRef: MutableRefObject<boolean>;
  onStatus: (status: QrPollingStatus) => void;
}

interface UseQrStatusPollingReturn {
  startCheckingStatus: () => void;
  stopCheckingStatus: () => void;
}

export function useQrStatusPolling({
  mountedRef,
  onStatus,
}: UseQrStatusPollingOptions): UseQrStatusPollingReturn {
  const checkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollInFlightRef = useRef(false);
  const pollSessionRef = useRef(0);

  const stopCheckingStatus = useCallback(() => {
    if (checkTimeoutRef.current) {
      clearTimeout(checkTimeoutRef.current);
      checkTimeoutRef.current = null;
    }
    pollInFlightRef.current = false;
    pollSessionRef.current += 1;
  }, []);

  const startCheckingStatus = useCallback(() => {
    stopCheckingStatus();
    const sessionId = pollSessionRef.current;

    const scheduleNext = () => {
      if (!mountedRef.current || sessionId !== pollSessionRef.current) return;
      checkTimeoutRef.current = setTimeout(() => {
        void pollStatus();
      }, 2000);
    };

    const pollStatus = async () => {
      if (!mountedRef.current || sessionId !== pollSessionRef.current) return;
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;

      let shouldContinue = true;

      try {
        const result = await checkQrStatus();
        if (!mountedRef.current || sessionId !== pollSessionRef.current) return;
        if (!result.success) return;

        switch (result.status) {
          case "success":
            onStatus("success");
            stopCheckingStatus();
            shouldContinue = false;
            break;
          case "scanned":
            onStatus("scanned");
            break;
          case "timeout":
            onStatus("timeout");
            stopCheckingStatus();
            shouldContinue = false;
            break;
          case "refused":
            onStatus("refused");
            stopCheckingStatus();
            shouldContinue = false;
            break;
          default:
            break;
        }
      } finally {
        pollInFlightRef.current = false;
        if (shouldContinue) {
          scheduleNext();
        }
      }
    };

    void pollStatus();
  }, [mountedRef, onStatus, stopCheckingStatus]);

  useEffect(() => stopCheckingStatus, [stopCheckingStatus]);

  return {
    startCheckingStatus,
    stopCheckingStatus,
  };
}
