import { api, toast, upload } from './core';

/**
 * Image fields backed by the media library: choose an existing image or upload a new one.
 * The chosen id goes into a hidden input; a 'change' event lets the form notice the edit.
 */

interface LibraryImage {
  id: string;
  thumb: string;
  alt: string;
}

let library: LibraryImage[] | null = null;

async function loadLibrary(): Promise<LibraryImage[]> {
  const result = await api<{ images: LibraryImage[] }>('GET', '/api/admin/media');
  if (!result.ok) throw new Error(result.error ?? 'Медиатека не загрузилась');
  library = result.data.images;
  return library;
}

function choose(): Promise<LibraryImage | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog dialog--wide';
    dialog.innerHTML = `
      <div class="dialog__body">
        <h2 class="dialog__title">Медиатека</h2>
        <p class="muted" data-library-state>Загрузка…</p>
        <div class="library" data-library></div>
        <div class="dialog__actions"><button class="button button--ghost" type="button" data-close>Закрыть</button></div>
      </div>`;
    document.body.append(dialog);
    let picked: LibraryImage | null = null;
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(picked);
    });
    dialog.querySelector('[data-close]')!.addEventListener('click', () => dialog.close());
    dialog.showModal();

    const grid = dialog.querySelector<HTMLElement>('[data-library]')!;
    const state = dialog.querySelector<HTMLElement>('[data-library-state]')!;
    (library ? Promise.resolve(library) : loadLibrary())
      .then((images) => {
        state.textContent = images.length ? 'Выберите изображение.' : 'Медиатека пуста. Загрузите изображение кнопкой «Загрузить новое».';
        for (const image of images) {
          const button = document.createElement('button');
          button.type = 'button';
          button.title = image.alt || 'Без описания';
          const img = document.createElement('img');
          img.src = image.thumb;
          img.alt = image.alt;
          img.loading = 'lazy';
          button.append(img);
          button.addEventListener('click', () => {
            picked = image;
            dialog.close();
          });
          grid.append(button);
        }
      })
      .catch((error: Error) => (state.textContent = error.message));
  });
}

document.querySelectorAll<HTMLElement>('[data-media-field]').forEach((field) => {
  const value = field.querySelector<HTMLInputElement>('[data-media-value]')!;
  const preview = field.querySelector<HTMLElement>('[data-media-preview]')!;
  const clear = field.querySelector<HTMLButtonElement>('[data-media-clear]')!;
  const fileInput = field.querySelector<HTMLInputElement>('[data-media-upload]')!;
  const progress = field.querySelector<HTMLProgressElement>('[data-media-progress]')!;
  const altInput = field.querySelector<HTMLInputElement>('input[type="text"]');

  const set = (image: LibraryImage | null) => {
    value.value = image?.id ?? '';
    preview.innerHTML = '';
    if (image) {
      const img = document.createElement('img');
      img.src = image.thumb;
      img.alt = '';
      preview.append(img);
      if (altInput && !altInput.value && image.alt) altInput.value = image.alt;
    } else {
      preview.textContent = 'Нет изображения';
    }
    clear.hidden = !image;
    value.dispatchEvent(new Event('change', { bubbles: true }));
  };

  field.querySelector('[data-media-choose]')!.addEventListener('click', async () => {
    const image = await choose();
    if (image) set(image);
  });

  clear.addEventListener('click', () => set(null));

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    const data = new FormData();
    data.append('file', file);
    if (altInput?.value) data.append('alt', altInput.value);
    progress.hidden = false;
    progress.value = 0;
    const result = await upload<{ image: LibraryImage }>('/api/admin/media', data, (f) => (progress.value = f));
    progress.hidden = true;
    if (!result.ok) return toast(result.error ?? 'Изображение не загружено', 'error');
    library = null; // refresh the list next time
    set(result.data.image);
    toast('Изображение загружено в медиатеку');
  });
});
