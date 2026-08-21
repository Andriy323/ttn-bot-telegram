import { createAdminCrudRouter } from './crudFactory.js';

export const destinationsRouter = createAdminCrudRouter({
  entityKey: 'destination',
  tableName: 'destinations',
  listTitle: '📍 **Список пунктів розвантаження:**',
  addBtnText: '➕ Додати пункт',
  backToListText: '⬅️ До списку',
  formatListButton: (d) => `[${d.destination_key.split(',')[0]}] ${d.name.substring(0, 20)}...`,
  formatDetailsText: (d) => `📍 **Пункт ID:** ${d.id}\n**Синоніми:** ${d.destination_key}\n**Назва в ТТН:** ${d.name}`,
  fields: [
    {
      key: 'destination_key',
      prompt: 'Введіть синоніми для ШІ через кому (напр. рівне, база)'
    },
    {
      key: 'name',
      prompt: 'Введіть офіційну назву для ТТН (напр. м.Рівне, вул.Центральна)'
    }
  ]
});
