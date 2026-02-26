export class ApiRequestError extends Error {
  public readonly status: number;
  public readonly data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.data = data;
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 20000;

let runtimeApiBase = '';
let runtimeAuthToken = '';

export function configureApiClient(config: { apiBase?: string; authToken?: string }): void {
  if (typeof config.apiBase === 'string') {
    runtimeApiBase = String(config.apiBase || '').trim().replace(/\/+$/, '');
  }
  if (typeof config.authToken === 'string') {
    runtimeAuthToken = String(config.authToken || '').trim();
  }
}

export function getApiBase(): string {
  return runtimeApiBase;
}

export function getAuthToken(): string {
  return runtimeAuthToken;
}

export function resolveApiUrl(pathOrUrl: string): string {
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;

  const base = runtimeApiBase;
  if (!base) return raw;

  if (raw.startsWith('/')) return `${base}${raw}`;
  return `${base}/${raw}`;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();

  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch (_) {
      return null;
    }
  }

  try {
    return await response.text();
  } catch (_) {
    return null;
  }
}

export async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, ...rest } = options;
  const headers = new Headers(rest.headers || {});

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  if (!headers.has('Authorization') && runtimeAuthToken) {
    headers.set('Authorization', `Bearer ${runtimeAuthToken}`);
  }

  if (!headers.has('Content-Type') && body && !isFormData && typeof body !== 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const requestInit: RequestInit = {
    method: rest.method || 'GET',
    cache: rest.cache || 'no-store',
    ...rest,
    headers,
  };

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  if (!rest.signal && typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    requestInit.signal = controller.signal;
    timeoutId = setTimeout(() => {
      controller.abort();
    }, DEFAULT_REQUEST_TIMEOUT_MS);
  }

  if (body !== undefined) {
    if (isFormData || typeof body === 'string') {
      requestInit.body = body as BodyInit;
    } else {
      requestInit.body = JSON.stringify(body);
    }
  }

  let response: Response;
  try {
    response = await fetch(resolveApiUrl(path), requestInit);
  } catch (error) {
    const isAbortError = (
      typeof error === 'object'
      && error !== null
      && 'name' in error
      && String((error as { name?: string }).name) === 'AbortError'
    );
    if (isAbortError) {
      throw new ApiRequestError('Tempo limite excedido ao conectar com o servidor.', 408, null);
    }
    throw new ApiRequestError('Falha de conexão com o servidor.', 0, null);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
  const parsedBody = await parseResponseBody(response);

  if (!response.ok) {
    const errorMessage =
      parsedBody && typeof parsedBody === 'object' && 'error' in parsedBody && typeof parsedBody.error === 'string'
        ? parsedBody.error
        : `HTTP ${response.status}`;
    throw new ApiRequestError(errorMessage, response.status, parsedBody);
  }

  return parsedBody as T;
}
