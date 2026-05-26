create or replace function public.current_org_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select organization_id
  from public.profiles
  where id = auth.uid()
  limit 1
$$;

create or replace function public.current_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role
  from public.profiles
  where id = auth.uid()
  limit 1
$$;

drop policy if exists "profiles can read same org" on public.profiles;
drop policy if exists "profiles can read own profile" on public.profiles;
drop policy if exists "profiles admin can read same org" on public.profiles;

create policy "profiles can read own profile"
on public.profiles
for select
using (id = auth.uid());
