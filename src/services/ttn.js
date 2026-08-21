import { InlineKeyboard, InputFile } from 'grammy';
import { db, generateNextTtnNumber, getSetting } from '../config/db.js';
import { parseTtnDataFromText } from './ai.js';
import { generateTtnPdf } from './pdf.js';
import { fuzzyMatch } from '../utils/textMatcher.js';
import { 
  formatUkrainianDate, 
  formatNumberComma, 
  calculateWeights, 
  escapeHtml 
} from '../utils/formatters.js';

// Загальні незмінні поля для бланка ТТН
export const staticPresets = {
  consignee_info: '',
  carrier_info: '',
  loading_point: '34550, смт.Клесів, вул.Чайковського,32',
  packing_type: 'насипом',
  places_words: 'одне'
};

export async function getDbContext() {
  const drivers = await db('drivers').select('name_key', 'fio');
  const vehicles = await db('vehicles').select('plate_number', 'car_info');
  const shippers = await db('shippers').select('shipper_key', 'manager');
  const fractions = await db('fractions').select('fraction_key', 'name');
  const destinations = await db('destinations').select('destination_key', 'name');

  const driverNames = drivers.flatMap(d => [d.name_key, d.fio]).filter(Boolean);
  const vehicleNames = vehicles.flatMap(v => [v.plate_number, v.car_info]).filter(Boolean);
  const shipperNames = shippers.flatMap(s => [s.shipper_key, s.manager]).filter(Boolean);
  const fractionNames = fractions.flatMap(f => [f.fraction_key, f.name]).filter(Boolean);
  const destinationNames = destinations.flatMap(d => [d.destination_key, d.name]).filter(Boolean);

  return {
    drivers: [...new Set(driverNames)],
    vehicles: [...new Set(vehicleNames)],
    shippers: [...new Set(shipperNames)],
    fractions: [...new Set(fractionNames)],
    destinations: [...new Set(destinationNames)],
  };
}

export async function processTtnText(ctx, textInput, dbContext = null) {
  try {
    if (!dbContext) {
      dbContext = await getDbContext();
    }
    
    // Структурування даних в JSON через AI
    const parsed = await parseTtnDataFromText(textInput, dbContext);

    // ПІДБІР ДАНИХ ІЗ БАЗИ ДАНИХ
    const drivers = await db('drivers').select('*');
    const vehicles = await db('vehicles').select('*');
    const shippers = await db('shippers').select('*');
    const fractions = await db('fractions').select('*');
    const destinations = await db('destinations').select('*');

    let dbDriver, dbVehicle, dbShipper, dbFraction, dbDest;

    if (parsed.driver_name) {
      const driverKey = parsed.driver_name.toLowerCase();
      dbDriver = drivers.find(d => 
        fuzzyMatch(d.name_key, driverKey) ||
        (d.fio && d.fio.toLowerCase().includes(driverKey))
      );
    }

    if (parsed.car_number) {
      const carKey = parsed.car_number.toString().toLowerCase();
      dbVehicle = vehicles.find(v => 
        (v.plate_number && v.plate_number.toLowerCase().includes(carKey)) ||
        (v.car_info && v.car_info.toLowerCase().includes(carKey))
      );
    }
    if (!dbVehicle && dbDriver && dbDriver.default_vehicle_id) {
      dbVehicle = vehicles.find(v => Number(v.id) === Number(dbDriver.default_vehicle_id));
    }

    if (parsed.shipper_name) {
      const shipperKey = parsed.shipper_name.toLowerCase();
      dbShipper = shippers.find(s => 
        fuzzyMatch(s.shipper_key, shipperKey) ||
        (s.manager && s.manager.toLowerCase().includes(shipperKey))
      );
    }

    if (parsed.cargo_fraction) {
      const fractionKey = parsed.cargo_fraction.toLowerCase();
      dbFraction = fractions.find(f => 
        fuzzyMatch(f.fraction_key, fractionKey) ||
        (f.name && f.name.toLowerCase().includes(fractionKey))
      );
    }

    if (parsed.unloading_point) {
      const destKey = parsed.unloading_point.toLowerCase();
      dbDest = destinations.find(d => 
        fuzzyMatch(d.destination_key, destKey) ||
        (d.name && d.name.toLowerCase().includes(destKey))
      );
    }

    let date = new Date();
    if (parsed.target_date) {
      const parsedDate = new Date(parsed.target_date);
      if (!isNaN(parsedDate.getTime())) {
        date = parsedDate;
      }
    }

    ctx.session.pendingTtn = {
      driver_id: dbDriver ? dbDriver.id : null,
      vehicle_id: dbVehicle ? dbVehicle.id : null,
      shipper_id: dbShipper ? dbShipper.id : null,
      fraction_id: dbFraction ? dbFraction.id : null,
      destination_id: dbDest ? dbDest.id : null,
      weight_netto: parsed.weight_netto ? parseFloat(parsed.weight_netto) : null,
      target_date: date.toISOString(),
      edited_fields: []
    };

    console.log("📋 DB matching result:", JSON.stringify({
      driver: dbDriver ? dbDriver.fio : null,
      vehicle: dbVehicle ? dbVehicle.plate_number : null,
      shipper: dbShipper ? dbShipper.manager : null,
      fraction: dbFraction ? dbFraction.name : null,
      destination: dbDest ? dbDest.name : null,
      weight: parsed.weight_netto,
      pendingTtn: ctx.session.pendingTtn
    }));

    // Будуємо фінальні дані та відправляємо прев'ю
    await sendOrEditPreview(ctx);

  } catch (err) {
    console.error("Помилка обробки тексту:", err);
    await ctx.reply("❌ Не вдалося обробити запит та згенерувати ТТН.");
  }
}

