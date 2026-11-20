# roboticslib-downloads

Исходники сайта: `site/`. Сборщик зашифрованных архивов: `scripts/`.
GitHub Pages публикует `docs/`. Приватный репозиторий с роботами хранится отдельно.

Адрес: https://astonikum.github.io/roboticslib-downloads/

Обновление запускается из `Astonikum/roboticslib` после пуша в `main` или вручную
через Actions → Publish encrypted downloads. Workflow скачивает этот репозиторий,
тестирует сборщик, читает приватные исходники через `SOURCE_REPOSITORY`, затем
публикует зашифрованный результат в `docs/`. При изменении кода сайта обнови
закреплённый `ref` в приватном workflow и запусти публикацию.

Локальная проверка (Node.js 24+, Git, Python 3):

```sh
node --test scripts/build-downloads.test.mjs
read -s SITE_PASSWORD
export SITE_PASSWORD
export SOURCE_REPOSITORY=../vsosh-manip-2026-2027
node scripts/build-downloads.mjs
unset SITE_PASSWORD
python3 -m http.server 8000 --directory dist
```

Пароль и SSH deploy key хранятся только в Actions Secrets приватного репозитория.
AES-256-GCM, PBKDF2-SHA256, 600 000 итераций. Весь каталог также зашифрован.
Пароль меняется через `SITE_PASSWORD` и повторную публикацию. Уже скачанные
копии и старые зашифрованные версии из Git-истории сменой пароля не отзываются.
