import { getSetting } from '../../config/db.js';
import { createAdminCrudRouter } from './crudFactory.js';

export const vehiclesRouter = createAdminCrudRouter({
  entityKey: 'vehicle',
  tableName: 'vehicles',
  listTitle: '🚗 **Список автомобілів:**',
  addBtnText: '➕ Додати авто',
  backToListText: '⬅️ До списку авто',
  formatListButton: (v) => `[${v.plate_number}] ${v.car_info.substring(0, 15)}...`,
  formatDetailsText: async (vehicle) => {
    const defaultStorage = await getSetting('default_vehicle_storage', 'м. Київ, вул. Центральна, 1');
    const storagePointDisplay = vehicle.storage_point 
      ? vehicle.storage_point 
      : `${defaultStorage} _(за замовчуванням)_`;

    return `🚗 **Автомобіль ID:** ${vehicle.id}\n` +
           `**Номер:** ${vehicle.plate_number}\n` +
           `**Авто:** ${vehicle.car_info}\n` +
           `**Причіп:** ${vehicle.trailer_info}\n` +
           `**Тара:** ${vehicle.tare_weight} т.\n` +
           `**Місце зберігання:** ${storagePointDisplay}`;
  },
  fields: [
    {
      key: 'plate_number',
      prompt: 'Введіть синоніми/ідентифікатори для пошуку авто через кому (напр. 8025, АА1234ВВ, даф)'
    },
    {
      key: 'car_info',
      prompt: 'Введіть інформацію про авто (напр. MAN TGX 18.440 АА1234ВВ)'
    },
    {
      key: 'trailer_info',
      prompt: 'Введіть інформацію про причіп (напр. Schmitz Cargobull АА5678ХХ)'
    },
    {
      key: 'tare_weight',
      prompt: 'Введіть тару авто в тоннах (напр. 15.2)',
      transform: (val) => parseFloat(String(val).replace(',', '.'))
    },
    {
      key: 'storage_point',
      isOptional: true,
      prompt: async (conversation) => {
        const defaultStorage = await conversation.external(() => getSetting('default_vehicle_storage', 'м. Київ, вул. Центральна, 1'));
        return `📍 **Місце (стоянка) зберігання автомобіля**\n\n` +
          `Введіть повну точну адресу постійного зберігання/базування авто (наприклад: *02000, м. Київ, вул. Промислова, 15*).\n\n` +
          `💡 **ПІДКАЗКА:**\n` +
          `Якщо ви натиснете кнопку **«⏭️ Пропустити»**, для цього авто автоматично використовуватиметься **загальна адреса за замовчуванням**:\n` +
          `👉 \`${defaultStorage}\`\n\n` +
          `_(Примітка: Загальну адресу за замовчуванням завжди можна змінити у меню адмінки «🏠 Стоянка авто (default)»)_`;
      },
      transform: (val) => (val && val.trim() ? val.trim() : null)
    }
  ]
});
