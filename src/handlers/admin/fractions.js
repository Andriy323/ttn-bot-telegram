import { createAdminCrudRouter } from './crudFactory.js';

export const fractionsRouter = createAdminCrudRouter({
  entityKey: 'fraction',
  tableName: 'fractions',
  listTitle: '🪨 **Список фракцій:**',
  addBtnText: '➕ Додати фракцію',
  backToListText: '⬅️ До списку',
  formatListButton: (f) => `[${f.fraction_key.split(',')[0]}] ${f.name.substring(0, 20)}...`,
  formatDetailsText: (f) => `🪨 **Фракція ID:** ${f.id}\n**Синоніми:** ${f.fraction_key}\n**Назва в ТТН:** ${f.name}`,
  fields: [
    {
      key: 'fraction_key',
      prompt: 'Введіть синоніми для ШІ через кому (напр. дрібна, 5-20, 5/20)'
    },
    {
      key: 'name',
      prompt: 'Введіть офіційну назву для ТТН (напр. Щебінь граніт з суміші фр.від 5 до 20 мм)'
    }
  ]
});