export async function rebuildPendingTtn(ctx) {
  const p = ctx.session?.pendingTtn;
  if (!p) return null;

  const dbDriver = p.driver_id ? await db('drivers').where({ id: p.driver_id }).first() : null;
  const dbVehicle = p.vehicle_id ? await db('vehicles').where({ id: p.vehicle_id }).first() : null;
  const dbShipper = p.shipper_id ? await db('shippers').where({ id: p.shipper_id }).first() : null;
  const dbFraction = p.fraction_id ? await db('fractions').where({ id: p.fraction_id }).first() : null;
  const dbDest = p.destination_id ? await db('destinations').where({ id: p.destination_id }).first() : null;

  const isComplete = !!(dbDriver && dbVehicle && dbShipper && dbFraction && dbDest && p.weight_netto);
  const formattedDate = formatUkrainianDate(p.target_date);
  const weights = calculateWeights(p.weight_netto);

  const defaultStorage = await getSetting('default_vehicle_storage', 'м. Київ, вул. Центральна, 1');
  const vehicleStorage = (dbVehicle && dbVehicle.storage_point) || defaultStorage;
  
  if (isComplete) {
    const ttnData = {
      ...staticPresets,
      consignee_info: dbDriver.info || staticPresets.consignee_info,
      carrier_info: dbDriver.info || staticPresets.carrier_info,
      ttn_date: formattedDate,
      shipper_info: dbShipper.info,
      shipper_manager: dbShipper.manager,
      car_info: dbVehicle.car_info,
      trailer_info: dbVehicle.trailer_info,
      vehicle_storage: vehicleStorage,
      driver_fio: dbDriver.fio,
      driver_license: dbDriver.license,
      unloading_point: dbDest.name,
      cargo_name: dbFraction.name,
      weight_netto: formatNumberComma(weights.netto),
      weight_brutto: formatNumberComma(weights.brutto),
      tare_and_brutto: `${formatNumberComma(weights.tare)}/${formatNumberComma(weights.brutto)}`,
      weight_brutto_words: `${formatNumberComma(weights.brutto)} т.`
    };
    ctx.session.pendingTtnData = ttnData;
  } else {
    ctx.session.pendingTtnData = null;
  }

  return { dbDriver, dbVehicle, dbShipper, dbFraction, dbDest, weights, formattedDate, isComplete, vehicleStorage };
}

