// EXEC-FOUND-052: Input Validation
import {
  createValidationProblem,
  type ValidationProblem,
} from '../../../../../packages/http-contracts/src/validation-problem.ts';
import { HttpError } from '../errors/classify.ts';
import { validateType, type ExpectedType } from './type.ts';
import { validateRange, type ValidationBounds } from './range.ts';

export interface FieldSchema extends ValidationBounds {
  readonly type: ExpectedType;
  readonly required?: boolean;
  readonly enum?: readonly (string | number)[];
}

export type InputSchema = Readonly<Record<string, FieldSchema>>;

export function validateInput<T extends Record<string, unknown> = Record<string, unknown>>(
  schema: InputSchema,
  value: unknown
): Readonly<T> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    const problem = createValidationProblem('$root', 'invalid_type', 'Input payload must be a JSON object.');
    throw new HttpError(400, 'VALIDATION_FAILED', 'Request input validation failed.', {
      problems: [problem],
    });
  }

  const inputObj = value as Record<string, unknown>;
  const problems: ValidationProblem[] = [];
  const validated: Record<string, unknown> = {};

  for (const [field, spec] of Object.entries(schema)) {
    const rawVal = inputObj[field];
    if (rawVal === undefined || rawVal === null) {
      if (spec.required !== false) {
        problems.push(createValidationProblem(field, 'required', `Field "${field}" is required.`));
      }
      continue;
    }

    const typeProblem = validateType(spec.type, rawVal, field);
    if (typeProblem) {
      problems.push(typeProblem);
      continue;
    }

    const rangeProblem = validateRange(spec, rawVal, field);
    if (rangeProblem) {
      problems.push(rangeProblem);
      continue;
    }

    if (spec.enum && !spec.enum.includes(rawVal as string | number)) {
      problems.push(
        createValidationProblem(
          field,
          'invalid_enum',
          `Field "${field}" must be one of: ${spec.enum.join(', ')}.`
        )
      );
      continue;
    }

    validated[field] = rawVal;
  }

  if (problems.length > 0) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Request input validation failed.', {
      problems: Object.freeze(problems),
    });
  }

  return Object.freeze(validated) as Readonly<T>;
}
