/**
 * Decky Music 插件主入口
 */

import { PanelSection, PanelSectionRow, staticClasses, Spinner } from "@decky/ui";
import { definePlugin, routerHook } from "@decky/api";
import { FaMusic } from "react-icons/fa";

import { getProviderSelection } from "./api";
import { setAuthLoggedIn } from "./features/auth";
import { cleanupPlayer } from "./features/player";
import { useAppLogicNew as useAppLogic } from "./hooks/useAppLogicNew";
import { PlayerBar, ErrorBoundary } from "./components";
import { Router } from "./navigation/Router";
import { FullscreenPlayer } from "./pages";
import { ROUTE_PATH, menuManager } from "./patches";
import type { PageType } from "./types";

// 主内容组件
function Content() {
    const { state, player, nav, data } = useAppLogic();
    const { currentPage, selectedPlaylist } = state;

    const paddingBottom =
        player.currentSong && currentPage !== "player" ? "70px" : "0";

    const isLoading = currentPage === "loading";
    return (
        <div
            className="decky-music-container"
            style={{ paddingBottom }}
        >
            {isLoading ? (
                <PanelSection title="Decky Music">
                    <PanelSectionRow>
                        <Spinner />
                    </PanelSectionRow>
                </PanelSection>
            ) : (
                <Router
                    currentPage={currentPage as PageType}
                    player={player}
                    selectedPlaylist={selectedPlaylist}
                    nav={nav}
                    data={data}
                />
            )}

            {/* 迷你播放器条 - 非全屏播放器页面且有歌曲时显示 */}
            {player.currentSong && currentPage !== "player" && currentPage !== "login" && currentPage !== "loading" && (
                <PlayerBar
                    song={player.currentSong}
                    isPlaying={player.isPlaying}
                    currentTime={player.currentTime}
                    duration={player.duration || player.currentSong.duration}
                    loading={player.loading}
                    onTogglePlay={player.togglePlay}
                    onSeek={player.seek}
                    onClick={nav.onGoToPlayer}
                    onNext={player.playlist.length > 1 ? player.playNext : undefined}
                    onPrev={player.playlist.length > 1 ? player.playPrev : undefined}
                    playMode={player.playMode}
                    onTogglePlayMode={player.cyclePlayMode}
                />
            )}
        </div>
    );
}

// 插件导出
export default definePlugin(() => {
    // TODO: 修复 full screen 的错误
    // 注册全屏路由
    routerHook.addRoute(ROUTE_PATH, FullscreenPlayer);

    // 插件初始化时检查登录状态，已登录则启用左侧菜单并预加载数据
    // 以前是 getLoginStatus()，现在改为 getProviderSelection()
    getProviderSelection()
        .then((result) => {
            // 只要 mainProvider 存在，就视为已登录
            const isLoggedIn = Boolean(result.success && result.mainProvider);
            setAuthLoggedIn(isLoggedIn);
            if (isLoggedIn) {
                menuManager.enable();
            }
        })
        .catch(() => {
            // 忽略错误
        });

    return {
        name: "Decky Music",
        titleView: (
            <div className={staticClasses.Title}>
                <FaMusic style={{ marginRight: "8px" }} />
                Decky Music
            </div>
        ),
        content: (
            <ErrorBoundary>
                <Content />
            </ErrorBoundary>
        ),
        icon: <FaMusic />,
        onDismount() {
            // some clean
            // 清理菜单 patch
            menuManager.cleanup();

            // 移除路由
            routerHook.removeRoute(ROUTE_PATH);

            // 清理播放器
            cleanupPlayer();

            // 移除全局样式
            const styleEl = document.getElementById("decky-music-styles");
            if (styleEl) {
                styleEl.remove();
            }
        },
    };
});
