import { McpError } from '../types';

export class Sanitizer {
  public static validateResourceUri(uri: string): {
    resourceType: 'event' | 'video' | 'thumbnail' | 'timeline' | 'statistics' | 'status';
    param: string | null;
  } {
    if (!uri || typeof uri !== 'string') {
      throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'URI must be a non-empty string', 400);
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(uri);
    } catch {
      throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Malformed URI encoding', 400);
    }

    if (
      decoded.includes('..') ||
      decoded.includes('\\') ||
      (decoded.includes('//') && !decoded.startsWith('novaguard://')) ||
      decoded.toLowerCase().includes('file:') ||
      decoded.toLowerCase().includes('content:')
    ) {
      throw new McpError('NOVAGUARD_MEDIA_FORBIDDEN', 'Path traversal or forbidden URI detected', 403);
    }

    if (!uri.startsWith('novaguard://')) {
      throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Unsupported URI scheme', 400);
    }

    const path = decoded.substring('novaguard://'.length);
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) {
      throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Empty resource URI path', 400);
    }

    const type = parts[0];

    if (type === 'status') {
      if (parts.length !== 1) {
        throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Invalid status resource URI', 400);
      }
      return { resourceType: 'status', param: null };
    }

    if (type === 'event' || type === 'video' || type === 'thumbnail') {
      if (parts.length !== 2 || !/^\d+$/.test(parts[1]) || Number(parts[1]) > Number.MAX_SAFE_INTEGER) {
        throw new McpError('NOVAGUARD_INVALID_ARGUMENT', `Invalid ${type} URI format`, 400);
      }
      return { resourceType: type, param: parts[1] };
    }

    if (type === 'timeline') {
      if (parts.length !== 2 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[1])) {
        throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Invalid timeline date', 400);
      }
      const [year, month, day] = parts[1].split('-').map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
      ) {
        throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Invalid calendar date', 400);
      }
      return { resourceType: 'timeline', param: parts[1] };
    }

    if (type === 'statistics') {
      if (parts.length !== 2 || !['today', '7d', '30d'].includes(parts[1])) {
        throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Invalid statistics period', 400);
      }
      return { resourceType: 'statistics', param: parts[1] };
    }

    throw new McpError('NOVAGUARD_INVALID_ARGUMENT', `Unknown resource type: ${type}`, 400);
  }

  public static sanitizeConfiguration(obj: Record<string, any>): Record<string, any> {
    const clean: Record<string, any> = JSON.parse(JSON.stringify(obj));
    const forbiddenKeys = [
      'localStreamPin',
      'pin',
      'password',
      'secret',
      'token',
      'credential',
      'authorization',
      'cookie',
      'filePath',
      'path',
      'thumbPath',
    ];

    const walkAndRemove = (item: any) => {
      if (!item || typeof item !== 'object') return;
      for (const key of Object.keys(item)) {
        if (forbiddenKeys.some((forbidden) => key.toLowerCase() === forbidden.toLowerCase())) {
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
