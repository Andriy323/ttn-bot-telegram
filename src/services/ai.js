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
  const aiResponse = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Ти помічник логіста. Аналізуй текст голосового повідомлення для створення ТТН.
        Витягни дані та поверни їх СУВОРО у форматі JSON. 
        
        ПРАВИЛА ВИ КЛЮЧІВ:
        - driver_name: ім'я водія маленькими літерами (наприклад: гриша, володя, сергій).
        - car_number: ідентифікатор або номер машини, який згадує водій (наприклад: "8025", "9999", "АА1234ВВ", "даф"). Якщо авто НЕ вказано, поверни null.
        - shipper_name: назва відправника коротко (наприклад: діна, карєр). 
        - unloading_point: назва міста чи смт (наприклад: Ратне). Запиши тільки назву населеного пункту.
        - cargo_fraction: фракція щебеню (наприклад: 5-20, 20-40).
        - weight_netto: чиста вага числом з крапкою (наприклад: 24.00 або 24.5).
        - date_type: "сьогодні" або "завтра".

        Формат відповіді:
        {
          "driver_name": "гриша",
          "car_number": "8025" або null,
          "shipper_name": "діна",
          "unloading_point": "Ратне",
          "cargo_fraction": "5-20",
          "weight_netto": 24.0,
          "date_type": "завтра"
        }`
      },
      { role: "user", content: text }
    ]
  });

  return JSON.parse(aiResponse.choices[0].message.content);
}