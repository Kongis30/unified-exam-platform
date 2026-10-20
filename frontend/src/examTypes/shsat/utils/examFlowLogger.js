import { http } from '@shsat/admin/services/http';

const LOGGER_PREFIX = '[SHSAT exam flow]';
const SENSITIVE_KEY_PATTERN = /answer|payload|body|token|password|content/i;
const ERROR_STORAGE_KEY = 'shsat:exam-flow-errors';
const MAX_STORED_ERRORS = 50;

let sequence = 0;

function createSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const sessionId = createSessionId();

function sanitize(value, key = '', depth = 0) {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return '[redacted]';
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      code: value.code || null,
      status: value.status || null,
    };
  }
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (depth >= 3) {
    return '[truncated]';
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, '', depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitize(entryValue, entryKey, depth + 1)])
    );
  }

  return String(value);
}

function persistError(entry) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const previous = JSON.parse(window.localStorage.getItem(ERROR_STORAGE_KEY) || '[]');
    const errors = Array.isArray(previous) ? previous : [];
    window.localStorage.setItem(
      ERROR_STORAGE_KEY,
      JSON.stringify([...errors, entry].slice(-MAX_STORED_ERRORS))
    );
  } catch {
    // Logging must never interrupt the exam when storage is unavailable or full.
  }
}

function reportToServer(entry) {
  http.post('/client-logs/errors', entry).catch(() => {
    // 日志接口异常不能影响考试操作。
  });
}

function write(level, event, details = {}) {
  const method = console[level] || console.log;
  const entry = {
    at: new Date().toISOString(),
    sessionId,
    sequence: ++sequence,
    event,
    ...sanitize(details),
  };
  method.call(console, LOGGER_PREFIX, entry);
  if (level === 'error') {
    persistError(entry);
  }
  reportToServer(entry);
}

export const examFlowLogger = {
  error(event, details) {
    write('error', event, details);
  },
  diagnostic(event, details) {
    write('info', event, details);
  },
};
