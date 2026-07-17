import fs from 'fs';
import { Groq } from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function transcribeAudio(audioPath, dbContext = null) {
  let promptVocab = "";
  if (dbContext) {
    promptVocab = `Рейси водіїв: ${dbContext.drivers.join(', ')}. ` +
                  `Автомобілі: ${dbContext.vehicles.join(', ')}. ` +
                  `Відправники: ${dbContext.shippers.join(', ')}. ` +
                  `Пункти розвантаження: ${dbContext.destinations.join(', ')}. ` +
                  `Вантаж фракції: ${dbContext.fractions.join(', ')}.`;
  }

  const transcription = await groq.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: "whisper-large-v3",
    language: "uk",
    prompt: promptVocab || undefined
  });
  return transcription.text;
}

export async function parseTtnDataFromText(text, dbContext = null) {
  const currentDate = new Date();
  const todayStr = currentDate.toLocaleDateString('uk-UA');
  const dayOfWeek = currentDate.toLocaleDateString('uk-UA', { weekday: 'long' });

  let contextInstructions = "";
  if (dbContext) {
    contextInstructions = `
ДЛЯ ТОЧНОСТІ ПОРІВНЯЙ ВХІДНІ ДАНІ З НАСТУПНИМ СПИСКОМ З БАЗИ ДАНИХ ТА ЗАВЖДИ ВИПРАВЛЯЙ ОДДРУКІВКИ АБО СЛЕНГ НА ПРАВИЛЬНИЙ ВАРІАНТ З БАЗИ:
- Відомі водії: ${dbContext.drivers.join(', ')}
- Відомі авто: ${dbContext.vehicles.join(', ')}
- Відомі відправники: ${dbContext.shippers.join(', ')}
- Відомі пункти розвантаження: ${dbContext.destinations.join(', ')}
- Відомі фракції: ${dbContext.fractions.join(', ')}
`;
  }

  const aiResponse = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Ти — штучний інтелект логістичної компанії. Твоє завдання — проаналізувати вхідний текст та структурувати його для створення товарно-транспортної накладної (ТТН).
Поверни результат виключно у форматі JSON.

Сьогоднішня дата: ${todayStr}, день тижня: ${dayOfWeek}.
${contextInstructions}

ПРАВИЛА ВИВОДУ JSON (ЯКЩО ДАНИХ НЕМАЄ В ТЕКСТІ — ЗАВЖДИ ВСТАНОВЛЮЙ null):
1. driver_name: ім'я водія маленькими літерами кирилицею (наприклад: "сергій", "григорій", "петро"). Якщо вказано сленгове/коротке ім'я, порівняй із відомими водіями з бази та запиши правильний варіант (наприклад: "гриша" -> "григорій").
2. car_number: номер або ідентифікатор машини (наприклад: "8025", "9367").
3. shipper_name: коротка назва відправника кирилицею (наприклад: "володя", "діна"). Якщо ШІ почує схоже за звучанням слово (наприклад, "дона" або "діно"), ОБОВ'ЯЗКОВО виправ на правильну назву з бази відправників (наприклад: "дона" -> "діна").
4. unloading_point: назва населеного пункту розвантаження (наприклад: "ратне", "клесів", "рівне"). Запиши тільки назву міста/села.
5. cargo_fraction: фракція щебеню (наприклад: "5-20", "20-40").
6. weight_netto: чиста вага числом (наприклад: 26.0, 24.5). Вилучи тільки числове значення з фраз на кшталт "26 тонн", "вага 27,2 тонни", "24 т".
7. target_date: цільова дата поїздки у форматі "YYYY-MM-DD". Розраховуй дату відштовхуючись від сьогоднішньої дати (${todayStr}):
   - "сьогодні" -> сьогоднішня дата
   - "завтра" -> наступний день
   - "на понеділок" -> дата найближчого наступного понеділка тощо.
   Якщо дата взагалі не згадується, поверни сьогоднішню дату.

СУВОРЕ ОБМЕЖЕННЯ: ВСІ текстові значення (імена, пункти, назви) записуй КИРИЛИЦЕЮ українською мовою. Жодної латиниці / транслітерації (наприклад: пиши "діна", а не "dina"; "сергій", а не "sergey").

ПРИКЛАДИ ДЛЯ СЛІДУВАННЯ:
Вхідний текст: "ратне водій сергій відправник діна вага 26 тонн сьогодні"
Очікуваний JSON:
{
  "driver_name": "сергій",
  "car_number": null,
  "shipper_name": "діна",
  "unloading_point": "ратне",
  "cargo_fraction": null,
  "weight_netto": 26.0,
  "target_date": "${todayStr.split('.').reverse().join('-')}"
}

Вхідний текст: "Сьогодні на ратно водій Гриша авто 9367 вага 27.2 фракція 5-20"
Очікуваний JSON:
{
  "driver_name": "григорій",
  "car_number": "9367",
  "shipper_name": null,
  "unloading_point": "ратне",
  "cargo_fraction": "5-20",
  "weight_netto": 27.2,
  "target_date": "${todayStr.split('.').reverse().join('-')}"
}`
      },
      { role: "user", content: text }
    ]
  });

  const parsed = JSON.parse(aiResponse.choices[0].message.content);
  console.log("🤖 AI parsed result:", JSON.stringify(parsed));
  return parsed;
}