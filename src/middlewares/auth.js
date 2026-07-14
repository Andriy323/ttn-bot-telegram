import { isAdmin } from '../handlers/admin/utils.js';

export async function adminAuthMiddleware(ctx, next) {
  // Дозволяємо команду /start та кнопку відправки ID для всіх
  if (ctx.message?.text?.startsWith('/start')) return next();
  if (ctx.callbackQuery?.data === "send_id_to_admin") return next();

  // Всі інші дії блокуємо для не-адмінів (бот буде просто ігнорувати повідомлення)
  if (!(await isAdmin(ctx))) {
    if (ctx.callbackQuery) {
      return ctx.answerCallbackQuery({ text: "⛔ Немає доступу.", show_alert: true });
    }
    return;
  }
  
  return next();
}
