import { Bot, session } from 'grammy';
import { conversations } from '@grammyjs/conversations';
import dotenv from 'dotenv';

import { initDb, setCounterValue } from './config/db.js';
import { userRouter } from './handlers/user.js';
import { adminRouter } from './handlers/admin/index.js';

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
// Вона залишається тут або може бути в settings.js. Залишимо тут як була в оригіналі, або перенесемо. 
// В оригіналі вона була глобальною командою.
bot.command("set", async (ctx) => {
  const num = parseInt(ctx.message.text.split(' ')[1], 10);
  if (isNaN(num)) {
    return ctx.reply("❌ Неправильний формат! Напиши, наприклад: `/set 344`", { parse_mode: "Markdown" });
  }

  try {
    await setCounterValue(num);
    const today = new Date();
    const currentMonth = String(today.getMonth() + 1).padStart(2, '0');
    ctx.reply(`🎯 Лічильник бази зафіксовано на **${num}**.\nНаступне голосове створить **ТТН № ${num + 1}/${currentMonth}**!`, { parse_mode: "Markdown" });
  } catch (err) {
    console.error(err);
    ctx.reply("❌ Не вдалося змінити значення лічильника в БД.");
  }
});

bot.start();
console.log("🎙️ Голосовий бот з базою даних SQLite запущений!");