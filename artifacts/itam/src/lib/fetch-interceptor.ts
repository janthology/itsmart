/**
 * Intercepts the global fetch API to automatically inject the Authorization header
 * if a JWT token is present in localStorage.
 * This ensures that @workspace/api-client-react hooks seamlessly authenticate.
 */
export function setupFetchInterceptor() {
  const originalFetch = window.fetch;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    // Only intercept calls to our internal /api
    if (url.startsWith('/api')) {
      const token = localStorage.getItem('itam_token');
      if (token) {
        init = init || {};
        init.headers = {
          ...init.headers,
          Authorization: `Bearer ${token}`
        };
      }
    }

    return originalFetch(input, init);
  };
}
