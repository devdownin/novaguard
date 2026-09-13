import { McpError } from '../types';

/**
 * Checks tool arguments against the very schema the tool advertised.
 *
 * The schemas were decorative: every tool declared `additionalProperties:
 * false`, enums and bounds, and nothing read any of it — arguments went
 * straight through to the client. A caller could send `sort: 'DROP TABLE'`,
 * `minConfidence: 'abc'` and a misspelled `hasVideo` and get a 200 with the
 * unfiltered history, which is a wrong answer wearing the shape of a right
 * one. Refusing an unknown key matters most of the three: a misspelled filter
 * is a filter the caller believes is applied.
 *
 * Driven by the declaration rather than by a table beside it. A parallel table
 * is a second copy of the contract, and the two drift the first time a tool
 * gains a parameter — the schema would advertise it and the validator would
 * reject it as unknown.
 */

interface JsonSchemaProperty {
  type?: string;
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
}

export interface ToolInputSchema {
  type?: string;
  additionalProperties?: boolean;
  required?: readonly string[];
  properties?: Record<string, JsonSchemaProperty>;
}

function reject(message: string): never {
  throw new McpError('NOVAGUARD_INVALID_ARGUMENT', message, 400);
}

function checkType(key: string, value: unknown, expected: string): void {
  switch (expected) {
    case 'string':
      if (typeof value !== 'string') reject(`Argument '${key}' must be a string`);
      return;
    case 'boolean':
      if (typeof value !== 'boolean') reject(`Argument '${key}' must be a boolean`);
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) reject(`Argument '${key}' must be a number`);
      return;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) reject(`Argument '${key}' must be an integer`);
      return;
    case 'object':
      if (!value || typeof value !== 'object' || Array.isArray(value)) reject(`Argument '${key}' must be an object`);
      return;
    case 'array':
      if (!Array.isArray(value)) reject(`Argument '${key}' must be an array`);
      return;
    default:
      return;
  }
}

export function validateArguments(
  toolName: string,
  schema: ToolInputSchema,
  args: Record<string, unknown>,
): void {
  const properties = schema.properties ?? {};

  for (const key of Object.keys(args)) {
    const property = properties[key];
    if (!property) {
      // Only when the schema says so. A tool that ever declares
      // `additionalProperties: true` means it, and this must not override it.
      if (schema.additionalProperties === false) {
        reject(`Unknown argument '${key}' for ${toolName}`);
      }
      continue;
    }

    const value = args[key];
    // An explicit null is the caller declining to pass the argument; an
    // undefined key is the same thing spelled differently. Neither is a value
    // to check, and neither satisfies `required` — that is checked below.
    if (value === undefined || value === null) continue;

    if (property.type) checkType(key, value, property.type);
    if (property.enum && !property.enum.includes(value)) {
      reject(`Argument '${key}' must be one of ${property.enum.join(', ')}`);
    }
    if (typeof value === 'number') {
      if (property.minimum !== undefined && value < property.minimum) {
        reject(`Argument '${key}' must be at least ${property.minimum}`);
      }
      if (property.maximum !== undefined && value > property.maximum) {
        reject(`Argument '${key}' must be at most ${property.maximum}`);
      }
    }
  }

  for (const key of schema.required ?? []) {
    if (args[key] === undefined || args[key] === null) {
      reject(`Missing required parameter ${key}`);
    }
  }
}
