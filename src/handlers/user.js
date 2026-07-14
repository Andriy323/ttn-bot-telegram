import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Composer, Keyboard, InlineKeyboard } from 'grammy';
import dotenv from 'dotenv';

import { processTtnText, generateAndSendTtnPdf } from '../services/ttn.js';
import { transcribeAudio } from '../services/ai.js';
import { isAdmin, MAIN_ADMIN_MENU_TEXT, mainAdminKeyboard } from './admin/utils.js';
import { adminAuthMiddleware } from '../middlewares/auth.js';
import { downloadVoiceFile } from '../services/telegramFiles.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const userRouter = new Composer();

// Використовуємо middleware для перевірки доступу
userRouter.use(adminAuthMiddleware);

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
  const helpText = `📌 **Довідка по роботі з ботом**\n\n` +
                   `🎤 **Як генерувати ТТН:**\n` +
                   `Просто надиктуйте голосове повідомлення або напишіть текст.\n` +
                   `Приклад: _"Іваненко, машина ВК1234, відправник Коваленко, 22.5 тон, щебінь 5-20, на Ратне, на завтра"_\n\n` +
                   `⚙️ **Адмін-панель:**\n` +
                   `Дозволяє додавати та редагувати водіїв, автомобілі, відправників, пункти розвантаження та фракції у базі.\n\n` +
                   `🔢 **Лічильник номерів:**\n` +
                   `Можна задати вручну командою \`/set номер\` (наприклад: \`/set 344\`).`;

  await ctx.reply(helpText, { parse_mode: "Markdown" });
});

userRouter.on("message:voice", async (ctx) => {
  await ctx.reply("🎧 Голосове отримано! Опрацьовую запит... 🚀");
  let audioPath = null;
  try {
    audioPath = await downloadVoiceFile(ctx, process.env.TELEGRAM_BOT_TOKEN, __dirname);
    const voiceText = await transcribeAudio(audioPath);
    await ctx.reply(`🗣️ **Розпізнаний текст:**\n_${voiceText}_`, { parse_mode: "Markdown" });
    await processTtnText(ctx, voiceText);
  } catch (err) {
    console.error("Помилка обробки голосового:", err);
    await ctx.reply("❌ Не вдалося розпізнати голосове повідомлення.");
  } finally {
    if (audioPath) {
      await fs.promises.unlink(audioPath).catch(console.error);
    }
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
  
  await generateAndSendTtnPdf(ctx);
});

userRouter.callbackQuery("ttn_generate_no", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
  ctx.session.pendingTtnData = null;
  await ctx.reply("🚫 Генерацію ТТН відмінено.");
});
