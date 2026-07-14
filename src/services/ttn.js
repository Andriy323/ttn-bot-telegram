import { InlineKeyboard, InputFile } from 'grammy';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, generateNextTtnNumber } from '../config/db.js';
import { parseTtnDataFromText } from './ai.js';
import { generateTtnPdf } from './pdf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Загальні незмінні поля для бланка ТТН
export const staticPresets = {
  consignee_info: '',
  carrier_info: '',
  loading_point: '34550, смт.Клесів, вул.Чайковського,32',
  packing_type: 'насипом',
  places_words: 'одне'
};

export async function processTtnText(ctx, textInput) {
  try {
    // 3. Структурування даних в JSON
    const parsed = await parseTtnDataFromText(textInput);

    const missingFields = [];
    if (!parsed.driver_name) missingFields.push("Водій");
    if (!parsed.shipper_name) missingFields.push("Вантажовідправник");
    if (!parsed.cargo_fraction) missingFields.push("Вантаж/Фракція");
    if (!parsed.unloading_point) missingFields.push("Пункт розвантаження");
    if (!parsed.weight_netto) missingFields.push("Вага (нетто)");
    
    if (missingFields.length > 0) {
      return await ctx.reply(`⚠️ **Не вистачає даних для ТТН!**\n\nВи не назвали:\n${missingFields.map(m => `— ${m}`).join('\n')}\n\n🎤 Будь ласка, надиктуйте рейс ще раз, вказавши всі відсутні дані.`, { parse_mode: "Markdown" });
    }

    // 4. ПІДБІР ДАНИХ ІЗ БАЗИ ДАНИХ
    const drivers = await db('drivers').select('*');
    const vehicles = await db('vehicles').select('*');
    const shippers = await db('shippers').select('*');
    const fractions = await db('fractions').select('*');
    const destinations = await db('destinations').select('*');

    // Шукаємо водія
    const driverKey = parsed.driver_name.toLowerCase();
    const dbDriver = drivers.find(d => d.name_key && d.name_key.toLowerCase().includes(driverKey));
    if (!dbDriver) {
      return await ctx.reply(`❌ Водія "${parsed.driver_name}" не знайдено в базі.`);
    }

    // Шукаємо машину
    let dbVehicle;
    if (parsed.car_number) {
      const carKey = parsed.car_number.toString().toLowerCase();
      dbVehicle = vehicles.find(v => v.plate_number.toLowerCase().includes(carKey));
    }
    if (!dbVehicle && dbDriver.default_vehicle_id) {
      dbVehicle = vehicles.find(v => v.id === dbDriver.default_vehicle_id);
    }
    if (!dbVehicle) {
      return await ctx.reply(`❌ Автомобіль не вказано, і за водієм "${dbDriver.fio}" не закріплено стандартне авто. Додайте авто в адмінці або надиктуйте його номер.`);
    }

    // Шукаємо вантажовідправника
    const shipperKey = parsed.shipper_name.toLowerCase();
    const dbShipper = shippers.find(s => s.shipper_key && s.shipper_key.toLowerCase().includes(shipperKey));
    if (!dbShipper) {
      return await ctx.reply(`❌ Вантажовідправника "${parsed.shipper_name}" не знайдено в базі.`);
    }

    // Шукаємо фракцію
    const fractionKey = parsed.cargo_fraction.toLowerCase();
    const dbFraction = fractions.find(f => f.fraction_key && f.fraction_key.toLowerCase().includes(fractionKey));
    if (!dbFraction) {
      return await ctx.reply(`❌ Фракцію/вантаж "${parsed.cargo_fraction}" не знайдено в базі.`);
    }

    // Шукаємо пункт розвантаження
    const destKey = parsed.unloading_point.toLowerCase();
    const dbDest = destinations.find(d => d.destination_key && d.destination_key.toLowerCase().includes(destKey));
    if (!dbDest) {
      return await ctx.reply(`❌ Пункт розвантаження "${parsed.unloading_point}" не знайдено в базі.`);
    }

    // Розрахунок дати складання документа
    let date = new Date();
    if (parsed.target_date) {
      const parsedDate = new Date(parsed.target_date);
      if (!isNaN(parsedDate.getTime())) {
        date = parsedDate;
      }
    }

    // Зберігаємо вихідні ID/значення в сесію
    ctx.session.pendingTtn = {
      driver_id: dbDriver.id,
      vehicle_id: dbVehicle.id,
      shipper_id: dbShipper.id,
      fraction_id: dbFraction.id,
      destination_id: dbDest.id,
      weight_netto: parseFloat(parsed.weight_netto) || 24.00,
      target_date: date.toISOString()
    };

    // Будуємо фінальні дані та відправляємо прев'ю
    await sendOrEditPreview(ctx);

  } catch (err) {
    console.error("Помилка обробки тексту:", err);
    await ctx.reply("❌ Не вдалося обробити запит та згенерувати ТТН.");
  }
}

