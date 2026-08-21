import { Bot, session } from 'grammy';
import { conversations } from '@grammyjs/conversations';
import dotenv from 'dotenv';

import { initDb, setCounterValue, db } from './config/db.js';
import { userRouter } from './handlers/user.js';
import { adminRouter } from './handlers/admin/index.js';
import { isAdmin } from './handlers/admin/utils.js';
import { closeBrowser } from './services/pdf.js';

dotenv.config();

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

// Ініціалізація БД при старті бота
await initDb();

// Налаштування сесій та conversations
bot.use(session({ initial: () => ({}) }));
bot.use(conversations());

// Підключення адмін-роутера (всі розбиті модулі адмінки)
bot.use(adminRouter);

// Підключення юзер-роутера (всі команди та генерація ТТН)
bot.use(userRouter);

// Адмінська команда фіксації лічильника ТТН (наприклад: /set 344)
bot.command("set", async (ctx) => {
  if (!(await isAdmin(ctx))) {
    return ctx.reply("⛔ У вас немає доступу до цієї команди.");
  }

  const parts = ctx.message.text.split(' ');
  const num = parseInt(parts[1], 10);
  if (isNaN(num)) {
    return ctx.reply("❌ Неправильний формат! Напиши, наприклад: `/set 344`", { parse_mode: "Markdown" });
  }

  try {
    await setCounterValue(num);
    const today = new Date();
    const currentMonth = String(today.getMonth() + 1).padStart(2, '0');
    ctx.reply(`🎯 Лічильник бази зафіксовано на **${num}**.\nНаступне голосове створить **ТТН № ${num + 1}/${currentMonth}**!`, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Помилка встановлення лічильника:", err);
    ctx.reply("❌ Не вдалося змінити значення лічильника в БД.");
  }
});

// Глобальний обробник помилок бота
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`❌ Помилка під час обробки оновлення ${ctx?.update?.update_id}:`, err.error);
});

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`\n🛑 Отримано сигнал ${signal}. Зупиняємо бота...`);
  try {
    await bot.stop();
    await closeBrowser();
    await db.destroy();
    console.log("✅ Ресурси успішно вивільнено. Вихід.");
    process.exit(0);
  } catch (e) {
    console.error("Помилка під час зупинки:", e);
    process.exit(1);
  }
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

bot.start();
console.log("🎙️ Голосовий бот з базою даних SQLite запущений!");