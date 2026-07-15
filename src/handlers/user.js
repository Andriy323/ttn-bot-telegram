import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Composer, Keyboard, InlineKeyboard } from 'grammy';
import dotenv from 'dotenv';

import { 
  processTtnText, 
  generateAndSendTtnPdf,
  getEditMenuKeyboard,
  sendOrEditPreview,
  showDriversList,
  showVehiclesList,
  showShippersList,
  showFractionsList,
  showDestinationsList,
  getDbContext
} from '../services/ttn.js';
import { transcribeAudio } from '../services/ai.js';
import { isAdmin, MAIN_ADMIN_MENU_TEXT, mainAdminKeyboard } from './admin/utils.js';
import { adminAuthMiddleware } from '../middlewares/auth.js';
import { downloadVoiceFile } from '../services/telegramFiles.js';

import { db } from '../config/db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const userRouter = new Composer();

// Використовуємо middleware для перевірки доступу
userRouter.use(adminAuthMiddleware);



userRouter.command("start", async (ctx) => {
  // Скидаємо стан очікування
  ctx.session.awaitingWeight = false;
  
  let isAdminUser = await isAdmin(ctx);

  if (!isAdminUser) {
    const inlineKb = new InlineKeyboard().text("🆔 Надіслати мій ID адміну", "send_id_to_admin");
    return ctx.reply("⛔ У вас немає доступу до цього бота.\n\nЩоб отримати права, надішліть свій запит головному адміну:", { reply_markup: inlineKb });
  }

  const reply_markup = new Keyboard()
    .text("⚙️ Адмін-панель")
    .text("❓ Допомога")
    .resized()
    .persistent()
    .placeholder("🎤 Водій, Відправник, Вантаж, Пункт, Вага, Авто...");

  const welcomeText = "👋 Привіт! Я твій голосовий логіст ТТН.\n\n" +
                      "🎤 **Натисни та утримуй мікрофон, щоб надиктувати рейс.**";

  await ctx.reply(welcomeText, { reply_markup, parse_mode: "Markdown" });

  const inlineKb = new InlineKeyboard().text("💡 Шпаргалка параметрів", "show_popup_help");
  const helpMsg = await ctx.reply("📋 Шпаргалка параметрів ТТН завжди закріплена вгорі чату:", { reply_markup: inlineKb });
  
  // Автоматично закріплюємо повідомлення з інлайн-кнопкою
  await ctx.pinChatMessage(helpMsg.message_id, { disable_notification: true }).catch(err => {
    console.error("Не вдалося закріпити повідомлення:", err);
  });
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
                   `Натисніть мікрофон і надиктуйте рейс (або надішліть текстом).\n` +
                   `👉 *Приклад:* _"Петро, відправник Завод, фракція 5-20, на Рівне, вага 24.5"_\n` +
                   `💡 **Шпаргалка обов'язкових параметрів** завжди закріплена вгорі вашого чату.\n\n` +
                   `🚗 **Призначення автомобіля:**\n` +
                   `Якщо ви не назвали авто, бот автоматично підтягне дефолтну машину, закріплену за цим водієм в Адмін-панелі.\n\n` +
                   `⚖️ **Розрахунок ваги:**\n` +
                   `Загальна вага (брутто) завжди зафіксована на рівні **39.8 т**. Вага тари вираховується автоматично: \`39.8 - вага нетто\`.\n\n` +
                   `✏️ **Редагування перед генерацією:**\n` +
                   `Якщо ви припустилися помилки або забули щось вказати — не диктуйте все заново! Під повідомленням-перевіркою натисніть **"✏️ Редагувати дані"**, щоб змінити або доповнити будь-яке поле.\n\n` +
                   `⚙️ **Адмін-панель:**\n` +
                   `Кнопка для керування водіями, авто, відправниками, пунктами розвантаження та фракціями.\n\n` +
                   `🔢 **Лічильник номерів:**\n` +
                   `Задати номер наступного бланку можна командою \`/set номер\` (наприклад: \`/set 344\`).`;

  await ctx.reply(helpText, { parse_mode: "Markdown" });
});

userRouter.hears("💡 Шпаргалка", async (ctx) => {
  const popupText = `🎤 **Приклад фрази:**\n` +
                    `_"Петро, відправник Вова, 5-20, на Рівне, вага 24.5"_\n\n` +
                    `📋 **Шаблон обов'язкових параметрів ТТН:**\n` +
                    `1. 👤 **Водій** (наприклад: Петро)\n` +
                    `2. 🚗 **Авто** (наприклад: 8025 — необов'язково, якщо є дефолтне)\n` +
                    `3. 🏢 **Відправник** (наприклад: Завод)\n` +
                    `4. 🪨 **Вантаж/фракція** (наприклад: 5-20)\n` +
                    `5. 📍 **Пункт розвантаження** (наприклад: Рівне)\n` +
                    `6. ⚖️ **Вага** (наприклад: 24.5)`;
  await ctx.reply(popupText, { parse_mode: "Markdown" });
});

