import { McpError } from '../types';

export class Sanitizer {
  /**
   * Validates and parses a novaguard:// resource URI.
   * Throws McpError if invalid or attempted path traversal.
   */
  public static validateResourceUri(uri: string): {
    resourceType: 'event' | 'video' | 'thumbnail' | 'timeline' | 'statistics' | 'status';
    param: string | null;
  } {
    if (!uri || typeof uri !== 'string') {
      throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'URI must be a non-empty string', 400);
    }

    // Check for path traversal attempts
    const decoded = decodeURIComponent(uri);
    if (
      decoded.includes('..') ||
      decoded.includes('\\') ||
      decoded.includes('//') && !decoded.startsWith('novaguard://') ||
      decoded.includes('file:') ||
      decoded.includes('content:')
    ) {
      throw new McpError('NOVAGUARD_MEDIA_FORBIDDEN', 'Path traversal or forbidden URI detected', 403);
    }

    if (!uri.startsWith('novaguard://')) {
      throw new McpError('NOVAGUARD_INVALID_ARGUMENT', `Unsupported URI scheme in: ${uri}`, 400);
    }

    const path = uri.substring('novaguard://'.length);
    const parts = path.split('/').filter(Boolean);

    if (parts.length === 0) {
      throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Empty resource URI path', 400);
    }

    const type = parts[0];

    if (type === 'status') {
      if (parts.length > 1) {
        throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Invalid status resource URI', 400);
      }
      return { resourceType: 'status', param: null };
    }

    if (type === 'event' || type === 'video' || type === 'thumbnail') {
      if (parts.length !== 2) {
        throw new McpError('NOVAGUARD_INVALID_ARGUMENT', `Invalid ${type} URI format`, 400);
      }
      const eventIdStr = parts[1];
      if (!/^\d+$/.test(eventIdStr)) {
        throw new McpError('NOVAGUARD_INVALID_ARGUMENT', `Invalid event ID in URI: ${eventIdStr}`, 400);
      }
      return { resourceType: type, param: eventIdStr };
    }

    if (type === 'timeline') {
      if (parts.length !== 2) {
        throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Invalid timeline URI format. Expected novaguard://timeline/YYYY-MM-DD', 400);
      }
      const dateStr = parts[1];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        throw new McpError('NOVAGUARD_INVALID_ARGUMENT', `Invalid date format in timeline URI: ${dateStr}`, 400);
      }
      return { resourceType: 'timeline', param: dateStr };
    }

    if (type === 'statistics') {
      if (parts.length !== 2) {
        throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Invalid statistics URI format', 400);
      }
      return { resourceType: 'statistics', param: parts[1] };
    }

    throw new McpError('NOVAGUARD_INVALID_ARGUMENT', `Unknown resource type: ${type}`, 400);
  }

  /**
   * Sanitizes configuration object to strictly remove sensitive data like localStreamPin or filesystem paths.
   */
  public static sanitizeConfiguration(obj: Record<string, any>): Record<string, any> {
    const clean: Record<string, any> = JSON.parse(JSON.stringify(obj));
    const forbiddenKeys = [
      'localStreamPin',
      'pin',
      'password',
      'secret',
      'token',
      'credential',
      'filePath',
      'path',
      'thumbPath',
    ];

    const walkAndRemove = (item: any) => {
      if (!item || typeof item !== 'object') return;
      for (const key of Object.keys(item)) {
        if (forbiddenKeys.includes(key)) {
          delete item[key];
        } else if (typeof item[key] === 'object') {
          walkAndRemove(item[key]);
        }
      }
    };

    walkAndRemove(clean);
    return clean;
  }
}
