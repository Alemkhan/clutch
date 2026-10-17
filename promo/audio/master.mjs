// Masters a rendered promo to TikTok loudness (-14 LUFS, -1 dBTP) in place; the video stream is copied.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

for (const file of process.argv.slice(2)) {
  const tmp = file.replace(/\.mp4$/, '.master.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-c:v', 'copy',
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=9', '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '256k', tmp]);
  fs.renameSync(tmp, file);
  console.log('mastered', file);
}
