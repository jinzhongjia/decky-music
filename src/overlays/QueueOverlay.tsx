import { Focusable, ModalRoot, showModal } from "@decky/ui";
import { ReactNode, useEffect, useState } from "react";
import { FaTimes } from "react-icons/fa";

import { PlayerEv, QueueState, api, onPlayer } from "../api";
import { guard } from "../errors";
import { t } from "../i18n";
import { usePlayer } from "../player/usePlayer";
import { QueueList, QueueTrack } from "./QueueList";
import { queueStyles } from "./queueStyles";

export function openQueueOverlay() {
  showModal(<QueueModal />, undefined, { bNeverPopOut: true, strTitle: t("queueTitle") });
}

function isQueue(value: unknown): value is QueueState {
  if (!value || typeof value !== "object") return false;
  const q = value as QueueState;
  return (
    (q.mode === "normal" || q.mode === "radio") &&
    Array.isArray(q.items) &&
    Number.isInteger(q.index) &&
    q.index >= -1 &&
    q.index < q.items.length &&
    q.items.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.singer === "string" &&
        typeof item.cover === "string" &&
        Number.isFinite(item.duration) &&
        item.duration >= 0
    )
  );
}

function useQueueSnapshot() {
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    let sequence = 0;
    const refresh = () => {
      const request = ++sequence;
      api
        .getQueue()
        .then((value) => {
          if (!alive || request !== sequence) return;
          if (!isQueue(value)) throw new Error("Invalid queue snapshot");
          setQueue(value);
          setError(false);
        })
        .catch(() => {
          if (alive && request === sequence) {
            setQueue(null);
            setError(true);
          }
        });
    };
    refresh();
    const off = onPlayer((event) => {
      if (event.type === PlayerEv.Queue || event.type === PlayerEv.Track) refresh();
    });
    return () => {
      alive = false;
      off();
    };
  }, [attempt]);
  return {
    queue,
    error,
    retry: () => {
      setError(false);
      setAttempt((n) => n + 1);
    },
  };
}

function QueueAction({
  children,
  label,
  action,
  close = false,
  initial = false,
}: {
  children: ReactNode;
  label: string;
  action: () => void;
  close?: boolean;
  initial?: boolean;
}) {
  return (
    <Focusable
      className={`dm-queue-action${close ? " dm-queue-close" : ""}`}
      noFocusRing
      focusClassName="dm-queue-focus"
      aria-label={label}
      onActivate={action}
      onOKActionDescription={label}
      preferredFocus={initial}
      {...(initial ? { autoFocus: true } : {})}
    >
      {children}
    </Focusable>
  );
}

function QueueHeader({ queue, close }: { queue: QueueState | null; close?: () => void }) {
  const radio = queue?.mode === "radio";
  return (
    <div className="dm-queue-header">
      <h2 id="dm-queue-title" className="dm-queue-title">
        {t(radio ? "listeningRadio" : "queueTitle")}
        {!radio && !!queue?.items.length && (
          <span className="dm-queue-count">
            {queue.items.length} {t("songsUnit")}
          </span>
        )}
      </h2>
      {!radio && !!queue?.items.length && (
        <QueueAction label={t("clearQueue")} action={() => guard(() => api.queueClear())}>
          {t("clearQueue")}
        </QueueAction>
      )}
      <QueueAction
        key={queue?.items.length ? "populated" : "empty"}
        label={t("back")}
        close
        initial={radio || !queue?.items.length}
        action={() => close?.()}
      >
        <FaTimes aria-hidden />
      </QueueAction>
    </div>
  );
}

function RadioQueue({ queue, close }: { queue: QueueState; close?: () => void }) {
  const item = queue.items[0];
  return (
    <>
      <div className="dm-queue-radio">
        <div className="dm-queue-label">{t("queueCurrentTrack")}</div>
        {item && (
          <div className="dm-queue-radio-track">
            <QueueTrack item={item} />
          </div>
        )}
        <p className="dm-queue-description">{t("queueRadioDescription")}</p>
      </div>
      <div className="dm-queue-secondary">
        <QueueAction
          label={t("exitRadio")}
          action={() =>
            guard(async () => {
              await api.queueClear();
              close?.();
            })
          }
        >
          {t("exitRadio")}
        </QueueAction>
      </div>
    </>
  );
}

function QueueModal({ closeModal }: { closeModal?: () => void }) {
  const { queue, error, retry } = useQueueSnapshot();
  const { playing } = usePlayer();
  return (
    <ModalRoot
      closeModal={closeModal}
      onCancel={closeModal}
      bOKDisabled
      bHideCloseIcon
      className="dm-queue-dialog"
      modalClassName="dm-queue-modal"
      aria-labelledby="dm-queue-title"
    >
      <style>{queueStyles}</style>
      <Focusable
        className="dm-queue-shell"
        flow-children="column"
        onCancelButton={closeModal}
        onCancelActionDescription={t("back")}
      >
        <QueueHeader queue={queue} close={closeModal} />
        {!queue ? (
          <div className="dm-queue-message">
            {t(error ? "queueUnavailable" : "loading")}
            {error && (
              <QueueAction label={t("queueRetry")} action={retry}>
                {t("queueRetry")}
              </QueueAction>
            )}
          </div>
        ) : queue.mode === "radio" ? (
          <RadioQueue queue={queue} close={closeModal} />
        ) : queue.items.length ? (
          <QueueList items={queue.items} index={queue.index} playing={playing} />
        ) : (
          <div className="dm-queue-message">{t("queueEmpty")}</div>
        )}
      </Focusable>
    </ModalRoot>
  );
}
