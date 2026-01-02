/**
 * 歌词解析器
 * 支持 LRC 和 QRC (卡拉OK) 格式
 */

// LRC 格式的歌词行
export interface LyricLine {
  time: number; // 毫秒
  text: string; // 原文
  trans?: string; // 翻译
}

// QRC 格式的逐字信息
export interface LyricWord {
  text: string; // 字/词文本
  start: number; // 开始时间（秒）
  duration: number; // 持续时间（秒）
}

// QRC 格式的歌词行（带逐字时间）
export interface QrcLyricLine {
  time: number; // 行开始时间（秒）
  words: LyricWord[]; // 逐字数组
  text: string; // 完整文本（用于回退显示）
  trans?: string; // 翻译
}

// 解析后的歌词
export interface ParsedLyric {
  lines: LyricLine[]; // LRC 格式行
  qrcLines?: QrcLyricLine[]; // QRC 格式行（如果有）
  isQrc: boolean; // 是否是 QRC 格式
}

// 清理非标准时间标记的正则
const CLEANUP_TIME_MARKER_REGEX = /\(\d+\)|\(\d+,\d+,\d+\)/g;

/**
 * 解析时间标签 [mm:ss.xx] 或 [mm:ss:xx] 或 [mm:ss]
 * @returns 毫秒数，解析失败返回 -1
 */
function parseTime(timeStr: string): number {
  const match = timeStr.match(/(\d+):(\d+)(?:[.:](\d+))?/);
  if (!match) return -1;

  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  let milliseconds = 0;

  if (match[3]) {
    milliseconds = parseInt(match[3], 10);
    // 如果是两位数，补齐到三位（10 -> 100）
    if (match[3].length === 2) {
      milliseconds *= 10;
    }
  }

  return minutes * 60 * 1000 + seconds * 1000 + milliseconds;
}

/**
 * 检查是否是无效的歌词文本（纯符号、间奏标记等）
 */
function isInvalidLyricText(text: string): boolean {
  const trimmed = text.trim();
  return !trimmed || /^[/\-*~\s\\：:.。，,]+$/.test(trimmed);
}

/**
 * 解析完整 LRC 歌词
 */
function parseLrc(lrc: string): Map<number, string> {
  const map = new Map<number, string>();
  if (!lrc || typeof lrc !== "string") return map;

  const cleaned = lrc.replace(/^\uFEFF/, "").replace(/\r/g, "");
  const timeTagRegex = /\[(\d+:\d+(?:[.:]\d+)?)\]/g;

  for (const line of cleaned.split("\n")) {
    const trimmedLine = line.trimEnd();
    if (!trimmedLine) continue;

    const times: number[] = [];
    let match;
    while ((match = timeTagRegex.exec(trimmedLine)) !== null) {
      const time = parseTime(match[1]);
      if (time >= 0) times.push(time);
    }

    const text = trimmedLine.replace(/\[\d+:\d+(?:[.:]\d+)?\]/g, "").trim();
    if (text && !isInvalidLyricText(text)) {
      for (const time of times) {
        map.set(time, text);
      }
    }
  }

  return map;
}

/**
 * 将 LRC Map 转换为 LyricLine 数组
 */
function buildLrcLines(lyricMap: Map<number, string>, transMap: Map<number, string>): LyricLine[] {
  const allTimes = new Set([...lyricMap.keys(), ...transMap.keys()]);
  const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);

  const lines: LyricLine[] = [];
  for (const time of sortedTimes) {
    const text = lyricMap.get(time) || "";
    if (text) {
      lines.push({ time, text, trans: transMap.get(time) });
    }
  }
  return lines;
}

/**
 * 检测是否是 QRC 格式歌词
 * QRC 格式特征：[lineStart,lineDuration]word(start,duration)...
 */