userRouter.on("message:voice", async (ctx) => {
  await ctx.reply("🎧 Голосове отримано! Опрацьовую запит... 🚀");
  let audioPath = null;
  try {
    const dbContext = await getDbContext();
    audioPath = await downloadVoiceFile(ctx, process.env.TELEGRAM_BOT_TOKEN, __dirname);
    const voiceText = await transcribeAudio(audioPath, dbContext);
    await ctx.reply(`🗣️ **Розпізнаний текст:**\n_${voiceText}_`, { parse_mode: "Markdown" });
    await processTtnText(ctx, voiceText, dbContext);
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

  // Обробка введення ваги (сесійна машина станів)
  if (ctx.session.awaitingWeight) {
    const textVal = text.trim().replace(',', '.');
    const weight = parseFloat(textVal);

    if (isNaN(weight) || weight <= 0) {
      await ctx.reply("❌ Неправильний формат числа. Будь ласка, введіть число більше 0 (наприклад: 24.5):");
      return;
    }

    // Видаляємо повідомлення-запит та відповідь користувача
    if (ctx.session.weightPromptMsgId) {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.session.weightPromptMsgId).catch(() => {});
    }
    await ctx.deleteMessage().catch(() => {});

    ctx.session.awaitingWeight = false;
    ctx.session.weightPromptMsgId = null;
    ctx.session.pendingTtn.weight_netto = weight;
    await sendOrEditPreview(ctx);
    return;
  }

  await ctx.reply("📝 Текстовий запит отримано! Опрацьовую... 🚀");
  const dbContext = await getDbContext();
  await processTtnText(ctx, text, dbContext);
});
userRouter.callbackQuery("show_popup_help", async (ctx) => {
  await ctx.answerCallbackQuery({
    text: `Приклад: "Петро, авто 8025, Завод, 5-20, Рівне, 24.5"\n\n` +
          `📋 Шаблон для надиктовування:\n` +
          `1. Водій (Петро)\n` +
          `2. Авто (8025)\n` +
          `3. Відправник (Завод)\n` +
          `4. Вантаж (5-20)\n` +
          `5. Пункт (Рівне)\n` +
          `6. Вага (24.5)`,
    show_alert: true
  });
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
  ctx.session.pendingTtn = null;
  await ctx.reply("🚫 Генерацію ТТН відмінено.");
});

// ==========================================
// ✏️ ІНТЕРАКТИВНЕ РЕДАГУВАННЯ ПОЛІВ ТТН
// ==========================================

// 1. Головне меню редагування ТТН
userRouter.callbackQuery("ttn_edit_main", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("✏️ **Оберіть поле для редагування:**", {
    reply_markup: getEditMenuKeyboard(),
    parse_mode: "Markdown"
  });
});

// 2. Назад до підтвердження
userRouter.callbackQuery("ttn_edit_back", async (ctx) => {
  await ctx.answerCallbackQuery();
  await sendOrEditPreview(ctx);
});

// 3. Перехід до списків довідників
userRouter.callbackQuery("ttn_edit_field_driver", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showDriversList(ctx);
});

userRouter.callbackQuery("ttn_edit_field_vehicle", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showVehiclesList(ctx);
});

userRouter.callbackQuery("ttn_edit_field_shipper", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showShippersList(ctx);
});

userRouter.callbackQuery("ttn_edit_field_fraction", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showFractionsList(ctx);
});

userRouter.callbackQuery("ttn_edit_field_destination", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showDestinationsList(ctx);
});

// 4. Редагування ваги (сесійна машина станів)
userRouter.callbackQuery("ttn_edit_field_weight", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.deleteMessage().catch(() => {});

  const keyboard = new InlineKeyboard().text("❌ Скасувати", "ttn_edit_weight_cancel");
  const promptMsg = await ctx.reply("⚖️ **Введіть нове значення чистої ваги (нетто) в тоннах (наприклад: 24.8 або 24):**", { reply_markup: keyboard, parse_mode: "Markdown" });

  ctx.session.awaitingWeight = true;
  ctx.session.weightPromptMsgId = promptMsg.message_id;
});

userRouter.callbackQuery("ttn_edit_weight_cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.awaitingWeight = false;
  ctx.session.weightPromptMsgId = null;
  await ctx.deleteMessage().catch(() => {});
  await sendOrEditPreview(ctx);
});

// 5. Встановлення вибраного значення з кнопок списку
userRouter.callbackQuery(/ttn_set_driver_(\d+)/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = parseInt(ctx.match[1], 10);
  ctx.session.pendingTtn.driver_id = id;
  
  // Автоматично ставимо дефолтне авто водія, якщо воно є
  try {
    const dbDriver = await db('drivers').where({ id }).first();
    if (dbDriver && dbDriver.default_vehicle_id) {
      ctx.session.pendingTtn.vehicle_id = dbDriver.default_vehicle_id;
    }
  } catch (err) {
    console.error("Помилка призначення дефолтного авто:", err);
  }
  
  await sendOrEditPreview(ctx);
});

userRouter.callbackQuery(/ttn_set_vehicle_(\d+)/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = parseInt(ctx.match[1], 10);
  ctx.session.pendingTtn.vehicle_id = id;
  await sendOrEditPreview(ctx);
});

userRouter.callbackQuery(/ttn_set_shipper_(\d+)/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = parseInt(ctx.match[1], 10);
  ctx.session.pendingTtn.shipper_id = id;
  await sendOrEditPreview(ctx);
});

userRouter.callbackQuery(/ttn_set_fraction_(\d+)/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = parseInt(ctx.match[1], 10);
  ctx.session.pendingTtn.fraction_id = id;
  await sendOrEditPreview(ctx);
});

userRouter.callbackQuery(/ttn_set_destination_(\d+)/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = parseInt(ctx.match[1], 10);
  ctx.session.pendingTtn.destination_id = id;
  await sendOrEditPreview(ctx);
});

