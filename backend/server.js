const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

app.use(cors()); app.use(express.json({ limit: '3mb' }));
const frontendDir = path.join(__dirname, '..', 'frontend');
if (!process.env.VERCEL) {
  app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'home.html')));
  app.use(express.static(frontendDir));
}
const email = value => String(value || '').trim().toLowerCase();
const ready = (req, res, next) => supabase ? next() : res.status(503).json({ error: 'Database is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to backend/.env.' });
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
async function identity(req) {
  const token = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw httpError(401, 'Sign in before accessing this feature.');
  const { data: authData, error: identityError } = await supabase.auth.getUser(token);
  if (identityError || !authData?.user?.id) throw httpError(401, 'Your sign-in session is invalid or has expired.');
  let accountType = authData.user.app_metadata?.account_type;
  if (!accountType) {
    const { data: workspace } = await supabase.from('businesses').select('id').eq('owner_id', authData.user.id).maybeSingle();
    if (workspace) accountType = 'business';
    else {
      const { data: investorProfile } = await supabase.from('investors').select('owner_id').eq('owner_id', authData.user.id).maybeSingle();
      if (investorProfile) accountType = 'investor';
    }
  }
  if (!['business', 'investor'].includes(accountType)) throw httpError(403, 'This account has no platform role. Register a business or investor account.');
  return { user: authData.user, accountType };
}
async function business(req) {
  const session = await identity(req);
  if (session.accountType !== 'business') throw httpError(403, 'A business account is required for this feature.');
  const { data, error } = await supabase.from('businesses').select('*').eq('owner_id', session.user.id).single();
  if (error || !data) throw httpError(404, 'Business workspace was not found for this account.');
  return data;
}
async function investor(req) {
  const session = await identity(req);
  if (session.accountType !== 'investor') throw httpError(403, 'An investor account is required for this feature.');
  return session.user;
}
function publicReport(rows) {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, offset) => new Date(now.getFullYear(), now.getMonth() - 11 + offset, 1));
  const values = months.map(date => ({ key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, label: date.toLocaleString('en', { month: 'short', year: '2-digit' }), sales: 0, capitalUsed: 0, outputEarned: 0, netProfit: 0, recordCount: 0 }));
  const byMonth = new Map(values.map(value => [value.key, value]));
  for (const row of rows) {
    const bucket = byMonth.get(String(row.record_date).slice(0, 7));
    if (!bucket) continue;
    bucket.recordCount += 1; bucket.sales += Number(row.sales || 0); bucket.capitalUsed += Number(row.capital_used || 0); bucket.outputEarned += Number(row.output_earned || 0);
    bucket.netProfit = bucket.outputEarned - bucket.capitalUsed;
  }
  return { series: values.map(({ key, ...value }) => value), totalSales: values.reduce((sum, value) => sum + value.sales, 0), totalProfit: values.reduce((sum, value) => sum + value.netProfit, 0), hasRecords: rows.length > 0 };
}
async function publicBusinesses(id) {
  let query = supabase.from('businesses').select('id,name,bio,photo,links,awards,team,share_price,shares_available').eq('public_listing', true).order('name');
  if (id) query = query.eq('id', id);
  const { data: businessRows, error: businessError } = await query;
  if (businessError) throw businessError;
  if (!businessRows?.length) return [];
  const from = new Date(); from.setMonth(from.getMonth() - 11, 1);
  const ids = businessRows.map(row => row.id);
  const { data: records, error: recordsError } = await supabase.from('financial_records').select('business_id,record_date,sales,capital_used,output_earned').in('business_id', ids).gte('record_date', from.toISOString().slice(0, 10)).order('record_date');
  if (recordsError) throw recordsError;
  const grouped = new Map(ids.map(businessId => [businessId, []]));
  for (const row of records || []) grouped.get(row.business_id)?.push(row);
  return businessRows.map(row => ({ ...row, ...publicReport(grouped.get(row.id) || []) }));
}
function startDate(period) { const d = new Date(); if (period === 'live') { d.setHours(0, 0, 0, 0); return d; } if (period === 'week') return new Date(d.getFullYear(), d.getMonth(), 1); if (period === 'year') return new Date(d.getFullYear() - 5, 0, 1); return new Date(d.getFullYear(), 0, 1); }
function summarise(rows, period) {
  const year = new Date().getFullYear(); const labels = period === 'custom' ? [...new Set(rows.map(row => String(row.record_date)))].sort() : period === 'live' ? Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`) : period === 'week' ? ['Week 1', 'Week 2', 'Week 3', 'Week 4'] : period === 'year' ? Array.from({ length: 6 }, (_, i) => String(year - 5 + i)) : months;
  const buckets = Object.fromEntries(labels.map(label => [label, { label, sales: 0, cashInvested: 0, cashEarned: 0, productsSold: 0, recordCount: 0 }]));
  rows.forEach(row => { const d = new Date(`${row.record_date}T12:00:00`); const label = period === 'custom' ? String(row.record_date) : period === 'live' ? `${String(row.record_hour || 0).padStart(2, '0')}:00` : period === 'week' ? `Week ${Math.min(4, Math.floor((d.getDate() - 1) / 7) + 1)}` : period === 'year' ? String(d.getFullYear()) : months[d.getMonth()]; const b = buckets[label]; if (b) { b.recordCount += 1; b.sales += Number(row.sales); b.cashInvested += Number(row.capital_used); b.cashEarned += Number(row.output_earned); b.productsSold += Number(row.products_sold); } });
  return labels.map(label => ({ ...buckets[label], performance: buckets[label].cashInvested ? Math.round((buckets[label].cashEarned - buckets[label].cashInvested) / buckets[label].cashInvested * 100) : 0 }));
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', database: supabase ? 'supabase' : 'not-configured' }));
app.get('/api/config/public', (req, res) => res.json({ supabaseUrl: process.env.SUPABASE_URL || '', publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '' }));
app.post('/api/auth/register', ready, async (req, res) => {
  const ownerEmail = email(req.body?.email), password = String(req.body?.password || ''), name = String(req.body?.businessName || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(ownerEmail) || password.length < 8 || !name) return res.status(400).json({ error: 'Enter a valid email, an 8-character password, and a business name.' });
  let user, created = false;
  const createdUser = await supabase.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true, app_metadata: { account_type: 'business' }, user_metadata: { business_name: name } });
  if (createdUser.error) {
    if (!/already (registered|exists)|already been registered|user exists/i.test(createdUser.error.message)) return res.status(400).json({ error: createdUser.error.message });
    const { data: signedIn, error: signInError } = await supabase.auth.signInWithPassword({ email: ownerEmail, password });
    if (signInError || !signedIn.user) return res.status(409).json({ error: 'An account already exists for this email. Sign in with that account instead.' });
    user = signedIn.user;
    const [{ data: existingBusiness }, { data: existingInvestor }] = await Promise.all([
      supabase.from('businesses').select('id').eq('owner_id', user.id).maybeSingle(),
      supabase.from('investors').select('owner_id').eq('owner_id', user.id).maybeSingle()
    ]);
    if (existingBusiness || existingInvestor) return res.status(409).json({ error: 'This email already has an account. Sign in instead of creating another one.' });
    if (user.app_metadata?.account_type && user.app_metadata.account_type !== 'business') return res.status(409).json({ error: 'This email is already registered as an investor account. Sign in with that account instead.' });
  } else { user = createdUser.data.user; created = true; }
  const { error: profileError } = await supabase.from('businesses').insert({ owner_id: user.id, owner_email: ownerEmail, name });
  if (profileError) {
    if (created) await supabase.auth.admin.deleteUser(user.id);
    const schemaHint = profileError.code === '42P01' || profileError.code === 'PGRST205' ? ' Run backend/supabase/schema.sql in your Supabase SQL Editor, then retry.' : '';
    return res.status(500).json({ error: `Could not save your business profile: ${profileError.message}.${schemaHint}` });
  }
  const { error: roleError } = await supabase.auth.admin.updateUserById(user.id, { app_metadata: { ...(user.app_metadata || {}), account_type: 'business' }, user_metadata: { ...(user.user_metadata || {}), business_name: name } });
  if (roleError) return res.status(500).json({ error: `Your profile was saved, but account setup did not finish: ${roleError.message}. Sign in again or contact support.` });
  const { data: session, error: sessionError } = await supabase.auth.signInWithPassword({ email: ownerEmail, password });
  if (sessionError) return res.status(500).json({ error: `Your profile was saved, but sign-in did not finish: ${sessionError.message}. Sign in with your new account.` });
  res.status(201).json({ email: ownerEmail, businessName: name, accountType: 'business', accessToken: session.session.access_token });
});
app.post('/api/auth/investor/register', ready, async (req, res) => {
  const investorEmail = email(req.body?.email), password = String(req.body?.password || ''), name = String(req.body?.fullName || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(investorEmail) || password.length < 8 || !name) return res.status(400).json({ error: 'Enter your name, a valid email, and a password of at least 8 characters.' });
  let user, created = false;
  const createdUser = await supabase.auth.admin.createUser({ email: investorEmail, password, email_confirm: true, app_metadata: { account_type: 'investor' }, user_metadata: { full_name: name } });
  if (createdUser.error) {
    if (!/already (registered|exists)|already been registered|user exists/i.test(createdUser.error.message)) return res.status(400).json({ error: createdUser.error.message });
    const { data: signedIn, error: signInError } = await supabase.auth.signInWithPassword({ email: investorEmail, password });
    if (signInError || !signedIn.user) return res.status(409).json({ error: 'An account already exists for this email. Sign in with that account instead.' });
    user = signedIn.user;
    const [{ data: existingBusiness }, { data: existingInvestor }] = await Promise.all([
      supabase.from('businesses').select('id').eq('owner_id', user.id).maybeSingle(),
      supabase.from('investors').select('owner_id').eq('owner_id', user.id).maybeSingle()
    ]);
    if (existingBusiness || existingInvestor) return res.status(409).json({ error: 'This email already has an account. Sign in instead of creating another one.' });
    if (user.app_metadata?.account_type && user.app_metadata.account_type !== 'investor') return res.status(409).json({ error: 'This email is already registered as a business account. Sign in with that account instead.' });
  } else { user = createdUser.data.user; created = true; }
  const { error: profileError } = await supabase.from('investors').insert({ owner_id: user.id, email: investorEmail, full_name: name });
  if (profileError) {
    if (created) await supabase.auth.admin.deleteUser(user.id);
    const schemaHint = profileError.code === '42P01' || profileError.code === 'PGRST205' ? ' Run backend/supabase/schema.sql in your Supabase SQL Editor, then retry.' : '';
    return res.status(500).json({ error: `Could not save your investor profile: ${profileError.message}.${schemaHint}` });
  }
  const { error: roleError } = await supabase.auth.admin.updateUserById(user.id, { app_metadata: { ...(user.app_metadata || {}), account_type: 'investor' }, user_metadata: { ...(user.user_metadata || {}), full_name: name } });
  if (roleError) return res.status(500).json({ error: `Your profile was saved, but account setup did not finish: ${roleError.message}. Sign in again or contact support.` });
  const { data: session, error: sessionError } = await supabase.auth.signInWithPassword({ email: investorEmail, password });
  if (sessionError) return res.status(500).json({ error: `Your profile was saved, but sign-in did not finish: ${sessionError.message}. Sign in with your new account.` });
  res.status(201).json({ email: investorEmail, fullName: name, accountType: 'investor', accessToken: session.session.access_token });
});
app.post('/api/auth/oauth/complete', ready, async (req, res) => {
  try {
    const token = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) throw httpError(401, 'Google sign-in session is missing.');
    const { data: authData, error } = await supabase.auth.getUser(token);
    if (error || !authData?.user?.id) {
      console.warn(`Supabase rejected Google OAuth session (${error?.status || 'unknown'}): ${error?.message || 'No user returned.'}`);
      throw httpError(401, 'Google sign-in could not be verified. Start Google sign-in again.');
    }
    const user = authData.user, requestedRole = String(req.body?.accountType || ''), ownerEmail = email(user.email);
    const { data: existingBusiness } = await supabase.from('businesses').select('id,name').eq('owner_id', user.id).maybeSingle();
    const { data: existingInvestor } = await supabase.from('investors').select('owner_id,full_name').eq('owner_id', user.id).maybeSingle();
    const existingRole = user.app_metadata?.account_type || (existingBusiness ? 'business' : existingInvestor ? 'investor' : '');
    const accountType = requestedRole || existingRole;
    if (!['business', 'investor'].includes(accountType)) throw httpError(400, 'Choose an account type when creating a new account.');
    if (existingRole && existingRole !== accountType) throw httpError(403, `This Google account is already set up as a ${existingRole} account.`);
    let businessName = existingBusiness?.name || '';
    let fullName = existingInvestor?.full_name || String(user.user_metadata?.full_name || user.user_metadata?.name || '').trim();
    if (accountType === 'business' && !existingBusiness) {
      businessName = String(req.body?.businessName || user.user_metadata?.business_name || '').trim().slice(0, 80);
      if (!businessName) throw httpError(400, 'Enter your business name in the create-account form, then try Google again.');
      const { error: createError } = await supabase.from('businesses').insert({ owner_id: user.id, owner_email: ownerEmail, name: businessName });
      if (createError) throw createError;
    }
    if (accountType === 'investor') {
      fullName = String(req.body?.fullName || fullName || ownerEmail.split('@')[0]).trim().slice(0, 100);
      const { error: profileError } = await supabase.from('investors').upsert({ owner_id: user.id, email: ownerEmail, full_name: fullName }, { onConflict: 'owner_id' });
      if (profileError) throw profileError;
    }
    const userMetadata = { ...(user.user_metadata || {}) };
    if (businessName) userMetadata.business_name = businessName;
    if (fullName) userMetadata.full_name = fullName;
    const { error: roleError } = await supabase.auth.admin.updateUserById(user.id, { app_metadata: { ...(user.app_metadata || {}), account_type: accountType }, user_metadata: userMetadata });
    if (roleError) throw roleError;
    res.json({ email: ownerEmail, accountType, businessName, fullName, accessToken: token });
  } catch (error) { res.status(error.status || 500).json({ error: error.message || 'Google sign-in could not be completed.' }); }
});
app.post('/api/auth/login', ready, async (req, res) => {
  const accountEmail = email(req.body?.email), { data, error } = await supabase.auth.signInWithPassword({ email: accountEmail, password: String(req.body?.password || '') });
  if (error || !data.user) return res.status(401).json({ error: 'Incorrect email or password.' });
  const { data: workspace } = await supabase.from('businesses').select('name').eq('owner_id', data.user.id).maybeSingle();
  const { data: investorProfile } = await supabase.from('investors').select('full_name').eq('owner_id', data.user.id).maybeSingle();
  const accountType = data.user.app_metadata?.account_type || (workspace ? 'business' : investorProfile ? 'investor' : '');
  if (!accountType) return res.status(403).json({ error: 'This account has no registered business or investor role.' });
  if (req.body?.accountType && req.body.accountType !== accountType) return res.status(403).json({ error: `This is a ${accountType} account. Choose the matching sign-in option.` });
  res.json({ email: accountEmail, businessName: workspace?.name || '', fullName: investorProfile?.full_name || data.user.user_metadata?.full_name || '', accountType, accessToken: data.session.access_token });
});
app.get('/api/public/businesses', ready, async (req, res) => {
  try { res.json({ businesses: await publicBusinesses() }); }
  catch (error) { res.status(500).json({ error: 'Public business directory is unavailable.' }); }
});
app.get('/api/public/businesses/:id', ready, async (req, res) => {
  try { const [record] = await publicBusinesses(req.params.id); if (!record) return res.status(404).json({ error: 'This business has not published a public profile.' }); res.json(record); }
  catch (error) { res.status(500).json({ error: 'Business report is unavailable.' }); }
});
app.get('/api/investor/share-requests', ready, async (req, res) => {
  try {
    const user = await investor(req);
    const { data, error } = await supabase.from('share_requests').select('id,shares,price_per_share,status,created_at,businesses(name)').eq('investor_id', user.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ requests: (data || []).map(row => ({ id: row.id, shares: row.shares, pricePerShare: Number(row.price_per_share), status: row.status, createdAt: row.created_at, businessName: row.businesses?.name || 'Business' })) });
  } catch (error) { res.status(error.status || 500).json({ error: error.message || 'Share requests are unavailable.' }); }
});
app.post('/api/investor/share-requests', ready, async (req, res) => {
  try {
    const user = await investor(req), shares = Number(req.body?.shares), businessId = String(req.body?.businessId || '');
    if (!Number.isInteger(shares) || shares < 1 || shares > 1000000) return res.status(400).json({ error: 'Enter a whole number of shares from 1 to 1,000,000.' });
    const [listed] = await publicBusinesses(businessId);
    if (!listed) return res.status(404).json({ error: 'This business is not currently listed.' });
    if (Number(listed.share_price) <= 0 || Number(listed.shares_available) <= 0) return res.status(400).json({ error: 'This business is not currently accepting share requests.' });
    if (shares > Number(listed.shares_available)) return res.status(400).json({ error: `Only ${listed.shares_available} shares are currently listed.` });
    const { data, error } = await supabase.from('share_requests').insert({ business_id: listed.id, investor_id: user.id, shares, price_per_share: listed.share_price }).select('id,shares,price_per_share,status,created_at').single();
    if (error) throw error;
    res.status(201).json({ request: { ...data, pricePerShare: Number(data.price_per_share), businessName: listed.name }, notice: 'Request received. This is not a completed purchase and does not reserve or transfer shares.' });
  } catch (error) { res.status(error.status || 500).json({ error: error.message || 'Share request could not be submitted.' }); }
});
app.get('/api/business/share-requests', ready, async (req, res) => {
  try {
    const workspace = await business(req);
    const { data, error } = await supabase.from('share_requests').select('id,investor_id,shares,price_per_share,status,created_at').eq('business_id', workspace.id).order('created_at', { ascending: false });
    if (error) throw error;
    const requests = await Promise.all((data || []).map(async row => {
      const { data: account } = await supabase.auth.admin.getUserById(row.investor_id);
      return { id: row.id, investorEmail: account?.user?.email || 'Investor', shares: row.shares, pricePerShare: Number(row.price_per_share), status: row.status, createdAt: row.created_at };
    }));
    res.json({ requests });
  } catch (error) { res.status(error.status || 500).json({ error: error.message || 'Share requests are unavailable.' }); }
});
async function shareRequestParticipant(req, requestId) {
  const session = await identity(req);
  const { data: request, error } = await supabase.from('share_requests').select('id,business_id,investor_id').eq('id', requestId).maybeSingle();
  if (error) throw error;
  if (!request) throw httpError(404, 'Share request not found.');
  if (session.accountType === 'investor' && request.investor_id === session.user.id) return { session, request };
  if (session.accountType === 'business') {
    const { data: owned, error: ownerError } = await supabase.from('businesses').select('id').eq('id', request.business_id).eq('owner_id', session.user.id).maybeSingle();
    if (ownerError) throw ownerError;
    if (owned) return { session, request };
  }
  throw httpError(403, 'Only the investor who sent this request and its business owner can access this chat.');
}
app.get('/api/share-requests/:id/messages', ready, async (req, res) => {
  try {
    const { session, request } = await shareRequestParticipant(req, req.params.id);
    const { data, error } = await supabase.from('share_messages').select('id,sender_id,message,created_at').eq('request_id', request.id).order('created_at');
    if (error) throw error;
    res.json({ messages: (data || []).map(row => ({ id: row.id, message: row.message, createdAt: row.created_at, mine: row.sender_id === session.user.id })) });
  } catch (error) { res.status(error.status || 500).json({ error: error.message || 'Chat messages could not be loaded.' }); }
});
app.post('/api/share-requests/:id/messages', ready, async (req, res) => {
  try {
    const { session, request } = await shareRequestParticipant(req, req.params.id);
    const message = String(req.body?.message || '').trim();
    if (!message || message.length > 2000) return res.status(400).json({ error: 'Messages must contain 1 to 2,000 characters.' });
    const { data, error } = await supabase.from('share_messages').insert({ request_id: request.id, sender_id: session.user.id, message }).select('id,sender_id,message,created_at').single();
    if (error) throw error;
    res.status(201).json({ message: { id: data.id, message: data.message, createdAt: data.created_at, mine: true } });
  } catch (error) { res.status(error.status || 500).json({ error: error.message || 'Message could not be sent.' }); }
});
app.get('/api/profile', ready, async (req, res) => { try { const b = await business(req); res.json({ name: b.name, bio: b.bio || '', photo: b.photo || '', links: b.links || {}, awards: b.awards || [], team: b.team || [], publicListing: Boolean(b.public_listing), sharePrice: Number(b.share_price || 0), sharesAvailable: Number(b.shares_available || 0) }); } catch (error) { res.status(error.status || 404).json({ error: error.message }); } });
app.put('/api/profile', ready, async (req, res) => { try { const b = await business(req), p = req.body || {}; if (!String(p.name || '').trim()) return res.status(400).json({ error: 'A business name is required.' }); const price = p.sharePrice === undefined ? Number(b.share_price || 0) : Number(p.sharePrice), shares = p.sharesAvailable === undefined ? Number(b.shares_available || 0) : Number(p.sharesAvailable); if (!Number.isFinite(price) || price < 0 || !Number.isInteger(shares) || shares < 0) return res.status(400).json({ error: 'Share price and available shares must be zero or greater.' }); const update = { name: String(p.name).trim().slice(0, 80), bio: String(p.bio || '').slice(0, 500), photo: String(p.photo || ''), links: p.links || {}, awards: Array.isArray(p.awards) ? p.awards.slice(0, 20) : [], team: Array.isArray(p.team) ? p.team.slice(0, 50) : [], public_listing: p.publicListing === undefined ? Boolean(b.public_listing) : Boolean(p.publicListing), share_price: price, shares_available: shares }; const { error } = await supabase.from('businesses').update(update).eq('id', b.id); if (error) throw error; res.json({ ...p, name: update.name, bio: update.bio, publicListing: update.public_listing, sharePrice: update.share_price, sharesAvailable: update.shares_available }); } catch (error) { res.status(error.status || 400).json({ error: error.message }); } });
app.post('/api/profile/publish', ready, async (req, res) => {
  try {
    const workspace = await business(req);
    const { error } = await supabase.from('businesses').update({ public_listing: true }).eq('id', workspace.id);
    if (error) throw error;
    res.json({ publicListing: true, message: 'Your business is published. Investors can now view its profile and reported analytics.' });
  } catch (error) { res.status(error.status || 400).json({ error: error.message || 'Business could not be published.' }); }
});
function selectedRecordPeriod(req) { const period = ['live', 'week', 'month', 'year', 'custom'].includes(req.query.period) ? req.query.period : 'month'; if (period !== 'custom') return { period, from: startDate(period).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) }; const { from, to } = req.query; const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); if (!validDate(from) || !validDate(to) || from > to) throw Object.assign(new Error('Choose a valid start and end date.'), { status: 400 }); return { period, from, to }; }
app.get('/api/metrics', ready, async (req, res) => { try { const range = selectedRecordPeriod(req), b = await business(req); const { data: rows, error } = await supabase.from('financial_records').select('*').eq('business_id', b.id).gte('record_date', range.from).lte('record_date', range.to).order('record_date'); if (error) throw error; const data = summarise(rows, range.period), total = key => data.reduce((n, row) => n + row[key], 0), invested = total('cashInvested'), earned = total('cashEarned'); res.json({ period: range.period, from: range.from, to: range.to, lastUpdated: new Date().toISOString(), summary: { hasRecords: rows.length > 0, totalSales: total('sales'), totalInvested: invested, totalEarned: earned, productsSold: total('productsSold'), netCash: earned - invested, avgPerformance: invested ? Math.round((earned - invested) / invested * 100) : 0 }, data }); } catch (error) { res.status(error.status || 400).json({ error: error.message }); } });
app.post('/api/records', ready, async (req, res) => { try { const b = await business(req), { date, sales, cashInvested, cashEarned, productsSold } = req.body || {}; if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || [sales, cashInvested, cashEarned, productsSold].some(value => !Number.isFinite(value) || value < 0)) return res.status(400).json({ error: 'Enter a valid date and non-negative figures.' }); const { data, error } = await supabase.from('financial_records').insert({ business_id: b.id, record_date: date, sales, capital_used: cashInvested, output_earned: cashEarned, products_sold: productsSold, record_hour: 12 }).select().single(); if (error) throw error; res.status(201).json(data); } catch (error) { res.status(400).json({ error: error.message }); } });
app.get('/api/insights', ready, async (req, res) => { try { const range = selectedRecordPeriod(req), b = await business(req), { data: rows, error } = await supabase.from('financial_records').select('record_date,sales,capital_used,output_earned').eq('business_id', b.id).gte('record_date', range.from).lte('record_date', range.to); if (error) throw error; const sales = rows.reduce((n, r) => n + Number(r.sales), 0), capital = rows.reduce((n, r) => n + Number(r.capital_used), 0), output = rows.reduce((n, r) => n + Number(r.output_earned), 0), net = output - capital, activeDays = new Set(rows.map(row => row.record_date)).size; const status = !rows.length ? 'No financial records have been entered for this period.' : net > 0 ? capital ? `Profit: output earned is ${Math.round(net / capital * 100)}% above capital used.` : 'Profit: output earned is positive and no capital use was recorded.' : net < 0 ? `Loss: output earned is ${Math.round(Math.abs(net) / capital * 100)}% below capital used.` : 'Break-even: output earned equals capital used.'; res.json({ insights: [status, `Average sales per recorded day: ${Math.round(sales / Math.max(activeDays, 1)).toLocaleString()}.`, 'Net result is calculated as output earned minus capital used.'] }); } catch (error) { res.status(error.status || 400).json({ error: error.message }); } });
app.get('/api/products', (req, res) => res.json({ products: [] }));
app.get('/api/market-intelligence', (req, res) => res.json({ disclaimer: 'Comparison data must be anonymised and permission-controlled before release.', investors: [], shareholders: [], competitors: [], leaders: [] }));
app.get('/api/billing', (req, res) => res.json({ plan: { name: 'SME Intelligence Pro', amount: 10, currency: 'USD', interval: 'month' }, checkoutEnabled: false, mpesaEnabled: false }));
app.use('/api', (req, res) => res.status(404).json({ error: `API route ${req.method} ${req.path} was not found. Restart the backend to load the latest routes.` }));
if (require.main === module) app.listen(PORT, () => console.log(`SME Intelligence Platform running at http://localhost:${PORT}`));

module.exports = app;
