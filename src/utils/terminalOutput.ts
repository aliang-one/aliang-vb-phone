const escapeControl = String.fromCharCode(27);
const csiControl = String.fromCharCode(155);

const oscPattern = new RegExp(
  `${escapeControl}\\][\\s\\S]*?(?:\\u0007|${escapeControl}\\\\)`,
  'g',
);
const csiPattern = new RegExp(
  `(?:${escapeControl}\\[|${csiControl})[0-?]*[ -/]*[@-~]`,
  'g',
);
const escapeSequencePattern = new RegExp(
  `${escapeControl}[0-?]*[ -/]*[@-~]`,
  'g',
);
const controlPattern =
// eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g;
const screenRewritePattern = new RegExp(
  `${escapeControl}c|(?:${escapeControl}\\[|${csiControl})(?:\\?(?:1049|1047|47)[hl]|[?=><0-9;]*[Hf]|(?:2|3)(?:;[0-9]*)*J)`,
);
const eraseDisplayBelowPattern = new RegExp(
  `(?:${escapeControl}\\[|${csiControl})0?J`,
);
const carriageReturnRewritePattern = /\r(?!\n)/;
const carriageReturnCleanupPattern = /\r[ \t]*\r?$/;

const base64Chars =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export type TerminalDisplayMode =
  | 'append'
  | 'replaceScreen'
  | 'rewriteLastLine';

export interface TerminalDisplayUpdate {
  mode: TerminalDisplayMode;
  text: string;
  lines: string[];
}

interface TerminalScreenProjection {
  text: string;
  lines: string[];
}

const decodeUtf8Bytes = (bytes: number[]) => {
  let output = '';
  let index = 0;

  while (index < bytes.length) {
    const first = bytes[index];

    if (first < 0x80) {
      output += String.fromCharCode(first);
      index += 1;
      continue;
    }

    if ((first & 0xe0) === 0xc0 && index + 1 < bytes.length) {
      output += String.fromCharCode(
        ((first & 0x1f) << 6) | (bytes[index + 1] & 0x3f),
      );
      index += 2;
      continue;
    }

    if ((first & 0xf0) === 0xe0 && index + 2 < bytes.length) {
      output += String.fromCharCode(
        ((first & 0x0f) << 12) |
          ((bytes[index + 1] & 0x3f) << 6) |
          (bytes[index + 2] & 0x3f),
      );
      index += 3;
      continue;
    }

    if ((first & 0xf8) === 0xf0 && index + 3 < bytes.length) {
      const codePoint =
        ((first & 0x07) << 18) |
        ((bytes[index + 1] & 0x3f) << 12) |
        ((bytes[index + 2] & 0x3f) << 6) |
        (bytes[index + 3] & 0x3f);
      output += String.fromCodePoint(codePoint);
      index += 4;
      continue;
    }

    output += String.fromCharCode(first);
    index += 1;
  }

  return output;
};

const decodeBase64 = (value: string) => {
  const clean = value.replace(/\s/g, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of clean) {
    if (char === '=') break;
    const digit = base64Chars.indexOf(char);
    if (digit < 0) return value;
    buffer = (buffer << 6) | digit;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return decodeUtf8Bytes(bytes);
};

export const decodeTerminalData = (data: string, encoding = 'text') => {
  if (encoding.toLowerCase() !== 'base64') return data;
  return decodeBase64(data);
};

export const stripTerminalControlCodes = (value: string) =>
  value
    .replace(oscPattern, '')
    .replace(csiPattern, '')
    .replace(escapeSequencePattern, '')
    .replace(controlPattern, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

export const terminalDisplayText = (data: string, encoding = 'text') =>
  stripTerminalControlCodes(decodeTerminalData(data, encoding));

const splitTerminalDisplayLines = (text: string) =>
  text
    .split('\n')
    .map(item => item.replace(/[ \t]+$/g, ''))
    .filter(item => item.length > 0);

const parseCsiParams = (params: string) =>
  params
    .replace(/[?=><]/g, '')
    .split(';')
    .map(item => {
      if (!item.length) return undefined;
      const value = Number(item);
      return Number.isFinite(value) ? value : undefined;
    });

const readCsiSequence = (value: string, startIndex: number) => {
  const bodyStart =
    value[startIndex] === csiControl ? startIndex + 1 : startIndex + 2;
  let index = bodyStart;

  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      return {
        endIndex: index + 1,
        final: value[index],
        params: value.slice(bodyStart, index).replace(/[ -/]+$/g, ''),
      };
    }
    index += 1;
  }

  return undefined;
};

const findOscEnd = (value: string, startIndex: number) => {
  for (let index = startIndex + 2; index < value.length; index += 1) {
    if (value[index] === '\u0007') return index + 1;
    if (value[index] === escapeControl && value[index + 1] === '\\') {
      return index + 2;
    }
  }

  return value.length;
};

const ensureScreenRow = (screen: string[][], row: number) => {
  while (screen.length <= row) {
    screen.push([]);
  }
  return screen[row];
};

const eraseLine = (
  screen: string[][],
  rowIndex: number,
  colIndex: number,
  mode: number,
) => {
  const row = ensureScreenRow(screen, rowIndex);
  if (mode === 2) {
    screen[rowIndex] = [];
    return;
  }
  if (mode === 1) {
    for (let index = 0; index <= colIndex; index += 1) {
      row[index] = ' ';
    }
    return;
  }

  row.length = Math.max(0, colIndex);
};

