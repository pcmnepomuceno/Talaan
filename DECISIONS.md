# Decision: Session Lifetime

- **Date:** 2025-02-14
- **Decision:** Use a 30-day session lifetime.
- **Rationale:** The application handles low-stakes data—job applications rather than financial or otherwise sensitive information—so the convenience of a longer-lived session outweighs the associated security trade-off.
---

# Decision: Job Application and Interview schema, enums, Alembic baseline

- **Date:** 2026-10-20
- **Decision:** Schema is owned by Alembic (one baseline migration, all four tables). Models match the CLAUDE.md spec with the choices below.
- **ENUMs (native Postgres ENUM types, lowercase snake_case values):**
  - `application_status`: applied, screening, interviewing, offered, accepted, rejected, withdrawn, ghosted
  - `mode_of_work`: on_site, hybrid, remote
  - `interview_mode`: on_site, online, async
  - `interview_outcome`: pending, good, bad (server default `pending`)
  - Tradeoff: native ENUMs enforce values in the DB, but adding a value needs `ALTER TYPE ... ADD VALUE` and removing or renaming one means recreating the type. Alternative was VARCHAR + CHECK, easier to evolve but weaker in the schema.
- **Nullability:** `remarks` is nullable Text on both tables (spec had no `?`; free notes should not be forced). `Interview.interviewer` is nullable because async interviews may have none.
- **Salary convention:** `salary` is an integer holding monthly gross pay in PHP. There is no currency column for now; add one (and a migration) if non-PHP offers need tracking.
- **`date_applied`:** `Date`, not a timestamp, so it does not use the `_at` suffix. The time of day is not meaningful.
- **Timestamps:** `created_at`/`updated_at` are `DateTime(timezone=True)`, NOT NULL, `server_default=now()`; `updated_at` also has ORM-side `onupdate`. Raw SQL updates will not bump `updated_at`; add a trigger if non-ORM writes appear.
- **Foreign keys:** `job_applications.created_by` and `interviews.job_application_id` use `ON DELETE CASCADE` and are indexed (Postgres does not index FK columns automatically, and every CRUD query filters on them). `sessions.user_id` is unchanged for now (see CLAUDE.md backlog).
- **Downgrade:** autogenerate does not drop native enum types, so the baseline `downgrade()` drops them explicitly. Verified: upgrade, `alembic check`, downgrade, upgrade again on a fresh DB.

---

# Decision: Rename ApplyFlow to Talaan

- **Date:** 2026-10-20
- **Decision:** The project is renamed Talaan (Tagalog for "record" or "list"). Container is `talaan-db`, volume `talaan_pgdata`, Postgres user and database `talaan`. Compose no longer defaults the database password; a missing `.env` fails loudly.
- **Rationale:** The name ApplyFlow collides with applyflow.com. The Filipino name also fits the target audience.
- **Alternative:** Keep the name and accept the collision. Rejected because it hurts discoverability and risks confusion.

---

# Correction: Session Lifetime entry date

- **Date:** 2026-10-20
- **Decision:** The "Session Lifetime" entry above is dated 2025-02-14, which is wrong. Git history shows it was added in commit `efce6ae` on 2026-09-11, so the decision dates to 2026-09-11 or earlier. The exact day is unverified. The decision itself is unchanged. The original entry is left as written.
