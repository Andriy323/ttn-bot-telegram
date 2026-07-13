import { Composer, InlineKeyboard } from 'grammy';
import { createConversation } from '@grammyjs/conversations';
import { db } from '../../config/db.js';
import { promptText, MAIN_ADMIN_MENU_TEXT, mainAdminKeyboard } from './utils.js';

export const shippersRouter = new Composer();

shippersRouter.callbackQuery("admin_shippers_list", async (ctx) => {
  const shippers = await db('shippers').select('*');
  const keyboard = new InlineKeyboard();
  shippers.forEach(s => {
    keyboard.text(`[${s.shipper_key.split(',')[0]}] ${s.manager}`, `admin_shipper_show_${s.id}`).row();
  });
  keyboard.text("➕ Додати відправника", "admin_shipper_add").row();
  keyboard.text("⬅️ Назад", "admin_main");
  
  await ctx.editMessageText("🏢 **Список відправників:**", { reply_markup: keyboard, parse_mode: "Markdown" });
});

shippersRouter.callbackQuery(/admin_shipper_show_(\d+)/, async (ctx) => {
  const id = ctx.match[1];
  const shipper = await db('shippers').where({ id }).first();
  if (!shipper) return ctx.answerCallbackQuery("Не знайдено");

  const text = `🏢 **Відправник ID:** ${shipper.id}\n` +
               `**Синоніми (ключі):** ${shipper.shipper_key}\n` +
               `**Інфо:** ${shipper.info}\n` +
               `**Менеджер:** ${shipper.manager}`;

  const keyboard = new InlineKeyboard()
    .text("✏️ Редагувати", `admin_shipper_edit_${shipper.id}`)
    .text("❌ Видалити", `admin_shipper_delete_${shipper.id}`).row()
    .text("⬅️ До списку", "admin_shippers_list");

  await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: "Markdown" });
});

shippersRouter.callbackQuery(/admin_shipper_delete_(\d+)/, async (ctx) => {
  const id = ctx.match[1];
  await db('shippers').where({ id }).del();
  await ctx.answerCallbackQuery("Видалено!");
  await ctx.editMessageText("Запис видалено. Відкрийте меню знову.");
});

async function shipperConv(conversation, ctx) {
  const data = ctx.callbackQuery?.data || '';
  const isEdit = data.startsWith('admin_shipper_edit_');
  const id = isEdit ? parseInt(data.split('_')[3], 10) : null;
  const shipper = isEdit ? (await conversation.external(() => db('shippers').where({ id }).first()) || {}) : {};

  let shipper_key = await promptText(conversation, ctx, `Введіть ключові слова для ШІ через кому (напр. іван, іваненко, петро)`, isEdit, shipper.shipper_key);
  if (shipper_key === '__CANCEL__') return;
  
  let info = await promptText(conversation, ctx, `Введіть реквізити (напр. ТОВ "Логістика" 12345, м.Київ...)`, isEdit, shipper.info);
  if (info === '__CANCEL__') return;
  
  let manager = await promptText(conversation, ctx, `Введіть ПІБ керівника/менеджера (напр. Петренко П.П.)`, isEdit, shipper.manager);
  if (manager === '__CANCEL__') return;

  if (!isEdit) {
    await conversation.external(() => db('shippers').insert({ shipper_key, info, manager }));
    await ctx.reply("✅ Додано!\n\n" + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
  } else {
    await conversation.external(() => db('shippers').where({ id }).update({ shipper_key, info, manager }));
    await ctx.reply("✅ Оновлено!\n\n" + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
  }
}

shippersRouter.use(createConversation(shipperConv));

shippersRouter.callbackQuery("admin_shipper_add", async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("shipperConv");
});
shippersRouter.callbackQuery(/admin_shipper_edit_(\d+)/, async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("shipperConv");
});
