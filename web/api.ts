export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) { super(message); }
}

export async function request<T>(token: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(error?.error?.code ?? 'REQUEST_FAILED', error?.error?.message ?? `Request failed (${response.status})`, response.status);
  }
  return data as T;
}

export function download(name: string, value: unknown, markdown = false): void {
  const content = markdown ? String(value) : JSON.stringify(value, null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: markdown ? 'text/markdown;charset=utf-8' : 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
