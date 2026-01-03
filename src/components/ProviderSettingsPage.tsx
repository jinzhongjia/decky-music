
import { FC, useCallback, useState } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, Focusable } from "@decky/ui";
import { toaster } from "@decky/api";
import { FaMusic } from "react-icons/fa";

import { getProviderInfo, getProviderSelection } from "../api";
import { useMountedRef } from "../hooks/useMountedRef";
import { useProvider } from "../hooks/useProvider";
import { setAuthLoggedIn } from "../state/authState";
import { useDataManager } from "../hooks/useDataManager";
import { usePlayer } from "../hooks/usePlayer";
import { restoreQueueForProvider } from "../hooks/playerHooks";
import { setProviderId as setQueueProviderId } from "../hooks/useSongQueue";
import { BackButton } from "./BackButton";
import type { ProviderFullInfo } from "../types";

interface Props {
  onBack: () => void;
  onGoToLogin: () => void;
}

export const ProviderSettingsPage: FC<Props> = ({ onBack, onGoToLogin }) => {
  const mountedRef = useMountedRef();
  const { provider, allProviders, switchProvider, loading: providerLoading } = useProvider();
  const dataManager = useDataManager();
  const player = usePlayer();
  
  const [switchingProvider, setSwitchingProvider] = useState(false);
  const [focusedProvider, setFocusedProvider] = useState<string | null>(null);

  const handleProviderSwitch = useCallback(
    async (providerId: string) => {
      if (switchingProvider || providerId === provider?.id) return;
      setSwitchingProvider(true);
      
      try {
        // 1. 切换 Provider（队列已在修改时自动保存，无需手动保存）
        const success = await switchProvider(providerId);
        if (!mountedRef.current) return;
        
        if (success) {
          const providerName = allProviders.find((p) => p.id === providerId)?.name || providerId;
          toaster.toast({ title: "音源已切换", body: providerName });
          
          // 3. 停止当前播放（避免旧 Provider 的音频继续播放）
          // stop() 现在只停止播放，不清空队列
          player.stop();
          
          // 4. 更新全局 provider ID
          setQueueProviderId(providerId);
          
          // 5. 恢复新 provider 的队列
          // 使用 getProviderInfo 确保 provider 信息已更新
          await getProviderInfo();
          await restoreQueueForProvider(providerId);
          
          // 6. 检查登录状态
          const selection = await getProviderSelection();
          if (!mountedRef.current) return;
          
          const isLoggedIn = Boolean(selection.success && selection.mainProvider);
          setAuthLoggedIn(isLoggedIn);
          
          // 7. 刷新首页推荐数据
          dataManager.clearDataCache(); // 清空旧数据
          
          // 8. 如果未登录，跳转登录页
          if (!isLoggedIn) {
            onGoToLogin();
          }
        } else {
          toaster.toast({ title: "切换失败", body: "请稍后重试" });
        }
      } catch (e) {
        if (!mountedRef.current) return;
        toaster.toast({ title: "切换失败", body: (e as Error).message });
      } finally {
        if (mountedRef.current) {
          setSwitchingProvider(false);
        }
      }
    },
    [switchingProvider, provider?.id, switchProvider, mountedRef, allProviders, player, dataManager, onGoToLogin]
  );

  return (
    <>
      <PanelSection title="音源选择">
        <PanelSectionRow>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <FaMusic />
            <span>当前音源：{providerLoading ? "加载中..." : provider?.name || "未知"}</span>
          </div>
        </PanelSectionRow>
        
        {allProviders.length > 0 && (
          <PanelSectionRow>
            <div
              style={{
                width: "100%",
                maxWidth: 520,
                margin: "0 auto",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {allProviders.map((p: ProviderFullInfo) => {
                const active = provider?.id === p.id;
                const focused = focusedProvider === p.id;
                const borderColor = active || focused ? "#1DB954" : "rgba(255,255,255,0.16)";
                const background = active
                  ? "rgba(29,185,84,0.16)"
                  : focused
                    ? "rgba(255,255,255,0.07)"
                    : "rgba(255,255,255,0.05)";
                return (
                  <Focusable
                    key={p.id}
                    onActivate={() => handleProviderSwitch(p.id)}
                    onClick={() => handleProviderSwitch(p.id)}
                    onFocus={() => setFocusedProvider(p.id)}
                    onBlur={() => setFocusedProvider(null)}
                    style={{
                      width: "100%",
                      padding: "0",
                      border: "none",
                      background: "transparent",
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        borderRadius: 12,
                        border: `2px solid ${borderColor}`,
                        background,
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        boxSizing: "border-box",
                        opacity: switchingProvider ? 0.6 : 1,
                      }}
                    >
                      <div
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: "50%",
                          border: "2px solid #1DB954",
                          background: active ? "#1DB954" : "transparent",
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>
                            {active ? "当前使用中" : "点击切换"}
                        </div>
                      </div>
                    </div>
                  </Focusable>
                );
              })}
            </div>
          </PanelSectionRow>
        )}
        
        <PanelSectionRow>
          <div style={{ fontSize: 12, lineHeight: "18px", opacity: 0.8, marginTop: 8 }}>
            注意：切换音源后需要重新登录对应平台的账号。播放队列将自动切换。
          </div>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="账号管理">
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onGoToLogin}>
            登录 / 切换账号
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <BackButton onClick={onBack} />
    </>
  );
};

