// EXEC-DB-029: Data Mapping
export type FieldMapper<TOut = unknown> = (raw: unknown) => TOut;

export type RowMappingSpec<TDomain extends Record<string, unknown>> = {
  readonly [K in keyof TDomain]: {
    readonly column: string;
    readonly transform?: FieldMapper<TDomain[K]>;
  };
};

export function mapRow<TDomain extends Record<string, unknown>>(
  row: Record<string, unknown>,
  spec: RowMappingSpec<TDomain>
): Readonly<TDomain> {
  const domain: Record<string, unknown> = {};
  for (const [domainKey, rule] of Object.entries(spec)) {
    const rawVal = row[rule.column];
    domain[domainKey] = rule.transform ? rule.transform(rawVal) : rawVal;
  }
  return Object.freeze(domain) as Readonly<TDomain>;
}
