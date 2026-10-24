import Constants from 'expo-constants';

const API_URL = (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://localhost:3000';

type TokenGetter = () => Promise<string | null>;
let getToken: TokenGetter = async () => null;

/** Вызывается один раз из провайдера авторизации: подставляет получение свежего JWT Clerk. */
export function setTokenGetter(fn: TokenGetter) {
  getToken = fn;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
  } catch {
    throw new ApiError(0, 'Нет соединения с сервером');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const msg = Array.isArray(body?.message) ? body?.message.join('; ') : body?.message;
    throw new ApiError(res.status, msg ?? 'Что-то пошло не так');
  }
  return (await res.json()) as T;
}

export const API_BASE_URL = API_URL;
