import fs from 'fs';
import { Groq } from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function transcribeAudio(audioPath) {
  const transcription = await groq.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: "whisper-large-v3",
    language: "uk"
  });
  return transcription.text;
}

export async function parseTtnDataFromText(text) {
  const currentDate = new Date();
  const todayStr = currentDate.toLocaleDateString('uk-UA');
  const dayOfWeek = currentDate.toLocaleDateString('uk-UA', { weekday: 'long' });

  const aiResponse = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Ти помічник логіста. Аналізуй текст голосового повідомлення для створення ТТН.
        Витягни дані та поверни їх СУВОРО у форматі JSON. 
        
        Сьогоднішня дата: ${todayStr}, день тижня: ${dayOfWeek}.
        
        ПРАВИЛА ВИ КЛЮЧІВ (ЯКЩО ДАНИХ НЕМАЄ - ОБОВ'ЯЗКОВО ПОВЕРНИ null ЗАМІСТЬ ВИГАДУВАННЯ):
        - driver_name: ім'я водія маленькими літерами (наприклад: гриша, володя, сергій). Якщо відсутнє - null.
        - car_number: ідентифікатор або номер машини, який згадує водій (наприклад: "8025", "9999", "АА1234ВВ", "даф"). Якщо відсутнє - null.
        - shipper_name: назва відправника коротко (наприклад: діна, карєр). Якщо відсутнє - null.
        - unloading_point: назва міста чи смт (наприклад: Ратне). Запиши тільки назву населеного пункту. Якщо відсутнє - null.
        - cargo_fraction: фракція щебеню (наприклад: 5-20, 20-40). Якщо відсутнє - null.
        - weight_netto: чиста вага числом з крапкою (наприклад: 24.00 або 24.5). Якщо відсутнє - null.
        - target_date: обчислена цільова дата поїздки у форматі "YYYY-MM-DD" (наприклад: "2026-07-15"). Враховуй слова "сьогодні", "завтра", "на понеділок", "на 25 число" відштовхуючись від сьогоднішньої дати. Якщо дата не вказана у повідомленні, поверни сьогоднішню дату.

        Формат відповіді:
        {
          "driver_name": "гриша",
          "car_number": "8025" або null,
          "shipper_name": "діна",
          "unloading_point": "Ратне",
          "cargo_fraction": "5-20",
          "weight_netto": 24.0,
          "target_date": "2026-07-15"
        }`
      },
      { role: "user", content: text }
    ]
  });

  return JSON.parse(aiResponse.choices[0].message.content);
}