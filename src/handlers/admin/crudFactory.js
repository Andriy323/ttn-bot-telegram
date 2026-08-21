import { Composer, InlineKeyboard } from 'grammy';
import { createConversation } from '@grammyjs/conversations';
import { db } from '../../config/db.js';
import { promptText, MAIN_ADMIN_MENU_TEXT, mainAdminKeyboard } from './utils.js';

/**
 * Фабрика створення стандартизованих CRUD роутерів для адмін-панелі (DRY)
 */
export function createAdminCrudRouter({
  entityKey,         // напр. 'destination'
  tableName,         // напр. 'destinations'
  listTitle,         // напр. '📍 **Список пунктів розвантаження:**'
  addBtnText,        // напр. '➕ Додати пункт'
  backToListText,    // напр. '⬅️ До списку'
  formatListButton,  // (item) => `[${item.key}] ${item.name}`
  formatDetailsText, // (item) => string
  fields,            // [ { key, prompt, isOptional, transform, getOldVal } ]
  customSteps = null // опціональна кастомна функція кроків розмови
}) {
  const router = new Composer();
  const convName = `${entityKey}CrudConv`;

  const listAction = `admin_${entityKey}s_list`;
  const showRegex = new RegExp(`^admin_${entityKey}_show_(\\d+)$`);
  const deleteRegex = new RegExp(`^admin_${entityKey}_delete_(\\d+)$`);
  const addAction = `admin_${entityKey}_add`;
  const editRegex = new RegExp(`^admin_${entityKey}_edit_(\\d+)$`);

  // 1. Список
  router.callbackQuery(listAction, async (ctx) => {
    const items = await db(tableName).select('*');
    const keyboard = new InlineKeyboard();
    items.forEach(item => {
      keyboard.text(formatListButton(item), `admin_${entityKey}_show_${item.id}`).row();
    });
    keyboard.text(addBtnText, addAction).row();
    keyboard.text("⬅️ Назад", "admin_main");

    await ctx.editMessageText(listTitle, { reply_markup: keyboard, parse_mode: "Markdown" });
  });

  // 2. Перегляд
  router.callbackQuery(showRegex, async (ctx) => {
    const id = ctx.match[1];
    const item = await db(tableName).where({ id }).first();
    if (!item) return ctx.answerCallbackQuery("Запис не знайдено.");

    const text = await formatDetailsText(item);
    const keyboard = new InlineKeyboard()
      .text("✏️ Редагувати", `admin_${entityKey}_edit_${item.id}`)
      .text("❌ Видалити", `admin_${entityKey}_delete_${item.id}`).row()
      .text(backToListText, listAction);

    await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: "Markdown" });
  });

  // 3. Видалення
  router.callbackQuery(deleteRegex, async (ctx) => {
    const id = ctx.match[1];
    await db(tableName).where({ id }).del();
    await ctx.answerCallbackQuery("Видалено!");
    await ctx.editMessageText("Запис успішно видалено.", {
      reply_markup: new InlineKeyboard().text(backToListText, listAction),
      parse_mode: "Markdown"
    });
  });

  // 4. Покроковий діалог додавання / редагування
  const crudConv = async (conversation, ctx) => {
    if (customSteps) {
      return await customSteps(conversation, ctx);
    }

    const data = ctx.callbackQuery?.data || '';
    const isEdit = data.startsWith(`admin_${entityKey}_edit_`);
    const id = isEdit ? parseInt(data.split('_')[3], 10) : null;
    const item = isEdit ? (await conversation.external(() => db(tableName).where({ id }).first()) || {}) : {};

    const valuesToSave = {};

    for (const field of fields) {
      const oldVal = field.getOldVal ? field.getOldVal(item) : item[field.key];
      const prompt = typeof field.prompt === 'function' ? await field.prompt(conversation, isEdit, oldVal) : field.prompt;
      const isOptional = field.isOptional ?? isEdit;

      const input = await promptText(conversation, ctx, prompt, isOptional, oldVal);
      if (input === '__CANCEL__') return;

      const val = field.transform ? field.transform(input) : input;
      valuesToSave[field.key] = val;
    }

    if (!isEdit) {
      await conversation.external(() => db(tableName).insert(valuesToSave));
      await ctx.reply(`✅ Запис додано!\n\n` + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
    } else {
      await conversation.external(() => db(tableName).where({ id }).update(valuesToSave));
      await ctx.reply(`✅ Запис оновлено!\n\n` + MAIN_ADMIN_MENU_TEXT, { reply_markup: mainAdminKeyboard, parse_mode: "Markdown" });
    }
  };

  router.use(createConversation(crudConv, convName));

  router.callbackQuery(addAction, async (ctx) => {
    await ctx.deleteMessage().catch(() => {});
    await ctx.conversation.enter(convName);
  });

  router.callbackQuery(editRegex, async (ctx) => {
    await ctx.deleteMessage().catch(() => {});
    await ctx.conversation.enter(convName);
  });

  return router;
}
