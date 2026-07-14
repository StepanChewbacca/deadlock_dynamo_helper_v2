const nativeFetch = globalThis.fetch;

if (typeof nativeFetch === 'function') {
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    nativeFetch.call(globalThis, input, init);
}
