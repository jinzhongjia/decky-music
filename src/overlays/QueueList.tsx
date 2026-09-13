import { Focusable, NavEntryPositionPreferences } from "@decky/ui";
import { useLayoutEffect, useRef, useState } from "react";
import { FaMusic, FaPause, FaPlay } from "react-icons/fa";

import { TrackInfo, api } from "../api";
import { guard } from "../errors";
import { t } from "../i18n";
import { fmtTime } from "../ui/theme";
import { windowRange } from "../ui/windowRange";

const ROW_HEIGHT = 72;

export function QueueTrack({ item }: { item: TrackInfo }) {
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => setFailed(false), [item.cover]);
  return (
    <>
      {item.cover && !failed ? (
        <img
          className="dm-queue-cover"
          src={item.cover}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="dm-queue-cover" style={{ display: "grid", placeItems: "center" }}>
          <FaMusic aria-hidden />
        </div>
      )}
      <div className="dm-queue-track">
        <div className="dm-queue-track-name">{item.name || item.id}</div>
        <div className="dm-queue-track-singer">{item.singer}</div>
      </div>
      <span className="dm-queue-duration">{item.duration > 0 ? fmtTime(item.duration) : ""}</span>
    </>
  );
}

function QueueRow({
  item,
  index,
  current,
  playing,
  initial,
  preferred,
  onFocus,
}: {
  item: TrackInfo;
  index: number;
  current: boolean;
  playing: boolean;
  initial: boolean;
  preferred: boolean;
  onFocus: () => void;
}) {
  return (
    <Focusable
      className="dm-queue-row"
      data-current={current}
      data-queue-index={index}
      noFocusRing
      focusClassName="dm-queue-focus"
      preferredFocus={preferred}
      {...(initial ? { autoFocus: true } : {})}
      onGamepadFocus={onFocus}
      onActivate={() => guard(() => api.queuePlay(index))}
      onOKActionDescription={t("queuePlay")}
      onSecondaryButton={() => guard(() => api.queueRemove(index))}
      onSecondaryActionDescription={t("remove")}
    >
      <span className="dm-queue-marker" data-current={current} aria-hidden>
        {current ? playing ? <FaPlay /> : <FaPause /> : index + 1}
      </span>
      <QueueTrack item={item} />
    </Focusable>
  );
}

function useQueueViewport(count: number, initialIndex: number) {
  const root = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({
    top: Math.max(0, initialIndex - 1) * ROW_HEIGHT,
    height: 360,
  });
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    element.scrollTop = Math.max(0, initialIndex - 1) * ROW_HEIGHT;
    const measure = () => setViewport({ top: element.scrollTop, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [initialIndex]);
  const onScroll = (event: React.UIEvent<HTMLDivElement>) =>
    setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight });
  return {
    root,
    range: windowRange(count, ROW_HEIGHT, viewport.top, viewport.height, 12),
    onScroll,
  };
}

export function QueueList({
  items,
  index,
  playing,
}: {
  items: TrackInfo[];
  index: number;
  playing: boolean;
}) {
  const initial = useRef(Math.max(0, index));
  const didInitialFocus = useRef(false);
  const [focused, setFocused] = useState(initial.current);
  const { root, range, onScroll } = useQueueViewport(items.length, initial.current);
  return (
    <Focusable
      ref={root}
      className="dm-queue-list"
      flow-children="column"
      navEntryPreferPosition={NavEntryPositionPreferences.PREFERRED_CHILD}
      onScroll={onScroll}
    >
      <div style={{ height: range.before }} />
      {items.slice(range.start, range.end).map((item, offset) => {
        const i = range.start + offset;
        return (
          <div key={i} style={{ height: ROW_HEIGHT, display: "flex", flexDirection: "column" }}>
            <QueueRow
              item={item}
              index={i}
              current={i === index}
              playing={playing}
              initial={i === initial.current && !didInitialFocus.current}
              preferred={i === Math.min(focused, items.length - 1)}
              onFocus={() => {
                didInitialFocus.current = true;
                setFocused(i);
              }}
            />
          </div>
        );
      })}
      <div style={{ height: range.after }} />
    </Focusable>
  );
}
