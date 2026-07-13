import { InlineKeyboard } from 'grammy';
import { db } from '../../config/db.js';

// ==========================================
// 🛡️ ПЕРЕВІРКА АДМІНІСТРАТОРА
// ==========================================
export async function isAdmin(ctx) {
  const superAdminId = process.env.SUPER_ADMIN_ID?.trim();
  const userId = ctx.from?.id?.toString();
  if (userId === superAdminId) return true;
  
  const dbAdmin = await db('admins').where({ telegram_id: userId }).first();
  return !!dbAdmin;
}

export const MAIN_ADMIN_MENU_TEXT = "⚙️ **Головне меню Адмін-панелі**\nОберіть розділ для керування:";

export const mainAdminKeyboard = new InlineKeyboard()
  .text("🚗 Машини", "admin_vehicles_list")
  .text("🛞 Водії", "admin_drivers_list").row()
  .text("🏢 Відправники", "admin_shippers_list")
  .text("🪨 Фракції", "admin_fractions_list").row()
  .text("📍 Розвантаження", "admin_destinations_list")
  .text("🔢 Лічильник", "admin_counter_edit").row()
  .text("👮 Адміністратори", "admin_admins_list").row()
  .text("❌ Закрити", "admin_close");

// Утиліта для покрокового опитування з можливістю "Пропустити" та "Скасувати"
export async function promptText(conversation, ctx, text, isEdit, oldVal) {
  const keyboard = new InlineKeyboard();
  if (isEdit) keyboard.text("⏭️ Пропустити", "skip_step");
  keyboard.text("❌ Скасувати", "cancel_conv");

  let fullText = text;
  if (isEdit && oldVal) {
    fullText += `\n\n_Поточне значення (натисніть, щоб скопіювати):_\n\`${oldVal}\``;
  }

  const sentMsg = await ctx.reply(fullText, { reply_markup: keyboard, parse_mode: "Markdown" });
  while (true) {
    const responseCtx = await conversation.waitFor(['message:text', 'callback_query:data']);
    if (responseCtx.callbackQuery?.data === 'skip_step') {
      await responseCtx.answerCallbackQuery();
      await responseCtx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
      return oldVal?.toString() || '';
    } else if (responseCtx.callbackQuery?.data === 'cancel_conv') {
      await responseCtx.answerCallbackQuery();
      await responseCtx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
      await ctx.reply("🚫 Дію скасовано.\n\n" + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
      return '__CANCEL__';
    } else if (responseCtx.message?.text) {
      await ctx.api.editMessageReplyMarkup(sentMsg.chat.id, sentMsg.message_id, { reply_markup: { inline_keyboard: [] } }).catch(() => {});
      return responseCtx.message.text;
    } else if (responseCtx.callbackQuery) {
       await responseCtx.answerCallbackQuery("Будь ласка, введіть текст або оберіть дію.");
    }
  }
}
