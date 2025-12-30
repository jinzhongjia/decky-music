/**
 * 登录页面组件
 */

import { FC, useState, useEffect, useRef, useCallback } from "react";
import { PanelSection, PanelSectionRow, ButtonItem } from "@decky/ui";
import { toaster } from "@decky/api";
import { FaQrcode } from "react-icons/fa";
import { getQrCode, checkQrStatus } from "../api";
import { LoadingSpinner } from "./LoadingSpinner";
import { FocusableList } from "./FocusableList";
import { useMountedRef } from "../hooks/useMountedRef";
import { useProvider } from "../hooks/useProvider";
import { COLORS } from "../utils/styles";

interface LoginPageProps {
  onLoginSuccess: () => void;
}

type LoginStatus =
  | "idle"
  | "loading"
  | "waiting"
  | "scanned"
  | "success"
  | "timeout"
  | "refused"
  | "error";

export const LoginPage: FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [qrData, setQrData] = useState<string>("");
  const [status, setStatus] = useState<LoginStatus>("idle");
  const [loginType, setLoginType] = useState<"qq" | "wx" | "netease">("qq");
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useMountedRef();
  const { hasCapability, provider, allProviders, switchProvider, loading: providerLoading } =
    useProvider();
  const [switchingProvider, setSwitchingProvider] = useState(false);

  const canQrLogin = hasCapability("auth.qr_login");
  const isQQMusic = provider?.id === "qqmusic";
  const isNetease = provider?.id === "netease";
  const hasNetease = allProviders.some((p) => p.id === "netease");
  const hasQQ = allProviders.some((p) => p.id === "qqmusic");

  const resetQrState = () => {
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
      checkIntervalRef.current = null;
    }
    setQrData("");
    setStatus("idle");
  };

  const fetchQrCode = async (type: "qq" | "wx" | "netease", targetProviderId?: string) => {
    if (targetProviderId && targetProviderId !== provider?.id) {
      setSwitchingProvider(true);
      resetQrState();
      const switched = await switchProvider(targetProviderId);
      if (!mountedRef.current) return;
      setSwitchingProvider(false);
      if (!switched) {
        toaster.toast({ title: "切换音源失败", body: "请稍后重试" });
        return;
      }
    }

    setLoginType(type);
    setStatus("loading");

    const result = await getQrCode(type);
    if (!mountedRef.current) return;

    if (result.success && result.qr_data) {
      setQrData(result.qr_data);
      setStatus("waiting");
      startCheckingStatus();
    } else {
      setStatus("error");
      toaster.toast({
        title: "获取二维码失败",
        body: result.error || "未知错误",
      });
    }
  };

  const startCheckingStatus = () => {
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
    }

    checkIntervalRef.current = setInterval(async () => {
      const result = await checkQrStatus();
      if (!mountedRef.current) return;

      if (result.success) {
        switch (result.status) {
          case "success":
            clearInterval(checkIntervalRef.current!);
            setStatus("success");
            toaster.toast({
              title: "登录成功",
              body: "欢迎回来！",
            });
            setTimeout(onLoginSuccess, 800);
            break;
          case "scanned":
            setStatus("scanned");
            break;
          case "timeout":
            clearInterval(checkIntervalRef.current!);
            setStatus("timeout");
            break;
          case "refused":
            clearInterval(checkIntervalRef.current!);
            setStatus("refused");
            break;
        }
      }
    }, 2000);
  };

  useEffect(() => {
    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, []);

  const handleProviderSwitch = useCallback(
    async (providerId: string) => {
      if (providerId === provider?.id || switchingProvider) return;
      setSwitchingProvider(true);
      resetQrState();
      const ok = await switchProvider(providerId);
      if (!mountedRef.current) return;
      setSwitchingProvider(false);
      if (ok) {
        const loginDefault = providerId === "netease" ? "netease" : "qq";
        setLoginType(loginDefault);
      }
    },
    [allProviders, mountedRef, provider?.id, switchProvider, switchingProvider]
  );

  const getStatusText = () => {
    switch (status) {
      case "loading":
        return "正在获取二维码...";
      case "waiting":
        return "请使用手机扫描二维码";
      case "scanned":
        return "已扫描，请在手机上确认登录";
      case "success":
        return "✓ 登录成功！";
      case "timeout":
        return "二维码已过期，请刷新";
      case "refused":
        return "登录已取消";
      case "error":
        return "获取二维码失败";
      default:
        return "选择登录方式开始";
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case "success":
        return COLORS.primary;
      case "scanned":
        return "#ffc107";
      case "timeout":
      case "refused":
      case "error":
        return COLORS.error;
      default:
        return "#b8bcbf";
    }
  };

  const loginTypeLabel = loginType === "qq" ? "QQ" : loginType === "wx" ? "微信" : "网易云";

  return (
    <PanelSection title={`🎵 ${provider?.name || "音乐"}登录`}>
      {allProviders.length > 1 && (
        <PanelSectionRow>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              width: "100%",
              boxSizing: "border-box",
            }}
          >
            <div style={{ fontSize: 14, opacity: 0.8 }}>选择音源后登录（无需先退出其他音源）</div>
            <FocusableList gap="8px">
              {allProviders.map((p) => {
                const active = provider?.id === p.id;
                return (
                  <ButtonItem
                    key={p.id}
                    layout="below"
                    disabled={providerLoading || switchingProvider || active}
                    onClick={() => handleProviderSwitch(p.id)}
                  >
                    {active ? "✓ " : ""}
                    {p.name}
                  </ButtonItem>
                );
              })}
            </FocusableList>
          </div>
        </PanelSectionRow>
      )}

      <PanelSectionRow>
        <div
          style={{
            textAlign: "center",
            padding: "10px",
            color: getStatusColor(),
            fontSize: "14px",
            fontWeight: status === "success" ? 600 : 400,
          }}
        >
          {getStatusText()}
        </div>
      </PanelSectionRow>

      {qrData && status !== "success" && (
        <PanelSectionRow>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "15px",
              background: COLORS.textPrimary,
              borderRadius: "12px",
              margin: "0 auto",
              width: "fit-content",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            <img
              src={qrData}
              alt="登录二维码"
              style={{
                width: "180px",
                height: "180px",
                imageRendering: "pixelated",
              }}
            />
          </div>
        </PanelSectionRow>
      )}

      {status === "loading" && <LoadingSpinner padding={20} />}

      {status === "idle" && canQrLogin && (
        <PanelSectionRow>
          {providerLoading && allProviders.length === 0 ? (
            <LoadingSpinner padding={12} />
          ) : (
            <FocusableList gap="10px">
              {(isQQMusic || (!provider && hasQQ)) && (
                <>
                  <ButtonItem
                    layout="below"
                    disabled={switchingProvider || providerLoading}
                    onClick={() => fetchQrCode("qq")}
                  >
                    <FaQrcode style={{ marginRight: "8px" }} />
                    QQ 扫码登录
                  </ButtonItem>
                  <ButtonItem
                    layout="below"
                    disabled={switchingProvider || providerLoading}
                    onClick={() => fetchQrCode("wx")}
                  >
                    <FaQrcode style={{ marginRight: "8px" }} />
                    微信扫码登录
                  </ButtonItem>
                </>
              )}

              {hasNetease && !isNetease && (
                <ButtonItem
                  layout="below"
                  disabled={switchingProvider || providerLoading}
                  onClick={() => fetchQrCode("netease", "netease")}
                >
                  <FaQrcode style={{ marginRight: "8px" }} />
                  网易云扫码登录
                </ButtonItem>
              )}
              {isNetease && (
                <ButtonItem
                  layout="below"
                  disabled={switchingProvider || providerLoading}
                  onClick={() => fetchQrCode("netease")}
                >
                  <FaQrcode style={{ marginRight: "8px" }} />
                  网易云扫码登录
                </ButtonItem>
              )}

              {hasQQ && !isQQMusic && (
                <>
                  <ButtonItem
                    layout="below"
                    disabled={switchingProvider || providerLoading}
                    onClick={() => fetchQrCode("qq", "qqmusic")}
                  >
                    <FaQrcode style={{ marginRight: "8px" }} />
                    QQ 扫码登录
                  </ButtonItem>
                  <ButtonItem
                    layout="below"
                    disabled={switchingProvider || providerLoading}
                    onClick={() => fetchQrCode("wx", "qqmusic")}
                  >
                    <FaQrcode style={{ marginRight: "8px" }} />
                    微信扫码登录
                  </ButtonItem>
                </>
              )}

              {!hasNetease && !providerLoading && (
                <div style={{ fontSize: 12, color: COLORS.textSecondary }}>
                  未检测到网易云音源，请检查后端依赖或设置。
                </div>
              )}
            </FocusableList>
          )}
        </PanelSectionRow>
      )}

      {(status === "timeout" || status === "refused" || status === "error") && (
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => fetchQrCode(loginType)}>
            🔄 刷新二维码
          </ButtonItem>
        </PanelSectionRow>
      )}

      {status !== "idle" && status !== "success" && (
        <PanelSectionRow>
          <div
            style={{
              textAlign: "center",
              fontSize: "12px",
              color: COLORS.textSecondary,
              marginTop: "10px",
            }}
          >
            当前登录方式：{loginTypeLabel}
          </div>
        </PanelSectionRow>
      )}
    </PanelSection>
  );
};
