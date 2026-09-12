export interface AuditLogEntry {
  timestamp: string;
  principal: string;
  operation: string;
  eventId?: number | null;
  status: number;
  durationMs: number;
  mediaBytes?: number;
}

export interface AuditLoggerOptions {
  maxEntries?: number;
  onLogCallback?: (entry: AuditLogEntry) => void;
}

export class AuditLogger {
  private logs: AuditLogEntry[] = [];
  private readonly maxEntries: number;
  private readonly onLogCallback?: (entry: AuditLogEntry) => void;

  constructor(options: AuditLoggerOptions | ((entry: AuditLogEntry) => void) = {}) {
    if (typeof options === 'function') {
      this.maxEntries = 1000;
      this.onLogCallback = options;
    } else {
      this.maxEntries = Math.max(1, Math.min(options.maxEntries ?? 1000, 100_000));
      this.onLogCallback = options.onLogCallback;
    }
  }

  public log(entry: AuditLogEntry): void {
    const safeEntry: AuditLogEntry = {
      timestamp: entry.timestamp || new Date().toISOString(),
      principal: entry.principal,
      operation: entry.operation.length > 256 ? entry.operation.slice(0, 256) : entry.operation,
      eventId: entry.eventId ?? null,
      status: entry.status,
      durationMs: entry.durationMs,
      mediaBytes: entry.mediaBytes,
    };

    if (this.logs.length >= this.maxEntries) {
      this.logs.shift();
    }
    this.logs.push(safeEntry);

    if (this.onLogCallback) {
      this.onLogCallback(safeEntry);
    }
  }

  public getLogs(): AuditLogEntry[] {
    return [...this.logs];
  }

  public clear(): void {
    this.logs = [];
  }
}
