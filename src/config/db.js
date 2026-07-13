import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import knex from 'knex';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbDir = path.join(__dirname, '..', '..', '.database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = knex({
  client: 'sqlite3',
  connection: { filename: path.join(dbDir, 'data.db') },
  useNullAsDefault: true
});

export async function initDb() {
  // 1. Таблиця лічильника номери ТТН
  if (!await db.schema.hasTable('counters')) {
    await db.schema.createTable('counters', (table) => {
      table.string('id').primary();
      table.integer('current_value').notNullable().defaultTo(0);
    });
    await db('counters').insert({ id: 'ttn_counter', current_value: 0 });
  }

  // 2. Таблиця АВТОМОБІЛІВ
  if (!await db.schema.hasTable('vehicles')) {
    await db.schema.createTable('vehicles', (table) => {
      table.increments('id').primary();
      table.string('plate_number').notNullable().unique(); // "8025"
      table.string('car_info').notNullable();              // "DAF XF105..."
      table.string('trailer_info').notNullable();          // "Wielton..."
      table.float('tare_weight').notNullable();            // 14.68
    });

    await db('vehicles').insert([
      { plate_number: '1111', car_info: 'VOLVO FH12 AA11-11BB', trailer_info: 'Schmitz AA22-22CC', tare_weight: 14.50 },
      { plate_number: '2222', car_info: 'DAF XF105 BB33-33CC', trailer_info: 'Wielton BB44-44DD', tare_weight: 15.00 }
    ]);
  }

  // 3. Таблиця ВОДІЇВ
  if (!await db.schema.hasTable('drivers')) {
    await db.schema.createTable('drivers', (table) => {
      table.increments('id').primary();
      table.string('fio').notNullable();             // ФІО (Понедільник С.О.)
      table.string('license').notNullable();         // Посвідчення (ВХР 907241)
      table.string('info', 500).nullable();          // Повні реквізити як ФОП
      table.integer('default_vehicle_id').references('id').inTable('vehicles');
      table.string('name_key').nullable(); 
    });

    const car1111 = await db('vehicles').where({ plate_number: '1111' }).first();
    const car2222 = await db('vehicles').where({ plate_number: '2222' }).first();

    await db('drivers').insert([
      { 
        fio: 'Іваненко І.І.', 
        license: 'АВХ 123456',
        info: 'Фізична особа Іваненко І.І. 01001, м.Київ, вул.Хрещатик 1, 1111111111',
        name_key: 'іван,ваня', 
        default_vehicle_id: car1111 ? car1111.id : null 
      },
      { 
        fio: 'Петренко П.П.', 
        license: 'СХМ 654321', 
        info: 'Фізична особа Петренко П.П. 02002, м.Київ, вул.Банкова 2, 2222222222',
        name_key: 'петро,петя', 
        default_vehicle_id: car2222 ? car2222.id : null 
      }
    ]);
  } else {
    // Міграція: додаємо нові колонки, якщо їх немає
    if (!await db.schema.hasColumn('drivers', 'fio')) {
      await db.schema.alterTable('drivers', table => {
        table.string('fio');
        table.string('license');
      });
      // Заповнюємо зі старих даних
      const drivers = await db('drivers').select('*');
      for (let d of drivers) {
         let fio = d.driver_signature_name ? d.driver_signature_name.split(' /')[0] : 'Невідомо';
         let license = d.driver_info ? (d.driver_info.split('/ ')[1] || d.driver_info.split('/')[1] || '') : '';
         await db('drivers').where({ id: d.id }).update({ fio, license: license.trim() });
      }
    }
    if (!await db.schema.hasColumn('drivers', 'info')) {
      await db.schema.alterTable('drivers', table => {
        table.string('info', 500).nullable();
      });
    }
  }

  // 4. Таблиця ВАНТАЖОВІДПРАВНИКІВ
  if (!await db.schema.hasTable('shippers')) {
    await db.schema.createTable('shippers', (table) => {
      table.increments('id').primary();
      table.string('shipper_key').notNullable().unique(); // "понедільник", "діна"
      table.string('info', 500).notNullable();
      table.string('manager').notNullable();
    });

    await db('shippers').insert([
      { 
        shipper_key: 'тест', 
        info: 'ФОП ТЕСТЕНКО Т.Т. 01001, м.Київ, вул.Хрещатик 1, ЄДРПОУ 1111111111',
        manager: 'Тестенко Т.Т.'
      },
      { 
        shipper_key: 'логістика,транс', 
        info: "ТОВ 'ЛОГІСТИКА-ТРАНС', 02002, м.Київ, вул.Банкова 2, ЄДРПОУ 22222222", 
        manager: 'Логінов Л.Л.' 
      }
    ]);
  }

  // 5. Таблиця АДМІНІСТРАТОРІВ
  if (!await db.schema.hasTable('admins')) {
    await db.schema.createTable('admins', (table) => {
      table.increments('id').primary();
      table.string('telegram_id').notNullable().unique();
      table.string('name').notNullable();
    });
  }

  // 6. Таблиця ФРАКЦІЙ
  if (!await db.schema.hasTable('fractions')) {
    await db.schema.createTable('fractions', (table) => {
      table.increments('id').primary();
      table.string('fraction_key').notNullable().unique();
      table.string('name').notNullable();
    });

    await db('fractions').insert([
      { fraction_key: '5-20, 5/20, дрібна', name: 'Щебінь граніт з суміші фр.від 5 до 20 мм' },
      { fraction_key: '20-40, 20/40, крупна', name: 'Щебінь граніт з суміші фр.від 20 до 40 мм' }
    ]);
  }

  // 7. Таблиця ПУНКТІВ РОЗВАНТАЖЕННЯ
  if (!await db.schema.hasTable('destinations')) {
    await db.schema.createTable('destinations', (table) => {
      table.increments('id').primary();
      table.string('destination_key').notNullable().unique();
      table.string('name').notNullable();
    });

    await db('destinations').insert([
      { destination_key: 'київ, база', name: 'м.Київ, вул.Будівельників 10' }
    ]);
  }

  console.log("🗄️ База даних та довідники ініціалізовані успішно!");
}

export async function generateNextTtnNumber() {
  await db('counters').where({ id: 'ttn_counter' }).increment('current_value', 1);
  const counter = await db('counters').where({ id: 'ttn_counter' }).first();
  const nextNumeric = counter.current_value;
  const today = new Date();
  const currentMonth = String(today.getMonth() + 1).padStart(2, '0');
  return { numeric: nextNumeric, full: `${nextNumeric}/${currentMonth}` };
}

export async function setCounterValue(value) {
  await db('counters').where({ id: 'ttn_counter' }).update({ current_value: value });
}