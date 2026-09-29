// EXEC-FOUND-054: Boundary/Range Validation
import { createValidationProblem, type ValidationProblem } from '../../../../../packages/http-contracts/src/validation-problem.ts';

export interface ValidationBounds {
  readonly min?: number;
  readonly max?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
}

export function validateRange(
  bounds: ValidationBounds,
  value: unknown,
  field = 'value'
): ValidationProblem | null {
  if (typeof value === 'number') {
    if (bounds.min !== undefined && value < bounds.min) {
      return createValidationProblem(field, 'out_of_range', `Field "${field}" must be >= ${bounds.min}.`);
    }
    if (bounds.max !== undefined && value > bounds.max) {
      return createValidationProblem(field, 'out_of_range', `Field "${field}" must be <= ${bounds.max}.`);
    }
  }

  if (typeof value === 'string' || Array.isArray(value)) {
    const len = value.length;
    if (bounds.minLength !== undefined && len < bounds.minLength) {
      return createValidationProblem(
        field,
        'out_of_range',
        `Field "${field}" length must be >= ${bounds.minLength}.`
      );
    }
    if (bounds.maxLength !== undefined && len > bounds.maxLength) {
      return createValidationProblem(
        field,
        'out_of_range',
        `Field "${field}" length must be <= ${bounds.maxLength}.`
      );
    }
  }

  return null;
}
