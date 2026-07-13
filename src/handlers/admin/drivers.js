import { Composer, InlineKeyboard } from 'grammy';
import { createConversation } from '@grammyjs/conversations';
import { db } from '../../config/db.js';
import { promptText, MAIN_ADMIN_MENU_TEXT, mainAdminKeyboard } from './utils.js';

export const driversRouter = new Composer();

driversRouter.callbackQuery("admin_drivers_list", async (ctx) => {
  const drivers = await db('drivers').select('*');
  const keyboard = new InlineKeyboard();
  drivers.forEach(d => {
    keyboard.text(`[${d.fio}] ${d.license}`, `admin_driver_show_${d.id}`).row();
  });
  keyboard.text("➕ Додати водія", "admin_driver_add").row();
  keyboard.text("⬅️ Назад", "admin_main");
  
  await ctx.editMessageText("🛞 **Список водіїв:**", { reply_markup: keyboard, parse_mode: "Markdown" });
});

driversRouter.callbackQuery(/admin_driver_show_(\d+)/, async (ctx) => {
  const id = ctx.match[1];
  const driver = await db('drivers').where({ id }).first();
  if (!driver) return ctx.answerCallbackQuery("Не знайдено");
  
  const vehicle = await db('vehicles').where({ id: driver.default_vehicle_id }).first();
  const vText = vehicle ? vehicle.plate_number : "Немає";

  const text = `🛞 **Водій ID:** ${driver.id}\n` +
               `**ПІБ:** ${driver.fio}\n` +
               `**Посвідчення:** ${driver.license}\n` +
               `**Реквізити (як ФОП):** ${driver.info || 'немає'}\n` +
               `**Синоніми (для ШІ):** ${driver.name_key || 'немає'}\n` +
               `**Дефолтне авто:** ${vText}`;

  const keyboard = new InlineKeyboard()
    .text("✏️ Редагувати", `admin_driver_edit_${driver.id}`)
    .text("❌ Видалити", `admin_driver_delete_${driver.id}`).row()
    .text("⬅️ До списку водіїв", "admin_drivers_list");

  await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: "Markdown" });
});

driversRouter.callbackQuery(/admin_driver_delete_(\d+)/, async (ctx) => {
  const id = ctx.match[1];
  await db('drivers').where({ id }).del();
  await ctx.answerCallbackQuery("Водія видалено!");
  await ctx.editMessageText("Запис видалено. Відкрийте меню знову.");
});

async function driverConv(conversation, ctx) {
  const data = ctx.callbackQuery?.data || '';
  const isEdit = data.startsWith('admin_driver_edit_');
  const id = isEdit ? parseInt(data.split('_')[3], 10) : null;
  const driver = isEdit ? (await conversation.external(() => db('drivers').where({ id }).first()) || {}) : {};

  let name_key = await promptText(conversation, ctx, `Введіть ключові слова/синоніми для ШІ через кому (напр. іван, ваня, іваненко)`, isEdit, driver.name_key);
  if (name_key === '__CANCEL__') return;

  let fio = await promptText(conversation, ctx, `Введіть ПІБ водія (напр. Іваненко І.І.)`, isEdit, driver.fio);
  if (fio === '__CANCEL__') return;
  
  let license = await promptText(conversation, ctx, `Введіть посвідчення водія (напр. ВХА 123456)`, isEdit, driver.license);
  if (license === '__CANCEL__') return;

  let info = await promptText(conversation, ctx, `Введіть повні реквізити водія (як ФОП для Перевізника/Отримувача, напр. Фізична особа Іваненко І.І. 01001, м.Київ, вул.Хрещатик 1, ІПН 1111111111)`, isEdit, driver.info);
  if (info === '__CANCEL__') return;

  const vehicles = await conversation.external(() => db('vehicles').select('*'));
  const vKeyboard = new InlineKeyboard();
  vehicles.forEach(v => vKeyboard.text(v.plate_number, `drv_veh_${v.id}`).row());
  vKeyboard.text("Без авто", "drv_veh_null").row();
  if (isEdit) vKeyboard.text("⏭️ Пропустити", "skip_step");
  vKeyboard.text("❌ Скасувати", "cancel_conv");

  await ctx.reply(`Оберіть дефолтне авто (поточне ID: ${driver.default_vehicle_id || 'немає'}):`, { reply_markup: vKeyboard });
  let default_vehicle_id;
  while(true) {
    const vehCtx = await conversation.waitForCallbackQuery(/drv_veh_.+|skip_step|cancel_conv/);
    if (vehCtx.callbackQuery.data === 'skip_step') {
      await vehCtx.answerCallbackQuery();
      await vehCtx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
      default_vehicle_id = driver.default_vehicle_id;
      break;
    } else if (vehCtx.callbackQuery.data === 'cancel_conv') {
      await vehCtx.answerCallbackQuery();
      await vehCtx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
      await ctx.reply("🚫 Дію скасовано.\n\n" + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
      return;
    } else {
      const vVal = vehCtx.callbackQuery.data.split('_')[2];
      default_vehicle_id = vVal === 'null' ? null : parseInt(vVal, 10);
      await vehCtx.answerCallbackQuery();
      await vehCtx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
      break;
    }
  }

  if (!isEdit) {
    await conversation.external(() => db('drivers').insert({ fio, license, info, name_key, default_vehicle_id }));
    await ctx.reply("✅ Водія додано!\n\n" + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
  } else {
    await conversation.external(() => db('drivers').where({ id }).update({ fio, license, info, name_key, default_vehicle_id }));
    await ctx.reply("✅ Водія оновлено!\n\n" + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
  }
}

driversRouter.use(createConversation(driverConv));

driversRouter.callbackQuery("admin_driver_add", async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("driverConv");
});
driversRouter.callbackQuery(/admin_driver_edit_(\d+)/, async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("driverConv");
});
