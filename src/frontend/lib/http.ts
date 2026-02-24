import { getAuthToken, resolveApiUrl } from '@/src/frontend/lib/runtime';

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
  const token = getAuthToken();
  const headers = new Headers(rest.headers || {});

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  if (!headers.has('Content-Type') && body && !isFormData && typeof body !== 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const requestInit: RequestInit = {
    method: rest.method || 'GET',
    credentials: rest.credentials || 'include',
    cache: rest.cache || 'no-store',
    ...rest,
    headers,
  };

  if (body !== undefined) {
    if (isFormData || typeof body === 'string') {
      requestInit.body = body as BodyInit;
    } else {
      requestInit.body = JSON.stringify(body);
    }
  }

  const response = await fetch(resolveApiUrl(path), requestInit);
  const parsedBody = await parseResponseBody(response);

  if (!response.ok) {
    const errorMessage =
      (parsedBody && typeof parsedBody === 'object' && 'error' in parsedBody && typeof parsedBody.error === 'string')
        ? parsedBody.error
        : `HTTP ${response.status}`;
    throw new ApiRequestError(errorMessage, response.status, parsedBody);
  }

  return parsedBody as T;
}