export async function rebuildPendingTtn(ctx) {
  const p = ctx.session.pendingTtn;
  if (!p) return null;

  const dbDriver = await db('drivers').where({ id: p.driver_id }).first();
  const dbVehicle = await db('vehicles').where({ id: p.vehicle_id }).first();
  const dbShipper = await db('shippers').where({ id: p.shipper_id }).first();
  const dbFraction = await db('fractions').where({ id: p.fraction_id }).first();
  const dbDest = await db('destinations').where({ id: p.destination_id }).first();

  if (!dbDriver || !dbVehicle || !dbShipper || !dbFraction || !dbDest) {
    throw new Error("Не вдалося завантажити всі сутності з бази даних для перерахунку ТТН.");
  }

  let date = new Date(p.target_date);
  if (isNaN(date.getTime())) {
    date = new Date();
  }
  const months = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];
  const formattedDate = `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()} р.`;

  const netto = parseFloat(p.weight_netto) || 24.00;
  const brutto = parseFloat((netto + dbVehicle.tare_weight).toFixed(2));

  // Безпечне форматування: заміна крапки на кому для українських бланків
  const formatVal = (val) => val !== null && val !== undefined ? val.toString().replace('.', ',') : '';

  const ttnData = {
    ...staticPresets,
    consignee_info: dbDriver.info || staticPresets.consignee_info,
    carrier_info: dbDriver.info || staticPresets.carrier_info,
    ttn_date: formattedDate,
    shipper_info: dbShipper.info,
    shipper_manager: dbShipper.manager,
    car_info: dbVehicle.car_info,
    trailer_info: dbVehicle.trailer_info,
    driver_fio: dbDriver.fio,
    driver_license: dbDriver.license,
    unloading_point: dbDest.name,
    cargo_name: dbFraction.name,
    weight_netto: formatVal(netto),
    weight_brutto: formatVal(brutto),
    tare_and_brutto: `${formatVal(dbVehicle.tare_weight)}/${formatVal(brutto)}`,
    weight_brutto_words: `${formatVal(brutto)} т.`
  };

  ctx.session.pendingTtnData = ttnData;
  return { dbDriver, dbVehicle, dbShipper, dbFraction, dbDest, netto };
}

export function getPreviewMessage(dbDriver, dbVehicle, dbShipper, dbFraction, dbDest, netto) {
  let confirmText = `📄 **Перевірте дані для ТТН:**\n\n` +
    `👤 **Водій:** ${dbDriver.fio}\n` +
    `🚗 **Авто:** ${dbVehicle.plate_number} (${dbVehicle.car_info})\n` +
    `🏢 **Відправник:** ${dbShipper.manager}\n` +
    `🪨 **Вантаж:** ${dbFraction.name}\n` +
    `📍 **Розвантаження:** ${dbDest.name}\n` +
    `⚖️ **Вага (нетто):** ${netto} т.\n\n`;

  let emptyFields = [];
  if (!dbDriver.info) emptyFields.push('Реквізити водія (Перевізник / Одержувач)');
  if (!dbDriver.license) emptyFields.push('Посвідчення водія');
  if (!dbShipper.info) emptyFields.push('Реквізити відправника');
  if (!dbVehicle.car_info) emptyFields.push('Марка автомобіля');
  if (!dbVehicle.trailer_info) emptyFields.push('Причіп');

  if (emptyFields.length > 0) {
    confirmText += `⚠️ **Увага:** У базі даних не заповнені наступні поля:\n`;
    emptyFields.forEach(f => confirmText += `— ${f}\n`);
    confirmText += `Відповідні графи у бланку ТТН залишаться пустими!\n\n`;
  }

  confirmText += `Генеруємо?`;
  return confirmText;
}

export function getPreviewKeyboard() {
  return new InlineKeyboard()
    .text("✅ Так, генерувати", "ttn_generate_yes")
    .text("❌ Відмінити", "ttn_generate_no").row()
    .text("✏️ Редагувати дані", "ttn_edit_main");
}

export async function sendOrEditPreview(ctx) {
  try {
    const details = await rebuildPendingTtn(ctx);
    if (!details) {
      return ctx.reply("❌ Помилка: дані ТТН не знайдено.");
    }
    const text = getPreviewMessage(details.dbDriver, details.dbVehicle, details.dbShipper, details.dbFraction, details.dbDest, details.netto);
    const reply_markup = getPreviewKeyboard();
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { reply_markup, parse_mode: "Markdown" }).catch(() => {});
    } else {
      await ctx.reply(text, { reply_markup, parse_mode: "Markdown" });
    }
  } catch (err) {
    console.error("Помилка оновлення прев'ю:", err);
    await ctx.reply("❌ Не вдалося оновити дані ТТН.");
  }
}

