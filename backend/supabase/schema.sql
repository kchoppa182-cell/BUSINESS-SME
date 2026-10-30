-- Run this in Supabase SQL Editor before starting the backend.
create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  owner_email text not null unique,
  name text not null,
  bio text not null default '',
  photo text not null default '',
  links jsonb not null default '{}'::jsonb,
  awards jsonb not null default '[]'::jsonb,
  team jsonb not null default '[]'::jsonb,
  public_listing boolean not null default false,
  share_price numeric(14,2) not null default 0 check (share_price >= 0),
  shares_available integer not null default 0 check (shares_available >= 0),
  created_at timestamptz not null default now()
);

alter table public.businesses add column if not exists public_listing boolean not null default false;
alter table public.businesses add column if not exists share_price numeric(14,2) not null default 0 check (share_price >= 0);
alter table public.businesses add column if not exists shares_available integer not null default 0 check (shares_available >= 0);

create table if not exists public.investors (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.financial_records (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  record_date date not null,
  record_hour smallint not null default 12 check (record_hour between 0 and 23),
  sales numeric(18,6) not null check (sales >= 0),
  capital_used numeric(18,6) not null check (capital_used >= 0),
  output_earned numeric(18,6) not null check (output_earned >= 0),
  products_sold integer not null check (products_sold >= 0),
  created_at timestamptz not null default now()
);

-- Preserve fractional USD when users enter amounts in other currencies.
alter table public.financial_records alter column sales type numeric(18,6) using sales::numeric(18,6);
alter table public.financial_records alter column capital_used type numeric(18,6) using capital_used::numeric(18,6);
alter table public.financial_records alter column output_earned type numeric(18,6) using output_earned::numeric(18,6);

create index if not exists financial_records_business_date_idx on public.financial_records (business_id, record_date);

create table if not exists public.share_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  investor_id uuid not null references auth.users(id) on delete cascade,
  shares integer not null check (shares > 0),
  price_per_share numeric(14,2) not null check (price_per_share > 0),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now()
);

create index if not exists share_requests_investor_created_idx on public.share_requests (investor_id, created_at desc);
create index if not exists share_requests_business_created_idx on public.share_requests (business_id, created_at desc);

create table if not exists public.share_messages (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.share_requests(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists share_messages_request_created_idx on public.share_messages (request_id, created_at);

alter table public.businesses enable row level security;
alter table public.financial_records enable row level security;
alter table public.share_requests enable row level security;
alter table public.share_messages enable row level security;
alter table public.investors enable row level security;

drop policy if exists "Owners manage their business" on public.businesses;
create policy "Owners manage their business" on public.businesses
  for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
drop policy if exists "Owners manage their financial records" on public.financial_records;
create policy "Owners manage their financial records" on public.financial_records
  for all to authenticated using (business_id in (select id from public.businesses where owner_id = (select auth.uid())))
  with check (business_id in (select id from public.businesses where owner_id = (select auth.uid())));

drop policy if exists "Investors view their share requests" on public.share_requests;
create policy "Investors view their share requests" on public.share_requests
  for select to authenticated using (investor_id = (select auth.uid()));
drop policy if exists "Business owners view share requests" on public.share_requests;
create policy "Business owners view share requests" on public.share_requests
  for select to authenticated using (business_id in (select id from public.businesses where owner_id = (select auth.uid())));
drop policy if exists "Participants view share messages" on public.share_messages;
create policy "Participants view share messages" on public.share_messages
  for select to authenticated using (exists (
    select 1 from public.share_requests r join public.businesses b on b.id = r.business_id
    where r.id = request_id and (r.investor_id = (select auth.uid()) or b.owner_id = (select auth.uid()))
  ));
drop policy if exists "Participants send share messages" on public.share_messages;
create policy "Participants send share messages" on public.share_messages
  for insert to authenticated with check (
    sender_id = (select auth.uid()) and exists (
      select 1 from public.share_requests r join public.businesses b on b.id = r.business_id
      where r.id = request_id and (r.investor_id = (select auth.uid()) or b.owner_id = (select auth.uid()))
    )
  );
drop policy if exists "Investors manage their profile" on public.investors;
create policy "Investors manage their profile" on public.investors
  for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
