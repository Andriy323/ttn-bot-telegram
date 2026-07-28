import { Composer, InlineKeyboard } from 'grammy';
import { createConversation } from '@grammyjs/conversations';
import { db, getSetting, setSetting } from '../../config/db.js';
import { promptText, MAIN_ADMIN_MENU_TEXT, mainAdminKeyboard } from './utils.js';

export const settingsRouter = new Composer();

// ==========================================
// 🏠 КЕРУВАННЯ МІСЦЕМ ЗБЕРІГАННЯ ЗА ЗАМОВЧУВАННЯМ
// ==========================================
settingsRouter.callbackQuery("admin_storage_setting", async (ctx) => {
  const currentVal = await getSetting('default_vehicle_storage', 'м. Київ, вул. Центральна, 1');
  const keyboard = new InlineKeyboard()
    .text("✏️ Змінити адресу", "admin_storage_change").row()
    .text("⬅️ Назад", "admin_main");

  await ctx.editMessageText(
    `🏠 **Місце зберігання авто за замовчуванням**\n\n` +
    `Поточне значення:\n\`${currentVal}\`\n\n` +
    `_Ця адреса використовуватиметься для всіх автомобілів, у яких не задано індивідуальне місце зберігання._`,
    { reply_markup: keyboard, parse_mode: "Markdown" }
  );
});

async function storageSettingConv(conversation, ctx) {
  const currentVal = await conversation.external(() => getSetting('default_vehicle_storage', 'м. Київ, вул. Центральна, 1'));
  let newAddress = await promptText(conversation, ctx, "Введіть загальне місце/адресу зберігання автомобілів за замовчуванням (наприклад: м. Київ, вул. Центральна, 1):", true, currentVal);
  if (newAddress === '__CANCEL__') return;

  await conversation.external(() => setSetting('default_vehicle_storage', newAddress.trim()));
  await ctx.reply(`✅ Загальну адресу зберігання авто за замовчуванням оновлено!\n\n` + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
}
settingsRouter.use(createConversation(storageSettingConv));

settingsRouter.callbackQuery("admin_storage_change", async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("storageSettingConv");
});

// ==========================================
// 🔢 КЕРУВАННЯ ЛІЧИЛЬНИКОМ
// ==========================================
settingsRouter.callbackQuery("admin_counter_edit", async (ctx) => {
  const counter = await db('counters').where({ id: 'ttn_counter' }).first();
  const keyboard = new InlineKeyboard()
    .text("✏️ Змінити значення", "admin_counter_change").row()
    .text("⬅️ Назад", "admin_main");
  
  await ctx.editMessageText(`🔢 **Лічильник ТТН**\nПоточне значення: **${counter ? counter.current_value : 0}**`, { reply_markup: keyboard, parse_mode: "Markdown" });
});

async function counterConv(conversation, ctx) {
  let valText = await promptText(conversation, ctx, "Введіть числове значення лічильника (напр. 344).\nТТН почнуться з цього числа + 1:", false, null);
  if (valText === '__CANCEL__') return;
  
  let val = parseInt(valText, 10);
  if (isNaN(val)) {
    await ctx.reply("❌ Неправильний формат числа. Скасовано.\n\n" + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
    return;
  }
  await conversation.external(() => db('counters').where({ id: 'ttn_counter' }).update({ current_value: val }));
  await ctx.reply(`✅ Лічильник встановлено на ${val}.\n\n` + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
}
settingsRouter.use(createConversation(counterConv));

settingsRouter.callbackQuery("admin_counter_change", async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("counterConv");
});


// ==========================================
// 👮 КЕРУВАННЯ АДМІНІСТРАТОРАМИ (ADMINS)
// ==========================================
settingsRouter.callbackQuery("admin_admins_list", async (ctx) => {
  const admins = await db('admins').select('*');
  const keyboard = new InlineKeyboard();
  admins.forEach(a => {
    keyboard.text(`[${a.name}] ${a.telegram_id}`, `admin_admin_show_${a.id}`).row();
  });
  keyboard.text("➕ Додати адміна", "admin_admin_add").row();
  keyboard.text("⬅️ Назад", "admin_main");
  
  await ctx.editMessageText("👮 **Список додаткових адміністраторів:**\n_(Головний адмін налаштовується в .env)_", { reply_markup: keyboard, parse_mode: "Markdown" });
});

settingsRouter.callbackQuery(/admin_admin_show_(\d+)/, async (ctx) => {
  const id = ctx.match[1];
  const a = await db('admins').where({ id }).first();
  if (!a) return ctx.answerCallbackQuery("Не знайдено");

  const text = `👮 **Адмін ID:** ${a.id}\n**Ім'я:** ${a.name}\n**Telegram ID:** ${a.telegram_id}`;

  const keyboard = new InlineKeyboard()
    .text("❌ Видалити", `admin_admin_delete_${a.id}`).row()
    .text("⬅️ До списку", "admin_admins_list");

  await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: "Markdown" });
});

settingsRouter.callbackQuery(/admin_admin_delete_(\d+)/, async (ctx) => {
  const id = ctx.match[1];
  await db('admins').where({ id }).del();
  await ctx.answerCallbackQuery("Видалено!");
  await ctx.editMessageText("Запис видалено. Відкрийте меню знову.");
});

async function adminAddConv(conversation, ctx) {
  let telegram_id = await promptText(conversation, ctx, "Введіть Telegram ID нового адміністратора (напр. 123456789):", false, null);
  if (telegram_id === '__CANCEL__') return;
  
  let name = await promptText(conversation, ctx, "Введіть ім'я для цього адміністратора (напр. Іван):", false, null);
  if (name === '__CANCEL__') return;

  await conversation.external(() => db('admins').insert({ telegram_id, name }));
  await ctx.reply("✅ Адміністратора додано!\n\n" + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
}
settingsRouter.use(createConversation(adminAddConv));

settingsRouter.callbackQuery("admin_admin_add", async (ctx) => {
  const superAdminId = process.env.SUPER_ADMIN_ID?.trim();
  const userId = ctx.from?.id?.toString();
  
  if (userId !== superAdminId) {
    return ctx.answerCallbackQuery({ 
      text: "⛔ Тільки головний адміністратор може додавати нових адмінів.", 
      show_alert: true 
    });
  }

  await ctx.deleteMessage();
  await ctx.conversation.enter("adminAddConv");
});
