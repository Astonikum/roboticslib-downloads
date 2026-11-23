const $ = id => document.getElementById(id);
let key, catalog, current = '', busy = false, generation = 0, downloadUrl;
const sizes = bytes => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
async function get(path, signal = AbortSignal.timeout(30_000)) {
  const response = await fetch(path, { cache: path === 'config.json' || path === 'data/catalog.bin' ? 'no-store' : 'default', signal });
  if (!response.ok) throw new Error(`Не удалось загрузить архив (${response.status}). Попробуй обновить страницу.`);
  return response;
}
async function decrypt(path, cryptoKey, onProgress) {
  const controller = new AbortController();
  let timer;
  const resetTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new DOMException('No download progress', 'TimeoutError')), 60_000);
  };
  let data;
  resetTimeout();
  try {
    const response = await get(path, controller.signal);
    if (response.body) {
      const reader = response.body.getReader();
      const chunks = [];
      let loaded = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          resetTimeout();
          chunks.push(value); loaded += value.length; onProgress?.(loaded);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      data = bytes.buffer;
    } else data = await response.arrayBuffer();
  } catch (error) {
    throw controller.signal.aborted ? controller.signal.reason : error;
  } finally { clearTimeout(timer); }
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, cryptoKey, data.slice(12));
}
function clearDownload() {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = undefined;
  $('save-zip').hidden = true;
  $('save-zip').removeAttribute('href');
}
function render() {
  $('breadcrumbs').replaceChildren();
  const parts = current ? current.split('/') : [];
  ['roboticslib', ...parts].forEach((name, index) => {
    if (index) { const separator = document.createElement('span'); separator.textContent = '/'; $('breadcrumbs').append(separator); }
    const button = document.createElement('button');
    button.textContent = name;
    button.onclick = () => { current = parts.slice(0, index).join('/'); render(); };
    $('breadcrumbs').append(button);
  });
  const children = catalog.folders.filter(folder => folder.path && folder.path.split('/').slice(0, -1).join('/') === current);
  $('folders').replaceChildren();
  for (const folder of children) {
    const row = document.createElement('div'); row.className = 'folder';
    const open = document.createElement('button'); open.className = 'folder-open';
    const icon = document.createElement('span'); icon.textContent = '▱'; icon.className = 'folder-icon'; icon.setAttribute('aria-hidden', 'true');
    const details = document.createElement('span'); details.className = 'folder-details';
    const name = document.createElement('span'); name.textContent = folder.name;
    const info = document.createElement('small'); info.textContent = `${folder.files} файлов · ${sizes(folder.bytes)}`;
    details.append(name, info); open.append(icon, details);
    open.onclick = () => { current = folder.path; render(); };
    const download = document.createElement('button'); download.className = 'download'; download.textContent = 'Скачать ZIP';
    download.setAttribute('aria-label', `Скачать папку ${folder.name}`);
    download.onclick = () => save(folder);
    row.append(open, download); $('folders').append(row);
  }
  $('empty').hidden = children.length > 0;
  $('download-current').hidden = !current;
}
async function save(folder) {
  if (busy || !key) return;
  busy = true;
  const session = generation;
  clearDownload();
  $('status').textContent = `Загружаю ${folder.name}.zip: 0 / ${sizes(folder.bytes)}`;
  try {
    const bytes = await decrypt(`data/${folder.id}`, key, loaded => {
      if (session === generation) $('status').textContent = `Загружаю ${folder.name}.zip: ${sizes(Math.min(loaded, folder.bytes))} / ${sizes(folder.bytes)}`;
    });
    if (session !== generation) return;
    downloadUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const link = $('save-zip'); link.href = downloadUrl; link.download = `${folder.name}.zip`;
    link.hidden = false; link.click();
    $('status').textContent = 'Архив готов. Если скачивание не началось, нажми «Сохранить ZIP».';
  } catch (error) {
    if (session === generation) $('status').textContent = error.name === 'TimeoutError' ? 'Загрузка заняла слишком долго. Попробуй скачать ещё раз.' : error.name === 'OperationError' ? 'Архив обновился или повреждён. Выйди и введи пароль снова.' : error.name === 'AbortError' ? 'Соединение прервалось. Попробуй скачать ещё раз.' : error.message;
  } finally { busy = false; }
}
$('unlock-form').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('password').disabled) return;
  $('password').disabled = true; $('status').textContent = 'Открываю…';
  try {
    if (!globalThis.crypto?.subtle) throw new Error('Для открытия нужен современный браузер и HTTPS.');
    const config = await (await get('config.json')).json();
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode($('password').value), 'PBKDF2', false, ['deriveKey']);
    const candidate = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: Uint8Array.from(atob(config.salt), c => c.charCodeAt(0)), iterations: config.iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    catalog = JSON.parse(new TextDecoder().decode(await decrypt('data/catalog.bin', candidate)));
    key = candidate; current = ''; $('password').value = '';
    $('revision').textContent = `Коммит ${catalog.commit} · ${new Date(catalog.built).toLocaleDateString('ru-RU')}`;
    render(); $('login').hidden = true; $('library').hidden = false; $('status').textContent = ''; $('download-all').focus();
  } catch (error) {
    $('status').textContent = error.name === 'OperationError' ? 'Неверный пароль или сайт обновляется. Проверь пароль и попробуй ещё раз.' : error.name === 'AbortError' ? 'Соединение прервалось. Попробуй скачать ещё раз.' : error.message;
  } finally { $('password').disabled = false; }
});
$('download-all').onclick = () => save(catalog.folders.find(folder => folder.path === ''));
$('download-current').onclick = () => save(catalog.folders.find(folder => folder.path === current));
$('lock').onclick = () => {
  generation++; key = null; catalog = null; current = '';
  clearDownload();
  $('folders').replaceChildren(); $('breadcrumbs').replaceChildren(); $('revision').textContent = '';
  $('library').hidden = true; $('login').hidden = false; $('status').textContent = ''; $('password').focus();
};
