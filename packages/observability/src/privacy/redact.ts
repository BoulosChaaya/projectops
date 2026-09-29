// EXEC-OBS-013: Telemetry Privacy & PII Scrubber
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+-]+/gi;

export function redactTelemetryText(input: string): string {
  return input
    .replace(BEARER_PATTERN, 'Bearer [Redacted]')
    .replace(EMAIL_PATTERN, '[RedactedEmail]');
}
