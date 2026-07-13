import { InlineKeyboard } from 'grammy';
import { db } from '../config/db.js';
import { parseTtnDataFromText } from './ai.js';

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
    // 3. Структурування даних  в JSON
    const parsed = await parseTtnDataFromText(textInput);

    // 4. ПІДБІР ДАНИХ ІЗ БАЗИ ДАНИХ
    const drivers = await db('drivers').select('*');
    const vehicles = await db('vehicles').select('*');
    const shippers = await db('shippers').select('*');
    const fractions = await db('fractions').select('*');

    // Шукаємо водія
    const driverKey = parsed.driver_name ? parsed.driver_name.toLowerCase() : "гриша";
    let dbDriver = drivers.find(d => d.name_key && d.name_key.toLowerCase().includes(driverKey));
    if (!dbDriver) dbDriver = drivers.find(d => d.name_key && d.name_key.toLowerCase().includes('гриша'));
    if (!dbDriver) dbDriver = drivers[0];
    if (!dbDriver) return await ctx.reply("❌ Помилка: У базі даних немає жодного водія! Додайте їх в адмінці.");

    // Шукаємо машину
    let dbVehicle;
    if (parsed.car_number) {
      const carKey = parsed.car_number.toString().toLowerCase();
      dbVehicle = vehicles.find(v => v.plate_number.toLowerCase().includes(carKey));
    }
    if (!dbVehicle && dbDriver.default_vehicle_id) {
      dbVehicle = vehicles.find(v => v.id === dbDriver.default_vehicle_id);
    }
    if (!dbVehicle) dbVehicle = vehicles[0];
    if (!dbVehicle) return await ctx.reply("❌ Помилка: У базі даних немає жодного автомобіля! Додайте їх в адмінці.");

    // Шукаємо вантажовідправника
    const shipperKey = parsed.shipper_name ? parsed.shipper_name.toLowerCase() : "понедільник";
    let dbShipper = shippers.find(s => s.shipper_key && s.shipper_key.toLowerCase().includes(shipperKey));
    if (!dbShipper) dbShipper = shippers.find(s => s.shipper_key && s.shipper_key.toLowerCase().includes('понедільник'));
    if (!dbShipper) dbShipper = shippers[0];
    if (!dbShipper) return await ctx.reply("❌ Помилка: У базі даних немає жодного відправника! Додайте їх в адмінці.");

    // Шукаємо фракцію
    const fractionKey = parsed.cargo_fraction ? parsed.cargo_fraction.toLowerCase() : "5-20";
    let dbFraction = fractions.find(f => f.fraction_key && f.fraction_key.toLowerCase().includes(fractionKey));
    if (!dbFraction) dbFraction = fractions.find(f => f.fraction_key && f.fraction_key.toLowerCase().includes('5-20'));
    if (!dbFraction) dbFraction = fractions[0];
    if (!dbFraction) return await ctx.reply("❌ Помилка: У базі даних немає жодної фракції! Додайте їх в адмінці.");

    // Шукаємо пункт розвантаження
    const destinations = await db('destinations').select('*');
    const destKey = parsed.unloading_point ? parsed.unloading_point.toLowerCase() : "ратне";
    let dbDest = destinations.find(d => d.destination_key && d.destination_key.toLowerCase().includes(destKey));
    if (!dbDest) dbDest = destinations.find(d => d.destination_key && d.destination_key.toLowerCase().includes('ратне'));
    if (!dbDest) dbDest = destinations[0];
    if (!dbDest) return await ctx.reply("❌ Помилка: У базі даних немає жодного пункту розвантаження! Додайте їх в адмінці.");

    // Розрахунок дати складання документа
    const date = new Date();
    if (parsed.date_type === "завтра") date.setDate(date.getDate() + 1);
    const months = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];
    const formattedDate = `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()} р.`;

    // Математика ваги та тари
    const netto = parseFloat(parsed.weight_netto) || 24.00;
    const brutto = parseFloat((netto + dbVehicle.tare_weight).toFixed(2));
    
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
      weight_netto: netto.toString().replace('.', ','),
      weight_brutto: brutto.toString().replace('.', ','),
      tare_and_brutto: `${dbVehicle.tare_weight.toString().replace('.', ',')}/${brutto.toString().replace('.', ',')}`,
      weight_brutto_words: `${brutto.toString().replace('.', ',')} т.`
    };

    ctx.session.pendingTtnData = ttnData;

    let confirmText = `📄 **Перевірте дані для ТТН:**\n\n` +
      `👤 **Водій:** ${dbDriver.fio}\n` +
      `🚗 **Авто:** ${dbVehicle.plate_number}\n` +
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

    const keyboard = new InlineKeyboard()
      .text("✅ Так, генерувати", "ttn_generate_yes")
      .text("❌ Відмінити", "ttn_generate_no");

    await ctx.reply(confirmText, { reply_markup: keyboard, parse_mode: "Markdown" });

  } catch (err) {
    console.error("Помилка обробки тексту:", err);
    await ctx.reply("❌ Не вдалося обробити запит та згенерувати ТТН.");
  }
}
