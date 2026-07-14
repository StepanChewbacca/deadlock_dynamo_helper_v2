const runtimeWindow = window;
const nativeFetch = runtimeWindow.fetch;

if (typeof nativeFetch === 'function') {
  runtimeWindow.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    nativeFetch.call(runtimeWindow, input, init);
}