export function getPreviewMessage(details) {
  const { dbDriver, dbVehicle, dbShipper, dbFraction, dbDest, weights, formattedDate, isComplete, vehicleStorage } = details;

  let confirmText = `<u>📄 <b>Перевірте дані для ТТН:</b></u>\n\n` +
    `<code>📅 Дата:</code> <i>${escapeHtml(formattedDate) || '❌ Не вказано'}</i>\n\n` +
    `<code>👤 Водій:</code> <i>${dbDriver ? escapeHtml(dbDriver.fio) : '❌ Відсутній або не знайдено'}</i>\n` +
    `<code>🚗 Авто:</code> <i>${dbVehicle ? escapeHtml(dbVehicle.car_info) : '❌ Відсутнє або не знайдено'}</i>\n` +
    `<code>🏠 Стоянка:</code> <i>${escapeHtml(vehicleStorage) || '❌ Не вказано'}</i>\n\n` +
    `<code>🏢 Відправник:</code> <i>${dbShipper ? escapeHtml(dbShipper.manager) : '❌ Відсутній або не знайдено'}</i>\n\n` +
    `<code>🪨 Вантаж:</code> <i>${dbFraction ? escapeHtml(dbFraction.name) : '❌ Відсутній або не знайдено'}</i>\n` +
    `<code>📍 Розвантаження:</code> <i>${dbDest ? escapeHtml(dbDest.name) : '❌ Відсутнє або не знайдено'}</i>\n\n`;
    
  if (weights?.netto) {
    confirmText += `<code>⚖️ Вага:</code>\n` +
      `  • <code>Нетто:</code> <i><b>${weights.netto} т.</b></i>\n` +
      `  • <code>Тара:</code> <i><b>${weights.tare} т.</b></i>\n` +
      `  • <code>Брутто:</code> <i><b>${weights.brutto} т.</b></i>\n`;
  } else {
    confirmText += `<code>⚖️ Вага (нетто):</code> ❌ Не вказано\n`;
  }

  if (!isComplete) {
    let missingFields = [];
    if (!dbDriver) missingFields.push('👤 Водій');
    if (!dbVehicle) missingFields.push('🚗 Авто');
    if (!dbShipper) missingFields.push('🏢 Відправник');
    if (!dbFraction) missingFields.push('🪨 Вантаж');
    if (!dbDest) missingFields.push('📍 Розвантаження');
    if (!weights?.netto) missingFields.push('⚖️ Вага');

    confirmText += `\n───────────────────\n`;
    confirmText += `🚨 <b>НЕ ВИСТАЧАЄ ДАНИХ:</b>\n`;
    missingFields.forEach(field => {
      confirmText += ` • ${field}\n`;
    });
    confirmText += `\n💡 <i>Натисніть кнопку <b>«✏️ Редагувати дані»</b> нижче, щоб додати недостатню інформацію.</i>\n`;
    return confirmText;
  }

  let emptyFields = [];
  if (dbDriver && !dbDriver.info) emptyFields.push('Реквізити водія (Перевізник / Одержувач)');
  if (dbDriver && !dbDriver.license) emptyFields.push('Посвідчення водія');
  if (dbShipper && !dbShipper.info) emptyFields.push('Реквізити відправника');
  if (dbVehicle && !dbVehicle.car_info) emptyFields.push('Марка автомобіля');
  if (dbVehicle && !dbVehicle.trailer_info) emptyFields.push('Причіп');

  if (emptyFields.length > 0) {
    confirmText += `\n───────────────────\n`;
    confirmText += `⚠️ <b>Увага:</b> У базі даних не заповнені реквізити:\n`;
    emptyFields.forEach(f => confirmText += ` • ${f}\n`);
    confirmText += `<i>Відповідні графи у бланку ТТН залишаться порожніми.</i>\n`;
  }

  confirmText += `\n🎉 <b>Генеруємо ТТН?</b>`;
  return confirmText;
}

export function getPreviewKeyboard(isComplete) {
  const keyboard = new InlineKeyboard();
  if (isComplete) {
    keyboard.inline_keyboard.push([
      { text: "✅ Так, генерувати", callback_data: "ttn_generate_yes", style: "success" },
      { text: "❌ Скасувати", callback_data: "ttn_generate_no", style: "danger" }
    ]);
  } else {
    keyboard.inline_keyboard.push([
      { text: "❌ Скасувати", callback_data: "ttn_generate_no", style: "danger" }
    ]);
  }
  keyboard.inline_keyboard.push([
    { text: "✏️ Редагувати дані", callback_data: "ttn_edit_main", style: "primary" }
  ]);
  return keyboard;
}

