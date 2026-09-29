// EXEC-FOUND-053: Type Validation
import { createValidationProblem, type ValidationProblem } from '../../../../../packages/http-contracts/src/validation-problem.ts';

export type ExpectedType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';

export function validateType(
  expected: ExpectedType,
  value: unknown,
  field = 'value'
): ValidationProblem | null {
  switch (expected) {
    case 'string':
      return typeof value === 'string'
        ? null
        : createValidationProblem(field, 'invalid_type', `Field "${field}" must be a string.`);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? null
        : createValidationProblem(field, 'invalid_type', `Field "${field}" must be a finite number.`);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
        ? null
        : createValidationProblem(field, 'invalid_type', `Field "${field}" must be an integer.`);
    case 'boolean':
      return typeof value === 'boolean'
        ? null
        : createValidationProblem(field, 'invalid_type', `Field "${field}" must be a boolean.`);
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? null
        : createValidationProblem(field, 'invalid_type', `Field "${field}" must be an object.`);
    case 'array':
      return Array.isArray(value)
        ? null
        : createValidationProblem(field, 'invalid_type', `Field "${field}" must be an array.`);
    default:
      return createValidationProblem(field, 'invalid_type', `Field "${field}" has unsupported type.`);
  }
}
