/**
 * 格式化工具函数
 */

/**
 * 格式化时长为 mm:ss 格式
 */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 格式化播放次数
 */
export function formatPlayCount(count: number): string {
  if (count >= 100000000) {
    return `${(count / 100000000).toFixed(1)}亿`;
  }
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}万`;
  }
  return count.toString();
}

/**
 * 获取专辑封面 URL
 */
export function getAlbumCover(albumMid: string, size: number = 300): string {
  if (!albumMid) {
    return '';
  }
  return `https://y.qq.com/music/photo_new/T002R${size}x${size}M000${albumMid}.jpg`;
}

/**
 * 生成默认封面占位图
 */
export function getDefaultCover(size: number = 48): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect fill="#2a2a2a" width="${size}" height="${size}" rx="6"/><text x="${size/2}" y="${size/2 + 6}" text-anchor="middle" fill="#666" font-size="${size/3}">♪</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

