import { api, confirmDialog, formatDate, initCounters, serialize, showErrors, toast, trackChanges } from './core';

/** Project form: save (Ctrl/Cmd+S), publish, unpublish, delete, restore an earlier version. */

interface ProjectResponse {
  project: { id: number; version: number; status: string; slug: string; title: string; updated_at: string };
  problems?: string[];
}

const editor = document.querySelector<HTMLElement>('[data-project-editor]');
const form = document.querySelector<HTMLFormElement>('[data-project-form]');

if (editor && form) {
  const isNew = editor.dataset.new !== undefined;
  const id = editor.dataset.id;
  let version = Number(editor.dataset.version ?? 0);
  const state = document.querySelector<HTMLElement>('[data-save-state]');
  const saveButton = document.querySelector<HTMLButtonElement>('[data-action="save"]')!;
  const changes = trackChanges(form, state);
  let saving = false;

  initCounters(form);
  form.addEventListener('submit', (event) => event.preventDefault());

  // Live preview of the page address.
  const slugInput = form.querySelector<HTMLInputElement>('[name="slug"]')!;
  const slugPreview = form.querySelector<HTMLElement>('[data-slug-preview]');
  slugInput.addEventListener('input', () => {
    if (slugPreview) slugPreview.textContent = slugInput.value || '…';
  });

  async function save(): Promise<boolean> {
    if (saving) return false;
    saving = true;
    saveButton.disabled = true;
    saveButton.textContent = 'Сохраняем…';
    const data = serialize(form!);
    const result = isNew
      ? await api<ProjectResponse>('POST', '/api/admin/projects', { data })
      : await api<ProjectResponse>('PUT', `/api/admin/projects/${id}`, { data, version });
    saving = false;
    saveButton.disabled = false;
    saveButton.textContent = isNew ? 'Создать черновик' : 'Сохранить';

    if (!result.ok) {
      if (result.fields) showErrors(form!, result.fields);
      changes.error(result.status === 409 ? 'Не сохранено: проект изменили в другом месте' : 'Не сохранено');
      if (result.status === 409) {
        await confirmDialog({
          title: 'Проект изменили в другой вкладке',
          text: 'Ваши правки не сохранены и остаются в форме. Скопируйте нужный текст, затем обновите страницу, чтобы увидеть актуальную версию.',
          confirm: 'Понятно',
        });
      } else toast(result.error ?? 'Не удалось сохранить', 'error');
      return false;
    }

    showErrors(form!, {});
    const { project, problems } = result.data;
    if (isNew) {
      changes.markSaved();
      window.location.assign(`/admin/projects/${project.id}?created=1`);
      return true;
    }
    version = project.version;
    editor!.dataset.version = String(version);
    changes.markSaved();
    document.querySelector('[data-project-heading]')!.textContent = project.title;
    document.querySelector('[data-updated]')!.textContent = formatDate(project.updated_at);
    slugInput.value = project.slug;
    updateStatus(project.status, problems ?? []);
    const link = document.querySelector<HTMLAnchorElement>('[data-public-link]');
    if (link) {
      link.href = `/projects/${project.slug}/`;
      link.textContent = `/projects/${project.slug}/`;
    }
    toast('Сохранено');
    return true;
  }

  function updateStatus(status: string, problems: string[]) {
    editor!.dataset.status = status;
    const published = status === 'published';
    const badge = document.querySelector<HTMLElement>('[data-status-badge]');
    if (badge) {
      badge.className = `badge badge--${status}`;
      badge.textContent = published ? 'Опубликован' : 'Черновик';
    }
    document.querySelector<HTMLElement>('[data-action="publish"]')!.hidden = published;
    document.querySelector<HTMLElement>('[data-action="unpublish"]')!.hidden = !published;
    document.querySelector<HTMLElement>('[data-public-link]')!.hidden = !published;
    document.querySelector<HTMLElement>('[data-public-hidden]')!.hidden = published;
    const problemBox = document.querySelector<HTMLElement>('[data-problems]')!;
    problemBox.hidden = published || problems.length === 0;
    problemBox.textContent = problems.length ? `Чтобы опубликовать: ${problems.join('; ')}.` : '';
  }

  async function setStatus(status: 'published' | 'draft') {
    if (status === 'published' && changes.isDirty()) {
      const go = await confirmDialog({
        title: 'Сохранить и опубликовать?',
        text: 'В форме есть несохранённые изменения. Они будут сохранены, и проект сразу появится на сайте.',
        confirm: 'Сохранить и опубликовать',
      });
      if (!go || !(await save())) return;
    }
    if (status === 'draft') {
      const go = await confirmDialog({
        title: 'Снять проект с публикации?',
        text: 'Страница проекта перестанет открываться, проект исчезнет из списков на сайте и из подборки на главной. Данные и фото сохранятся.',
        confirm: 'Снять с публикации',
      });
      if (!go) return;
    }
    const result = await api<ProjectResponse>('POST', `/api/admin/projects/${id}/status`, { status });
    if (!result.ok) return toast(result.error ?? 'Не удалось изменить статус', 'error');
    version = result.data.project.version;
    updateStatus(result.data.project.status, []);
    toast(status === 'published' ? 'Проект опубликован' : 'Проект снят с публикации');
  }

  saveButton.addEventListener('click', () => void save());
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  });

  document.querySelector('[data-action="publish"]')?.addEventListener('click', () => void setStatus('published'));
  document.querySelector('[data-action="unpublish"]')?.addEventListener('click', () => void setStatus('draft'));

  document.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    const go = await confirmDialog({
      title: 'Удалить проект навсегда?',
      text: 'Будут удалены тексты, все фотографии, история версий, и проект уберётся из подборки на главной. Это нельзя отменить. Если нужно лишь скрыть проект, снимите его с публикации.',
      confirm: 'Удалить навсегда',
      danger: true,
    });
    if (!go) return;
    const result = await api('DELETE', `/api/admin/projects/${id}`);
    if (!result.ok) return toast(result.error ?? 'Не удалось удалить', 'error');
    changes.markSaved();
    window.location.assign('/admin/projects?deleted=1');
  });

  document.querySelectorAll<HTMLButtonElement>('[data-restore]').forEach((button) => {
    button.addEventListener('click', async () => {
      const go = await confirmDialog({
        title: 'Вернуть эту версию текстов?',
        text: changes.isDirty()
          ? 'Несохранённые правки в форме будут потеряны. Текущие сохранённые тексты останутся в истории. Фото и статус публикации не изменятся.'
          : 'Текущие тексты останутся в истории, их можно будет вернуть. Фото и статус публикации не изменятся.',
        confirm: 'Вернуть версию',
      });
      if (!go) return;
      const result = await api('POST', `/api/admin/projects/${id}/revisions/${button.dataset.restore}`);
      if (!result.ok) return toast(result.error ?? 'Не удалось вернуть версию', 'error');
      changes.markSaved();
      window.location.reload();
    });
  });
}