export async function sendOrEditPreview(ctx, forceReply = false) {
  try {
    const details = await rebuildPendingTtn(ctx);
    if (!details) {
      return ctx.reply("❌ Помилка: дані ТТН не знайдено.");
    }
    const text = getPreviewMessage(details);
    const reply_markup = getPreviewKeyboard(details.isComplete);
    if (ctx.callbackQuery && !forceReply) {
      await ctx.editMessageText(text, { reply_markup, parse_mode: "HTML" }).catch(() => {});
    } else {
      await ctx.reply(text, { reply_markup, parse_mode: "HTML" });
    }
  } catch (err) {
    console.error("Помилка оновлення прев'ю:", err);
    await ctx.reply("❌ Не вдалося оновити дані ТТН.");
  }
}

export function markFieldEdited(ctx, fieldName) {
  if (!ctx.session?.pendingTtn) return;
  if (!Array.isArray(ctx.session.pendingTtn.edited_fields)) {
    ctx.session.pendingTtn.edited_fields = [];
  }
  if (!ctx.session.pendingTtn.edited_fields.includes(fieldName)) {
    ctx.session.pendingTtn.edited_fields.push(fieldName);
  }
}

function getFieldButton(fieldName, baseLabel, callbackData, pendingTtn) {
  const isEdited = pendingTtn?.edited_fields?.includes(fieldName);
  let hasValue = false;

  if (fieldName === 'driver') hasValue = !!pendingTtn?.driver_id;
  else if (fieldName === 'vehicle') hasValue = !!pendingTtn?.vehicle_id;
  else if (fieldName === 'shipper') hasValue = !!pendingTtn?.shipper_id;
  else if (fieldName === 'fraction') hasValue = !!pendingTtn?.fraction_id;
  else if (fieldName === 'destination') hasValue = !!pendingTtn?.destination_id;
  else if (fieldName === 'weight') hasValue = pendingTtn?.weight_netto !== null && pendingTtn?.weight_netto !== undefined && Number(pendingTtn?.weight_netto) > 0;
  else if (fieldName === 'date') hasValue = !!pendingTtn?.target_date;

  let style = 'danger';

  if (isEdited && hasValue) {
    style = 'primary';
  } else if (hasValue) {
    style = 'success';
  } else {
    style = 'danger';
  }

  return {
    text: baseLabel,
    callback_data: callbackData,
    style: style
  };
}

export function getEditMenuKeyboard(pendingTtn = {}) {
  const keyboard = new InlineKeyboard();

  const driverBtn = getFieldButton('driver', '👤 Водій', 'ttn_edit_field_driver', pendingTtn);
  const vehicleBtn = getFieldButton('vehicle', '🚗 Авто', 'ttn_edit_field_vehicle', pendingTtn);
  const shipperBtn = getFieldButton('shipper', '🏢 Відправник', 'ttn_edit_field_shipper', pendingTtn);
  const fractionBtn = getFieldButton('fraction', '🪨 Вантаж', 'ttn_edit_field_fraction', pendingTtn);
  const destBtn = getFieldButton('destination', '📍 Розвантаження', 'ttn_edit_field_destination', pendingTtn);
  const weightBtn = getFieldButton('weight', '⚖️ Вага', 'ttn_edit_field_weight', pendingTtn);
  const dateBtn = getFieldButton('date', '📅 Дата', 'ttn_edit_field_date', pendingTtn);

  keyboard.inline_keyboard.push([driverBtn, vehicleBtn]);
  keyboard.inline_keyboard.push([shipperBtn, fractionBtn]);
  keyboard.inline_keyboard.push([destBtn, weightBtn]);
  keyboard.inline_keyboard.push([dateBtn]);
  keyboard.inline_keyboard.push([
    { text: "⬅️ Назад", callback_data: "ttn_edit_back" }
  ]);

  return keyboard;
}

