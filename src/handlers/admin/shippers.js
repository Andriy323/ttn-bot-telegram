import { createAdminCrudRouter } from './crudFactory.js';

export const shippersRouter = createAdminCrudRouter({
  entityKey: 'shipper',
  tableName: 'shippers',
  listTitle: '🏢 **Список відправників:**',
  addBtnText: '➕ Додати відправника',
  backToListText: '⬅️ До списку',
  formatListButton: (s) => `[${s.shipper_key.split(',')[0]}] ${s.manager}`,
  formatDetailsText: (s) => `🏢 **Відправник ID:** ${s.id}\n**Синоніми (ключі):** ${s.shipper_key}\n**Інфо:** ${s.info}\n**Менеджер:** ${s.manager}`,
  fields: [
    {
      key: 'shipper_key',
      prompt: 'Введіть ключові слова для ШІ через кому (напр. іван, іваненко, петро)'
    },
    {
      key: 'info',
      prompt: 'Введіть реквізити (напр. ТОВ "Логістика" 12345, м.Київ...)'
    },
    {
      key: 'manager',
      prompt: 'Введіть ПІБ керівника/менеджера (напр. Петренко П.П.)'
    }
  ]
});
