/**
 * Provider 相关类型定义
 */

/** Provider 能力类型 - 匹配后端 Capability 枚举值 */
export type Capability =
  // 认证相关
  | "auth.qr_login"
  // 搜索相关
  | "search.song"
  | "search.suggest"
  | "search.hot"
  // 播放相关
  | "play.song"
  | "play.quality.lossless"
  | "play.quality.high"
  | "play.quality.standard"
  // 歌词相关
  | "lyric.basic"
  | "lyric.word"
  | "lyric.translation"
  // 推荐相关
  | "recommend.daily"
  | "recommend.personalized"
  | "recommend.playlist"
  // 歌单相关
  | "playlist.user"
  | "playlist.favorite";

/** Provider 基本信息 */
export interface ProviderBasicInfo {
  id: string;
  name: string;
}

/** Provider 完整信息（包含能力列表） */
export interface ProviderFullInfo extends ProviderBasicInfo {
  capabilities: Capability[];
}
