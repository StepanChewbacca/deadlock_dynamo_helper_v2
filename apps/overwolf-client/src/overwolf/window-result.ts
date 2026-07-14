export function isSuccessfulOverwolfResult(result: unknown): boolean {
  if (!result || typeof result !== 'object') {
    return false;
  }

  const value = result as {
    success?: unknown;
    status?: unknown;
  };

  return value.success === true || value.status === 'success';
}
