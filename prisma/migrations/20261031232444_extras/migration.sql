-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Fast vector similarity + fuzzy search + language overlap
CREATE INDEX skills_embedding_idx ON skills USING hnsw (embedding vector_cosine_ops);
CREATE INDEX skills_name_trgm_idx ON skills USING gin (name gin_trgm_ops);
CREATE INDEX users_languages_idx  ON users  USING gin (languages);

-- Data rules the database enforces
ALTER TABLE user_skill_haves ADD CONSTRAINT level_range      CHECK (level BETWEEN 1 AND 5);
ALTER TABLE user_skill_wants ADD CONSTRAINT goal_level_range CHECK (goal_level BETWEEN 1 AND 5);
ALTER TABLE reviews          ADD CONSTRAINT rating_range     CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE availability_slots ADD CONSTRAINT slot_order     CHECK (start_min < end_min AND end_min <= 1440);
ALTER TABLE matches          ADD CONSTRAINT pair_order       CHECK (user_a_id < user_b_id);
ALTER TABLE swipes           ADD CONSTRAINT no_self_swipe    CHECK (swiper_id <> swiped_id);
ALTER TABLE users            ADD CONSTRAINT credits_non_negative CHECK (credits >= 0);

-- No double-booking (teacher or learner)
ALTER TABLE sessions
  ADD COLUMN slot tsrange GENERATED ALWAYS AS
    (tsrange(starts_at, starts_at + duration_min * interval '1 minute')) STORED;

ALTER TABLE sessions ADD CONSTRAINT no_teacher_overlap
  EXCLUDE USING gist (teacher_id WITH =, slot WITH &&)
  WHERE (status IN ('PROPOSED', 'CONFIRMED'));

ALTER TABLE sessions ADD CONSTRAINT no_learner_overlap
  EXCLUDE USING gist (learner_id WITH =, slot WITH &&)
  WHERE (status IN ('PROPOSED', 'CONFIRMED'));
