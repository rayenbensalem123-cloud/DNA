-- Bureau d'Ordre DNA: schema. Only the API function (service role) touches these tables.

create table public.users (
  id text primary key,
  username text not null unique,
  name text not null,
  role text not null check (role in ('admin', 'agent', 'lecture')),
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table public.committees (
  id text primary key,
  nom text not null
);

create table public.letters (
  id text primary key,
  ref text not null unique,
  numero_lettre text not null default '',
  direction text not null default 'entrant' check (direction in ('entrant', 'sortant')),
  type text not null default 'courrier',
  categorie text not null default 'autre',
  objet text not null default '',
  resume text not null default '',
  priorite text not null default 'normale',
  statut text not null default 'recu',
  commission text references public.committees (id),
  expediteur jsonb not null default '{}'::jsonb,
  destinataire jsonb not null default '{}'::jsonb,
  date_emission timestamptz,
  date_reception timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text
);
create index letters_created_at_idx on public.letters (created_at desc);
create index letters_statut_idx on public.letters (statut);
create index letters_commission_idx on public.letters (commission);
create index letters_direction_idx on public.letters (direction);

create table public.letter_events (
  id text primary key,
  letter_id text not null references public.letters (id) on delete cascade,
  date timestamptz not null default now(),
  type text not null,
  committee text,
  by_user text,
  by_name text,
  note text not null default ''
);
create index letter_events_letter_idx on public.letter_events (letter_id);

create table public.pieces (
  id text primary key,
  letter_id text not null references public.letters (id) on delete cascade,
  nom text not null,
  taille bigint not null,
  stored_as text not null,
  created_at timestamptz not null default now()
);
create index pieces_letter_idx on public.pieces (letter_id);

create table public.app_config (
  key text primary key,
  value text not null
);

create table public.ref_counters (
  year int primary key,
  n int not null
);

-- Atomic yearly counter for references like BO-2026-0001 (safe when two people register at once).
create function public.next_letter_ref() returns text
language plpgsql security definer set search_path = public as $$
declare
  y int := extract(year from now())::int;
  v int;
begin
  insert into public.ref_counters (year, n) values (y, 1)
  on conflict (year) do update set n = public.ref_counters.n + 1
  returning n into v;
  return 'BO-' || y || '-' || lpad(v::text, 4, '0');
end $$;
revoke execute on function public.next_letter_ref() from public, anon, authenticated;

-- Lock everything: with RLS on and no policies, the public API keys can read or write nothing.
alter table public.users enable row level security;
alter table public.committees enable row level security;
alter table public.letters enable row level security;
alter table public.letter_events enable row level security;
alter table public.pieces enable row level security;
alter table public.app_config enable row level security;
alter table public.ref_counters enable row level security;
revoke all on public.users, public.committees, public.letters, public.letter_events,
  public.pieces, public.app_config, public.ref_counters from anon, authenticated;

-- Secret used to sign login tokens (generated here, never leaves the database and the API function).
insert into public.app_config (key, value)
values ('token_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

insert into public.committees (id, nom) values
  ('cna', 'Comité National d''Arbitrage'),
  ('discipline', 'Commission de Discipline'),
  ('appel', 'Commission d''Appel'),
  ('administration', 'Administration');

-- Private bucket for scanned letters: 10 MB max, PDF / JPG / PNG only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('letters', 'letters', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- The first administrator account is NOT created here: add it with a password hash made by
-- supabase/functions/api/auth.js (hashPassword), see README.
