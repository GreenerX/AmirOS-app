# AmirOS Control Center database

This is the Supabase Free development database schema for operational Control
Center data. It intentionally excludes conversations, AmirOS memory, contacts,
API keys, WhatsApp material, and all other local-app data.

## Create the development project

1. Create one **Free** Supabase project named `amiros-control-center-dev`.
2. Choose the region closest to the initial team and testers. Frankfurt is a
   sensible starting point for an Israel-based development team.
3. Do not enable paid add-ons, custom domains, or Supabase Auth. Netlify
   Identity remains the only account system.
4. Keep the project as development-only until the real control workflow has
   been exercised with a small group of testers.

## Apply this schema

Link this directory to the Supabase project using the Supabase CLI, then run:

```sh
supabase db push
```

The migration under `migrations/` is the source of truth. Do not make untracked
production schema changes in the Supabase dashboard.

## Netlify connection

When the database exists, add these **private Netlify Function environment
variables** for the Control Center site:

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

The secret key is server-only. Do not add it to any `VITE_` variable, desktop
app build, browser code, repository, screenshot, or chat message. The hosted
website will continue to use Netlify Identity; Netlify Functions will verify
the signed-in user and their role before querying Supabase.
