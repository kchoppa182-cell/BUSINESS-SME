const localPreview = window.location.protocol === 'file:' || (['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port !== '3001');
const API = String(window.BSI_API_URL || document.querySelector('meta[name="bsi-api-url"]')?.content || (localPreview ? 'http://localhost:3001' : window.location.origin)).replace(/\/+$/, '');
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith(API) && !url.startsWith('/api/')) return originalFetch(input, init);
  const headers = new Headers(init.headers || {});
  const token = localStorage.getItem('smeAccessToken');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return originalFetch(input, { ...init, headers }).then(response => {
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The API returned a webpage instead of JSON. Restart the backend and confirm the app is using the backend URL.');
    return response;
  });
};

const $ = id => document.getElementById(id);
const escapeHtml = value => { const span = document.createElement('span'); span.textContent = value ?? ''; return span.innerHTML; };
const currencyRates = window.BSI_CURRENCY_RATES;
const savedCurrency = localStorage.getItem('smeCurrency');
const state = { accountType: '', authRole: 'business', authMode: 'signin', selectedBusiness: null, pendingBusinessId: '', chatRequestId: '', chatPoll: null, chatCount: -1, currency: Object.hasOwn(currencyRates, savedCurrency) ? savedCurrency : 'USD' };
let directoryData = [];
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: state.currency, maximumFractionDigits: 2 }).format((Number(value) || 0) * currencyRates[state.currency]);
let supabaseClientPromise;
const authDialog = $('authDialog');
const businessDialog = $('businessDialog');
const requestsPanel = $('requestsPanel');

function safeImage(value) {
  const url = String(value || '');
  return /^https:\/\//i.test(url) || /^data:image\/(png|jpeg|webp);base64,/i.test(url) ? url : 'assets/bsi-logo.svg?v=5';
}

