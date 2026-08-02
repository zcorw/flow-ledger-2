export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown[];
  };
};

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: unknown[] = [],
  ) {
    super(message);
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new ApiClientError(
      response.status,
      body.error?.code ?? 'REQUEST_FAILED',
      body.error?.message ?? '请求失败，请稍后重试',
      body.error?.details ?? [],
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export type HealthResponse = {
  status: string;
  api: string;
  database: string;
  scheduler: string;
  environment: string;
};

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiRequest<HealthResponse>('/system/health', { signal });
}
