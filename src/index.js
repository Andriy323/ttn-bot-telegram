import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Bot, InputFile, session, Keyboard, InlineKeyboard } from 'grammy';
import { conversations } from '@grammyjs/conversations';
import axios from 'axios';
import dotenv from 'dotenv';

// Імпортуємо налаштовані архітектурні сервіси
import { db, initDb, generateNextTtnNumber, setCounterValue } from './config/db.js';
import { transcribeAudio, parseTtnDataFromText } from './services/ai.js';
import { generateTtnPdf } from './services/pdf.js';
import { adminRouter, isAdmin, MAIN_ADMIN_MENU_TEXT, mainAdminKeyboard } from './services/admin.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

// Ініціалізація БД при старті бота
await initDb();

// Налаштування сесій та conversations (мають бути підключені до інших роутерів)
bot.use(session({ initial: () => ({}) }));
bot.use(conversations());

// Підключення адмін-роутера
bot.use(adminRouter);

// Загальні незмінні поля для бланка ТТН
const staticPresets = {
  consignee_info: 'Фізична особа Понедільник С.О. 34550, смт.Клесів,вул.Меліораторів 1а/11,Рівненська обл. Сарненський р-н 2857804858',
  carrier_info: 'Фізична особа Понедільник С.О. 34550, смт.Клесів,вул.Меліораторів 1а/11,Рівненська обл. Сарненський р-н 2857804858',
  loading_point: '34550, смт.Клесів, вул.Чайковського,32',
  packing_type: 'насипом',
  places_words: 'одне'
};

async function processTtnText(ctx, textInput) {
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

    const confirmText = `📄 **Перевірте дані для ТТН:**\n\n` +
      `👤 **Водій:** ${dbDriver.fio}\n` +
      `🚗 **Авто:** ${dbVehicle.plate_number}\n` +
      `🏢 **Відправник:** ${dbShipper.manager}\n` +
      `🪨 **Вантаж:** ${dbFraction.name}\n` +
      `📍 **Розвантаження:** ${dbDest.name}\n` +
      `⚖️ **Вага (нетто):** ${netto} т.\n\n` +
      `Генеруємо?`;

    const keyboard = new InlineKeyboard()
      .text("✅ Так, генерувати", "ttn_generate_yes")
      .text("❌ Відмінити", "ttn_generate_no");

    await ctx.reply(confirmText, { reply_markup: keyboard, parse_mode: "Markdown" });

  } catch (err) {
    console.error("Помилка обробки тексту:", err);
    await ctx.reply("❌ Не вдалося обробити запит та згенерувати ТТН.");
  }
}

bot.on("message:voice", async (ctx) => {
  await ctx.reply("🎧 Голосове отримано! Опрацьовую запит... 🚀");
  const audioPath = path.join(__dirname, `voice_${ctx.message.message_id}.ogg`);

  try {
    const file = await ctx.getFile();
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const writer = fs.createWriteStream(audioPath);
    const response = await axios({ url: fileUrl, method: 'GET', responseType: 'stream' });
    response.data.pipe(writer);
    await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

    const voiceText = await transcribeAudio(audioPath);
    await ctx.reply(`🗣️ **Розпізнаний текст:**\n_${voiceText}_`, { parse_mode: "Markdown" });

    await processTtnText(ctx, voiceText);
  } catch (err) {
    console.error("Помилка обробки голосового:", err);
    await ctx.reply("❌ Не вдалося розпізнати голосове повідомлення.");
  } finally {
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
  }
});

bot.on("message:text", async (ctx, next) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return next();
  if (text.includes("Адмін-панель")) return next();
  if (text.includes("Допомога")) return next();

  await ctx.reply("📝 Текстовий запит отримано! Опрацьовую... 🚀");
  await processTtnText(ctx, text);
});

bot.callbackQuery("ttn_generate_yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});

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
    fs.writeFileSync(pdfPath, pdfBuffer);

    await ctx.replyWithDocument(
      new InputFile(pdfPath),
      { caption: `✅ **ТТН № ${ttnCounters.full}** успішно сформована!`, parse_mode: "Markdown" }
    );
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);

    ctx.session.pendingTtnData = null;
  } catch (err) {
    console.error("Помилка генерації:", err);
    await ctx.reply("❌ Не вдалося згенерувати ТТН. Перевір логи сервера.");
  }
});

