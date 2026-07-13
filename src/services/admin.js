import { Composer, InlineKeyboard } from 'grammy';
import { createConversation } from '@grammyjs/conversations';
import { db } from '../config/db.js';

export const adminRouter = new Composer();

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

// Middleware для захисту адмінських callback_query
adminRouter.use(async (ctx, next) => {
  if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith('admin_')) {
    if (!(await isAdmin(ctx))) {
      return ctx.answerCallbackQuery({ text: "⛔ У вас немає доступу до адмін-панелі.", show_alert: true });
    }
  }
  return next();
});

// Утиліта для покрокового опитування з можливістю "Пропустити" та "Скасувати"
async function promptText(conversation, ctx, text, isEdit, oldVal) {
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

// ==========================================
// 🛠️ ГОЛОВНЕ МЕНЮ АДМІН-ПАНЕЛІ
// ==========================================
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

adminRouter.callbackQuery("admin_main", async (ctx) => {
  await ctx.editMessageText(MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
});

adminRouter.callbackQuery("admin_close", async (ctx) => {
  await ctx.deleteMessage();
});

// ==========================================
// 🚗 КЕРУВАННЯ МАШИНАМИ (VEHICLES)
// ==========================================
adminRouter.callbackQuery("admin_vehicles_list", async (ctx) => {
  const vehicles = await db('vehicles').select('*');
  const keyboard = new InlineKeyboard();
  vehicles.forEach(v => {
    keyboard.text(`[${v.plate_number}] ${v.car_info.substring(0, 15)}...`, `admin_vehicle_show_${v.id}`).row();
  });
  keyboard.text("➕ Додати авто", "admin_vehicle_add").row();
  keyboard.text("⬅️ Назад", "admin_main");
  
  await ctx.editMessageText("🚗 **Список автомобілів:**", { reply_markup: keyboard, parse_mode: "Markdown" });
});

adminRouter.callbackQuery(/admin_vehicle_show_(\d+)/, async (ctx) => {
  const id = ctx.match[1];
  const vehicle = await db('vehicles').where({ id }).first();
  if (!vehicle) return ctx.answerCallbackQuery("Не знайдено");

  const text = `🚗 **Автомобіль ID:** ${vehicle.id}\n` +
               `**Номер:** ${vehicle.plate_number}\n` +
               `**Авто:** ${vehicle.car_info}\n` +
               `**Причіп:** ${vehicle.trailer_info}\n` +
               `**Тара:** ${vehicle.tare_weight} т.`;

  const keyboard = new InlineKeyboard()
    .text("✏️ Редагувати", `admin_vehicle_edit_${vehicle.id}`)
    .text("❌ Видалити", `admin_vehicle_delete_${vehicle.id}`).row()
    .text("⬅️ До списку авто", "admin_vehicles_list");

  await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: "Markdown" });
});

adminRouter.callbackQuery(/admin_vehicle_delete_(\d+)/, async (ctx) => {
  const id = ctx.match[1];
  await db('vehicles').where({ id }).del();
  await ctx.answerCallbackQuery("Авто видалено!");
  
  // Return to list
  const vehicles = await db('vehicles').select('*');
  const keyboard = new InlineKeyboard();
  vehicles.forEach(v => keyboard.text(`[${v.plate_number}]`, `admin_vehicle_show_${v.id}`).row());
  keyboard.text("➕ Додати авто", "admin_vehicle_add").row().text("⬅️ Назад", "admin_main");
  await ctx.editMessageText("🚗 **Список автомобілів:**\n_Запис видалено_", { reply_markup: keyboard, parse_mode: "Markdown" });
});

// Conversation: Add/Edit Vehicle
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

  if (!isEdit) {
    await conversation.external(() => db('vehicles').insert({ plate_number, car_info, trailer_info, tare_weight }));
    await ctx.reply("✅ Авто додано!\n\n" + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
  } else {
    await conversation.external(() => db('vehicles').where({ id }).update({ plate_number, car_info, trailer_info, tare_weight }));
    await ctx.reply("✅ Авто оновлено!\n\n" + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
  }
}
adminRouter.use(createConversation(vehicleConv));

adminRouter.callbackQuery("admin_vehicle_add", async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("vehicleConv");
});
adminRouter.callbackQuery(/admin_vehicle_edit_(\d+)/, async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("vehicleConv");
});


// ==========================================
// 🛞 КЕРУВАННЯ ВОДІЯМИ (DRIVERS)
// ==========================================
adminRouter.callbackQuery("admin_drivers_list", async (ctx) => {
  const drivers = await db('drivers').select('*');
  const keyboard = new InlineKeyboard();
  drivers.forEach(d => {
    keyboard.text(`[${d.fio}] ${d.license}`, `admin_driver_show_${d.id}`).row();
  });
  keyboard.text("➕ Додати водія", "admin_driver_add").row();
  keyboard.text("⬅️ Назад", "admin_main");
  
  await ctx.editMessageText("🛞 **Список водіїв:**", { reply_markup: keyboard, parse_mode: "Markdown" });
});

