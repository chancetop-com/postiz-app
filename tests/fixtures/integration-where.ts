// The in-memory integration tables use the same subset of Prisma predicates
// as the provider connection and credential queries. PostgreSQL supplies NULL
// for nullable columns on rows that predate browser bindings.
export function matchesIntegrationWhere(
  row: Record<string, unknown>,
  where: Record<string, any> = {}
): boolean {
  return Object.entries(where).every(([field, expected]) => {
    if (field === 'OR') {
      return expected.some((alternative: Record<string, any>) =>
        matchesIntegrationWhere(row, alternative)
      );
    }
    if (field === 'NOT') return !matchesIntegrationWhere(row, expected);

    const actual = row[field] ?? null;
    if (expected === null || typeof expected !== 'object') {
      return actual === expected;
    }
    if ('in' in expected) return expected.in.includes(actual);
    if ('not' in expected) return actual !== expected.not;
    if ('equals' in expected) return actual === expected.equals;
    if ('startsWith' in expected) {
      return (
        typeof actual === 'string' && actual.startsWith(expected.startsWith)
      );
    }
    if ('lte' in expected) {
      return (
        actual instanceof Date &&
        actual.getTime() <= new Date(expected.lte).getTime()
      );
    }
    // Relation filters require a related row; an official channel has none.
    return (
      actual !== null &&
      typeof actual === 'object' &&
      matchesIntegrationWhere(actual as Record<string, unknown>, expected)
    );
  });
}
