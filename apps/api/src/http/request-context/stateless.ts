// EXEC-FOUND-056: Stateless Request Handling
import { resolveRequestIdentity } from '../../kernel/request-context/request-identity.ts';
import { createRequestContext, runWithRequestContext, type RequestContext } from './context.ts';
import type { ParsedRequest } from '../request.ts';

export type StatelessHandler<TResult = unknown> = (
  request: ParsedRequest,
  context: RequestContext
) => TResult | Promise<TResult>;

export async function runStateless<TResult = unknown>(
  handler: StatelessHandler<TResult>,
  request: ParsedRequest
): Promise<{ result: TResult; context: RequestContext }> {
  const identity = resolveRequestIdentity(request.headers.get('x-correlation-id'));
  const context = createRequestContext(identity);

  const result = await runWithRequestContext(context, async () => {
    return await handler(request, context);
  });

  return Object.freeze({ result, context });
}
