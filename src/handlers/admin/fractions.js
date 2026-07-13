import { Composer, InlineKeyboard } from 'grammy';
import { createConversation } from '@grammyjs/conversations';
import { db } from '../../config/db.js';
import { promptText, MAIN_ADMIN_MENU_TEXT, mainAdminKeyboard } from './utils.js';

export const fractionsRouter = new Composer();

fractionsRouter.callbackQuery("admin_fractions_list", async (ctx) => {
  const fractions = await db('fractions').select('*');
  const keyboard = new InlineKeyboard();
  fractions.forEach(f => {
    keyboard.text(`[${f.fraction_key.split(',')[0]}] ${f.name.substring(0, 20)}...`, `admin_fraction_show_${f.id}`).row();
  });
  keyboard.text("➕ Додати фракцію", "admin_fraction_add").row();
  keyboard.text("⬅️ Назад", "admin_main");
  
  await ctx.editMessageText("🪨 **Список фракцій:**", { reply_markup: keyboard, parse_mode: "Markdown" });
});

fractionsRouter.callbackQuery(/admin_fraction_show_(\d+)/, async (ctx) => {
  const id = ctx.match[1];
  const fraction = await db('fractions').where({ id }).first();
  if (!fraction) return ctx.answerCallbackQuery("Не знайдено");

  const text = `🪨 **Фракція ID:** ${fraction.id}\n**Синоніми:** ${fraction.fraction_key}\n**Назва в ТТН:** ${fraction.name}`;

  const keyboard = new InlineKeyboard()
    .text("✏️ Редагувати", `admin_fraction_edit_${fraction.id}`)
    .text("❌ Видалити", `admin_fraction_delete_${fraction.id}`).row()
    .text("⬅️ До списку", "admin_fractions_list");

  await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: "Markdown" });
});

fractionsRouter.callbackQuery(/admin_fraction_delete_(\d+)/, async (ctx) => {
  const id = ctx.match[1];
  await db('fractions').where({ id }).del();
  await ctx.answerCallbackQuery("Видалено!");
  await ctx.editMessageText("Запис видалено.", { reply_markup: new InlineKeyboard().text("⬅️ До списку", "admin_fractions_list") });
});

async function fractionConv(conversation, ctx) {
  const data = ctx.callbackQuery?.data || '';
  const isEdit = data.startsWith('admin_fraction_edit_');
  const id = isEdit ? parseInt(data.split('_')[3], 10) : null;
  const fraction = isEdit ? (await conversation.external(() => db('fractions').where({ id }).first()) || {}) : {};

  let fraction_key = await promptText(conversation, ctx, `Введіть синоніми для ШІ через кому (напр. дрібна, 5-20, 5/20)`, isEdit, fraction.fraction_key);
  if (fraction_key === '__CANCEL__') return;
  
  let name = await promptText(conversation, ctx, `Введіть офіційну назву для ТТН (напр. Щебінь граніт з суміші фр.від 5 до 20 мм)`, isEdit, fraction.name);
  if (name === '__CANCEL__') return;

  if (!isEdit) {
    await conversation.external(() => db('fractions').insert({ fraction_key, name }));
    await ctx.reply("✅ Фракцію додано!\n\n" + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
  } else {
    await conversation.external(() => db('fractions').where({ id }).update({ fraction_key, name }));
    await ctx.reply("✅ Фракцію оновлено!\n\n" + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
  }
}

fractionsRouter.use(createConversation(fractionConv));

fractionsRouter.callbackQuery("admin_fraction_add", async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("fractionConv");
});

fractionsRouter.callbackQuery(/admin_fraction_edit_(\d+)/, async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("fractionConv");
});
