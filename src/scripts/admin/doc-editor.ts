import { api, confirmDialog, formatDate, initCounters, serialize, showErrors, sortable, toast, trackChanges } from './core';
import './media-picker';

/**
 * Editor for a draft document (homepage, about, company): save draft, publish, discard,
 * restore an earlier version. Also runs the repeaters (lists of stages or principles) and
 * the homepage portfolio selection.
 */

const form = document.querySelector<HTMLFormElement>('[data-doc-form]');

if (form) {
  const key = form.dataset.docKey!;
  let version = Number(form.dataset.version ?? 0);
  const state = document.querySelector<HTMLElement>('[data-save-state]');
  const saveButton = document.querySelector<HTMLButtonElement>('[data-doc-save]')!;
  const featured = form.querySelector<HTMLElement>('[data-featured]');
  const changes = trackChanges(form, state);
  let busy = false;

  initCounters(form);
  form.addEventListener('submit', (event) => event.preventDefault());

  /* ---------- Repeaters ---------- */

  form.querySelectorAll<HTMLElement>('[data-repeater]').forEach((repeater) => {
    const prefix = repeater.dataset.repeater!;
    const min = Number(repeater.dataset.repeatMin ?? 0);
    const max = Number(repeater.dataset.repeatMax ?? 99);
    const list = repeater.querySelector<HTMLElement>('[data-repeat-list]')!;
    const template = repeater.querySelector<HTMLTemplateElement>('template')!;
    const addButton = repeater.querySelector<HTMLButtonElement>('[data-repeat-add]')!;
    const pattern = new RegExp(`^${prefix.replace(/\./g, '\\.')}\\.(\\d+|__i__)\\.`);

    const renumber = () => {
      const items = Array.from(list.querySelectorAll<HTMLElement>('[data-repeat-item]'));
      items.forEach((item, index) => {
        item.querySelectorAll<HTMLElement>('[name]').forEach((el) => {
          const input = el as HTMLInputElement;
          input.name = input.name.replace(pattern, `${prefix}.${index}.`);
        });
        item.querySelectorAll<HTMLElement>('[data-error-for]').forEach((el) => {
          el.dataset.errorFor = el.dataset.errorFor!.replace(pattern, `${prefix}.${index}.`);
        });
        const number = item.querySelector('[data-repeat-number]');
        if (number) number.textContent = String(index + 1).padStart(2, '0');
        item.querySelector<HTMLButtonElement>('[data-repeat-up]')!.disabled = index === 0;
        item.querySelector<HTMLButtonElement>('[data-repeat-down]')!.disabled = index === items.length - 1;
        item.querySelector<HTMLButtonElement>('[data-repeat-remove]')!.disabled = items.length <= min;
      });
      addButton.disabled = items.length >= max;
      changes.render();
    };

    addButton.addEventListener('click', () => {
      list.append(template.content.cloneNode(true));
      renumber();
      list.lastElementChild?.querySelector<HTMLElement>('input, textarea')?.focus();
    });

    list.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      const item = button?.closest<HTMLElement>('[data-repeat-item]');
      if (!button || !item) return;
      if (button.dataset.repeatRemove !== undefined) item.remove();
      if (button.dataset.repeatUp !== undefined) item.previousElementSibling?.before(item);
      if (button.dataset.repeatDown !== undefined) item.nextElementSibling?.after(item);
      renumber();
      if (item.isConnected) button.focus({ preventScroll: true });
    });

    renumber();
  });

  /* ---------- Homepage portfolio selection ---------- */

  const featuredIds = (): number[] =>
    featured ? Array.from(featured.querySelectorAll<HTMLElement>('[data-pick]')).map((pick) => Number(pick.dataset.id)) : [];

  if (featured) {
    const list = featured.querySelector<HTMLElement>('[data-pick-list]')!;
    const select = featured.querySelector<HTMLSelectElement>('[data-featured-select]')!;
    const empty = featured.querySelector<HTMLElement>('[data-pick-empty]')!;

    const limit = Number(featured.dataset.featuredLimit ?? 3);
    const sync = () => {
      const picks = Array.from(list.querySelectorAll<HTMLElement>('[data-pick]'));
      picks.forEach((pick, index) => {
        pick.querySelector<HTMLElement>('[data-pick-index]')!.textContent = index < limit ? `${index + 1} · на главной` : 'резерв';
        pick.querySelector<HTMLButtonElement>('[data-pick-up]')!.disabled = index === 0;
        pick.querySelector<HTMLButtonElement>('[data-pick-down]')!.disabled = index === picks.length - 1;
      });
      const chosen = new Set(picks.map((pick) => pick.dataset.id));
      Array.from(select.options).forEach((option) => (option.hidden = !!option.value && chosen.has(option.value)));
      select.value = '';
      empty.hidden = picks.length > 0;
      changes.markDirty();
    };

    featured.querySelector('[data-featured-add]')!.addEventListener('click', () => {
      const option = select.selectedOptions[0];
      if (!option?.value) return;
      const pick = featured.querySelector<HTMLTemplateElement>('[data-pick-template]')!.content.firstElementChild!.cloneNode(true) as HTMLElement;
      pick.dataset.id = option.value;
      pick.querySelector('[data-pick-title]')!.textContent = option.textContent;
      pick.querySelector('[data-pick-meta]')!.textContent = option.dataset.meta ?? '';
      const img = pick.querySelector('img')!;
      if (option.dataset.thumb) img.src = option.dataset.thumb;
      else img.remove();
      list.append(pick);
      sync();
    });

    list.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      const pick = button?.closest<HTMLElement>('[data-pick]');
      if (!button || !pick) return;
      if (button.dataset.pickRemove !== undefined) pick.remove();
      if (button.dataset.pickUp !== undefined) pick.previousElementSibling?.before(pick);
      if (button.dataset.pickDown !== undefined) pick.nextElementSibling?.after(pick);
      sync();
      if (pick.isConnected) button.focus({ preventScroll: true });
    });

    sortable(list, '[data-pick]', sync);
    // Initial state is the saved state, not a change.
    sync();
    changes.markSaved();
  }

  /* ---------- Save, publish, discard, history ---------- */

  async function save(): Promise<boolean> {
    if (busy) return false;
    busy = true;
    saveButton.disabled = true;
    const body: Record<string, unknown> = { doc: serialize(form!), version };
    if (featured) body.featured = featuredIds();
    const result = await api<{ version: number; pending: boolean; updatedAt: string }>('PUT', `/api/admin/docs/${key}`, body);
    busy = false;
    saveButton.disabled = false;
    if (!result.ok) {
      if (result.fields) showErrors(form!, result.fields);
      changes.error(result.status === 409 ? 'Не сохранено: черновик изменили в другом месте' : 'Не сохранено');
      toast(result.error ?? 'Не удалось сохранить', 'error');
      return false;
    }
    showErrors(form!, {});
    version = result.data.version;
    changes.markSaved();
    setPending(result.data.pending);
    const updated = document.querySelector('[data-draft-updated]');
    if (updated) updated.textContent = formatDate(result.data.updatedAt);
    toast('Черновик сохранён. На сайте пока прежняя версия.');
    return true;
  }

  function setPending(pending: boolean) {
    const badge = document.querySelector<HTMLElement>('[data-pending-badge]');
    if (badge) {
      badge.className = `badge ${pending ? 'badge--draft' : 'badge--published'}`;
      badge.textContent = pending ? 'Есть черновик' : 'Опубликовано';
    }
    const discard = document.querySelector<HTMLElement>('[data-doc-discard]');
    if (discard) discard.hidden = !pending;
  }

  saveButton.addEventListener('click', () => void save());
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  });

  document.querySelector('[data-doc-publish]')?.addEventListener('click', async () => {
    const dirty = changes.isDirty();
    const go = await confirmDialog({
      title: 'Опубликовать изменения?',
      text: dirty
        ? 'Несохранённые изменения будут сохранены и сразу появятся на сайте.'
        : 'Сохранённый черновик сразу появится на сайте. Предыдущая версия останется в истории.',
      confirm: dirty ? 'Сохранить и опубликовать' : 'Опубликовать',
    });
    if (!go) return;
    if (dirty && !(await save())) return;
    const result = await api<{ version: number; pending: boolean; publishedAt: string }>('POST', `/api/admin/docs/${key}/publish`);
    if (!result.ok) {
      if (result.fields) showErrors(form!, result.fields);
      return toast(result.error ?? 'Не удалось опубликовать', 'error');
    }
    version = result.data.version;
    setPending(false);
    const published = document.querySelector('[data-published-at]');
    if (published) published.textContent = formatDate(result.data.publishedAt);
    toast('Опубликовано. Изменения уже на сайте.');
  });

  document.querySelector('[data-doc-discard]')?.addEventListener('click', async () => {
    const go = await confirmDialog({
      title: 'Отменить черновик?',
      text: 'Все неопубликованные изменения этого раздела пропадут, в форме окажется версия, которая сейчас на сайте.',
      confirm: 'Отменить черновик',
      danger: true,
    });
    if (!go) return;
    const result = await api('POST', `/api/admin/docs/${key}/discard`);
    if (!result.ok) return toast(result.error ?? 'Не удалось', 'error');
    changes.markSaved();
    window.location.reload();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-history]').forEach((button) => {
    button.addEventListener('click', async () => {
      const go = await confirmDialog({
        title: 'Загрузить эту версию в черновик?',
        text: `Версия заменит текущий черновик${changes.isDirty() ? ' (несохранённые правки будут потеряны)' : ''}. На сайте ничего не изменится, пока вы не опубликуете.`,
        confirm: 'Загрузить в черновик',
      });
      if (!go) return;
      const result = await api('POST', `/api/admin/docs/${key}/history/${button.dataset.history}`);
      if (!result.ok) return toast(result.error ?? 'Не удалось', 'error');
      changes.markSaved();
      window.location.reload();
    });
  });
}
