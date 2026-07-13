import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Composer, Keyboard, InputFile, InlineKeyboard } from 'grammy';
import axios from 'axios';
import dotenv from 'dotenv';

import { generateNextTtnNumber } from '../config/db.js';
import { processTtnText } from '../services/ttn.js';
import { transcribeAudio } from '../services/ai.js';
import { generateTtnPdf } from '../services/pdf.js';
import { isAdmin, MAIN_ADMIN_MENU_TEXT, mainAdminKeyboard } from './admin/utils.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const userRouter = new Composer();

userRouter.use(async (ctx, next) => {
  // Дозволяємо команду /start та кнопку відправки ID для всіх
  if (ctx.message?.text?.startsWith('/start')) return next();
  if (ctx.callbackQuery?.data === "send_id_to_admin") return next();

  // Всі інші дії блокуємо для не-адмінів (бот буде просто ігнорувати повідомлення)
  if (!(await isAdmin(ctx))) {
    if (ctx.callbackQuery) {
      return ctx.answerCallbackQuery({ text: "⛔ Немає доступу.", show_alert: true });
    }
    return;
  }
  
  return next();
});

userRouter.command("start", async (ctx) => {
  let isAdminUser = await isAdmin(ctx);

  if (!isAdminUser) {
    const inlineKb = new InlineKeyboard().text("🆔 Надіслати мій ID адміну", "send_id_to_admin");
    return ctx.reply("⛔ У вас немає доступу до цього бота.\n\nЩоб отримати права, надішліть свій запит головному адміну:", { reply_markup: inlineKb });
  }

  const reply_markup = new Keyboard().text("⚙️ Адмін-панель").text("❓ Допомога").resized().persistent();

  const welcomeText = "👋 Привіт! Я твій голосовий логіст ТТН.\n\n" +
                      "🎤 **Натисни та утримуй мікрофон, щоб надиктувати рейс.**\n\n" +
                      "💡 *Приклад:* _«Іваненко,  22.5 тон,  5-20»_";

  await ctx.reply(welcomeText, { reply_markup, parse_mode: "Markdown" });
});

userRouter.callbackQuery("send_id_to_admin", async (ctx) => {
  await ctx.answerCallbackQuery();
  const superAdminId = process.env.SUPER_ADMIN_ID?.trim();
  
  if (!superAdminId) {
    return ctx.editMessageText("❌ Помилка: Головний адмін не налаштований у системі.");
  }
  
  const user = ctx.from;
  const safeFirstName = (user.first_name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeLastName = (user.last_name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  const userInfo = `🆕 <b>Запит на додавання в адміни!</b>\n\n` +
                   `👤 <b>Ім'я:</b> ${safeFirstName} ${safeLastName}\n` +
                   `🔗 <b>Username:</b> ${user.username ? '@' + user.username : 'немає'}\n` +
                   `🆔 <b>Telegram ID:</b> <code>${user.id}</code>\n\n` +
                   `<i>Щоб додати його, перейдіть в Адмін-панель -> Адміністратори -> Додати.</i>`;
                   
  try {
    await ctx.api.sendMessage(superAdminId, userInfo, { parse_mode: "HTML" });
    await ctx.editMessageText("✅ Ваш ID успішно надіслано головному адміністратору!");
  } catch (err) {
    console.error("Не вдалося надіслати адміну:", err.message);
    await ctx.editMessageText("❌ Не вдалося надіслати повідомлення.\nПричина: " + err.message);
  }
});

userRouter.hears("⚙️ Адмін-панель", async (ctx) => {
  if (!(await isAdmin(ctx))) {
    return ctx.reply("⛔ У вас немає доступу до адмін-панелі.");
  }
  await ctx.reply(MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
});

userRouter.hears("❓ Допомога", async (ctx) => {
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

userRouter.on("message:voice", async (ctx) => {
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

userRouter.on("message:text", async (ctx, next) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return next();
  if (text.includes("Адмін-панель")) return next();
  if (text.includes("Допомога")) return next();

  await ctx.reply("📝 Текстовий запит отримано! Опрацьовую... 🚀");
  await processTtnText(ctx, text);
});

userRouter.callbackQuery("ttn_generate_yes", async (ctx) => {
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

userRouter.callbackQuery("ttn_generate_no", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  ctx.session.pendingTtnData = null;
  await ctx.reply("🚫 Генерацію ТТН відмінено.");
});
