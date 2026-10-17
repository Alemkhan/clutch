import { runRemoteSmoke } from './lib/smoke-remote.mjs';

// Использование: npm run smoke:remote -- <worker-url> [<pages-url>]
// Только GET-запросы; в базу ничего не пишет.
const [workerUrl, pagesUrl, ...extra] = process.argv.slice(2);
if (!workerUrl || extra.length > 0) {
  console.error('Usage: npm run smoke:remote -- <worker-url> [<pages-url>]');
  process.exit(2);
}

try {
  const results = await runRemoteSmoke({ workerUrl, pagesUrl });
  for (const result of results) {
    console.log(`${result.ok ? 'OK  ' : 'FAIL'} ${result.name}`);
    for (const detail of result.details) console.log(`       - ${detail}`);
  }
  if (!pagesUrl) console.log('Pages не проверялся: второй аргумент не передан.');
  if (results.some((result) => !result.ok)) {
    console.error('Remote smoke провален.');
    process.exitCode = 1;
  } else {
    console.log('Remote smoke пройден (запись в базу не выполнялась).');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
