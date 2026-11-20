const $ = id => document.getElementById(id);
let key, catalog, current = '', busy = false, generation = 0;
const sizes = bytes => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
async function get(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Не удалось загрузить архив (${response.status}). Попробуй обновить страницу.`);
  return response;
}
async function decrypt(path, cryptoKey) {
  const data = await (await get(path)).arrayBuffer();
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, cryptoKey, data.slice(12));
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
  $('status').textContent = `Подготавливаю ${folder.name}.zip…`;
  try {
    const bytes = await decrypt(`data/${folder.id}`, key);
    if (session !== generation) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const link = document.createElement('a'); link.href = url; link.download = `${folder.name}.zip`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    $('status').textContent = 'Архив готов. Скачивание началось.';
  } catch (error) {
    if (session === generation) $('status').textContent = error.name === 'OperationError' ? 'Архив обновился или повреждён. Выйди и введи пароль снова.' : error.message;
  } finally { busy = false; }
}
$('unlock-form').addEventListener('submit', async event => {
  event.preventDefault(); $('unlock').disabled = true; $('status').textContent = 'Открываю библиотеку…';
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
    $('status').textContent = error.name === 'OperationError' ? 'Неверный пароль или сайт обновляется. Проверь пароль и попробуй ещё раз.' : error.message;
  } finally { $('unlock').disabled = false; }
});
$('download-all').onclick = () => save(catalog.folders.find(folder => folder.path === ''));
$('download-current').onclick = () => save(catalog.folders.find(folder => folder.path === current));
$('lock').onclick = () => {
  generation++; key = null; catalog = null; current = '';
  $('folders').replaceChildren(); $('breadcrumbs').replaceChildren(); $('revision').textContent = '';
  $('library').hidden = true; $('login').hidden = false; $('status').textContent = ''; $('password').focus();
};
