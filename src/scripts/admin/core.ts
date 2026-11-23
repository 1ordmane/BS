/**
 * Shared browser helpers for the admin panel: API calls with the CSRF token, toasts,
 * confirmation dialogs, form serialisation, field errors and unsaved-change tracking.
 */

export interface ApiResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T;
  error?: string;
  fields?: Record<string, string>;
}

export function csrfToken(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';
}

export async function api<T = Record<string, unknown>>(method: string, url: string, body?: unknown): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { 'X-CSRF-Token': csrfToken(), Accept: 'application/json' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  try {
    const response = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string; fields?: Record<string, string> };
    if (response.status === 401) {
      toast('Сессия истекла. Войдите снова в новой вкладке — несохранённые данные на этой странице останутся.', 'error');
    }
    return { ok: response.ok, status: response.status, data, error: data.error, fields: data.fields };
  } catch {
    return { ok: false, status: 0, data: {} as T, error: 'Нет связи с сервером. Проверьте подключение и повторите.' };
  }
}

/** Upload with progress (fetch cannot report upload progress). */
export function upload<T = Record<string, unknown>>(url: string, data: FormData, onProgress: (fraction: number) => void): Promise<ApiResult<T>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('X-CSRF-Token', csrfToken());
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener('load', () => {
      let body: T & { error?: string; fields?: Record<string, string> };
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = {} as typeof body;
      }
      const ok = xhr.status >= 200 && xhr.status < 300;
      resolve({ ok, status: xhr.status, data: body, error: ok ? undefined : body.error ?? `Ошибка ${xhr.status}`, fields: body.fields });
    });
    xhr.addEventListener('error', () => resolve({ ok: false, status: 0, data: {} as T, error: 'Нет связи с сервером' }));
    xhr.send(data);
  });
}

export function toast(message: string, kind: 'ok' | 'error' = 'ok'): void {
  let host = document.querySelector<HTMLElement>('.toasts');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.append(host);
  }
  const item = document.createElement('div');
  item.className = `toast${kind === 'error' ? ' toast--error' : ''}`;
  item.textContent = message;
  host.append(item);
  setTimeout(() => item.remove(), kind === 'error' ? 8000 : 3500);
}

/** A modal confirmation. Resolves to true only when the action button is pressed. */
export function confirmDialog(options: { title: string; text: string; confirm: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    dialog.innerHTML = `
      <form method="dialog" class="dialog__body">
        <h2 class="dialog__title"></h2>
        <p></p>
        <div class="dialog__actions">
          <button class="button button--ghost" value="cancel">Отмена</button>
          <button class="button ${options.danger ? 'button--danger' : 'button--primary'}" value="confirm"></button>
        </div>
      </form>`;
    dialog.querySelector('h2')!.textContent = options.title;
    dialog.querySelector('p')!.textContent = options.text;
    dialog.querySelector<HTMLButtonElement>('[value="confirm"]')!.textContent = options.confirm;
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'confirm');
      dialog.remove();
    });
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('[value="cancel"]')!.focus();
  });
}

/**
 * Turns named fields into a nested object: "hero.lines" → { hero: { lines } },
 * "highlights.0.title" → { highlights: [{ title }] }. Checkboxes become booleans.
 */
export function serialize(form: HTMLFormElement): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const element of Array.from(form.elements)) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) continue;
    if (!element.name || element.disabled || element.dataset.ignore !== undefined) continue;
    if (element instanceof HTMLInputElement && element.type === 'radio' && !element.checked) continue;
    const value = element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : element.value;
    const path = element.name.split('.');
    let target: Record<string, unknown> = result;
    path.forEach((key, index) => {
      if (index === path.length - 1) {
        target[key] = value;
        return;
      }
      const nextIsIndex = /^\d+$/.test(path[index + 1]!);
      target[key] ??= nextIsIndex ? [] : {};
      target = target[key] as Record<string, unknown>;
    });
  }
  return result;
}

export function clearErrors(form: HTMLElement): void {
  form.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
  form.querySelectorAll<HTMLElement>('[data-error-for]').forEach((el) => (el.textContent = ''));
}