export function getEditMenuKeyboard() {
  return new InlineKeyboard()
    .text("👤 Водій", "ttn_edit_field_driver")
    .text("🚗 Авто", "ttn_edit_field_vehicle").row()
    .text("🏢 Відправник", "ttn_edit_field_shipper")
    .text("🪨 Вантаж", "ttn_edit_field_fraction").row()
    .text("📍 Розвантаження", "ttn_edit_field_destination")
    .text("⚖️ Вага", "ttn_edit_field_weight").row()
    .text("⬅️ Назад", "ttn_edit_back");
}

export async function showDriversList(ctx) {
  const drivers = await db('drivers').select('*');
  const keyboard = new InlineKeyboard();
  drivers.forEach(d => {
    keyboard.text(d.fio, `ttn_set_driver_${d.id}`).row();
  });
  keyboard.text("⬅️ Назад", "ttn_edit_main");
  await ctx.editMessageText("👤 **Оберіть водія із бази даних:**", { reply_markup: keyboard, parse_mode: "Markdown" });
}

export async function showVehiclesList(ctx) {
  const vehicles = await db('vehicles').select('*');
  const keyboard = new InlineKeyboard();
  vehicles.forEach(v => {
    keyboard.text(`${v.plate_number} (${v.car_info.substring(0, 15)})`, `ttn_set_vehicle_${v.id}`).row();
  });
  keyboard.text("⬅️ Назад", "ttn_edit_main");
  await ctx.editMessageText("🚗 **Оберіть автомобіль із бази даних:**", { reply_markup: keyboard, parse_mode: "Markdown" });
}

export async function showShippersList(ctx) {
  const shippers = await db('shippers').select('*');
  const keyboard = new InlineKeyboard();
  shippers.forEach(s => {
    keyboard.text(s.manager, `ttn_set_shipper_${s.id}`).row();
  });
  keyboard.text("⬅️ Назад", "ttn_edit_main");
  await ctx.editMessageText("🏢 **Оберіть вантажовідправника із бази даних:**", { reply_markup: keyboard, parse_mode: "Markdown" });
}

export async function showFractionsList(ctx) {
  const fractions = await db('fractions').select('*');
  const keyboard = new InlineKeyboard();
  fractions.forEach(f => {
    keyboard.text(f.name.substring(0, 30), `ttn_set_fraction_${f.id}`).row();
  });
  keyboard.text("⬅️ Назад", "ttn_edit_main");
  await ctx.editMessageText("🪨 **Оберіть фракцію/вантаж із бази даних:**", { reply_markup: keyboard, parse_mode: "Markdown" });
}

export async function showDestinationsList(ctx) {
  const destinations = await db('destinations').select('*');
  const keyboard = new InlineKeyboard();
  destinations.forEach(d => {
    keyboard.text(d.name.substring(0, 30), `ttn_set_destination_${d.id}`).row();
  });
  keyboard.text("⬅️ Назад", "ttn_edit_main");
  await ctx.editMessageText("📍 **Оберіть пункт розвантаження із бази даних:**", { reply_markup: keyboard, parse_mode: "Markdown" });
}

export async function generateAndSendTtnPdf(ctx) {
  const ttnData = ctx.session.pendingTtnData;
  if (!ttnData) {
    return ctx.reply("❌ Помилка: дані ТТН не знайдено або сесія застаріла.");
  }
  
  await ctx.reply("⏳ Реквізити підтверджено. Генерую бланк PDF...");

  try {
    const ttnCounters = await generateNextTtnNumber();
    ttnData.ttn_number = ttnCounters.full;

    const pdfBuffer = await generateTtnPdf(ttnData);
    const pdfFilename = `TTN_No_${ttnCounters.full.replace('/', '_')}.pdf`;
    const pdfPath = path.join(__dirname, pdfFilename);
    await fs.promises.writeFile(pdfPath, pdfBuffer);

    await ctx.replyWithDocument(
      new InputFile(pdfPath),
      { caption: `✅ **ТТН № ${ttnCounters.full}** успішно сформована!`, parse_mode: "Markdown" }
    );
    
    // Асинхронне видалення файлу
    await fs.promises.unlink(pdfPath).catch(console.error);

    ctx.session.pendingTtnData = null;
    ctx.session.pendingTtn = null;
  } catch (err) {
    console.error("Помилка генерації:", err);
    await ctx.reply("❌ Не вдалося згенерувати ТТН. Перевір логи сервера.");
  }
}
