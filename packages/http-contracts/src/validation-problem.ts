// EXEC-FOUND-055: Rejection Feedback Design
export interface ValidationProblem {
  readonly field: string;
  readonly code: 'invalid_type' | 'out_of_range' | 'required' | 'invalid_enum' | 'unknown_field';
  readonly message: string;
}

export function createValidationProblem(
  field: string,
  code: ValidationProblem['code'],
  message: string
): ValidationProblem {
  return Object.freeze({ field, code, message });
}