export async function showDateOptions(ctx) {
  const keyboard = new InlineKeyboard()
    .text("📅 Сьогодні", "ttn_set_date_today")
    .text("📅 Завтра", "ttn_set_date_tomorrow").row()
    .text("📅 Післязавтра", "ttn_set_date_after_tomorrow").row()
    .text("✍️ Ввести іншу дату", "ttn_edit_field_date_manual").row()
    .text("⬅️ Назад", "ttn_edit_main");

  await ctx.editMessageText("📅 **Оберіть дату поїздки для ТТН або введіть свій варіант:**", {
    reply_markup: keyboard,
    parse_mode: "Markdown"
  });
}

/**
 * Універсальний рендерер вибору сутностей для ТТН (DRY)
 */
async function showEntitySelectionList(ctx, { title, tableName, getButtonText, getCallbackData }) {
  const items = await db(tableName).select('*');
  const keyboard = new InlineKeyboard();
  items.forEach(item => {
    keyboard.text(getButtonText(item), getCallbackData(item)).row();
  });
  keyboard.text("⬅️ Назад", "ttn_edit_main");
  await ctx.editMessageText(title, { reply_markup: keyboard, parse_mode: "Markdown" });
}

export async function showDriversList(ctx) {
  await showEntitySelectionList(ctx, {
    title: "👤 **Оберіть водія із бази даних:**",
    tableName: 'drivers',
    getButtonText: (d) => d.fio,
    getCallbackData: (d) => `ttn_set_driver_${d.id}`
  });
}

export async function showVehiclesList(ctx) {
  await showEntitySelectionList(ctx, {
    title: "🚗 **Оберіть автомобіль із бази даних:**",
    tableName: 'vehicles',
    getButtonText: (v) => `${v.plate_number} (${v.car_info.substring(0, 15)})`,
    getCallbackData: (v) => `ttn_set_vehicle_${v.id}`
  });
}

export async function showShippersList(ctx) {
  await showEntitySelectionList(ctx, {
    title: "🏢 **Оберіть вантажовідправника із бази даних:**",
    tableName: 'shippers',
    getButtonText: (s) => s.manager,
    getCallbackData: (s) => `ttn_set_shipper_${s.id}`
  });
}

export async function showFractionsList(ctx) {
  await showEntitySelectionList(ctx, {
    title: "🪨 **Оберіть фракцію/вантаж із бази даних:**",
    tableName: 'fractions',
    getButtonText: (f) => {
      const shortName = f.name.length > 20 ? f.name.substring(0, 17) + "..." : f.name;
      return f.fraction_key ? `📎 ${f.fraction_key} (${shortName})` : f.name.substring(0, 30);
    },
    getCallbackData: (f) => `ttn_set_fraction_${f.id}`
  });
}

export async function showDestinationsList(ctx) {
  await showEntitySelectionList(ctx, {
    title: "📍 **Оберіть пункт розвантаження із бази даних:**",
    tableName: 'destinations',
    getButtonText: (d) => d.name.substring(0, 30),
    getCallbackData: (d) => `ttn_set_destination_${d.id}`
  });
}

export async function generateAndSendTtnPdf(ctx) {
  const ttnData = ctx.session?.pendingTtnData;
  if (!ttnData) {
    return ctx.reply("❌ Помилка: дані ТТН не знайдено або сесія застаріла.");
  }
  
  await ctx.reply("⏳ Реквізити підтверджено. Генерую бланк PDF...");

  try {
    const ttnCounters = await generateNextTtnNumber();
    ttnData.ttn_number = ttnCounters.full;

    const pdfBuffer = await generateTtnPdf(ttnData);
    const pdfFilename = `TTN_No_${ttnCounters.full.replace('/', '_')}.pdf`;

    // Надсилання PDF напряму з Buffer (без запису на диск)
    await ctx.replyWithDocument(
      new InputFile(pdfBuffer, pdfFilename),
      { caption: `✅ **ТТН № ${ttnCounters.full}** успішно сформована!`, parse_mode: "Markdown" }
    );

    ctx.session.pendingTtnData = null;
    ctx.session.pendingTtn = null;
  } catch (err) {
    console.error("Помилка генерації:", err);
    await ctx.reply("❌ Не вдалося згенерувати ТТН. Перевір логи сервера.");
  }
}