function lineSvg(series, width = 520, height = 150) {
  const points = (series || []).map(row => Number(row.netProfit) || 0);
  if (points.length < 2 || points.every(value => value === 0)) return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="No profit or loss trend reported"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#98a2b3" font-size="12">No trend reported</text></svg>`;
  const min = Math.min(0, ...points), max = Math.max(0, ...points), range = max - min || 1;
  const padX = 6, padY = 9;
  const xy = points.map((value, index) => ({ x: padX + index * (width - padX * 2) / (points.length - 1), y: padY + (max - value) * (height - padY * 2) / range, value }));
  const zeroY = padY + (max - 0) * (height - padY * 2) / range;
  const segments = xy.slice(1).map((point, index) => {
    const previous = xy[index];
    const color = value => value < 0 ? '#d92d20' : '#16845b';
    if (previous.value * point.value < 0) {
      const fraction = previous.value / (previous.value - point.value);
      const crossX = previous.x + (point.x - previous.x) * fraction;
      return `<path d="M${previous.x.toFixed(1)},${previous.y.toFixed(1)} L${crossX.toFixed(1)},${zeroY.toFixed(1)}" fill="none" stroke="${color(previous.value)}" stroke-width="3" stroke-linecap="round"/><path d="M${crossX.toFixed(1)},${zeroY.toFixed(1)} L${point.x.toFixed(1)},${point.y.toFixed(1)}" fill="none" stroke="${color(point.value)}" stroke-width="3" stroke-linecap="round"/>`;
    }
    const value = previous.value || point.value;
    return `<path d="M${previous.x.toFixed(1)},${previous.y.toFixed(1)} L${point.x.toFixed(1)},${point.y.toFixed(1)}" fill="none" stroke="${value ? color(value) : '#98a2b3'}" stroke-width="3" stroke-linecap="round"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly net result: green is profit and red is loss"><line x1="0" y1="${zeroY.toFixed(1)}" x2="${width}" y2="${zeroY.toFixed(1)}" stroke="#e4e7ec" stroke-dasharray="4 5"/>${segments}</svg>`;
}

function statusFor(business) {
  if (!business.hasRecords) return { label: 'No report yet', className: 'status-neutral' };
  const latest = [...(business.series || [])].reverse().find(month => Number(month.recordCount) > 0);
  if (latest?.netProfit > 0) return { label: 'Profit', className: 'status-profit', period: latest.label };
  if (latest?.netProfit < 0) return { label: 'Loss', className: 'status-loss', period: latest.label };
  return { label: 'Break-even', className: 'status-neutral' };
}

function renderDirectory(businesses) {
  directoryData = businesses;
  const grid = $('businessGrid');
  if (!businesses.length) {
    grid.innerHTML = '<div class="directory-empty"><strong>No public business profiles yet.</strong><span>Business owners can publish their profile from the business workspace.</span></div>';
    $('directoryMessage').textContent = 'No businesses are published yet. Business owners: open Business workspace → Business profile, enable “Show my business on the public homepage”, then save. Investors: refresh this page after the business publishes.';
    return;
  }
  $('directoryMessage').textContent = `${businesses.length} public ${businesses.length === 1 ? 'business' : 'businesses'} · 12-month reported sales and profit status`;
  grid.innerHTML = businesses.map(business => {
    const status = statusFor(business);
    const sharesAvailable = Math.max(0, Number(business.shares_available) || 0);
    const sharePrice = Number(business.share_price) || 0;
    const price = sharesAvailable > 0 ? `${sharesAvailable.toLocaleString()} shares available${sharePrice > 0 ? ` · ${money(sharePrice)} each` : ' · price not set'}` : 'No shares listed';
    return `<article class="business-card"><div class="business-card-head"><div class="business-avatar">${business.photo ? `<img src="${escapeHtml(safeImage(business.photo))}" alt="">` : escapeHtml((business.name || 'B').slice(0, 1).toUpperCase())}</div><div class="business-card-title"><h3>${escapeHtml(business.name)}</h3><small>Business profile</small></div><span class="business-status ${status.className}" title="${status.period ? `Based on latest recorded month: ${escapeHtml(status.period)}` : 'Based on the latest available record'}">${status.label}</span></div><div class="business-card-metrics"><div><small>Reported sales · 12 months</small><strong>${business.hasRecords ? money(business.totalSales) : '—'}</strong></div><div><small>Net result · 12 months</small><strong class="${business.totalProfit < 0 ? 'loss-text' : business.totalProfit > 0 ? 'profit-text' : ''}">${business.hasRecords ? money(business.totalProfit) : '—'}</strong></div></div><div class="mini-chart">${lineSvg(business.series, 360, 48)}</div><div class="business-card-footer"><small>${escapeHtml(price)}</small><button class="outline-button" type="button" data-open-business="${escapeHtml(business.id)}">View profile</button></div></article>`;
  }).join('');
  grid.querySelectorAll('[data-open-business]').forEach(button => button.addEventListener('click', () => openBusiness(button.dataset.openBusiness)));
}

async function loadDirectory() {
  $('directoryMessage').textContent = 'Loading public business profiles…';
  try {
    const response = await fetch(`${API}/api/public/businesses`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Directory could not be loaded.');
    renderDirectory(result.businesses || []);
  } catch (error) {
    $('directoryMessage').textContent = error.message;
    $('businessGrid').innerHTML = '<div class="directory-empty"><strong>Business reports are unavailable.</strong><span>Start the backend and configure Supabase to load the directory.</span></div>';
  }
}

function openAuth(role = 'business', mode = 'signin') {
  role = 'business';
  state.authRole = role; state.authMode = mode;
  $('modeSignIn').classList.toggle('selected', mode === 'signin');
  $('modeSignUp').classList.toggle('selected', mode === 'signup');
  $('businessNameField').hidden = role !== 'business' || mode !== 'signup';
  $('businessName').required = role === 'business' && mode === 'signup';
  $('authTitle').textContent = mode === 'signup' ? 'Create an account' : 'Sign in';
  $('authSubtitle').textContent = mode === 'signup' ? (role === 'business' ? 'Create a business account.' : 'Create an investor account.') : 'Sign in to continue. Your account type will be recognized automatically.';
  $('submitAuth').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
  $('authMessage').textContent = '';
  if (!authDialog.open) authDialog.showModal();
}

async function getSupabaseBrowserClient() {
  if (!supabaseClientPromise) supabaseClientPromise = (async () => {
    const response = await originalFetch(`${API}/api/config/public`, { cache: 'no-store' });
    const config = await response.json();
    if (!response.ok || !config.supabaseUrl || !config.publishableKey) throw new Error('Google sign-in is not configured yet. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to backend/.env, then restart the backend.');
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    return createClient(config.supabaseUrl, config.publishableKey, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } });
  })();
  return supabaseClientPromise;
}

async function startGoogleAuth() {
  const role = state.authRole;
  const mode = state.authMode;
  const businessName = $('businessName').value.trim();
  const fullName = '';
  if (mode === 'signup' && role === 'business' && !businessName) { $('authMessage').textContent = 'Enter your business name before continuing with Google.'; $('businessName').focus(); return; }
  sessionStorage.setItem('smeGoogleAuth', JSON.stringify({ accountType: role, mode, businessName, fullName }));
  try {
    $('googleAuthButton').disabled = true;
    $('authMessage').textContent = 'Connecting to Google…';
    if (window.location.protocol === 'file:') throw new Error('Open the app from its HTTP address, such as http://localhost:3001, before connecting Google.');
    const client = await getSupabaseBrowserClient();
    await client.auth.signOut({ scope: 'local' });
    const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/home.html?oauth=complete`, skipBrowserRedirect: true } });
    if (error) throw error;
    if (!data?.url) throw new Error('Google did not return an authorization page. Check that Google is enabled in Supabase Auth.');
    window.location.assign(data.url);
  } catch (error) {
    $('authMessage').textContent = error.message || 'Google sign-in could not be started.';
    $('authMessage').style.color = '#b42318';
    $('googleAuthButton').disabled = false;
  }
}

async function completeGoogleAuth() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('error_description')) throw new Error(params.get('error_description'));
  const pending = JSON.parse(sessionStorage.getItem('smeGoogleAuth') || '{}');
  const role = pending.accountType === 'investor' ? 'investor' : 'business';
  const client = await getSupabaseBrowserClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const session = data.session;
  if (!session?.access_token) throw new Error('Google did not return a session. Please try again.');
  const response = await originalFetch(`${API}/api/auth/oauth/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ accountType: pending.mode === 'signin' ? '' : role, businessName: pending.businessName || '', fullName: pending.fullName || '' }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not finish Google sign-in.');
  localStorage.setItem('smeAccessToken', result.accessToken);
  localStorage.setItem('smeAccountEmail', result.email);
  localStorage.setItem('smeAccountType', result.accountType);
  localStorage.setItem('smeSignedIn', 'true');
  sessionStorage.removeItem('smeGoogleAuth');
  params.delete('oauth');
  window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}${window.location.hash}`);
  if (result.accountType === 'business') {
    const returnTo = sessionStorage.getItem('smeReturnTo');
    sessionStorage.removeItem('smeReturnTo');
    if (returnTo && /^(analytics|records|profile|billing|connections)\.html(?:\?.*)?$/.test(returnTo)) { window.location.replace(returnTo); return; }
    await updateAccountActions(result.businessName || result.email);
    return;
  }
  state.accountType = 'investor';
  await updateAccountActions(result.fullName || result.email);
  await loadShareRequests();
  document.querySelector('#directory').scrollIntoView({ behavior: 'smooth' });
}

async function submitAuth(event) {
  event.preventDefault();
  const submit = $('submitAuth');
  const email = $('authEmail').value.trim().toLowerCase();
  const password = $('authPassword').value;
  const endpoint = state.authMode === 'signup' ? '/api/auth/register' : '/api/auth/login';
  const body = { email, password, accountType: state.authRole };
  if (state.authMode === 'signup') {
    body.businessName = $('businessName').value.trim();
  }
  try {
    submit.disabled = true; $('authMessage').textContent = state.authMode === 'signup' ? 'Creating your account…' : 'Signing in…';
    const response = await fetch(`${API}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Authentication failed.');
    localStorage.setItem('smeAccessToken', result.accessToken);
    localStorage.setItem('smeAccountEmail', result.email);
    localStorage.setItem('smeAccountType', result.accountType);
    localStorage.setItem('smeSignedIn', 'true');
    authDialog.close();
    if (result.accountType === 'business') {
      const returnTo = sessionStorage.getItem('smeReturnTo');
      if (returnTo && /^(analytics|records|profile|billing|connections)\.html(?:\?.*)?$/.test(returnTo)) { sessionStorage.removeItem('smeReturnTo'); window.location.assign(returnTo); }
      else { sessionStorage.removeItem('smeReturnTo'); authDialog.close(); await updateAccountActions(result.businessName || result.email); }
      return;
    }
    state.accountType = 'investor';
    await updateAccountActions(result.fullName || result.email);
    await loadShareRequests();
    document.querySelector('#directory').scrollIntoView({ behavior: 'smooth' });
    if (state.pendingBusinessId) await openBusiness(state.pendingBusinessId);
  } catch (error) {
    $('authMessage').textContent = error.message;
    $('authMessage').style.color = '#b42318';
  } finally { submit.disabled = false; }
}

