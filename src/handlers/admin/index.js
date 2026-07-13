import { Composer } from 'grammy';
import { isAdmin, MAIN_ADMIN_MENU_TEXT, mainAdminKeyboard } from './utils.js';
import { vehiclesRouter } from './vehicles.js';
import { driversRouter } from './drivers.js';
import { shippersRouter } from './shippers.js';
import { fractionsRouter } from './fractions.js';
import { destinationsRouter } from './destinations.js';
import { settingsRouter } from './settings.js';

export const adminRouter = new Composer();

// Middleware для захисту адмінських callback_query
adminRouter.use(async (ctx, next) => {
  if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith('admin_')) {
    if (!(await isAdmin(ctx))) {
      return ctx.answerCallbackQuery({ text: "⛔ У вас немає доступу до адмін-панелі.", show_alert: true });
    }
  }
  return next();
});

adminRouter.callbackQuery("admin_main", async (ctx) => {
  await ctx.editMessageText(MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
});

adminRouter.callbackQuery("admin_close", async (ctx) => {
  await ctx.deleteMessage();
});

adminRouter.use(vehiclesRouter);
adminRouter.use(driversRouter);
adminRouter.use(shippersRouter);
adminRouter.use(fractionsRouter);
adminRouter.use(destinationsRouter);
adminRouter.use(settingsRouter);
