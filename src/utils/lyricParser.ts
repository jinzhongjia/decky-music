/**
 * 歌词解析器
 * 支持 LRC 和 QRC (卡拉OK) 格式
 */

// LRC 格式的歌词行
export interface LyricLine {
  time: number;  // 毫秒
  text: string;  // 原文
  trans?: string; // 翻译
}

// QRC 格式的逐字信息
export interface LyricWord {
  text: string;      // 字/词文本
  start: number;     // 开始时间（秒）
  duration: number;  // 持续时间（秒）
}

// QRC 格式的歌词行（带逐字时间）
export interface QrcLyricLine {
  time: number;      // 行开始时间（秒）
  words: LyricWord[]; // 逐字数组
  text: string;      // 完整文本（用于回退显示）
  trans?: string;    // 翻译
}

// 解析后的歌词
export interface ParsedLyric {
  lines: LyricLine[];      // LRC 格式行
  qrcLines?: QrcLyricLine[]; // QRC 格式行（如果有）
  isQrc: boolean;          // 是否是 QRC 格式
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
  
  // 移除行尾空白字符
  const trimmedLine = line.trimEnd();
  if (!trimmedLine) return results;
  
  // 匹配所有时间标签
  const timeRegex = /\[(\d+:\d+[.:]\d+)\]/g;
  const times: number[] = [];
  let match;
  
  while ((match = timeRegex.exec(trimmedLine)) !== null) {
    const time = parseTime(match[1]);
    if (time >= 0 && !isNaN(time)) {
      times.push(time);
    }
  }
  
  // 获取歌词文本（移除所有时间标签）
  const text = trimmedLine.replace(/\[\d+:\d+[.:]\d+\]/g, '').trim();
  
  // 为每个时间创建一条记录
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
  
  if (!lrc || typeof lrc !== 'string') return map;
  
  // 移除 UTF-8 BOM 和 Windows 换行符 \r，避免干扰正则匹配
  // 同时移除行尾空白字符（空格、制表符等）
  const cleaned = lrc.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const lines = cleaned.split('\n');
  
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
  // 检查是否包含 QRC 特征：[数字,数字] 后跟 字词(数字,数字)
  return /^\[\d+,\d+\]/.test(lyric.trim()) || /\(\d+,\d+\)/.test(lyric);
}

/**
 * 解析 QRC 格式歌词
 * 格式：[lineStart,lineDuration]word1(start,duration)word2(start,duration)...
 */
function parseQrc(qrc: string): QrcLyricLine[] {
  const result: QrcLyricLine[] = [];
  
  if (!qrc || typeof qrc !== 'string') return result;
  
  // 移除 UTF-8 BOM 和 Windows 换行符 \r，避免干扰正则匹配
  const cleaned = qrc.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const lines = cleaned.split('\n');
  
  for (const line of lines) {
    // 移除行尾空白字符，避免干扰匹配
    const trimmedLine = line.trimEnd();
    if (!trimmedLine) continue;
    
    // 匹配行格式：[lineStart,lineDuration]content
    const lineMatch = trimmedLine.match(/^\[(\d+),(\d+)\](.+)$/);
    if (!lineMatch) continue;
    
    const lineStart = parseInt(lineMatch[1], 10);
    // 验证时间戳有效性
    if (isNaN(lineStart) || lineStart < 0) continue;
    
    const content = lineMatch[3];
    const words: LyricWord[] = [];
    let fullText = '';
    
    // 找到所有时间标记的位置 (数字,数字)
    // 注意：使用新的正则实例避免全局标志的重用问题
    const timeRegex = /\((\d+),(\d+)\)/g;
    const timeMatches: Array<{ index: number; start: number; duration: number; length: number }> = [];
    let timeMatch;
    
    while ((timeMatch = timeRegex.exec(content)) !== null) {
      const start = parseInt(timeMatch[1], 10);
      const duration = parseInt(timeMatch[2], 10);
      // 验证时间有效性
      if (isNaN(start) || isNaN(duration) || start < 0 || duration <= 0) continue;
      
      timeMatches.push({
        index: timeMatch.index,
        start: start / 1000,
        duration: duration / 1000,
        length: timeMatch[0].length
      });
    }
    
    // 根据时间标记位置提取文本
    let lastEnd = 0;
    for (const tm of timeMatches) {
      const text = content.substring(lastEnd, tm.index);
      if (text) {  // 可能有空文本
        words.push({ text, start: tm.start, duration: tm.duration });
        fullText += text;
      }
      lastEnd = tm.index + tm.length;
    }
    
    // 处理最后一个时间标记后的文本（如果有）
    if (lastEnd < content.length) {
      const remainingText = content.substring(lastEnd);
      if (remainingText.trim()) {
        // 如果还有文本，使用最后一个时间标记的结束时间
        if (timeMatches.length > 0) {
          const lastTime = timeMatches[timeMatches.length - 1];
          words.push({ 
            text: remainingText, 
            start: lastTime.start + lastTime.duration, 
            duration: 0.1 // 给一个很小的持续时间
          });
          fullText += remainingText;
        }
      }
    }
    
    if (words.length > 0) {
      // 过滤无效行
      const cleanText = fullText.trim();
      
      // 1. 过滤间奏行（纯斜线、纯符号等）
      const isInterlude = /^[/\-*~\s\\：:]+$/.test(cleanText) || cleanText.length === 0;
      
      // 2. 过滤元信息行（歌曲标题、作词作曲等）
      const isMetaInfo = /^(Writtenby|Composedby|Producedby|Arrangedby|词|曲|编曲|制作|演唱|原唱|翻唱)[\s：:]/i.test(cleanText) ||
                         /[-–]\s*(Artist|Singer|Band|作词|作曲|编曲)/i.test(cleanText);
      
      // 3. 检查是否整行都是符号（包括每个 word）
      const allSymbols = words.every(w => /^[/\-*~\s\\：:.。，,()（）]+$/.test(w.text.trim()));
      
      // 4. 过滤第一行如果是歌曲标题格式（包含 " - " 分隔符且在开头）
      const isTitleLine = result.length === 0 && cleanText.includes(' - ') && lineStart < 60000;
      
      if (!isInterlude && !isMetaInfo && !allSymbols && !isTitleLine) {
        result.push({
          time: lineStart / 1000,  // 转为秒
          words,
          text: fullText
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
  if (!lyric || typeof lyric !== 'string') {
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
    const lines: LyricLine[] = qrcLines.map(qrcLine => ({
      time: qrcLine.time * 1000,  // 转为毫秒
      text: qrcLine.text,
      trans: qrcLine.trans
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
    const text = lyricMap.get(time) || '';
    const transText = transMap.get(time);
    
    if (text) {
      lines.push({
        time,
        text,
        trans: transText
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

