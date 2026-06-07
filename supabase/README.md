# Supabase migrations

Schema lives in [`migrations/`](./migrations). One file per logical change,
named `NNNN_short_description.sql`.

## Apply

```bash
# Local Supabase (docker)
supabase start
supabase db push           # applies everything in migrations/

# Production
supabase link --project-ref <ref>
supabase db push           # confirm prompt then push
```

For one-off SQL editing during a hackathon, paste the contents of the latest
migration into the project SQL editor at
`https://supabase.com/dashboard/project/<ref>/sql/new` and run it.

## Schema summary

| File | Adds |
|------|------|
| `0001_trips.sql` | `public.trips` cold store + `auth.uid()`-scoped RLS. |

`trips.snapshot` holds the full Pydantic `TripState` JSON at the moment of
save. Loading a saved trip drops you back at `/trip/<session_id>` and the
existing `useTripBackendState` hook re-hydrates the HOT store from there.
