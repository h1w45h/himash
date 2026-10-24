import { isClerkAPIResponseError } from '@clerk/clerk-expo';

const MESSAGES: Record<string, string> = {
  form_identifier_not_found: 'Аккаунт с таким email не найден',
  form_password_incorrect: 'Неверный пароль',
  form_identifier_exists: 'Этот email уже зарегистрирован',
  form_password_pwned: 'Этот пароль найден в утечках, выберите другой',
  form_password_length_too_short: 'Пароль слишком короткий (минимум 8 символов)',
  form_code_incorrect: 'Неверный код',
  verification_expired: 'Срок действия кода истёк, запросите новый',
  too_many_requests: 'Слишком много попыток, попробуйте позже',
};

/** Переводит ошибки Clerk на русский. */
export function authErrorMessage(e: unknown): string {
  if (isClerkAPIResponseError(e)) {
    const code = e.errors[0]?.code;
    const text = code ? MESSAGES[code] : undefined;
    if (text) return text;
  }
  return 'Не удалось выполнить вход. Проверьте соединение и попробуйте снова.';
}
