export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export type HealthResponse = {
  status: string;
  api: string;
  database: string;
  scheduler: string;
  environment: string;
};

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/system/health`, {
    credentials: 'include',
    signal,
  });
  if (!response.ok) throw new Error('健康检查请求失败');
  return response.json() as Promise<HealthResponse>;
}
