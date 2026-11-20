import { createCipheriv, createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, cpSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function encrypt(bytes, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  return Buffer.concat([iv, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
}

export function build(password, output = 'dist', repository = process.env.SOURCE_REPOSITORY || process.cwd()) {
  if (!password || password.length < 12) throw new Error('SITE_PASSWORD must contain at least 12 characters.');
  const destination = resolve(output);
  // Only generated output may be replaced, never source or Git metadata.
  if (destination !== resolve('dist')) throw new Error('Output must be ./dist');
  const salt = randomBytes(16);
  const iterations = 600_000;
  const key = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const git = (...args) => execFileSync('git', args, { cwd: repository, maxBuffer: 256 * 1024 * 1024 });
  const files = git('ls-tree', '-r', '--name-only', '-z', 'HEAD').toString().split('\0').filter(Boolean);
  const paths = new Set(['']);
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) paths.add(parts.slice(0, i).join('/'));
  }
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(`${destination}/data`, { recursive: true });
  cpSync('site', destination, { recursive: true });
  let html = readFileSync(`${destination}/index.html`, 'utf8');
  for (const asset of ['app.js', 'style.css']) {
    const version = createHash('sha256').update(readFileSync(`${destination}/${asset}`)).digest('hex').slice(0, 12);
    html = html.replaceAll(`"${asset}"`, `"${asset}?v=${version}"`);
  }
  writeFileSync(`${destination}/index.html`, html);
  const folders = [...paths].sort().map(path => {
    const name = path ? path.split('/').at(-1) : 'roboticslib';
    const archive = git('archive', '--format=zip', `--prefix=${name}/`, path ? `HEAD:${path}` : 'HEAD');
    const id = `${randomUUID()}.bin`;
    writeFileSync(`${destination}/data/${id}`, encrypt(archive, key));
    return { path, name, id, bytes: archive.length, files: files.filter(f => !path || f.startsWith(`${path}/`)).length };
  });
  const manifest = { commit: git('rev-parse', '--short', 'HEAD').toString().trim(), built: new Date().toISOString(), folders };
  writeFileSync(`${destination}/data/catalog.bin`, encrypt(Buffer.from(JSON.stringify(manifest)), key));
  writeFileSync(`${destination}/config.json`, JSON.stringify({ salt: salt.toString('base64'), iterations }));
  writeFileSync(`${destination}/.nojekyll`, '');
  key.fill(0);
  console.log(`Built encrypted downloads for ${folders.length} folders.`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) build(process.env.SITE_PASSWORD);