const eraseDisplay = (
  screen: string[][],
  rowIndex: number,
  colIndex: number,
  mode: number,
) => {
  if (mode === 2 || mode === 3) {
    screen.length = 0;
    return;
  }

  if (mode === 1) {
    for (let index = 0; index < rowIndex; index += 1) {
      screen[index] = [];
    }
    eraseLine(screen, rowIndex, colIndex, 1);
    return;
  }

  eraseLine(screen, rowIndex, colIndex, 0);
  screen.length = Math.min(screen.length, rowIndex + 1);
};

const isPrintableTerminalChar = (char: string) =>
  char >= ' ' && char !== '\u007f';

const projectTerminalScreen = (
  decoded: string,
  previousScreenLines: string[] = [],
): TerminalScreenProjection => {
  const screen = previousScreenLines.map(item => item.split(''));
  const touchedRows = new Set<number>();
  let row = 0;
  let col = 0;
  let sawDisplayReset = false;
  let sawHome = false;

  for (let index = 0; index < decoded.length; ) {
    const char = decoded[index];

    if (char === escapeControl && decoded[index + 1] === ']') {
      index = findOscEnd(decoded, index);
      continue;
    }

    if (
      char === csiControl ||
      (char === escapeControl && decoded[index + 1] === '[')
    ) {
      const sequence = readCsiSequence(decoded, index);
      if (!sequence) break;

      const params = parseCsiParams(sequence.params);
      const first = params[0] ?? 0;
      const distance = Math.max(1, first || 1);

      switch (sequence.final) {
        case 'A':
          row = Math.max(0, row - distance);
          break;
        case 'B':
          row += distance;
          break;
        case 'C':
          col += distance;
          break;
        case 'D':
          col = Math.max(0, col - distance);
          break;
        case 'G':
          col = Math.max(0, (params[0] ?? 1) - 1);
          break;
        case 'H':
        case 'f':
          row = Math.max(0, (params[0] ?? 1) - 1);
          col = Math.max(0, (params[1] ?? 1) - 1);
          if (row === 0 && col === 0) sawHome = true;
          break;
        case 'J':
          eraseDisplay(screen, row, col, first);
          sawDisplayReset = true;
          break;
        case 'K':
          eraseLine(screen, row, col, first);
          break;
        case 'h':
        case 'l':
          if (sequence.params.includes('?1049')) {
            screen.length = 0;
            row = 0;
            col = 0;
            sawDisplayReset = true;
          }
          break;
      }

      index = sequence.endIndex;
      continue;
    }

    if (char === escapeControl) {
      if (decoded[index + 1] === 'c') {
        screen.length = 0;
        row = 0;
        col = 0;
        sawDisplayReset = true;
        index += 2;
        continue;
      }
      index += 2;
      continue;
    }

    if (char === '\r') {
      col = 0;
      index += 1;
      continue;
    }

    if (char === '\n') {
      row += 1;
      col = 0;
      index += 1;
      continue;
    }

    if (char === '\b') {
      col = Math.max(0, col - 1);
      index += 1;
      continue;
    }

    if (char === '\t') {
      col += 8 - (col % 8);
      index += 1;
      continue;
    }

    if (isPrintableTerminalChar(char)) {
      const screenRow = ensureScreenRow(screen, row);
      screenRow[col] = char;
      touchedRows.add(row);
      col += 1;
    }

    index += 1;
  }

  const touchedMax = touchedRows.size
    ? Math.max(...Array.from(touchedRows))
    : -1;
  const shouldTrimToFrame =
    sawDisplayReset || (sawHome && touchedRows.size > 1);
  const lastRow = shouldTrimToFrame ? touchedMax : screen.length - 1;
  const text =
    lastRow >= 0
      ? screen
          .slice(0, lastRow + 1)
          .map(item => item.join('').replace(/[ \t]+$/g, ''))
          .join('\n')
      : '';

  return {
    text,
    lines: splitTerminalDisplayLines(text),
  };
};

export const terminalDisplayUpdate = (
  data: string,
  encoding = 'text',
  previousScreenLines: string[] = [],
): TerminalDisplayUpdate => {
  const decoded = decodeTerminalData(data, encoding);
  const hasScreenRewrite = screenRewritePattern.test(decoded);
  const hasPromptRepaint = eraseDisplayBelowPattern.test(decoded);
  const hasCarriageReturnCleanup =
    carriageReturnCleanupPattern.test(decoded) && !decoded.includes('\n');
  const hasCarriageReturnRewrite =
    carriageReturnRewritePattern.test(decoded) &&
    !hasPromptRepaint &&
    !hasCarriageReturnCleanup;
  const mode: TerminalDisplayMode = hasScreenRewrite
    ? 'replaceScreen'
    : hasCarriageReturnRewrite
    ? 'rewriteLastLine'
    : 'append';
  const projection = hasScreenRewrite
    ? projectTerminalScreen(decoded, previousScreenLines)
    : undefined;
  const text = projection?.text ?? stripTerminalControlCodes(decoded);
  const lines = projection?.lines ?? splitTerminalDisplayLines(text);
  const displayLines =
    !hasScreenRewrite &&
    hasCarriageReturnCleanup &&
    lines.length === 1 &&
    lines[0] === '%'
      ? []
      : mode === 'rewriteLastLine' && lines.length
      ? [lines[lines.length - 1]]
      : lines;

  return {
    mode,
    text,
    lines: displayLines,
  };
};

export const terminalDisplayLines = (data: string, encoding = 'text') =>
  terminalDisplayUpdate(data, encoding).lines;
