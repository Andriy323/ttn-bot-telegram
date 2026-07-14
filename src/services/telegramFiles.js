import fs from 'fs';
import path from 'path';
import axios from 'axios';

export async function downloadVoiceFile(ctx, botToken, destDir) {
  const audioPath = path.join(destDir, `voice_${ctx.message.message_id}.ogg`);
  const file = await ctx.getFile();
  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
  
  const writer = fs.createWriteStream(audioPath);
  const response = await axios({ url: fileUrl, method: 'GET', responseType: 'stream' });
  response.data.pipe(writer);
  
  await new Promise((resolve, reject) => { 
    writer.on('finish', resolve); 
    writer.on('error', reject); 
  });

  return audioPath;
}
