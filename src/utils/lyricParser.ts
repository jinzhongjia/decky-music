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

/**
 * 解析时间标签 [mm:ss.xx] 或 [mm:ss:xx] 或 [mm:ss]
 * @returns 毫秒数
 */
function parseTime(timeStr: string): number {
  // 支持 [mm:ss.xx]、[mm:ss:xx] 和 [mm:ss] 格式
  const matchWithMs = timeStr.match(/(\d+):(\d+)[.:](\d+)/);
  if (matchWithMs) {
    const minutes = parseInt(matchWithMs[1], 10);
    const seconds = parseInt(matchWithMs[2], 10);
    let milliseconds = parseInt(matchWithMs[3], 10);

    // 如果是两位数，补齐到三位（10 -> 100）
    if (matchWithMs[3].length === 2) {
      milliseconds *= 10;
    }

    return minutes * 60 * 1000 + seconds * 1000 + milliseconds;
  }

  // 支持无毫秒格式 [mm:ss]
  const matchNoMs = timeStr.match(/(\d+):(\d+)$/);
  if (matchNoMs) {
    const minutes = parseInt(matchNoMs[1], 10);
    const seconds = parseInt(matchNoMs[2], 10);
    return minutes * 60 * 1000 + seconds * 1000;
  }

  return -1;
}

/**
 * 解析单行 LRC
 * 支持多时间标签：[00:12.34][00:45.67]歌词内容
 */
function parseLrcLine(line: string): Array<{ time: number; text: string }> {
  const results: Array<{ time: number; text: string }> = [];

  const trimmedLine = line.trimEnd();
  if (!trimmedLine) return results;

  // 匹配所有时间标签：[mm:ss.xx]、[mm:ss:xx] 或 [mm:ss]
  const timeRegex = /\[(\d+:\d+(?:[.:]\d+)?)\]/g;
  const times: number[] = [];
  let match;

  while ((match = timeRegex.exec(trimmedLine)) !== null) {
    const time = parseTime(match[1]);
    if (time >= 0 && !isNaN(time)) {
      times.push(time);
    }
  }

  // 移除所有时间标签格式
  const text = trimmedLine.replace(/\[\d+:\d+(?:[.:]\d+)?\]/g, "").trim();

  for (const time of times) {
    results.push({ time, text });
  }

  return results;
}

/**
 * 检查是否是无效的歌词文本（纯符号、间奏标记等）
 */
function isInvalidLyricText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  // 纯斜线、符号等
  if (/^[/\-*~\s\\：:.。，,]+$/.test(trimmed)) return true;
  return false;
}

/**
 * 解析完整 LRC 歌词
 */
function parseLrc(lrc: string): Map<number, string> {
  const map = new Map<number, string>();

  if (!lrc || typeof lrc !== "string") return map;

  // 移除 UTF-8 BOM 和 Windows 换行符 \r，避免干扰正则匹配
  // 同时移除行尾空白字符（空格、制表符等）
  const cleaned = lrc.replace(/^\uFEFF/, "").replace(/\r/g, "");
  const lines = cleaned.split("\n");

  for (const line of lines) {
    const parsed = parseLrcLine(line);
    for (const { time, text } of parsed) {
      // 过滤空行和纯符号行（如 "//"）
      if (text && !isInvalidLyricText(text)) {
        map.set(time, text);
      }
    }
  }

  return map;
}

/**
 * 检测是否是 QRC 格式歌词
 * QRC 格式特征：[lineStart,lineDuration]word(start,duration)...
 */
function isQrcFormat(lyric: string): boolean {
  const trimmed = lyric.trim();
  const lines = trimmed.split("\n").slice(0, 10);

  let qrcLineCount = 0;
  let lrcLineCount = 0;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // QRC 行首格式：[数字,数字]
    if (/^\[\d+,\d+\]/.test(trimmedLine)) {
      qrcLineCount++;
    }
    // LRC 行首格式：[mm:ss.xx] 或 [mm:ss]
    else if (/^\[\d+:\d+/.test(trimmedLine)) {
      lrcLineCount++;
    }
  }

  // 只有当 QRC 特征行数明显多于 LRC 时才判定为 QRC
  return qrcLineCount > 0 && qrcLineCount > lrcLineCount;
}

// 表示所有时间标记位置（用于从文本中移除）
interface TimeMarkerPosition {
  index: number;
  length: number;
  start: number;
  duration: number;
  isValid: boolean; // duration > 0 为有效
}

/**
 * 解析 QRC 格式歌词
 * 格式：[lineStart,lineDuration]word1(start,duration)word2(start,duration)...
 */
