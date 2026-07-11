export function getDeadlockApiRequestConfig(): { headers?: { 'X-API-KEY': string } } {
  const apiKey = process.env.DEADLOCK_API_KEY?.trim();

  if (!apiKey) {
    return {};
  }

  return {
    headers: {
      'X-API-KEY': apiKey,
    },
  };
}
