import { Composer, InlineKeyboard } from 'grammy';
import { createConversation } from '@grammyjs/conversations';
import { db, getSetting } from '../../config/db.js';
import { promptText, MAIN_ADMIN_MENU_TEXT, mainAdminKeyboard } from './utils.js';

export const vehiclesRouter = new Composer();

vehiclesRouter.callbackQuery("admin_vehicles_list", async (ctx) => {
  const vehicles = await db('vehicles').select('*');
  const keyboard = new InlineKeyboard();
  vehicles.forEach(v => {
    keyboard.text(`[${v.plate_number}] ${v.car_info.substring(0, 15)}...`, `admin_vehicle_show_${v.id}`).row();
  });
  keyboard.text("➕ Додати авто", "admin_vehicle_add").row();
  keyboard.text("⬅️ Назад", "admin_main");
  
  await ctx.editMessageText("🚗 **Список автомобілів:**", { reply_markup: keyboard, parse_mode: "Markdown" });
});

vehiclesRouter.callbackQuery(/admin_vehicle_show_(\d+)/, async (ctx) => {
  const id = ctx.match[1];
  const vehicle = await db('vehicles').where({ id }).first();
  if (!vehicle) return ctx.answerCallbackQuery("Не знайдено");

  const defaultStorage = await getSetting('default_vehicle_storage', 'м. Київ, вул. Центральна, 1');
  const storagePointDisplay = vehicle.storage_point 
    ? vehicle.storage_point 
    : `${defaultStorage} _(за замовчуванням)_`;

  const text = `🚗 **Автомобіль ID:** ${vehicle.id}\n` +
               `**Номер:** ${vehicle.plate_number}\n` +
               `**Авто:** ${vehicle.car_info}\n` +
               `**Причіп:** ${vehicle.trailer_info}\n` +
               `**Тара:** ${vehicle.tare_weight} т.\n` +
               `**Місце зберігання:** ${storagePointDisplay}`;

  const keyboard = new InlineKeyboard()
    .text("✏️ Редагувати", `admin_vehicle_edit_${vehicle.id}`)
    .text("❌ Видалити", `admin_vehicle_delete_${vehicle.id}`).row()
    .text("⬅️ До списку авто", "admin_vehicles_list");

  await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: "Markdown" });
});

vehiclesRouter.callbackQuery(/admin_vehicle_delete_(\d+)/, async (ctx) => {
  const id = ctx.match[1];
  await db('vehicles').where({ id }).del();
  await ctx.answerCallbackQuery("Авто видалено!");
  
  const vehicles = await db('vehicles').select('*');
  const keyboard = new InlineKeyboard();
  vehicles.forEach(v => keyboard.text(`[${v.plate_number}]`, `admin_vehicle_show_${v.id}`).row());
  keyboard.text("➕ Додати авто", "admin_vehicle_add").row().text("⬅️ Назад", "admin_main");
  await ctx.editMessageText("🚗 **Список автомобілів:**\n_Запис видалено_", { reply_markup: keyboard, parse_mode: "Markdown" });
});

async function vehicleConv(conversation, ctx) {
  const data = ctx.callbackQuery?.data || '';
  const isEdit = data.startsWith('admin_vehicle_edit_');
  const id = isEdit ? parseInt(data.split('_')[3], 10) : null;
  const vehicle = isEdit ? (await conversation.external(() => db('vehicles').where({ id }).first()) || {}) : {};

  let plate_number = await promptText(conversation, ctx, `Введіть синоніми/ідентифікатори для пошуку авто через кому (напр. 8025, АА1234ВВ, даф)`, isEdit, vehicle.plate_number);
  if (plate_number === '__CANCEL__') return;
  
  let car_info = await promptText(conversation, ctx, `Введіть інформацію про авто (напр. MAN TGX 18.440 АА1234ВВ)`, isEdit, vehicle.car_info);
  if (car_info === '__CANCEL__') return;
  
  let trailer_info = await promptText(conversation, ctx, `Введіть інформацію про причіп (напр. Schmitz Cargobull АА5678ХХ)`, isEdit, vehicle.trailer_info);
  if (trailer_info === '__CANCEL__') return;
  
  let tareText = await promptText(conversation, ctx, `Введіть тару авто в тоннах (напр. 15.2)`, isEdit, vehicle.tare_weight);
  if (tareText === '__CANCEL__') return;
  let tare_weight = parseFloat(tareText.replace(',', '.'));

  const defaultStorage = await conversation.external(() => getSetting('default_vehicle_storage', 'м. Київ, вул. Центральна, 1'));
  let promptMsg = `📍 **Місце (стоянка) зберігання автомобіля**\n\n` +
    `Введіть повну точну адресу постійного зберігання/базування авто (наприклад: *02000, м. Київ, вул. Промислова, 15*).\n\n` +
    `💡 **ПІДКАЗКА:**\n` +
    `Якщо ви натиснете кнопку **«⏭️ Пропустити»**, для цього авто автоматично використовуватиметься **загальна адреса за замовчуванням**:\n` +
    `👉 \`${defaultStorage}\`\n\n` +
    `_(Примітка: Загальну адресу за замовчуванням завжди можна змінити у меню адмінки «🏠 Стоянка авто (default)»)_`;

  let storage_point_input = await promptText(
    conversation, 
    ctx, 
    promptMsg, 
    true, 
    vehicle.storage_point || ''
  );
  if (storage_point_input === '__CANCEL__') return;
  let storage_point = storage_point_input && storage_point_input.trim() ? storage_point_input.trim() : null;

  if (!isEdit) {
    await conversation.external(() => db('vehicles').insert({ plate_number, car_info, trailer_info, tare_weight, storage_point }));
    await ctx.reply("✅ Авто додано!\n\n" + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
  } else {
    await conversation.external(() => db('vehicles').where({ id }).update({ plate_number, car_info, trailer_info, tare_weight, storage_point }));
    await ctx.reply("✅ Авто оновлено!\n\n" + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
  }
}

vehiclesRouter.use(createConversation(vehicleConv));

vehiclesRouter.callbackQuery("admin_vehicle_add", async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("vehicleConv");
});
vehiclesRouter.callbackQuery(/admin_vehicle_edit_(\d+)/, async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("vehicleConv");
});
