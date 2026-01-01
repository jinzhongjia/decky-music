import type { FC } from "react";
import { LoginPage } from "./LoginPage";
import { HomePage } from "./HomePage";
import { SearchPage } from "./SearchPage";
import { PlayerPage } from "./PlayerPage";
import { PlaylistsPage } from "./PlaylistsPage";
import { PlaylistDetailPage } from "./PlaylistDetailPage";
import { HistoryPage } from "./HistoryPage";
import { SettingsPage } from "./SettingsPage";
import { ProviderSettingsPage } from "./ProviderSettingsPage";
import type { PageType, SongInfo, PlaylistInfo } from "../types";
import type { usePlayer } from "../hooks/usePlayer";

export interface NavigationHandlers {
  onLoginSuccess: () => void;
  onLogout: () => void;
  onGoToSearch: () => void;
  onGoToPlaylists: () => void;
  onGoToHistory: () => void;
  onGoToSettings: () => void;
  onGoToProviderSettings: () => void;
  onBackToHome: () => void;
  onBackToPlaylists: () => void;
  onGoToLogin: () => void;
  onGoToPlayer: () => void;
  onClearAllData: () => Promise<boolean>;
}

export interface DataHandlers {
  onSelectSong: (song: SongInfo, playlist?: SongInfo[], source?: string) => void;
  onSelectPlaylist: (playlist: PlaylistInfo) => void;
  onAddSongToQueue: (song: SongInfo) => void;
  onAddPlaylistToQueue: (songs: SongInfo[]) => void;
}

interface RouterProps {
  currentPage: PageType;
  player: ReturnType<typeof usePlayer>;
  selectedPlaylist: PlaylistInfo | null;
  nav: NavigationHandlers;
  data: DataHandlers;
}

export const Router: FC<RouterProps> = ({
  currentPage,
  player,
  selectedPlaylist,
  nav,
  data,
}) => {
  switch (currentPage) {
    case "login":
      return <LoginPage onLoginSuccess={nav.onLoginSuccess} />;

    case "home":
      return (
        <HomePage
          onSelectSong={data.onSelectSong}
          onGoToSearch={nav.onGoToSearch}
          onGoToPlaylists={nav.onGoToPlaylists}
          onGoToHistory={nav.onGoToHistory}
          onGoToSettings={nav.onGoToSettings}
          onLogout={nav.onLogout}
          currentPlayingMid={player.currentSong?.mid}
          onAddSongToQueue={data.onAddSongToQueue}
        />
      );

    case "search":
      return (
        <SearchPage
          onSelectSong={data.onSelectSong}
          onBack={nav.onBackToHome}
          currentPlayingMid={player.currentSong?.mid}
          onAddSongToQueue={data.onAddSongToQueue}
        />
      );

    case "playlists":
      return (
        <PlaylistsPage
          onSelectPlaylist={data.onSelectPlaylist}
          onBack={nav.onBackToHome}
        />
      );

    case "playlist-detail":
      return selectedPlaylist ? (
        <PlaylistDetailPage
          playlist={selectedPlaylist}
          onSelectSong={data.onSelectSong}
          onAddPlaylistToQueue={data.onAddPlaylistToQueue}
          onAddSongToQueue={data.onAddSongToQueue}
          onBack={nav.onBackToPlaylists}
          currentPlayingMid={player.currentSong?.mid}
        />
      ) : (
        <PlaylistsPage
          onSelectPlaylist={data.onSelectPlaylist}
          onBack={nav.onBackToHome}
        />
      );

    case "history":
      return (
        <HistoryPage
          playlist={player.playlist}
          currentIndex={player.currentIndex}
          onSelectIndex={player.playAtIndex}
          onBack={nav.onBackToHome}
          currentPlayingMid={player.currentSong?.mid}
          onRemoveFromQueue={player.removeFromQueue}
        />
      );

    case "player":
      return player.currentSong ? (
        <PlayerPage
          song={player.currentSong}
          isPlaying={player.isPlaying}
          currentTime={player.currentTime}
          duration={player.duration}
          volume={player.volume}
          loading={player.loading}
          error={player.error}
          hasPlaylist={player.playlist.length > 1}
          playMode={player.playMode}
          onTogglePlay={player.togglePlay}
          onTogglePlayMode={player.cyclePlayMode}
          onSeek={player.seek}
          onVolumeChange={player.setVolume}
          onNext={player.playNext}
          onPrev={player.playPrev}
          onBack={nav.onBackToHome}
        />
      ) : (
        <HomePage
          onSelectSong={data.onSelectSong}
          onGoToSearch={nav.onGoToSearch}
          onGoToPlaylists={nav.onGoToPlaylists}
          onGoToHistory={nav.onGoToHistory}
          onGoToSettings={nav.onGoToSettings}
          onLogout={nav.onLogout}
          onAddSongToQueue={data.onAddSongToQueue}
        />
      );

    case "settings":
      return (
        <SettingsPage
          onBack={nav.onBackToHome}
          onClearAllData={nav.onClearAllData}
          onGoToProviderSettings={nav.onGoToProviderSettings}
        />
      );

    case "provider-settings":
      return (
        <ProviderSettingsPage
          onBack={nav.onGoToSettings}
          onGoToLogin={nav.onGoToLogin}
        />
      );

    default:
      return <LoginPage onLoginSuccess={nav.onLoginSuccess} />;
  }
};