function isQrcFormat(lyric: string): boolean {
  const trimmed = lyric.trim();
  if (!trimmed) return false;

  // 检查前30行是否有 QRC 格式的行首 [数字,数字]
  const lines = trimmed.split("\n").slice(0, 30);
  return lines.some((line) => /^\[\d+,\d+/.test(line.trim()));
}

// 时间标记位置信息
interface TimeMarkerPosition {
  index: number;
  length: number;
  start: number;
  duration: number;
  isValid: boolean;
}

/**
 * 解析 QRC 格式歌词
 * 支持 QQ 音乐和网易云 YRC 格式
 */
function parseQrc(qrc: string): QrcLyricLine[] {
  const result: QrcLyricLine[] = [];
  if (!qrc || typeof qrc !== "string") return result;

  const cleaned = qrc.replace(/^\uFEFF/, "").replace(/\r/g, "");
  // 支持 QQ 音乐 (数字,数字) 和 网易云 YRC (数字,数字,数字)
  const timeMarkerRegex = /\((\d+),(\d+)(?:,\d+)?\)/g;

  for (const line of cleaned.split("\n")) {
    const trimmedLine = line.trimEnd();
    if (!trimmedLine) continue;

    // 匹配行首格式：[数字,数字] 或 [数字,数字,其他]
    const lineMatch = trimmedLine.match(/^\[(\d+),(\d+)(?:,.*?)?\](.+)$/);
    if (!lineMatch) continue;

    const lineStart = parseInt(lineMatch[1], 10);
    if (isNaN(lineStart) || lineStart < 0) continue;

    const content = lineMatch[3];
    const words: LyricWord[] = [];
    let fullText = "";

    // 收集所有时间标记
    const allMarkers: TimeMarkerPosition[] = [];
    let timeMatch;
    while ((timeMatch = timeMarkerRegex.exec(content)) !== null) {
      const start = parseInt(timeMatch[1], 10);
      const duration = parseInt(timeMatch[2], 10);
      if (!isNaN(start) && !isNaN(duration) && start >= 0) {
        allMarkers.push({
          index: timeMatch.index,
          length: timeMatch[0].length,
          start: start / 1000,
          duration: duration / 1000,
          isValid: duration > 0,
        });
      }
    }

    // 提取文本并构建 words 数组
    let lastEnd = 0;
    let lastValidMarker: TimeMarkerPosition | null = null;

    for (const marker of allMarkers) {
      const text = content.substring(lastEnd, marker.index);
      if (text) {
        const wordStart = marker.isValid
          ? marker.start
          : lastValidMarker
            ? lastValidMarker.start + lastValidMarker.duration
            : lineStart / 1000;
        const wordDuration = marker.isValid ? marker.duration : 0.1;
        words.push({ text, start: wordStart, duration: wordDuration });
        fullText += text;
      }
      lastEnd = marker.index + marker.length;
      if (marker.isValid) lastValidMarker = marker;
    }

    // 处理最后一个时间标记后的文本
    if (lastEnd < content.length) {
      const remaining = content.substring(lastEnd).replace(CLEANUP_TIME_MARKER_REGEX, "");
      if (remaining.trim()) {
        const startTime = lastValidMarker
          ? lastValidMarker.start + lastValidMarker.duration
          : lineStart / 1000;
        words.push({ text: remaining, start: startTime, duration: 0.1 });
        fullText += remaining;
      }
    }

    // 如果没有时间标记但有内容，整行作为一个词
    if (words.length === 0 && content.trim()) {
      const cleanedContent = content.replace(CLEANUP_TIME_MARKER_REGEX, "").trim();
      if (cleanedContent) {
        words.push({ text: cleanedContent, start: lineStart / 1000, duration: 0.1 });
        fullText = cleanedContent;
      }
    }

    // 过滤无效行
    if (words.length > 0) {
      const cleanText = fullText.trim();
      const isInterlude = /^[/\-*~\s\\：:]+$/.test(cleanText) || !cleanText;
      const isMetaInfo =
        /^(Writtenby|Composedby|Producedby|Arrangedby|词|曲|编曲|制作|演唱|原唱|翻唱)[\s：:]/i.test(cleanText) ||
        /[-–]\s*(Artist|Singer|Band|作词|作曲|编曲)/i.test(cleanText);
      const allSymbols = words.every((w) => /^[/\-*~\s\\：:.。，,()（）]+$/.test(w.text.trim()));
      const isTitleLine = result.length === 0 && cleanText.includes(" - ") && lineStart < 60000;

      if (!isInterlude && !isMetaInfo && !allSymbols && !isTitleLine) {
        result.push({ time: lineStart / 1000, words, text: fullText });
      }
    }
  }

  return result.sort((a, b) => a.time - b.time);
}

/**
 * 解析歌词（原文 + 翻译）
 * 自动检测 QRC 或 LRC 格式
 */
export function parseLyric(lyric: string, trans?: string): ParsedLyric {
  if (!lyric || typeof lyric !== "string") {
    return { lines: [], isQrc: false };
  }

  const transMap = trans ? parseLrc(trans) : new Map<number, string>();

  // 检测并尝试解析 QRC 格式
  if (isQrcFormat(lyric)) {
    const qrcLines = parseQrc(lyric);

    if (qrcLines.length > 0) {
      // 为 QRC 行添加翻译（时间差在 500ms 内匹配）
      for (const line of qrcLines) {
        const lineTimeMs = line.time * 1000;
        for (const [transTime, transText] of transMap) {
          if (Math.abs(transTime - lineTimeMs) < 500 && !isInvalidLyricText(transText)) {
            line.trans = transText;
            break;
          }
        }
      }

      // 同时生成 LRC 格式的 lines（用于回退）
      const lines: LyricLine[] = qrcLines.map((qrcLine) => ({
        time: qrcLine.time * 1000,
        text: qrcLine.text,
        trans: qrcLine.trans,
      }));

      return { lines, qrcLines, isQrc: true };
    }
    // QRC 解析失败，回退到 LRC
  }

  // LRC 格式解析
  const lyricMap = parseLrc(lyric);
  return { lines: buildLrcLines(lyricMap, transMap), isQrc: false };
}

/**
 * 根据当前播放时间找到对应的歌词索引
 */
export function findCurrentLyricIndex(lines: LyricLine[], currentTimeMs: number): number {
  if (lines.length === 0) return -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].time <= currentTimeMs) {
      return i;
    }
  }
  return -1;
}
