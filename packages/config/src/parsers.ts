// EXEC-FOUND-009: Configuration Type/Format Validation
export type ConfigValueType = 'string' | 'number' | 'integer' | 'boolean' | 'url' | 'enum';
export type ConfigValue = string | number | boolean;

export interface ConfigParserSpec {
  type: ConfigValueType;
  choices?: readonly string[];
  min?: number;
  max?: number;
  secret?: boolean;
}

export class ConfigParseError extends Error {
  public readonly key: string;
  public readonly code = 'CONFIG_PARSE_INVALID';
  public readonly secret: boolean;

  constructor(key: string, reason: string, secret = false) {
    super(`Configuration key "${key}" failed validation: ${reason}`);
    this.name = 'ConfigParseError';
    this.key = key;
    this.secret = secret;
  }
}

export function parseConfigValue(
  key: string,
  value: unknown,
  spec: ConfigParserSpec = { type: 'string' }
): ConfigValue {
  const secret = spec.secret === true;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new ConfigParseError(key, 'value must be a scalar string, number, or boolean', secret);
  }

  const text = String(value).trim();
  if (text === '') {
    throw new ConfigParseError(key, 'value must not be empty', secret);
  }

  switch (spec.type) {
    case 'string':
      return text;

    case 'integer': {
      if (!/^[-+]?\d+$/.test(text)) {
        throw new ConfigParseError(key, 'must be a base-10 integer', secret);
      }
      const intVal = Number(text);
      if (!Number.isSafeInteger(intVal)) {
        throw new ConfigParseError(key, 'must be a safe integer', secret);
      }
      if (spec.min !== undefined && intVal < spec.min) {
        throw new ConfigParseError(key, `must be >= ${spec.min}`, secret);
      }
      if (spec.max !== undefined && intVal > spec.max) {
        throw new ConfigParseError(key, `must be <= ${spec.max}`, secret);
      }
      return intVal;
    }

    case 'number': {
      if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
        throw new ConfigParseError(key, 'must be a valid decimal number', secret);
      }
      const numVal = Number(text);
      if (!Number.isFinite(numVal)) {
        throw new ConfigParseError(key, 'must be a finite number', secret);
      }
      if (spec.min !== undefined && numVal < spec.min) {
        throw new ConfigParseError(key, `must be >= ${spec.min}`, secret);
      }
      if (spec.max !== undefined && numVal > spec.max) {
        throw new ConfigParseError(key, `must be <= ${spec.max}`, secret);
      }
      return numVal;
    }

    case 'boolean': {
      const lower = text.toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(lower)) return true;
      if (['false', '0', 'no', 'off'].includes(lower)) return false;
      throw new ConfigParseError(key, 'must be a boolean (true/false/1/0)', secret);
    }

    case 'url': {
      try {
        new URL(text);
        return text;
      } catch {
        throw new ConfigParseError(key, 'must be a valid URL', secret);
      }
    }

    case 'enum': {
      if (!spec.choices || spec.choices.length === 0) {
        throw new ConfigParseError(key, 'enum specification is missing choices', secret);
      }
      if (!spec.choices.includes(text)) {
        throw new ConfigParseError(key, `must be one of: ${spec.choices.join(', ')}`, secret);
      }
      return text;
    }

    default:
      throw new ConfigParseError(key, 'unsupported configuration type', secret);
  }
}
