import { FC, memo, useMemo, ReactNode } from "react";
import { PanelSectionRow } from "@decky/ui";
import { FaListOl, FaPlay, FaPause, FaRandom, FaRedo, FaStepForward, FaStepBackward } from "react-icons/fa";
import type { PlayMode } from "../../types";
import { FLEX_CENTER, COLORS } from "../../utils/styles";

interface PlayerControlsProps {
  isPlaying: boolean;
  playMode: PlayMode;
  onTogglePlay: () => void;
  onTogglePlayMode: () => void;
  onPrev: () => void;
  onNext: () => void;
}

interface ModeConfig {
  icon: ReactNode;
  label: string;
}

const PlayerControlsComponent: FC<PlayerControlsProps> = ({
  isPlaying,
  playMode,
  onTogglePlay,
  onTogglePlayMode,
  onPrev,
  onNext,
}) => {
  const modeConfig: ModeConfig = useMemo(() => {
    switch (playMode) {
      case "shuffle":
        return { icon: <FaRandom size={18} />, label: "随机播放" };
      case "single":
        return { icon: <FaRedo size={18} />, label: "单曲循环" };
      default:
        return { icon: <FaListOl size={18} />, label: "顺序播放" };
    }
  }, [playMode]);

  return (
    <PanelSectionRow>
      <div style={{ ...FLEX_CENTER, gap: "16px", padding: "15px 0" }}>
        <ControlButton onClick={onTogglePlayMode} title={modeConfig.label} size={46}>
          {modeConfig.icon}
        </ControlButton>
        <ControlButton onClick={onPrev} size={52}>
          <FaStepBackward size={20} />
        </ControlButton>
        <PlayButton isPlaying={isPlaying} onClick={onTogglePlay} />
        <ControlButton onClick={onNext} size={52}>
          <FaStepForward size={20} />
        </ControlButton>
      </div>
    </PanelSectionRow>
  );
};

const ControlButton: FC<{
  onClick: () => void;
  size: number;
  title?: string;
  children: ReactNode;
}> = ({ onClick, size, title, children }) => (
  <div
    onClick={onClick}
    title={title}
    style={{
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: "50%",
      background: COLORS.backgroundDark,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      color: COLORS.textSecondary,
    }}
  >
    {children}
  </div>
);

const PlayButton: FC<{ isPlaying: boolean; onClick: () => void }> = ({ isPlaying, onClick }) => (
  <div
    onClick={onClick}
    style={{
      width: "68px",
      height: "68px",
      borderRadius: "50%",
      background: COLORS.primary,
      color: COLORS.textPrimary,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: `0 4px 16px ${COLORS.primaryShadow}`,
      cursor: "pointer",
    }}
  >
    {isPlaying ? <FaPause size={28} /> : <FaPlay size={28} style={{ marginLeft: "4px" }} />}
  </div>
);

export const PlayerControls = memo(PlayerControlsComponent);
