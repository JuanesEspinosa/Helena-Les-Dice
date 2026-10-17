-- =============================================================
-- Helena les dice — esquema de base de datos (PostgreSQL 14+)
-- Ejecutar con:  npm run db:init   (borra y recrea todo)
-- =============================================================

DROP TABLE IF EXISTS backups, team_achievements, achievements, notifications, activity_log,
  comments, section_versions, sections, level_sections, levels, team_members, teams, periods,
  password_resets, users, session CASCADE;
DROP FUNCTION IF EXISTS activity_log_readonly() CASCADE;
DROP TYPE IF EXISTS user_role, section_status, version_kind CASCADE;

CREATE TYPE user_role      AS ENUM ('estudiante', 'docente', 'administrador');
CREATE TYPE section_status AS ENUM ('redaccion', 'revision', 'aprobado', 'devuelto');
CREATE TYPE version_kind   AS ENUM ('manual', 'automatico', 'enviada');

-- ---------- Usuarios y acceso (RF-01, RF-02, RF-13, RF-14) ----------
CREATE TABLE users (
  id                    SERIAL PRIMARY KEY,
  name                  VARCHAR(120) NOT NULL,
  email                 VARCHAR(160) NOT NULL UNIQUE,
  password_hash         TEXT         NOT NULL,
  role                  user_role    NOT NULL,
  active                BOOLEAN      NOT NULL DEFAULT TRUE,
  must_change_password  BOOLEAN      NOT NULL DEFAULT FALSE,
  lang                  VARCHAR(2)   NOT NULL DEFAULT 'es',
  failed_attempts       INT          NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  last_login            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE password_resets (
  id          SERIAL PRIMARY KEY,
  user_id     INT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Periodos y equipos (RF-03, RF-17) ----------
CREATE TABLE periods (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(20) NOT NULL UNIQUE,
  start_date  DATE        NOT NULL,
  end_date    DATE        NOT NULL,
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT period_dates CHECK (end_date > start_date)
);

CREATE TABLE teams (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(80)  NOT NULL,
  project     VARCHAR(160) NOT NULL DEFAULT '',
  period_id   INT          NOT NULL REFERENCES periods(id),
  created_by  INT          REFERENCES users(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (name, period_id)
);

-- Un estudiante solo puede estar en un equipo por periodo (RF-03)
CREATE TABLE team_members (
  team_id    INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id),
  period_id  INT NOT NULL REFERENCES periods(id),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id),
  UNIQUE (user_id, period_id)
);

-- ---------- Niveles: plantilla que define el docente (RF-04) ----------
CREATE TABLE levels (
  id           SERIAL PRIMARY KEY,
  position     INT          NOT NULL,
  name         VARCHAR(120) NOT NULL,
  description  TEXT         NOT NULL DEFAULT '',
  points       INT          NOT NULL DEFAULT 100 CHECK (points >= 0),
  CONSTRAINT levels_position_unique UNIQUE (position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE level_sections (
  id        SERIAL PRIMARY KEY,
  level_id  INT          NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  position  INT          NOT NULL,
  name      VARCHAR(160) NOT NULL
);

-- ---------- Secciones de cada equipo (RF-05, RF-06, RF-07) ----------
CREATE TABLE sections (
  id                SERIAL PRIMARY KEY,
  team_id           INT            NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  level_section_id  INT            NOT NULL REFERENCES level_sections(id) ON DELETE CASCADE,
  content           TEXT           NOT NULL DEFAULT '',
  status            section_status NOT NULL DEFAULT 'redaccion',
  responsible_id    INT            REFERENCES users(id),
  reviewer_id       INT            REFERENCES users(id),
  updated_at        TIMESTAMPTZ,
  updated_by        INT            REFERENCES users(id),
  UNIQUE (team_id, level_section_id),
  CONSTRAINT distinct_roles CHECK (responsible_id IS NULL OR reviewer_id IS NULL OR responsible_id <> reviewer_id)
);

CREATE TABLE section_versions (
  id          SERIAL PRIMARY KEY,
  section_id  INT          NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  number      INT          NOT NULL,
  author_id   INT          NOT NULL REFERENCES users(id),
  content     TEXT         NOT NULL,
  kind        version_kind NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (section_id, number)
);

-- ---------- Comentarios (RF-10): nunca se borran, solo se marcan ----------
CREATE TABLE comments (
  id           SERIAL PRIMARY KEY,
  section_id   INT         NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  author_id    INT         NOT NULL REFERENCES users(id),
  parent_id    INT         REFERENCES comments(id),
  body         TEXT        NOT NULL CHECK (length(trim(body)) > 0),
  quote        TEXT,
  resolved     BOOLEAN     NOT NULL DEFAULT FALSE,
  resolved_by  INT         REFERENCES users(id),
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Registro de actividad inmodificable (RF-08, RNF-08) ----------
CREATE TABLE activity_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INT          REFERENCES users(id),
  team_id     INT          REFERENCES teams(id),
  section_id  INT          REFERENCES sections(id),
  action      VARCHAR(40)  NOT NULL,
  detail      TEXT         NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE FUNCTION activity_log_readonly() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'El registro de actividad no se puede modificar ni eliminar';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER activity_log_no_update BEFORE UPDATE OR DELETE ON activity_log
  FOR EACH ROW EXECUTE FUNCTION activity_log_readonly();
CREATE TRIGGER activity_log_no_truncate BEFORE TRUNCATE ON activity_log
  FOR EACH STATEMENT EXECUTE FUNCTION activity_log_readonly();

-- ---------- Notificaciones (RF-12) ----------
CREATE TABLE notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(30)  NOT NULL, -- devuelta | comentario | aprobada | nivel | insignia | revision
  title       VARCHAR(200) NOT NULL,
  body        TEXT         NOT NULL DEFAULT '',
  link        VARCHAR(200) NOT NULL DEFAULT '',
  read        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------- Logros (RF-11, RF-18) ----------
-- criterion: level_completed (param = posición del nivel) | all_levels_completed
--            first_submission | first_approved | sections_approved (param = cantidad)
--            comments_resolved (param = cantidad) | all_comments_resolved
CREATE TABLE achievements (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(80)  NOT NULL UNIQUE,
  description   TEXT         NOT NULL DEFAULT '',
  icon          TEXT         NOT NULL DEFAULT 'medal', -- clave de ícono o data URI (PNG/SVG ≤ 200 KB)
  criterion     VARCHAR(40)  NOT NULL,
  param         INT          NOT NULL DEFAULT 0,
  points        INT          NOT NULL DEFAULT 50 CHECK (points >= 0),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE team_achievements (
  team_id         INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  achievement_id  INT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  earned_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, achievement_id)
);

-- ---------- Copias de seguridad (RF-19, RNF-17) ----------
CREATE TABLE backups (
  id          SERIAL PRIMARY KEY,
  kind        VARCHAR(12)  NOT NULL, -- automatica | manual
  created_by  INT          REFERENCES users(id),
  filename    VARCHAR(200),
  size_bytes  BIGINT,
  status      VARCHAR(12)  NOT NULL, -- exitosa | fallida
  error       TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------- Índices ----------
CREATE INDEX idx_sections_team        ON sections(team_id);
CREATE INDEX idx_versions_section     ON section_versions(section_id, number DESC);
CREATE INDEX idx_comments_section     ON comments(section_id);
CREATE INDEX idx_activity_team        ON activity_log(team_id, created_at DESC);
CREATE INDEX idx_activity_user        ON activity_log(user_id, created_at DESC);
CREATE INDEX idx_notifications_user   ON notifications(user_id, read, created_at DESC);
CREATE INDEX idx_level_sections_level ON level_sections(level_id, position);
