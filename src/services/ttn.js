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
    
    // 3. Структурування даних в JSON
    const parsed = await parseTtnDataFromText(textInput, dbContext);

    // 4. ПІДБІР ДАНИХ ІЗ БАЗИ ДАНИХ
    const drivers = await db('drivers').select('*');
    const vehicles = await db('vehicles').select('*');
    const shippers = await db('shippers').select('*');
    const fractions = await db('fractions').select('*');
    const destinations = await db('destinations').select('*');

    let dbDriver, dbVehicle, dbShipper, dbFraction, dbDest;

    if (parsed.driver_name) {
      const driverKey = parsed.driver_name.toLowerCase();
      dbDriver = drivers.find(d => 
        (d.name_key && d.name_key.toLowerCase().includes(driverKey)) ||
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
        (s.shipper_key && s.shipper_key.toLowerCase().includes(shipperKey)) ||
        (s.manager && s.manager.toLowerCase().includes(shipperKey))
      );
    }

    if (parsed.cargo_fraction) {
      const fractionKey = parsed.cargo_fraction.toLowerCase();
      dbFraction = fractions.find(f => 
        (f.fraction_key && f.fraction_key.toLowerCase().includes(fractionKey)) ||
        (f.name && f.name.toLowerCase().includes(fractionKey))
      );
    }

    if (parsed.unloading_point) {
      const destKey = parsed.unloading_point.toLowerCase();
      dbDest = destinations.find(d => 
        (d.destination_key && d.destination_key.toLowerCase().includes(destKey)) ||
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
      target_date: date.toISOString()
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
  const p = ctx.session.pendingTtn;
  if (!p) return null;

  const dbDriver = p.driver_id ? await db('drivers').where({ id: p.driver_id }).first() : null;
  const dbVehicle = p.vehicle_id ? await db('vehicles').where({ id: p.vehicle_id }).first() : null;
  const dbShipper = p.shipper_id ? await db('shippers').where({ id: p.shipper_id }).first() : null;
  const dbFraction = p.fraction_id ? await db('fractions').where({ id: p.fraction_id }).first() : null;
  const dbDest = p.destination_id ? await db('destinations').where({ id: p.destination_id }).first() : null;

  let isComplete = !!(dbDriver && dbVehicle && dbShipper && dbFraction && dbDest && p.weight_netto);

  let date = new Date(p.target_date);
  if (isNaN(date.getTime())) {
    date = new Date();
  }
  const months = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];
  const formattedDate = `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()} р.`;

  const netto = p.weight_netto ? parseFloat(p.weight_netto) : null;
  
  if (isComplete) {
    const brutto = 39.8;
    const computedTare = parseFloat((brutto - netto).toFixed(2));
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
      tare_and_brutto: `${formatVal(computedTare)}/${formatVal(brutto)}`,
      weight_brutto_words: `${formatVal(brutto)} т.`
    };
    ctx.session.pendingTtnData = ttnData;
  } else {
    ctx.session.pendingTtnData = null;
  }

  return { dbDriver, dbVehicle, dbShipper, dbFraction, dbDest, netto, isComplete };
}

export function getPreviewMessage(dbDriver, dbVehicle, dbShipper, dbFraction, dbDest, netto, isComplete) {
  let confirmText = `📄 **Перевірте дані для ТТН:**\n\n` +
    `👤 **Водій:** ${dbDriver ? dbDriver.fio : '❌ Відсутній або не знайдено'}\n` +
    `🚗 **Авто:** ${dbVehicle ? `${dbVehicle.plate_number} (${dbVehicle.car_info})` : '❌ Відсутнє або не знайдено'}\n` +
    `🏢 **Відправник:** ${dbShipper ? dbShipper.manager : '❌ Відсутній або не знайдено'}\n` +
    `🪨 **Вантаж:** ${dbFraction ? dbFraction.name : '❌ Відсутній або не знайдено'}\n` +
    `📍 **Розвантаження:** ${dbDest ? dbDest.name : '❌ Відсутнє або не знайдено'}\n` +
    `⚖️ **Вага (нетто):** ${netto ? `${netto} т.` : '❌ Не вказано'}\n`;
    
  if (netto) {
    const computedTare = parseFloat((39.8 - netto).toFixed(2));
    confirmText += `⚖️ **Вага (тара):** ${computedTare} т.\n`;
    confirmText += `⚖️ **Вага (брутто):** 39.8 т.\n\n`;
  } else {
    confirmText += `\n`;
  }

  if (!isComplete) {
    confirmText += `⚠️ **Не всі дані розпізнано!**\nБудь ласка, натисніть "✏️ Редагувати дані", щоб заповнити відсутні поля та згенерувати ТТН.\n\n`;
    return confirmText;
  }

  let emptyFields = [];
  if (dbDriver && !dbDriver.info) emptyFields.push('Реквізити водія (Перевізник / Одержувач)');
  if (dbDriver && !dbDriver.license) emptyFields.push('Посвідчення водія');
  if (dbShipper && !dbShipper.info) emptyFields.push('Реквізити відправника');
  if (dbVehicle && !dbVehicle.car_info) emptyFields.push('Марка автомобіля');
  if (dbVehicle && !dbVehicle.trailer_info) emptyFields.push('Причіп');

  if (emptyFields.length > 0) {
    confirmText += `⚠️ **Увага:** У базі даних не заповнені наступні поля:\n`;
    emptyFields.forEach(f => confirmText += `— ${f}\n`);
    confirmText += `Відповідні графи у бланку ТТН залишаться пустими!\n\n`;
  }

  confirmText += `Генеруємо?`;
  return confirmText;
}

export function getPreviewKeyboard(isComplete) {
  const keyboard = new InlineKeyboard();
  if (isComplete) {
    keyboard.text("✅ Так, генерувати", "ttn_generate_yes")
    keyboard.text("❌ Відмінити", "ttn_generate_no").row();
  } else {
    keyboard.text("❌ Відмінити", "ttn_generate_no").row();
  }
  keyboard.text("✏️ Редагувати дані", "ttn_edit_main");
  return keyboard;
}

export async function sendOrEditPreview(ctx, forceReply = false) {
  try {
    const details = await rebuildPendingTtn(ctx);
    if (!details) {
      return ctx.reply("❌ Помилка: дані ТТН не знайдено.");
    }
    const text = getPreviewMessage(details.dbDriver, details.dbVehicle, details.dbShipper, details.dbFraction, details.dbDest, details.netto, details.isComplete);
    const reply_markup = getPreviewKeyboard(details.isComplete);
    if (ctx.callbackQuery && !forceReply) {
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