function parseQrc(qrc: string): QrcLyricLine[] {
  const result: QrcLyricLine[] = [];

  if (!qrc || typeof qrc !== "string") return result;

  const cleaned = qrc.replace(/^\uFEFF/, "").replace(/\r/g, "");
  const lines = cleaned.split("\n");

  for (const line of lines) {
    const trimmedLine = line.trimEnd();
    if (!trimmedLine) continue;

    const lineMatch = trimmedLine.match(/^\[(\d+),(\d+)\](.+)$/);
    if (!lineMatch) continue;

    const lineStart = parseInt(lineMatch[1], 10);
    if (isNaN(lineStart) || lineStart < 0) continue;

    const content = lineMatch[3];
    const words: LyricWord[] = [];
    let fullText = "";

    // 找到所有时间标记位置，包括无效的（duration<=0）
    const timeRegex = /\((\d+),(\d+)\)/g;
    const allMarkers: TimeMarkerPosition[] = [];
    let timeMatch;

    while ((timeMatch = timeRegex.exec(content)) !== null) {
      const start = parseInt(timeMatch[1], 10);
      const duration = parseInt(timeMatch[2], 10);

      if (isNaN(start) || isNaN(duration) || start < 0) continue;

      allMarkers.push({
        index: timeMatch.index,
        length: timeMatch[0].length,
        start: start / 1000,
        duration: duration / 1000,
        isValid: duration > 0,
      });
    }

    // 提取文本，移除所有时间标记（包括无效的）
    let lastEnd = 0;
    let lastValidMarker: TimeMarkerPosition | null = null;

    for (const marker of allMarkers) {
      const text = content.substring(lastEnd, marker.index);
      if (text) {
        if (marker.isValid) {
          words.push({ text, start: marker.start, duration: marker.duration });
          lastValidMarker = marker;
        } else if (lastValidMarker) {
          // duration<=0 时，使用上一个有效时间
          words.push({
            text,
            start: lastValidMarker.start + lastValidMarker.duration,
            duration: 0.1,
          });
        } else {
          // 没有有效时间标记，使用行开始时间
          words.push({ text, start: lineStart / 1000, duration: 0.1 });
        }
        fullText += text;
      }
      lastEnd = marker.index + marker.length;

      if (marker.isValid) {
        lastValidMarker = marker;
      }
    }

    // 处理最后一个时间标记后的文本
    if (lastEnd < content.length) {
      const remainingText = content.substring(lastEnd);
      // 清理可能残留的非标准时间标记格式
      const cleanedRemaining = remainingText.replace(/\(\d+\)|\(\d+,\d+,\d+\)/g, "");
      if (cleanedRemaining.trim()) {
        const startTime = lastValidMarker
          ? lastValidMarker.start + lastValidMarker.duration
          : lineStart / 1000;
        words.push({ text: cleanedRemaining, start: startTime, duration: 0.1 });
        fullText += cleanedRemaining;
      }
    }

    // 如果没有时间标记但有内容，整行作为一个词
    if (words.length === 0 && content.trim()) {
      const cleanedContent = content.replace(/\(\d+\)|\(\d+,\d+,\d+\)/g, "").trim();
      if (cleanedContent) {
        words.push({ text: cleanedContent, start: lineStart / 1000, duration: 0.1 });
        fullText = cleanedContent;
      }
    }

    if (words.length > 0) {
      const cleanText = fullText.trim();

      const isInterlude = /^[/\-*~\s\\：:]+$/.test(cleanText) || cleanText.length === 0;

      const isMetaInfo =
        /^(Writtenby|Composedby|Producedby|Arrangedby|词|曲|编曲|制作|演唱|原唱|翻唱)[\s：:]/i.test(
          cleanText
        ) || /[-–]\s*(Artist|Singer|Band|作词|作曲|编曲)/i.test(cleanText);

      const allSymbols = words.every((w) => /^[/\-*~\s\\：:.。，,()（）]+$/.test(w.text.trim()));

      const isTitleLine = result.length === 0 && cleanText.includes(" - ") && lineStart < 60000;

      if (!isInterlude && !isMetaInfo && !allSymbols && !isTitleLine) {
        result.push({
          time: lineStart / 1000,
          words,
          text: fullText,
        });
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
  // 输入验证
  if (!lyric || typeof lyric !== "string") {
    return { lines: [], isQrc: false };
  }

  // 检测是否是 QRC 格式
  const isQrc = isQrcFormat(lyric);

  if (isQrc) {
    // 解析 QRC 格式
    const qrcLines = parseQrc(lyric);

    // 解析翻译（翻译通常是 LRC 格式）
    const transMap = trans ? parseLrc(trans) : new Map<number, string>();

    // 为 QRC 行添加翻译
    for (const line of qrcLines) {
      // 找到最接近的翻译（时间差在 500ms 内）
      const lineTimeMs = line.time * 1000;
      for (const [transTime, transText] of transMap) {
        if (Math.abs(transTime - lineTimeMs) < 500) {
          // 确保翻译不是纯符号
          if (!isInvalidLyricText(transText)) {
            line.trans = transText;
          }
          break;
        }
      }
    }

    // 同时生成 LRC 格式的 lines（用于回退）
    const lines: LyricLine[] = qrcLines.map((qrcLine) => ({
      time: qrcLine.time * 1000, // 转为毫秒
      text: qrcLine.text,
      trans: qrcLine.trans,
    }));

    return { lines, qrcLines, isQrc: true };
  }

  // LRC 格式解析
  const lyricMap = parseLrc(lyric);
  const transMap = trans ? parseLrc(trans) : new Map<number, string>();

  const lines: LyricLine[] = [];
  const allTimes = new Set([...lyricMap.keys(), ...transMap.keys()]);
  const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);

  for (const time of sortedTimes) {
    const text = lyricMap.get(time) || "";
    const transText = transMap.get(time);

    if (text) {
      lines.push({
        time,
        text,
        trans: transText,
      });
    }
  }

  return { lines, isQrc: false };
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
