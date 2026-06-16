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
  /[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g;
const screenRewritePattern = new RegExp(
  `${escapeControl}(?:c|\\[(?:\\?1049[hl]|\\?1047[hl]|\\?47[hl]|(?:\\d+;?\\d*)?[Hf]|[0-3]?J))`,
);
const carriageReturnRewritePattern = /\r(?!\n)/;

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

export const terminalDisplayUpdate = (
  data: string,
  encoding = 'text',
): TerminalDisplayUpdate => {
  const decoded = decodeTerminalData(data, encoding);
  const mode: TerminalDisplayMode = screenRewritePattern.test(decoded)
    ? 'replaceScreen'
    : carriageReturnRewritePattern.test(decoded)
    ? 'rewriteLastLine'
    : 'append';
  const text = stripTerminalControlCodes(decoded);
  const lines = splitTerminalDisplayLines(text);

  return {
    mode,
    text,
    lines:
      mode === 'rewriteLastLine' && lines.length
        ? [lines[lines.length - 1]]
        : lines,
  };
};

export const terminalDisplayLines = (data: string, encoding = 'text') =>
  terminalDisplayUpdate(data, encoding).lines;
