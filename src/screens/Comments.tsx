// 热评视图(P5f,NCM;效果图 ncm-ui/07):正在播放页 X 键在歌词/热评间切换时挂载。
// 行:头像 + 昵称/时间 + 内容 + 点赞数。点赞快捷键(comment_like)留 P6。

import { Focusable, GamepadButton } from "@decky/ui";
import { useRef } from "react";
import { FaThumbsUp } from "react-icons/fa";

import { api } from "../api";
import { fmtCount, t } from "../i18n";
import { theme } from "../ui/theme";
import { unwrapList, useAsync } from "../ui/useAsync";

// 剥离 Steam 字体必然渲染成豆腐块的区段:新世代 emoji(U+1FA00+)、变体选择符、
// ZWJ、私有区。老 emoji(Steam 有字形)保留;NCM [表情] 括号文本本就按字面显示。
const stripTofu = (s: string) =>
  s.replace(/[\u{FE0F}\u{200D}\u{E000}-\u{F8FF}\u{1FA00}-\u{1FFFF}]/gu, "");

export function CommentsView({ songId }: { songId: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const comments = useAsync(() => unwrapList(api.getComments(songId), (r) => r.comments), [songId]);

  if (comments === null) {
    return (
      <div style={{ flexGrow: 1, display: "flex" }}>
        <div style={{ margin: "auto", color: theme.textDim }}>{t("loading")}</div>
      </div>
    );
  }
  if (comments.length === 0) {
    return (
      <div style={{ flexGrow: 1, display: "flex" }}>
        <div style={{ margin: "auto", color: theme.textDim }}>{t("noComments")}</div>
      </div>
    );
  }
  return (
    // 可聚焦滚动容器:空 onActivate 使 D-pad 右能走进来;onGamepadDirection 上下滚
    // (返回 true 消费不逃焦),按左返回 false 放行 → 焦点退回左侧控制列
    <Focusable
      onActivate={() => {}}
      ref={boxRef as never}
      {...({
        onGamepadDirection: (evt: { detail?: { button?: number } }) => {
          const b = evt?.detail?.button;
          if (b === GamepadButton.DIR_UP) boxRef.current?.scrollBy({ top: -110 });
          else if (b === GamepadButton.DIR_DOWN) boxRef.current?.scrollBy({ top: 110 });
          else return false;
          return true;
        },
      } as object)}
      style={{
        flexGrow: 1,
        minWidth: 0,
        height: "100%",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "0.8rem",
        paddingRight: "0.5rem",
      }}
    >
      {comments.map((c) => (
        <div key={c.id} style={{ display: "flex", gap: "0.6rem" }}>
          <img
            src={c.avatar || undefined}
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "#333",
              flexShrink: 0,
            }}
            alt=""
          />
          <div style={{ minWidth: 0, flexGrow: 1 }}>
            <div style={{ color: theme.textDim, fontSize: "0.78em" }}>{c.user}</div>
            <div style={{ color: theme.text, fontSize: "0.92em", lineHeight: 1.45 }}>
              {stripTofu(c.content)}
            </div>
            {c.likes > 0 && (
              <div
                style={{
                  color: theme.textDim,
                  fontSize: "0.72em",
                  marginTop: "0.2rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.3em",
                }}
              >
                <FaThumbsUp /> {fmtCount(c.likes)}
              </div>
            )}
          </div>
        </div>
      ))}
    </Focusable>
  );
}
