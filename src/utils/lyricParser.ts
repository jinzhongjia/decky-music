/**
 * LRC 歌词解析器
 * 支持原文和翻译合并显示
 */

export interface LyricLine {
  time: number;  // 毫秒
  text: string;  // 原文
  trans?: string; // 翻译
}

export interface ParsedLyric {
  lines: LyricLine[];
}

/**
 * 解析时间标签 [mm:ss.xx] 或 [mm:ss:xx]
 * @returns 毫秒数
 */
function parseTime(timeStr: string): number {
  // 支持 [mm:ss.xx] 和 [mm:ss:xx] 格式
  const match = timeStr.match(/(\d+):(\d+)[.:](\d+)/);
  if (!match) return -1;
  
  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  let milliseconds = parseInt(match[3], 10);
  
  // 如果是两位数，补齐到三位（10 -> 100）
  if (match[3].length === 2) {
    milliseconds *= 10;
  }
  
  return minutes * 60 * 1000 + seconds * 1000 + milliseconds;
}

/**
 * 解析单行 LRC
 * 支持多时间标签：[00:12.34][00:45.67]歌词内容
 */
function parseLrcLine(line: string): Array<{ time: number; text: string }> {
  const results: Array<{ time: number; text: string }> = [];
  
  // 匹配所有时间标签
  const timeRegex = /\[(\d+:\d+[.:]\d+)\]/g;
  const times: number[] = [];
  let match;
  
  while ((match = timeRegex.exec(line)) !== null) {
    const time = parseTime(match[1]);
    if (time >= 0) {
      times.push(time);
    }
  }
  
  // 获取歌词文本（移除所有时间标签）
  const text = line.replace(/\[\d+:\d+[.:]\d+\]/g, '').trim();
  
  // 为每个时间创建一条记录
  for (const time of times) {
    results.push({ time, text });
  }
  
  return results;
}

/**
 * 解析完整 LRC 歌词
 */
function parseLrc(lrc: string): Map<number, string> {
  const map = new Map<number, string>();
  
  if (!lrc) return map;
  
  const lines = lrc.split('\n');
  
  for (const line of lines) {
    const parsed = parseLrcLine(line);
    for (const { time, text } of parsed) {
      if (text) {  // 只保留有内容的行
        map.set(time, text);
      }
    }
  }
  
  return map;
}

/**
 * 解析歌词（原文 + 翻译）
 */
export function parseLyric(lyric: string, trans?: string): ParsedLyric {
  // 解析原文
  const lyricMap = parseLrc(lyric);
  
  // 解析翻译
  const transMap = trans ? parseLrc(trans) : new Map<number, string>();
  
  // 合并原文和翻译
  const lines: LyricLine[] = [];
  
  // 获取所有时间点并排序
  const allTimes = new Set([...lyricMap.keys(), ...transMap.keys()]);
  const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);
  
  for (const time of sortedTimes) {
    const text = lyricMap.get(time) || '';
    const transText = transMap.get(time);
    
    // 只添加有原文的行
    if (text) {
      lines.push({
        time,
        text,
        trans: transText
      });
    }
  }
  
  return { lines };
}

/**
 * 根据当前播放时间找到对应的歌词索引
 */
export function findCurrentLyricIndex(lines: LyricLine[], currentTimeMs: number): number {
  if (lines.length === 0) return -1;
  
  // 找到最后一个时间小于等于当前时间的歌词
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].time <= currentTimeMs) {
      return i;
    }
  }
  
  return -1;
}

