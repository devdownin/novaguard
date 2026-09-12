export interface AuditLogEntry {
  timestamp: string;
  principal: string;
  operation: string;
  eventId?: number | null;
  status: number;
  durationMs: number;
  mediaBytes?: number;
}

export class AuditLogger {
  private logs: AuditLogEntry[] = [];
  private onLogCallback?: (entry: AuditLogEntry) => void;

  constructor(onLogCallback?: (entry: AuditLogEntry) => void) {
    this.onLogCallback = onLogCallback;
  }

  public log(entry: AuditLogEntry): void {
    // Ensure no sensitive fields like tokens or media contents are present
    const safeEntry: AuditLogEntry = {
      timestamp: entry.timestamp || new Date().toISOString(),
      principal: entry.principal,
      operation: entry.operation,
      eventId: entry.eventId ?? null,
      status: entry.status,
      durationMs: entry.durationMs,
      mediaBytes: entry.mediaBytes,
    };

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
