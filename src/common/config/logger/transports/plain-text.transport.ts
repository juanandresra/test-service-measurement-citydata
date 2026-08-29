import { join } from 'node:path';
import build from 'pino-abstract-transport';

type TransportLog = {
  level?: number | string;
  time?: number;
  context?: string;
  msg?: unknown;
};

const LEVEL_LABELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);

  return `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${pad3(date.getMilliseconds())}`;
}

function normalizeLevel(level: TransportLog['level']): string {
  if (typeof level === 'number') {
    return LEVEL_LABELS[level] || String(level);
  }

  if (typeof level === 'string' && level.length > 0) {
    return level.toUpperCase();
  }

  return 'INFO';
}

export const plainTextTransport = {
  target: join(__dirname, 'plain-text.transport.js'),
  options: {},
};

function plainTextTransportWorker() {
  return build(async function (source: AsyncIterable<TransportLog>) {
    for await (const log of source) {
      const timestamp =
        typeof log.time === 'number' && Number.isFinite(log.time)
          ? log.time
          : Date.now();
      const level = normalizeLevel(log.level);
      const context =
        typeof log.context === 'string' && log.context.length > 0
          ? `(${log.context}) `
          : '';
      const message =
        typeof log.msg === 'string' && log.msg.length > 0
          ? log.msg
          : JSON.stringify(log.msg ?? '');

      process.stdout.write(
        `[${formatTimestamp(timestamp)}] ${level}: ${context}${message}\n`,
      );
    }
  });
}

export default plainTextTransportWorker;
