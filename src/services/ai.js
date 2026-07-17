import fs from 'fs';
import { Groq } from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function transcribeAudio(audioPath, dbContext = null) {
  let promptVocab = "";
  if (dbContext) {
    promptVocab = [
      ...dbContext.drivers, 
      ...dbContext.vehicles, 
      ...dbContext.shippers, 
      ...dbContext.destinations, 
      ...dbContext.fractions
    ].join(", ");
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
        ДЛЯ ТОЧНОСТІ ВИКОРИСТОВУЙ ТІЛЬКИ НАСТУПНІ ВІДОМІ ЗНАЧЕННЯ З БАЗИ (якщо слово схоже, виправляй на правильне з бази):
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
        content: `Ти помічник логіста. Аналізуй текст голосового повідомлення для створення ТТН.
        Витягни дані та поверни їх СУВОРО у форматі JSON. 
        
        Сьогоднішня дата: ${todayStr}, день тижня: ${dayOfWeek}.
        ${contextInstructions}
        
        ВАЖЛИВО: ВСІ текстові значення повертай ТІЛЬКИ українською мовою КИРИЛИЦЕЮ. НІКОЛИ не використовуй латиницю (наприклад: "сергій", а НЕ "sergey"; "діна", а НЕ "dina").
        
        ПРАВИЛА ДЛЯ КЛЮЧІВ (ЯКЩО ДАНИХ НЕМАЄ - ОБОВ'ЯЗКОВО ПОВЕРНИ null ЗАМІСТЬ ВИГАДУВАННЯ):
        - driver_name: ім'я водія маленькими літерами. Якщо відсутнє - null.
        - car_number: ідентифікатор або номер машини, який згадує водій. Якщо відсутнє - null.
        - shipper_name: назва відправника коротко. Якщо відсутнє - null.
        - unloading_point: назва міста чи смт. Запиши тільки назву населеного пункту. Якщо відсутнє - null.
        - cargo_fraction: фракція щебеню. Якщо відсутнє - null.
        - weight_netto: чиста вага числом (наприклад: 24.0, 26, 24.5). Витягни число з фраз типу "26 тонн", "вага 24.5", "24 т", "27,2 тонни". Якщо відсутнє - null.
        - target_date: обчислена цільова дата поїздки у форматі "YYYY-MM-DD" (наприклад: "2026-07-15"). Враховуй слова "сьогодні", "завтра", "на понеділок", "на 25 число" відштовхуючись від сьогоднішньої дати. Якщо дата не вказана у повідомленні, поверни сьогоднішню дату.

        Формат відповіді:
        {
          "driver_name": "петро",
          "car_number": "8025" або null,
          "shipper_name": "завод",
          "unloading_point": "Рівне",
          "cargo_fraction": "5-20",
          "weight_netto": 24.0,
          "target_date": "2026-07-15"
        }`
      },
      { role: "user", content: text }
    ]
  });

  const parsed = JSON.parse(aiResponse.choices[0].message.content);
  console.log("🤖 AI parsed result:", JSON.stringify(parsed));
  return parsed;
}