adminRouter.callbackQuery(/admin_driver_show_(\d+)/, async (ctx) => {
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

adminRouter.callbackQuery(/admin_driver_delete_(\d+)/, async (ctx) => {
  const id = ctx.match[1];
  await db('drivers').where({ id }).del();
  await ctx.answerCallbackQuery("Водія видалено!");
  await adminRouter.handle(ctx, () => {}); // Redirect is tricky, let's just close or text
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

  // Вибір дефолтного авто
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
adminRouter.use(createConversation(driverConv));

adminRouter.callbackQuery("admin_driver_add", async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("driverConv");
});
adminRouter.callbackQuery(/admin_driver_edit_(\d+)/, async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("driverConv");
});

// ==========================================
// 🏢 КЕРУВАННЯ ВІДПРАВНИКАМИ (SHIPPERS)
// ==========================================
adminRouter.callbackQuery("admin_shippers_list", async (ctx) => {
  const shippers = await db('shippers').select('*');
  const keyboard = new InlineKeyboard();
  shippers.forEach(s => {
    keyboard.text(`[${s.shipper_key.split(',')[0]}] ${s.manager}`, `admin_shipper_show_${s.id}`).row();
  });
  keyboard.text("➕ Додати відправника", "admin_shipper_add").row();
  keyboard.text("⬅️ Назад", "admin_main");
  
  await ctx.editMessageText("🏢 **Список відправників:**", { reply_markup: keyboard, parse_mode: "Markdown" });
});

adminRouter.callbackQuery(/admin_shipper_show_(\d+)/, async (ctx) => {
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

adminRouter.callbackQuery(/admin_shipper_delete_(\d+)/, async (ctx) => {
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
adminRouter.use(createConversation(shipperConv));

adminRouter.callbackQuery("admin_shipper_add", async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("shipperConv");
});
adminRouter.callbackQuery(/admin_shipper_edit_(\d+)/, async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("shipperConv");
});

// ==========================================
// 🪨 КЕРУВАННЯ ФРАКЦІЯМИ
// ==========================================
adminRouter.callbackQuery("admin_fractions_list", async (ctx) => {
  const fractions = await db('fractions').select('*');
  const keyboard = new InlineKeyboard();
  fractions.forEach(f => {
    keyboard.text(`[${f.fraction_key.split(',')[0]}] ${f.name.substring(0, 20)}...`, `admin_fraction_show_${f.id}`).row();
  });
  keyboard.text("➕ Додати фракцію", "admin_fraction_add").row();
  keyboard.text("⬅️ Назад", "admin_main");
  
  await ctx.editMessageText("🪨 **Список фракцій:**", { reply_markup: keyboard, parse_mode: "Markdown" });
});

adminRouter.callbackQuery(/admin_fraction_show_(\d+)/, async (ctx) => {
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

adminRouter.callbackQuery(/admin_fraction_delete_(\d+)/, async (ctx) => {
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

adminRouter.use(createConversation(fractionConv));

adminRouter.callbackQuery("admin_fraction_add", async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("fractionConv");
});

adminRouter.callbackQuery(/admin_fraction_edit_(\d+)/, async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("fractionConv");
});

// ==========================================
// 📍 КЕРУВАННЯ ПУНКТАМИ РОЗВАНТАЖЕННЯ
// ==========================================
adminRouter.callbackQuery("admin_destinations_list", async (ctx) => {
  const destinations = await db('destinations').select('*');
  const keyboard = new InlineKeyboard();
  destinations.forEach(d => {
    keyboard.text(`[${d.destination_key.split(',')[0]}] ${d.name.substring(0, 20)}...`, `admin_destination_show_${d.id}`).row();
  });
  keyboard.text("➕ Додати пункт", "admin_destination_add").row();
  keyboard.text("⬅️ Назад", "admin_main");
  
  await ctx.editMessageText("📍 **Список пунктів розвантаження:**", { reply_markup: keyboard, parse_mode: "Markdown" });
});

adminRouter.callbackQuery(/admin_destination_show_(\d+)/, async (ctx) => {
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

adminRouter.callbackQuery(/admin_destination_delete_(\d+)/, async (ctx) => {
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

adminRouter.use(createConversation(destinationConv));

adminRouter.callbackQuery("admin_destination_add", async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("destinationConv");
});

adminRouter.callbackQuery(/admin_destination_edit_(\d+)/, async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("destinationConv");
});

// ==========================================
// 🔢 КЕРУВАННЯ ЛІЧИЛЬНИКОМ
// ==========================================
adminRouter.callbackQuery("admin_counter_edit", async (ctx) => {
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
adminRouter.use(createConversation(counterConv));

adminRouter.callbackQuery("admin_counter_change", async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("counterConv");
});


// ==========================================
// 👮 КЕРУВАННЯ АДМІНІСТРАТОРАМИ (ADMINS)
// ==========================================
adminRouter.callbackQuery("admin_admins_list", async (ctx) => {
  const admins = await db('admins').select('*');
  const keyboard = new InlineKeyboard();
  admins.forEach(a => {
    keyboard.text(`[${a.name}] ${a.telegram_id}`, `admin_admin_show_${a.id}`).row();
  });
  keyboard.text("➕ Додати адміна", "admin_admin_add").row();
  keyboard.text("⬅️ Назад", "admin_main");
  
  await ctx.editMessageText("👮 **Список додаткових адміністраторів:**\n_(Головний адмін налаштовується в .env)_", { reply_markup: keyboard, parse_mode: "Markdown" });
});

adminRouter.callbackQuery(/admin_admin_show_(\d+)/, async (ctx) => {
  const id = ctx.match[1];
  const a = await db('admins').where({ id }).first();
  if (!a) return ctx.answerCallbackQuery("Не знайдено");

  const text = `👮 **Адмін ID:** ${a.id}\n**Ім'я:** ${a.name}\n**Telegram ID:** ${a.telegram_id}`;

  const keyboard = new InlineKeyboard()
    .text("❌ Видалити", `admin_admin_delete_${a.id}`).row()
    .text("⬅️ До списку", "admin_admins_list");

  await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: "Markdown" });
});

adminRouter.callbackQuery(/admin_admin_delete_(\d+)/, async (ctx) => {
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
adminRouter.use(createConversation(adminAddConv));

adminRouter.callbackQuery("admin_admin_add", async (ctx) => {
  await ctx.deleteMessage();
  await ctx.conversation.enter("adminAddConv");
});
