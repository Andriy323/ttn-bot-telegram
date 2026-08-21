import { InlineKeyboard } from 'grammy';
import { db } from '../../config/db.js';
import { promptText, MAIN_ADMIN_MENU_TEXT, mainAdminKeyboard } from './utils.js';
import { createAdminCrudRouter } from './crudFactory.js';

export const driversRouter = createAdminCrudRouter({
  entityKey: 'driver',
  tableName: 'drivers',
  listTitle: '🛞 **Список водіїв:**',
  addBtnText: '➕ Додати водія',
  backToListText: '⬅️ До списку водіїв',
  formatListButton: (d) => `[${d.fio}] ${d.license}`,
  formatDetailsText: async (driver) => {
    const vehicle = await db('vehicles').where({ id: driver.default_vehicle_id }).first();
    const vText = vehicle ? vehicle.plate_number : "Немає";

    return `🛞 **Водій ID:** ${driver.id}\n` +
           `**ПІБ:** ${driver.fio}\n` +
           `**Посвідчення:** ${driver.license}\n` +
           `**Реквізити (як ФОП):** ${driver.info || 'немає'}\n` +
           `**Синоніми (для ШІ):** ${driver.name_key || 'немає'}\n` +
           `**Дефолтне авто:** ${vText}`;
  },
  customSteps: async (conversation, ctx) => {
    const data = ctx.callbackQuery?.data || '';
    const isEdit = data.startsWith('admin_driver_edit_');
    const id = isEdit ? parseInt(data.split('_')[3], 10) : null;
    const driver = isEdit ? (await conversation.external(() => db('drivers').where({ id }).first()) || {}) : {};

    const name_key = await promptText(conversation, ctx, `Введіть ключові слова/синоніми для ШІ через кому (напр. іван, ваня, іваненко)`, isEdit, driver.name_key);
    if (name_key === '__CANCEL__') return;

    const fio = await promptText(conversation, ctx, `Введіть ПІБ водія (напр. Іваненко І.І.)`, isEdit, driver.fio);
    if (fio === '__CANCEL__') return;
    
    const license = await promptText(conversation, ctx, `Введіть посвідчення водія (напр. ВХА 123456)`, isEdit, driver.license);
    if (license === '__CANCEL__') return;

    const info = await promptText(conversation, ctx, `Введіть повні реквізити водія (як ФОП для Перевізника/Отримувача, напр. Фізична особа Іваненко І.І. 01001, м.Київ, вул.Хрещатик 1, ІПН 1111111111)`, isEdit, driver.info);
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
});
