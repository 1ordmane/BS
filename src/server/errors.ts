/** Errors that are safe to show to the administrator or visitor. */

export class ValidationError extends Error {
  readonly fields: Record<string, string>;

  constructor(fields: Record<string, string>, message = 'Проверьте отмеченные поля') {
    super(message);
    this.fields = fields;
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Не найдено') {
    super(message);
  }
}

/** Someone else saved the same record since it was opened. */
export class ConflictError extends Error {
  constructor(message = 'Данные изменились в другой вкладке или у другого администратора. Обновите страницу.') {
    super(message);
  }
}

export class UserError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