bot.callbackQuery("ttn_generate_no", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  ctx.session.pendingTtnData = null;
  await ctx.reply("🚫 Генерацію ТТН відмінено.");
});

// Адмінська команда фіксації лічильника ТТН (наприклад: /set 344)
bot.command("set", async (ctx) => {
  const num = parseInt(ctx.message.text.split(' ')[1], 10);
  if (isNaN(num)) {
    return ctx.reply("❌ Неправильний формат! Напиши, наприклад: `/set 344`", { parse_mode: "Markdown" });
  }

  try {
    await setCounterValue(num);
    const today = new Date();
    const currentMonth = String(today.getMonth() + 1).padStart(2, '0');
    ctx.reply(`🎯 Лічильник бази зафіксовано на poznachtsi **${num}**.\nНаступне голосове створить **ТТН № ${num + 1}/${currentMonth}**!`, { parse_mode: "Markdown" });
  } catch (err) {
    console.error(err);
    ctx.reply("❌ Не вдалося змінити значення лічильника в БД.");
  }
});

bot.command("start", async (ctx) => {
  let reply_markup = new Keyboard().text("❓ Допомога").resized().persistent();

  if (await isAdmin(ctx)) {
    reply_markup = new Keyboard().text("⚙️ Адмін-панель").text("❓ Допомога").resized().persistent();
  }

  const welcomeText = "👋 Привіт! Я твій голосовий логіст ТТН.\n\n" +
                      "🎤 **Натисни та утримуй мікрофон, щоб надиктувати рейс.**\n\n" +
                      "💡 *Приклад:* _«Іваненко,  22.5 тон,  5-20»_";

  await ctx.reply(welcomeText, { reply_markup, parse_mode: "Markdown" });
});

bot.hears("⚙️ Адмін-панель", async (ctx) => {
  if (!(await isAdmin(ctx))) {
    return ctx.reply("⛔ У вас немає доступу до адмін-панелі.");
  }
  await ctx.reply(MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
});

bot.hears("❓ Допомога", async (ctx) => {
  const helpText = `📌 **Довідка по роботі з ботом**

🎤 **Як генерувати ТТН:**
Просто надиктуйте голосове повідомлення або напишіть текст.
Приклад: _"Іваненко, машина ВК1234, відправник Коваленко, 22.5 тон, щебінь 5-20, на Ратне, на завтра"_

📋 **Які дані бот розпізнає та шукає в базі:**
- **Водій** — (напр. "Іваненко"). _Якщо не вказати, підставить "Гриша"_.
- **Авто** — (напр. "ВК1234"). _Якщо не вказати, візьме авто, закріплене за водієм_.
- **Вантажовідправник** — (напр. "Коваленко"). _Якщо не вказати, підставить "Понедільник"_.
- **Фракція / Вантаж** — (напр. "20-40"). _Якщо не вказати, підставить "5-20"_.
- **Пункт розвантаження** — (напр. "Сарни"). _Якщо не вказати, підставить "Ратне"_.
- **Вага нетто** — (напр. "22.5 тон"). _Якщо не вказати, підставить 24.00 т. Брутто вираховується автоматично (нетто + тара авто)_.
- **Дата** — (напр. "на завтра"). _Якщо не вказати, встановить сьогоднішню дату_.

💡 **Важливо:** Бот використовує штучний інтелект. Вам не обов'язково називати точне прізвище або номер повністю, достатньо сказати ключове слово. Наприклад, якщо ви скажете вантажовідправника, бот знайде його у вашій базі і підставить у бланк усі його складні реквізити. Якщо чогось не вистачає в повідомленні — бот використає значення за замовчуванням.

⚙️ **Адмін-панель:**
Дозволяє додавати та редагувати водіїв, автомобілі, відправників, пункти розвантаження та фракції у базі.

🔢 **Лічильник номерів:**
Можна задати вручну командою \`/set номер\` (наприклад: \`/set 344\`).`;

  await ctx.reply(helpText, { parse_mode: "Markdown" });
});

bot.start();
console.log("🎙️ Голосовий бот з базою даних SQLite запущений!");