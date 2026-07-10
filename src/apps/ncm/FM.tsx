// NCM 私人FM 页签(P5d,效果图 ncm-ui/03):未在电台 → 入口大卡;电台中 → 沉浸播放器。
// 状态跟随 queue 事件(queueMode),启动成功后自动切换,无需本地状态机。

import { useState } from "react";
import { FaBroadcastTower } from "react-icons/fa";

import { api, errorText } from "../../api";
import { guard, reportError } from "../../errors";
import { t } from "../../i18n";
import { usePlayer } from "../../player/usePlayer";
import { Immersive } from "../../screens/Immersive";
import { HeroCard } from "../../ui/cards";

const NCM_RED = "#ec4141";

export function FM() {
  const { queueMode } = usePlayer();
  const [starting, setStarting] = useState(false);

  if (queueMode === "radio") {
    return <Immersive title={t("fmTitle")} trash />;
  }

  const start = () =>
    guard(async () => {
      setStarting(true);
      try {
        const r = await api.playRadio("ncm_fm");
        if (!r.ok) reportError(errorText(r.error || "provider_error"));
      } finally {
        setStarting(false);
      }
    });

  return (
    <div
      style={{
        flexGrow: 1,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ width: "min(60%, 480px)", display: "flex" }}>
        <HeroCard
          title={t("fmTitle")}
          subtitle={starting ? t("loading") : t("fmDesc")}
          icon={<FaBroadcastTower />}
          accent={NCM_RED}
          onActivate={start}
          disabled={starting}
        />
      </div>
    </div>
  );
}