/** Shows server field errors next to their inputs and focuses the first one. */
export function showErrors(form: HTMLElement, fields: Record<string, string> = {}): void {
  clearErrors(form);
  let first: HTMLElement | null = null;
  for (const [name, message] of Object.entries(fields)) {
    const input = form.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`);
    const slot = form.querySelector<HTMLElement>(`[data-error-for="${CSS.escape(name)}"]`);
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      first ??= input;
    }
    if (slot) slot.textContent = message;
    else if (input) {
      const note = document.createElement('p');
      note.className = 'field__error';
      note.dataset.errorFor = name;
      note.textContent = message;
      input.insertAdjacentElement('afterend', note);
    }
  }
  first?.focus({ preventScroll: false });
}

/**
 * Tracks whether a form differs from its last saved state, updates a status label and
 * warns before leaving the page with unsaved changes.
 */
export function trackChanges(form: HTMLFormElement, state: HTMLElement | null) {
  let saved = JSON.stringify(serialize(form));
  let extraDirty = false;
  const isDirty = () => extraDirty || JSON.stringify(serialize(form)) !== saved;
  const render = () => {
    if (!state) return;
    const dirty = isDirty();
    state.dataset.state = dirty ? 'dirty' : 'clean';
    state.textContent = dirty ? 'Есть несохранённые изменения' : state.dataset.cleanText ?? 'Все изменения сохранены';
  };
  form.addEventListener('input', render);
  form.addEventListener('change', render);
  window.addEventListener('beforeunload', (event) => {
    if (isDirty()) {
      event.preventDefault();
    }
  });
  render();
  return {
    isDirty,
    /** Call after a successful save. */
    markSaved() {
      saved = JSON.stringify(serialize(form));
      extraDirty = false;
      render();
    },
    /** For changes outside the form's fields (e.g. the order of a pick list). */
    markDirty() {
      extraDirty = true;
      render();
    },
    error(message: string) {
      if (!state) return;
      state.dataset.state = 'error';
      state.textContent = message;
    },
    render,
  };
}

/** Live character counters for inputs with data-max. */
export function initCounters(root: ParentNode = document): void {
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[data-max], textarea[data-max]').forEach((input) => {
    const max = Number(input.dataset.max);
    const counter = document.createElement('span');
    counter.className = 'counter';
    input.insertAdjacentElement('afterend', counter);
    // Shown only near the limit, so empty forms are not covered in "0 / 120".
    const update = () => {
      const length = input.value.length;
      counter.hidden = length < max * 0.8;
      counter.textContent = `${length} / ${max}`;
      counter.classList.toggle('is-over', length > max);
    };
    input.addEventListener('input', update);
    update();
  });
}

/** Moves an element before or after a sibling, keeping keyboard focus on the moved control. */
export function moveElement(item: HTMLElement, direction: -1 | 1): boolean {
  const sibling = direction < 0 ? item.previousElementSibling : item.nextElementSibling;
  if (!sibling) return false;
  if (direction < 0) sibling.before(item);
  else sibling.after(item);
  return true;
}

/**
 * Drag-and-drop reordering for the children of a list (mouse; keyboard and touch use the
 * arrow buttons). Calls onDrop after an item has been moved.
 */
export function sortable(list: HTMLElement, itemSelector: string, onDrop: () => void): void {
  let dragged: HTMLElement | null = null;
  list.addEventListener('dragstart', (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>(itemSelector);
    if (!item || !list.contains(item)) return;
    dragged = item;
    item.classList.add('is-dragging');
    event.dataTransfer?.setData('text/plain', item.dataset.id ?? '');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });
  list.addEventListener('dragover', (event) => {
    if (!dragged) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>(itemSelector);
    if (!target || target === dragged) return;
    event.preventDefault();
    list.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
    target.classList.add('is-drop-target');
  });
  list.addEventListener('drop', (event) => {
    if (!dragged) return;
    event.preventDefault();
    const target = (event.target as HTMLElement).closest<HTMLElement>(itemSelector);
    if (target && target !== dragged) {
      const items = Array.from(list.querySelectorAll(itemSelector));
      if (items.indexOf(dragged) < items.indexOf(target)) target.after(dragged);
      else target.before(dragged);
      onDrop();
    }
  });
  list.addEventListener('dragend', () => {
    dragged?.classList.remove('is-dragging');
    list.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
    dragged = null;
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}
