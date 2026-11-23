/**
 * Database schema, as an ordered list of migrations. The database stores the number
 * of applied migrations in PRAGMA user_version. To change the schema, append a new
 * migration; never edit one that has already shipped.
 */
export const migrations: string[] = [
  // 1: initial schema
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- id is the SHA-256 of the cookie token, so a leaked database does not leak live sessions
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE rate_limits (
    key TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL
  );

  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    client TEXT NOT NULL DEFAULT '',
    event TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    area TEXT NOT NULL DEFAULT '',
    year TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL DEFAULT '',
    illustrative INTEGER NOT NULL DEFAULT 0 CHECK (illustrative IN (0, 1)),
    cover_image_id TEXT REFERENCES images(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    seo_title TEXT NOT NULL DEFAULT '',
    seo_description TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT
  );
  CREATE INDEX projects_status ON projects(status);

  -- kind 'project': belongs to one project; kind 'media': shared library for homepage and services
  CREATE TABLE images (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('project', 'media')),
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    alt TEXT NOT NULL DEFAULT '',
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    widths TEXT NOT NULL,
    bytes INTEGER NOT NULL DEFAULT 0,
    original_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    CHECK ((kind = 'project') = (project_id IS NOT NULL))
  );
  CREATE INDEX images_project ON images(project_id, position);

  -- A project's cover must be one of its own images
  CREATE TRIGGER projects_cover_insert BEFORE INSERT ON projects
  WHEN NEW.cover_image_id IS NOT NULL
  BEGIN
    SELECT RAISE(ABORT, 'cover image must belong to the project');
  END;
  CREATE TRIGGER projects_cover_update BEFORE UPDATE OF cover_image_id ON projects
  WHEN NEW.cover_image_id IS NOT NULL
    AND (SELECT project_id FROM images WHERE id = NEW.cover_image_id) IS NOT NEW.id
  BEGIN
    SELECT RAISE(ABORT, 'cover image must belong to the project');
  END;

  -- Old addresses of projects whose slug changed; they redirect to the current page
  CREATE TABLE slug_redirects (
    slug TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE project_revisions (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX project_revisions_project ON project_revisions(project_id, id);

  -- Homepage portfolio selection. The draft and the published selection are kept apart.
  CREATE TABLE featured_projects (
    stage TEXT NOT NULL CHECK (stage IN ('draft', 'published')),
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (stage, project_id)
  );

  CREATE TABLE services (
    id INTEGER PRIMARY KEY,
    anchor TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    image_id TEXT REFERENCES images(id) ON DELETE SET NULL,
    position INTEGER NOT NULL DEFAULT 0,
    published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Editable text blocks (homepage, about, company) with a draft and a published copy
  CREATE TABLE content_docs (
    key TEXT PRIMARY KEY,
    draft TEXT NOT NULL,
    published TEXT,
    draft_version INTEGER NOT NULL DEFAULT 1,
    draft_updated_at TEXT NOT NULL,
    published_at TEXT
  );

  CREATE TABLE content_history (
    id INTEGER PRIMARY KEY,
    key TEXT NOT NULL,
    data TEXT NOT NULL,
    published_at TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX content_history_key ON content_history(key, id);

  CREATE TABLE inquiries (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    name TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    event TEXT NOT NULL DEFAULT '',
    area TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    page TEXT NOT NULL DEFAULT '',
    attachment_file TEXT,
    attachment_name TEXT,
    attachment_size INTEGER,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'done', 'spam', 'archived')),
    notes TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX inquiries_status ON inquiries(status, created_at);

  CREATE TABLE activity (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    summary TEXT NOT NULL
  );
  `,
];
