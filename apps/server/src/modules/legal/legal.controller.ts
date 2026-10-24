import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../auth/auth.decorators';

const page = (title: string, body: string) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Настолки Онлайн</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:720px;margin:32px auto;padding:0 16px;color:#222}h1{font-size:26px}h2{font-size:19px;margin-top:28px}</style></head><body><h1>${title}</h1>${body}</body></html>`;
const CONTACT = process.env.SUPPORT_EMAIL ?? 'support@nastolki.online';

/** Публичные страницы для карточек в App Store / Google Play: политика, условия, поддержка, удаление данных. */
@Controller()
export class LegalController {
  @Public()
  @Get('privacy')
  @Header('Content-Type', 'text/html; charset=utf-8')
  privacy() {
    return page('Политика конфиденциальности', `
<p>Приложение «Настолки Онлайн» собирает только данные, необходимые для игры.</p>
<h2>Какие данные мы храним</h2>
<ul><li>Аккаунт: email (если вход по email или через Google/Apple/VK), имя, ник, аватар.</li>
<li>Игровые данные: партии, рейтинг, друзья, сообщения в чате, покупки за внутриигровые монеты.</li>
<li>Технические данные: токен push-уведомлений устройства, время последнего визита.</li></ul>
<h2>Для чего</h2><p>Для работы игр, матчмейкинга, чата, рейтингов и уведомлений. Мы не продаём данные и не показываем персонализированную рекламу.</p>
<h2>Третьи стороны</h2><p>Авторизация — Clerk; push-уведомления — Expo; хостинг — облачный провайдер. Они обрабатывают данные по нашему поручению.</p>
<h2>Удаление данных</h2><p>Аккаунт можно удалить в приложении: Профиль → «Удалить аккаунт». Профиль обезличивается, сообщения, друзья и устройства удаляются. Также напишите на ${CONTACT}.</p>
<h2>Дети</h2><p>Приложение не предназначено для детей младше 13 лет.</p>
<h2>Контакты</h2><p>${CONTACT}</p>`);
  }

  @Public()
  @Get('terms')
  @Header('Content-Type', 'text/html; charset=utf-8')
  terms() {
    return page('Условия использования', `
<p>Используя «Настолки Онлайн», вы соглашаетесь с этими условиями.</p>
<h2>Правила поведения</h2><p>Запрещены оскорбления, мошенничество, использование ботов и эксплойтов, договорные партии. Мы можем ограничить аккаунт за нарушения.</p>
<h2>Внутриигровая валюта</h2><p>Монеты и кристаллы не имеют денежной стоимости и не подлежат обмену на деньги.</p>
<h2>Ответственность</h2><p>Сервис предоставляется «как есть». Жалобы на игроков можно отправить из приложения.</p>
<h2>Контакты</h2><p>${CONTACT}</p>`);
  }

  @Public()
  @Get('support')
  @Header('Content-Type', 'text/html; charset=utf-8')
  support() {
    return page('Поддержка', `<p>Вопросы, жалобы и предложения: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p><p>Удаление аккаунта: Профиль → «Удалить аккаунт».</p>`);
  }
}