async function updateAccountActions(name) {
  state.accountType = localStorage.getItem('smeAccountType') || '';
  const signedIn = Boolean(localStorage.getItem('smeAccessToken'));
  $('guestActions').hidden = signedIn;
  $('accountActions').hidden = !signedIn;
  $('accountGreeting').textContent = signedIn ? `Hi, ${name || localStorage.getItem('smeAccountEmail') || 'there'}` : '';
  $('businessRequests').hidden = state.accountType !== 'business';
  $('viewBusinesses').hidden = state.accountType !== 'investor';
  $('myRequests').hidden = state.accountType !== 'investor';
}

async function loadShareRequests() {
  if (state.accountType !== 'investor') return;
  try {
    const response = await fetch(`${API}/api/investor/share-requests`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load requests.');
    const requests = result.requests || [];
    $('requestList').innerHTML = requests.length ? `<div class="request-list">${requests.map(request => `<div class="share-request-row"><div><strong>${escapeHtml(request.businessName)}</strong><small>${Number(request.shares).toLocaleString()} shares requested · ${money(request.pricePerShare)} each · ${escapeHtml(request.status)}</small></div><button class="outline-button" type="button" data-open-chat="${escapeHtml(request.id)}" data-chat-label="${escapeHtml(request.businessName)}">Chat with business</button></div>`).join('')}</div>` : '<p class="directory-message">You have not sent any share requests.</p>';
    $('requestList').querySelectorAll('[data-open-chat]').forEach(button => button.addEventListener('click', () => openShareChat(button.dataset.openChat, button.dataset.chatLabel)));
  } catch (error) { $('requestList').innerHTML = `<p class="directory-message">${escapeHtml(error.message)}</p>`; }
}

async function loadBusinessRequests() {
  if (state.accountType !== 'business') return;
  try {
    const response = await fetch(`${API}/api/business/share-requests`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Incoming requests could not be loaded.');
    const requests = result.requests || [];
    $('businessRequests').textContent = requests.length ? `Incoming share requests (${requests.length})` : 'Incoming share requests';
    $('businessRequestList').innerHTML = requests.length ? requests.map(request => `<div class="share-request-row"><div><strong>${escapeHtml(request.investorEmail)}</strong><small>${Number(request.shares).toLocaleString()} shares · ${money(request.pricePerShare)} each · ${escapeHtml(request.status)}</small></div><button class="outline-button" type="button" data-open-chat="${escapeHtml(request.id)}" data-chat-label="${escapeHtml(request.investorEmail)}">Open chat</button></div>`).join('') : '<p class="directory-message">No investors have sent a share request yet.</p>';
    $('businessRequestList').querySelectorAll('[data-open-chat]').forEach(button => button.addEventListener('click', () => openShareChat(button.dataset.openChat, button.dataset.chatLabel)));
  } catch (error) { $('businessRequests').textContent = 'Incoming share requests'; $('businessRequestList').innerHTML = `<p class="directory-message">${escapeHtml(error.message)}</p>`; }
}

async function refreshShareChat() {
  if (!state.chatRequestId) return;
  try {
    const response = await fetch(`${API}/api/share-requests/${encodeURIComponent(state.chatRequestId)}/messages`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Chat could not be loaded.');
    const messages = result.messages || [];
    if (messages.length !== state.chatCount) {
      const container = $('shareChatMessages');
      container.innerHTML = messages.map(item => `<div class="share-chat-message${item.mine ? ' mine' : ''}">${escapeHtml(item.message)}<small>${new Date(item.createdAt).toLocaleString()}</small></div>`).join('') || '<p class="directory-message">Send a message to start the conversation.</p>';
      container.scrollTop = container.scrollHeight;
      state.chatCount = messages.length;
    }
    $('shareChatNotice').textContent = '';
  } catch (error) { $('shareChatNotice').textContent = error.message; }
}

async function openShareChat(requestId, label) {
  state.chatRequestId = requestId; state.chatCount = -1;
  $('shareChatTitle').textContent = `Chat · ${label}`;
  $('shareChatMessages').innerHTML = '<p class="directory-message">Loading conversation…</p>';
  $('shareChatNotice').textContent = '';
  $('shareChatDialog').showModal();
  await refreshShareChat();
  if (state.chatPoll) clearInterval(state.chatPoll);
  state.chatPoll = setInterval(() => { if (state.chatRequestId && $('shareChatDialog').open && !document.hidden) refreshShareChat(); }, 2000);
}

async function openBusiness(id) {
  state.pendingBusinessId = id;
  try {
    const response = await fetch(`${API}/api/public/businesses/${encodeURIComponent(id)}`, { cache: 'no-store' });
    const business = await response.json();
    if (!response.ok) throw new Error(business.error || 'Business profile could not be loaded.');
    state.selectedBusiness = business;
    renderBusinessDetail(business);
    if (!businessDialog.open) businessDialog.showModal();
  } catch (error) {
    $('directoryMessage').textContent = error.message;
    document.querySelector('#directory').scrollIntoView({ behavior: 'smooth' });
  }
}

function renderBusinessDetail(business) {
  const status = statusFor(business);
  const series = business.series || [];
  const links = Object.entries(business.links || {}).filter(([, url]) => /^https:\/\//i.test(String(url || '')));
  const awards = Array.isArray(business.awards) ? business.awards : [];
  const sharesAvailable = Math.max(0, Number(business.shares_available) || 0);
  const sharePrice = Number(business.share_price) || 0;
  const sharesListed = sharesAvailable > 0;
  const canRequestShares = sharesListed && sharePrice > 0;
  $('businessDetail').innerHTML = `<div class="business-detail-head"><div class="business-avatar"><img src="${escapeHtml(safeImage(business.photo))}" alt=""></div><div><span class="business-status ${status.className}" title="${status.period ? `Based on latest recorded month: ${escapeHtml(status.period)}` : 'Based on latest available record'}">${status.label}</span><h2 id="businessDialogTitle">${escapeHtml(business.name)}</h2><p>Public business profile and 12-month report</p></div></div><p class="business-detail-bio">${escapeHtml(business.bio || 'This business has not added a profile description.')}</p><div class="detail-metrics"><article><small>Reported sales</small><strong>${business.hasRecords ? money(business.totalSales) : 'No report'}</strong></article><article><small>Net result (output minus capital used)</small><strong class="${business.totalProfit < 0 ? 'loss-text' : business.totalProfit > 0 ? 'profit-text' : ''}">${business.hasRecords ? money(business.totalProfit) : 'No report'}</strong></article><article><small>Share availability</small><strong>${sharesListed ? Number(business.shares_available).toLocaleString() : 'Not listed'}</strong></article></div><div class="report-chart">${lineSvg(series)}<div class="report-labels"><span>${escapeHtml(series[0]?.label || '')}</span><span>Green: profit · Red: loss</span><span>${escapeHtml(series[series.length - 1]?.label || '')}</span></div></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Month</th><th>Sales</th><th>Net result</th></tr></thead><tbody>${series.filter(row => row.recordCount > 0).map(row => `<tr><td>${escapeHtml(row.label)}</td><td>${money(row.sales)}</td><td class="${row.netProfit < 0 ? 'loss-text' : row.netProfit > 0 ? 'profit-text' : ''}">${money(row.netProfit)}</td></tr>`).join('') || '<tr><td colspan="3">No monthly records have been published.</td></tr>'}</tbody></table></div>${links.length ? `<div class="profile-links">${links.map(([label, url]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`).join('')}</div>` : ''}${awards.length ? `<div class="profile-awards"><h3>Recognition</h3>${awards.map(award => `<p><strong>${escapeHtml(award.title)}</strong> <small>${escapeHtml(award.detail)}</small></p>`).join('')}</div>` : ''}<section class="share-request-box"><h3>Share request</h3>${sharesListed ? `<p>${money(business.share_price)} per share · ${Number(business.shares_available).toLocaleString()} listed. Submit a request to contact the business about a potential purchase.</p><form id="shareRequestForm" class="share-request-form"><label>Number of shares<input id="requestedShares" type="number" min="1" max="${Number(business.shares_available)}" step="1" required value="1"></label><button class="primary-button" type="submit">Request to buy</button></form><p id="shareRequestMessage" class="share-request-notice" aria-live="polite">A request is not a purchase or reservation. No payment is taken and no shares are transferred here.</p>` : '<p>This business has not listed shares for requests.</p>'}</section>`;
  const detailMetrics = document.querySelector('.detail-metrics');
  if (detailMetrics) {
    const availability = detailMetrics.lastElementChild;
    if (availability) {
      availability.querySelector('small').textContent = 'Shares available';
      availability.querySelector('strong').textContent = sharesAvailable.toLocaleString();
    }
    const priceMetric = document.createElement('article');
    priceMetric.innerHTML = `<small>Price per share</small><strong>${sharePrice > 0 ? escapeHtml(money(sharePrice)) : 'Not set'}</strong>`;
    detailMetrics.append(priceMetric);
  }
  if (sharesListed && !canRequestShares) {
    document.querySelector('#shareRequestForm')?.remove();
    document.querySelector('#shareRequestMessage')?.remove();
    const availabilityNote = document.querySelector('.share-request-box > p');
    if (availabilityNote) availabilityNote.textContent = `${sharesAvailable.toLocaleString()} shares are available. The business needs to set a share price before investors can submit requests.`;
  }
  if (canRequestShares) {
    const requestShortcut = document.createElement('button');
    requestShortcut.type = 'button';
    requestShortcut.className = 'primary-button profile-share-shortcut';
    requestShortcut.textContent = 'Request shares';
    requestShortcut.addEventListener('click', () => document.querySelector('.share-request-box')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    document.querySelector('.business-detail-head')?.append(requestShortcut);
  }
  const form = $('shareRequestForm');
  if (form) form.addEventListener('submit', submitShareRequest);
}

async function submitShareRequest(event) {
  event.preventDefault();
  if (state.accountType !== 'investor') {
    businessDialog.close();
    openAuth('investor', 'signin');
    return;
  }
  const message = $('shareRequestMessage');
  const button = event.submitter;
  try {
    button.disabled = true; message.textContent = 'Sending request…';
    const response = await fetch(`${API}/api/investor/share-requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId: state.selectedBusiness.id, shares: Number($('requestedShares').value) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Share request could not be submitted.');
    message.textContent = result.notice;
    await loadShareRequests();
  } catch (error) { message.textContent = error.message; message.style.color = '#b42318'; }
  finally { button.disabled = false; }
}

async function initializeHome() {
  $('marketCurrency').value = state.currency;
  $('marketCurrency').addEventListener('change', event => {
    state.currency = Object.hasOwn(currencyRates, event.target.value) ? event.target.value : 'USD';
    localStorage.setItem('smeCurrency', state.currency);
    renderDirectory(directoryData);
    if (state.selectedBusiness) renderBusinessDetail(state.selectedBusiness);
    if (state.accountType === 'investor') loadShareRequests();
  });
  $('signInButton').addEventListener('click', () => openAuth('business', 'signin'));
  $('createAccountButton').addEventListener('click', () => openAuth('business', 'signup'));
  $('modeSignIn').addEventListener('click', () => openAuth(state.authRole, 'signin'));
  $('modeSignUp').addEventListener('click', () => openAuth(state.authRole, 'signup'));
  $('authForm').addEventListener('submit', submitAuth);
  $('googleAuthButton').addEventListener('click', startGoogleAuth);
  $('closeAuth').addEventListener('click', () => authDialog.close());
  $('closeBusiness').addEventListener('click', () => businessDialog.close());
  $('refreshDirectory').addEventListener('click', loadDirectory);
  $('viewBusinesses').addEventListener('click', () => document.querySelector('#directory').scrollIntoView({ behavior: 'smooth' }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadDirectory(); });
  window.setInterval(() => { if (!document.hidden) loadDirectory(); }, 5000);
  $('signOut').addEventListener('click', () => { ['smeSignedIn','smeAccountEmail','smeAccessToken','smeAccountType'].forEach(key => localStorage.removeItem(key)); state.accountType = ''; updateAccountActions(); });
  $('myRequests').addEventListener('click', async () => { await loadShareRequests(); requestsPanel.showModal(); });
  $('closeRequests').addEventListener('click', () => requestsPanel.close());
  $('businessRequests').addEventListener('click', async () => { await loadBusinessRequests(); $('businessRequestsPanel').showModal(); });
  $('closeBusinessRequests').addEventListener('click', () => $('businessRequestsPanel').close());
  $('closeShareChat').addEventListener('click', () => $('shareChatDialog').close());
  $('shareChatDialog').addEventListener('close', () => { if (state.chatPoll) clearInterval(state.chatPoll); state.chatPoll = null; state.chatRequestId = ''; });
  $('shareChatForm').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('shareChatInput'), button = event.submitter, message = input.value.trim();
    if (!message || !state.chatRequestId) return;
    try {
      button.disabled = true; $('shareChatNotice').textContent = 'Sending…';
      const response = await fetch(`${API}/api/share-requests/${encodeURIComponent(state.chatRequestId)}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Message could not be sent.');
      input.value = ''; state.chatCount = -1; await refreshShareChat();
    } catch (error) { $('shareChatNotice').textContent = error.message; }
    finally { button.disabled = false; }
  });
  document.querySelectorAll('a[href="index.html"]').forEach(link => link.addEventListener('click', event => { if (localStorage.getItem('smeAccountType') !== 'business') { event.preventDefault(); openAuth('business'); } }));
  await loadDirectory();
  window.setInterval(() => {
    if (document.hidden) return;
    if (state.accountType === 'business') loadBusinessRequests();
    if (state.accountType === 'investor' && requestsPanel.open) loadShareRequests();
  }, 5000);
  if (new URLSearchParams(window.location.search).get('oauth') === 'complete') {
    const pendingRole = JSON.parse(sessionStorage.getItem('smeGoogleAuth') || '{}').accountType;
    try { await completeGoogleAuth(); }
    catch (error) { sessionStorage.removeItem('smeGoogleAuth'); openAuth(pendingRole === 'investor' ? 'investor' : 'business'); $('authMessage').textContent = error.message; $('authMessage').style.color = '#b42318'; }
  }
  const requestedRole = new URLSearchParams(window.location.search).get('role');
  if (new URLSearchParams(window.location.search).has('signIn')) { openAuth(requestedRole === 'investor' ? 'investor' : 'business'); }
  const token = localStorage.getItem('smeAccessToken');
  if (token) {
    state.accountType = localStorage.getItem('smeAccountType') || '';
    try {
      if (state.accountType === 'investor') await fetch(`${API}/api/investor/share-requests`, { cache: 'no-store' }).then(response => { if (!response.ok) throw new Error(); return response.json(); });
      else {
        const response = await fetch(`${API}/api/profile`, { cache: 'no-store' });
        if (!response.ok) throw new Error();
        const profile = await response.json(); state.accountType = 'business'; localStorage.setItem('smeAccountType', 'business');
        await updateAccountActions(profile.name || localStorage.getItem('smeAccountEmail'));
        await loadBusinessRequests();
        if (new URLSearchParams(window.location.search).get('ownerRequests') === '1') $('businessRequestsPanel').showModal();
        return;
      }
      await updateAccountActions(localStorage.getItem('smeAccountEmail'));
      await loadShareRequests();
    } catch {
      ['smeSignedIn','smeAccountEmail','smeAccessToken','smeAccountType'].forEach(key => localStorage.removeItem(key));
      state.accountType = ''; await updateAccountActions();
    }
  }
}

initializeHome();
