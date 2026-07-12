// Y 键播放队列浮层(P4)。用原生 showModal + ModalRoot:焦点圈定、B 关闭、关闭恢复焦点全由系统管。
// 数据:打开时拉 getQueue;订阅 queue/track 事件实时刷新(跳播/移除/清空立即反映)。
// radio 分支(只显示当前曲 + 退出电台)P5d 启用;当前只有 normal。
// ponytail: 右侧抽屉样式(效果图)后续调,先用 ModalRoot 默认面板保证焦点正确性。

import { DialogButton, Focusable, ModalRoot, showModal } from "@decky/ui";
import { useEffect, useState } from "react";

import { PlayerEv, QueueState, TrackInfo, api, onPlayer } from "../api";
import { guard } from "../errors";
import { t } from "../i18n";
import { fmtTime, theme } from "../ui/theme";

export function openQueueOverlay() {
  showModal(<QueueModal />);
}

// 长队列渲染窗口:当前曲前后各 WINDOW 条(宿主安全:不一次塞几百节点)
const WINDOW = 50;

function QueueModal({ closeModal }: { closeModal?: () => void }) {
  const [q, setQ] = useState<QueueState | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      api
        .getQueue()
        .then((s) => alive && setQ(s))
        .catch(() => {});
    refresh();
    const off = onPlayer((e) => {
      if (e.type === PlayerEv.Queue || e.type === PlayerEv.Track) refresh();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const items = q?.items ?? [];
  const index = q?.index ?? -1;
  const lo = Math.max(0, index - WINDOW);
  const hi = Math.min(items.length, index + WINDOW + 1);

  // 电台模式:不展示未来曲目(保持电台未知感),只显示当前曲 + 退出入口(QUEUE-BEHAVIOR §4)
  if (q?.mode === "radio") {
    const cur = items[0];
    return (
      <ModalRoot closeModal={closeModal} onCancel={closeModal}>
        <div style={{ width: "min(560px, 92vw)" }}>
          <div style={{ color: theme.text, fontWeight: 700, fontSize: "1.1em" }}>
            {t("listeningRadio")}
          </div>
          {cur && (
            <div style={{ marginTop: "0.75rem" }}>
              <QueueRow item={cur} current onPlay={() => {}} onRemove={() => {}} />
            </div>
          )}
          <DialogButton
            style={{ marginTop: "1rem", width: "100%" }}
            onClick={() => guard(() => api.queueClear())}
          >
            {t("exitRadio")}
          </DialogButton>
        </div>
      </ModalRoot>
    );
  }

  const ellipsisRow = (
    <div style={{ color: theme.textDim, textAlign: "center", fontSize: "0.8em" }}>⋯</div>
  );
  return (
    <ModalRoot closeModal={closeModal} onCancel={closeModal}>
      <div style={{ width: "min(560px, 92vw)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: "0.75rem",
            gap: "1rem",
          }}
        >
          <span style={{ color: theme.text, fontWeight: 700, fontSize: "1.1em" }}>
            {t("queueTitle")}
            {items.length > 0 && (
              <span
                style={{
                  color: theme.textDim,
                  fontWeight: 400,
                  fontSize: "0.8em",
                  marginLeft: "0.6em",
                }}
              >
                {index + 1} / {items.length}
              </span>
            )}
          </span>
          {items.length > 0 && (
            <DialogButton
              style={{ minWidth: 0, width: "auto", padding: "0.35em 1.2em", flexShrink: 0 }}
              onClick={() => guard(() => api.queueClear())}
            >
              {t("clearQueue")}
            </DialogButton>
          )}
        </div>

        {items.length === 0 ? (
          <div style={{ color: theme.textDim, textAlign: "center", padding: "2.5rem 0" }}>
            {t("queueEmpty")}
          </div>
        ) : (
          <Focusable
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.2rem",
              maxHeight: 380,
              overflowY: "auto",
            }}
          >
            {lo > 0 && ellipsisRow}
            {items.slice(lo, hi).map((it, k) => {
              const i = lo + k;
              return (
                <QueueRow
                  key={`${it.id}-${i}`}
                  item={it}
                  current={i === index}
                  onPlay={() => guard(() => api.queuePlay(i))}
                  onRemove={() => guard(() => api.queueRemove(i))}
                />
              );
            })}
            {hi < items.length && ellipsisRow}
          </Focusable>
        )}
      </div>
    </ModalRoot>
  );
}

// 队列行:当前曲 Steam 蓝左侧指示条 + 高亮;A 跳播,X 移除(图例随焦点显示)
function QueueRow({
  item,
  current,
  onPlay,
  onRemove,
}: {
  item: TrackInfo;
  current: boolean;
  onPlay: () => void;
  onRemove: () => void;
}) {
  return (
    <Focusable
      onActivate={onPlay}
      onSecondaryButton={onRemove}
      onSecondaryActionDescription={t("remove")}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.45rem 0.6rem",
        borderLeft: current ? `3px solid ${theme.accent}` : "3px solid transparent",
        background: current ? theme.listHighlight : "transparent",
        borderRadius: theme.radius,
      }}
    >
      <img
        src={item.cover || undefined}
        style={{
          width: 40,
          height: 40,
          borderRadius: 2,
          objectFit: "cover",
          background: "#333",
          flexShrink: 0,
        }}
        alt=""
      />
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <div
          style={{
            color: current ? theme.accent : theme.text,
            fontSize: "0.95em",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {item.name || item.id}
        </div>
        {item.singer && (
          <div
            style={{
              color: theme.textDim,
              fontSize: "0.8em",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            {item.singer}
          </div>
        )}
      </div>
      <div style={{ color: theme.textDim, fontSize: "0.8em", flexShrink: 0 }}>
        {item.duration > 0 ? fmtTime(item.duration) : ""}
      </div>
    </Focusable>
  );
}
