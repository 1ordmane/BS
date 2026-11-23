import { api, confirmDialog, sortable, toast, upload } from './core';

/**
 * Gallery manager. The local list is the source of truth for what the user sees; each change
 * is sent as one small request and the page is never reloaded or re-rendered as a whole,
 * so scroll position, focus and the unsaved project form are left alone.
 *
 * Order saves are debounced and wait for running uploads, because the server only accepts
 * an order that lists exactly the project's current images.
 */

interface GalleryImage {
  id: string;
  thumb: string;
  alt: string;
  width: number;
  height: number;
}

interface ServerView {
  coverId: string | null;
  images: GalleryImage[];
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MAX_BYTES = 20 * 1024 * 1024;
const PARALLEL_UPLOADS = 2;

const root = document.querySelector<HTMLElement>('[data-gallery]');

if (root) {
  const projectId = root.dataset.projectId!;
  const base = `/api/admin/projects/${projectId}/images`;
  const list = root.querySelector<HTMLUListElement>('[data-gallery-list]')!;
  const empty = root.querySelector<HTMLElement>('[data-gallery-empty]')!;
  const status = root.querySelector<HTMLElement>('[data-gallery-status]')!;
  const input = root.querySelector<HTMLInputElement>('[data-file-input]')!;
  const dropzone = root.querySelector<HTMLElement>('[data-dropzone]')!;
  const uploads = root.querySelector<HTMLElement>('[data-uploads]')!;

  const initial = JSON.parse(root.dataset.initial ?? '{}') as ServerView;
  let images: GalleryImage[] = initial.images ?? [];
  let coverId: string | null = initial.coverId ?? null;
  const tiles = new Map<string, HTMLLIElement>();

  let uploadsRunning = 0;
  let orderDirty = false;
  let orderTimer: number | undefined;
  let orderSaving: Promise<void> = Promise.resolve();

  /* ---------- Rendering: tiles are reused by id, never rebuilt wholesale ---------- */

  function createTile(image: GalleryImage): HTMLLIElement {
    const tile = document.createElement('li');
    tile.className = 'tile';
    tile.dataset.id = image.id;
    tile.innerHTML = `
      <div class="tile__image" draggable="true" title="Перетащите, чтобы изменить порядок">
        <img alt="" loading="lazy" />
        <span class="tile__cover-badge" hidden>Обложка</span>
        <span class="tile__index"></span>
      </div>
      <input type="text" maxlength="300" placeholder="Описание фото (alt)" aria-label="Описание фото для незрячих посетителей" data-ignore />
      <div class="tile__tools">
        <span>
          <button type="button" class="icon-button" data-move="-1" aria-label="Переместить раньше">←</button>
          <button type="button" class="icon-button" data-move="1" aria-label="Переместить позже">→</button>
        </span>
        <span>
          <button type="button" class="icon-button" data-cover aria-label="Сделать обложкой" title="Сделать обложкой">★</button>
          <button type="button" class="icon-button icon-button--danger" data-delete aria-label="Удалить фото" title="Удалить">✕</button>
        </span>
      </div>`;
    tile.querySelector('img')!.src = image.thumb;
    const alt = tile.querySelector('input')!;
    alt.value = image.alt;
    alt.dataset.saved = image.alt;
    tiles.set(image.id, tile);
    return tile;
  }

  function render() {
    const order = images.map((image) => image.id);
    for (const [id, tile] of tiles) {
      if (!order.includes(id)) {
        tile.remove();
        tiles.delete(id);
      }
    }
    images.forEach((image, index) => {
      const tile = tiles.get(image.id) ?? createTile(image);
      // Only move nodes that are out of place, so focus inside a tile survives.
      if (list.children[index] !== tile) list.insertBefore(tile, list.children[index] ?? null);
      tile.classList.toggle('is-cover', image.id === coverId);
      tile.querySelector<HTMLElement>('.tile__cover-badge')!.hidden = image.id !== coverId;
      tile.querySelector<HTMLElement>('.tile__index')!.textContent = String(index + 1);
      tile.querySelector<HTMLButtonElement>('[data-move="-1"]')!.disabled = index === 0;
      tile.querySelector<HTMLButtonElement>('[data-move="1"]')!.disabled = index === images.length - 1;
      tile.querySelector<HTMLButtonElement>('[data-cover]')!.disabled = image.id === coverId;
      tile.querySelector('img')!.alt = image.alt;
    });
    empty.hidden = images.length > 0;
  }

  function applyServer(view: ServerView, keepLocalOrder = false) {
    const fresh = new Map(view.images.map((image) => [image.id, image]));
    if (keepLocalOrder) {
      const kept = images.filter((image) => fresh.has(image.id)).map((image) => ({ ...fresh.get(image.id)!, alt: image.alt }));
      const added = view.images.filter((image) => !images.some((local) => local.id === image.id));
      images = [...kept, ...added];
    } else {
      images = view.images;
    }
    coverId = view.coverId;
    render();
  }

  /* ---------- Order ---------- */

  function scheduleOrderSave() {
    orderDirty = true;
    window.clearTimeout(orderTimer);
    orderTimer = window.setTimeout(flushOrder, 400);
  }

  function flushOrder() {
    if (!orderDirty) return;
    if (uploadsRunning > 0) return; // retried when the uploads finish
    orderDirty = false;
    const ids = images.map((image) => image.id);
    orderSaving = orderSaving.then(async () => {
      const result = await api<ServerView>('PUT', base, { ids });
      if (result.ok) {
        status.textContent = 'Порядок сохранён';
        return;
      }
      toast(result.error ?? 'Порядок не сохранён', 'error');
      // Show what the server actually has rather than a state that was not saved.
      const fresh = await api<ServerView>('GET', base);
      if (fresh.ok) applyServer(fresh.data);
    });
  }

  function move(id: string, direction: -1 | 1) {
    const index = images.findIndex((image) => image.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= images.length) return;
    [images[index], images[target]] = [images[target]!, images[index]!];
    render();
    status.textContent = `Фото перемещено на позицию ${target + 1} из ${images.length}`;
    scheduleOrderSave();
  }

  sortable(list, '.tile', () => {
    images = Array.from(list.querySelectorAll<HTMLElement>('.tile')).map((tile) => images.find((image) => image.id === tile.dataset.id)!);
    render();
    scheduleOrderSave();
  });

  /* ---------- Tile actions ---------- */

  list.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    const tile = button?.closest<HTMLLIElement>('.tile');
    if (!button || !tile) return;
    event.preventDefault();
    const id = tile.dataset.id!;

    if (button.dataset.move) {
      move(id, Number(button.dataset.move) as -1 | 1);
      // Keep focus on the arrow that was pressed, now in the moved tile.
      tiles.get(id)?.querySelector<HTMLButtonElement>(`[data-move="${button.dataset.move}"]`)?.focus({ preventScroll: true });
      return;
    }

    if (button.dataset.cover !== undefined) {
      tile.classList.add('is-busy');
      const result = await api('PATCH', `${base}/${id}`, { cover: true });
      tile.classList.remove('is-busy');
      if (!result.ok) return toast(result.error ?? 'Обложка не изменена', 'error');
      coverId = id;
      render();
      toast('Обложка изменена');
      return;
    }

    if (button.dataset.delete !== undefined) {
      const confirmed = await confirmDialog({
        title: 'Удалить фото?',
        text: 'Фото будет удалено с сайта и с сервера. Это действие нельзя отменить. Тексты проекта не изменятся.',
        confirm: 'Удалить фото',
        danger: true,
      });
      if (!confirmed) return;
      tile.classList.add('is-busy');
      // Let a pending order save go first so the server's list matches ours.
      window.clearTimeout(orderTimer);
      flushOrder();
      await orderSaving;
      const result = await api('DELETE', `${base}/${id}`);
      if (!result.ok) {
        tile.classList.remove('is-busy');
        return toast(result.error ?? 'Фото не удалено', 'error');
      }
      images = images.filter((image) => image.id !== id);
      const fresh = await api<ServerView>('GET', base);
      if (fresh.ok) applyServer(fresh.data, true);
      else render();
      toast('Фото удалено');
    }
  });

  // Descriptions save when the field loses focus.
  list.addEventListener('change', async (event) => {
    const field = event.target as HTMLInputElement;
    const tile = field.closest<HTMLLIElement>('.tile');
    if (!tile || field.type !== 'text' || field.value === field.dataset.saved) return;
    const result = await api('PATCH', `${base}/${tile.dataset.id}`, { alt: field.value });
    if (!result.ok) return toast(result.error ?? 'Описание не сохранено', 'error');
    field.dataset.saved = field.value;
    const image = images.find((item) => item.id === tile.dataset.id);
    if (image) image.alt = field.value;
    status.textContent = 'Описание фото сохранено';
  });

  // Enter in a description saves it instead of submitting anything.
  list.addEventListener('keydown', (event) => {
    const field = event.target as HTMLElement;
    if (event.key === 'Enter' && field instanceof HTMLInputElement) {
      event.preventDefault();
      field.blur();
    }
  });

  /* ---------- Uploads ---------- */

  const queue: { file: File; row: HTMLElement }[] = [];

  function addUploadRow(file: File): HTMLElement {
    const row = document.createElement('div');
    row.className = 'upload';
    row.innerHTML = `<span class="upload__name"></span><span class="upload__state">в очереди</span><progress max="1" value="0"></progress>`;
    row.querySelector('.upload__name')!.textContent = file.name;
    uploads.append(row);
    return row;
  }

  function fail(row: HTMLElement, file: File, message: string) {
    row.classList.add('is-error');
    row.querySelector('progress')?.remove();
    row.querySelector('.upload__state')!.innerHTML = '';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'button button--ghost button--small';
    retry.textContent = 'Повторить';
    retry.addEventListener('click', () => {
      row.remove();
      enqueue([file]);
    });
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'link-button';
    dismiss.textContent = 'Убрать';
    dismiss.addEventListener('click', () => row.remove());
    row.querySelector('.upload__state')!.append(retry, ' ', dismiss);
    const error = document.createElement('span');
    error.className = 'upload__error';
    error.textContent = message;
    row.append(error);
  }

  function enqueue(files: File[]) {
    for (const file of files) {
      const row = addUploadRow(file);
      if (!ACCEPTED.includes(file.type)) {
        fail(row, file, 'Формат не поддерживается: нужен JPG, PNG, WebP или AVIF');
        continue;
      }
      if (file.size > MAX_BYTES) {
        fail(row, file, 'Файл больше 20 МБ');
        continue;
      }
      queue.push({ file, row });
    }
    pump();
  }

  function pump() {
    while (uploadsRunning < PARALLEL_UPLOADS && queue.length) {
      const job = queue.shift()!;
      uploadsRunning += 1;
      void runUpload(job).finally(() => {
        uploadsRunning -= 1;
        if (uploadsRunning === 0 && queue.length === 0) flushOrder();
        pump();
      });
    }
  }

  async function runUpload({ file, row }: { file: File; row: HTMLElement }) {
    const progress = row.querySelector('progress')!;
    const state = row.querySelector('.upload__state')!;
    state.textContent = 'загрузка…';
    const data = new FormData();
    data.append('file', file);
    const result = await upload<ServerView & { image: GalleryImage }>(base, data, (fraction) => {
      progress.value = fraction;
      if (fraction >= 1) state.textContent = 'обработка…';
    });
    if (!result.ok) return fail(row, file, result.error ?? 'Не загружено');
    // Add the new photo at the end without disturbing a reorder the user is making.
    if (!images.some((image) => image.id === result.data.image.id)) images.push(result.data.image);
    coverId = result.data.coverId;
    render();
    row.remove();
    status.textContent = `Загружено: ${file.name}`;
  }

  input.addEventListener('change', () => {
    enqueue(Array.from(input.files ?? []));
    input.value = '';
  });

  dropzone.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    dropzone.classList.add('is-over');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-over'));
  dropzone.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    dropzone.classList.remove('is-over');
    enqueue(Array.from(event.dataTransfer.files));
  });
  // A file dropped beside the drop zone must not make the browser open it and leave the page.
  window.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  window.addEventListener('drop', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });

  window.addEventListener('beforeunload', (event) => {
    if (uploadsRunning > 0 || queue.length > 0 || orderDirty) {
      event.preventDefault();
    }
  });

  render();
}
