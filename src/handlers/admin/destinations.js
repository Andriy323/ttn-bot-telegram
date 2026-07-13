import { Composer, InlineKeyboard } from 'grammy';
import { createConversation } from '@grammyjs/conversations';
import { db } from '../../config/db.js';
import { promptText, MAIN_ADMIN_MENU_TEXT, mainAdminKeyboard } from './utils.js';

export const destinationsRouter = new Composer();

destinationsRouter.callbackQuery("admin_destinations_list", async (ctx) => {
  const destinations = await db('destinations').select('*');
  const keyboard = new InlineKeyboard();
  destinations.forEach(d => {
    keyboard.text(`[${d.destination_key.split(',')[0]}] ${d.name.substring(0, 20)}...`, `admin_destination_show_${d.id}`).row();
  });
  keyboard.text("➕ Додати пункт", "admin_destination_add").row();
  keyboard.text("⬅️ Назад", "admin_main");
  
  await ctx.editMessageText("📍 **Список пунктів розвантаження:**", { reply_markup: keyboard, parse_mode: "Markdown" });
});

destinationsRouter.callbackQuery(/admin_destination_show_(\d+)/, async (ctx) => {
  const id = ctx.match[1];
  const destination = await db('destinations').where({ id }).first();
  if (!destination) return ctx.answerCallbackQuery("Не знайдено");

  const text = `📍 **Пункт ID:** ${destination.id}\n**Синоніми:** ${destination.destination_key}\n**Назва в ТТН:** ${destination.name}`;

  const keyboard = new InlineKeyboard()
    .text("✏️ Редагувати", `admin_destination_edit_${destination.id}`)
    .text("❌ Видалити", `admin_destination_delete_${destination.id}`).row()
    .text("⬅️ До списку", "admin_destinations_list");

  await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: "Markdown" });
});

destinationsRouter.callbackQuery(/admin_destination_delete_(\d+)/, async (ctx) => {
  const id = ctx.match[1];
  await db('destinations').where({ id }).del();
  await ctx.answerCallbackQuery("Видалено!");
  await ctx.editMessageText("Запис видалено.", { reply_markup: new InlineKeyboard().text("⬅️ До списку", "admin_destinations_list") });
});

async function destinationConv(conversation, ctx) {
  const data = ctx.callbackQuery?.data || '';
  const isEdit = data.startsWith('admin_destination_edit_');
  const id = isEdit ? parseInt(data.split('_')[3], 10) : null;
  const destination = isEdit ? (await conversation.external(() => db('destinations').where({ id }).first()) || {}) : {};

  let destination_key = await promptText(conversation, ctx, `Введіть синоніми для ШІ через кому (напр. ратне, база)`, isEdit, destination.destination_key);
  if (destination_key === '__CANCEL__') return;
  
  let name = await promptText(conversation, ctx, `Введіть офіційну назву для ТТН (напр. смт.Ратне, вул.В.Івасюка)`, isEdit, destination.name);
  if (name === '__CANCEL__') return;

  if (!isEdit) {
    await conversation.external(() => db('destinations').insert({ destination_key, name }));
    await ctx.reply("✅ Пункт розвантаження додано!\n\n" + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
  } else {
    await conversation.external(() => db('destinations').where({ id }).update({ destination_key, name }));
    await ctx.reply("✅ Пункт розвантаження оновлено!\n\n" + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
  }
}

destinationsRouter.use(createConversation(destinationConv));

destinationsRouter.callbackQuery("admin_destination_add", async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("destinationConv");
});

destinationsRouter.callbackQuery(/admin_destination_edit_(\d+)/, async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("destinationConv");
});
