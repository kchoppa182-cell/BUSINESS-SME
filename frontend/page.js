// Live Server can serve the HTML on another port, while the API always runs on 3001.
const localPreview = window.location.protocol === 'file:' || (['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port !== '3001');
const API = String(window.BSI_API_URL || document.querySelector('meta[name="bsi-api-url"]')?.content || (localPreview ? 'http://localhost:3001' : window.location.origin)).replace(/\/+$/, '');
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith(API) && !url.startsWith('/api/')) return originalFetch(input, init);
  const headers = new Headers(init.headers || {}); const accessToken = localStorage.getItem('smeAccessToken');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  return originalFetch(input, { ...init, headers }).then(response => {
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The API returned a webpage instead of JSON. Restart the backend and confirm the app is using the backend URL.');
    return response;
  });
};
const page = document.body.dataset.page;
const $ = id => document.getElementById(id);
const rates = window.BSI_CURRENCY_RATES;
let currency = localStorage.getItem('smeCurrency') || 'USD';
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format((Number(value) || 0) * rates[currency]);
const escapeHtml = value => { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; };

function setupNavigation() {
  const menu = document.querySelector('.menu-button'); const sidebar = document.querySelector('.sidebar'); const overlay = document.querySelector('.menu-overlay');
  const close = () => { sidebar.classList.remove('open'); overlay.classList.remove('visible'); menu.setAttribute('aria-expanded', 'false'); };
  menu.addEventListener('click', () => { const open = !sidebar.classList.contains('open'); sidebar.classList.toggle('open', open); overlay.classList.toggle('visible', open); menu.setAttribute('aria-expanded', String(open)); });
  document.querySelector('.menu-exit').addEventListener('click', close); overlay.addEventListener('click', close);
  document.querySelectorAll('.sidebar nav a').forEach(link => link.classList.toggle('active', link.dataset.page === page));
  document.querySelector('.back-button').addEventListener('click', () => window.history.length > 1 ? window.history.back() : window.location.assign('index.html'));
  $('signOut').addEventListener('click', () => { ['smeSignedIn','smeAccountEmail','smeAccessToken','smeAccountType'].forEach(key => localStorage.removeItem(key)); window.location.assign('home.html'); });
}

function applyMistizenBrand() {
  document.querySelectorAll('.logo').forEach(logo => {
    const image = logo.querySelector('img'); const name = logo.querySelector('span');
    if (image) { image.src = 'assets/bsi-logo.svg?v=5'; image.alt = ''; image.classList.add('mistizen-mark'); }
    if (name) { name.textContent = 'MISTIZEN'; name.className = 'brand-name'; }
    logo.setAttribute('aria-label', 'MISTIZEN dashboard');
  });
}

function setupCurrency(onChange) {
  const select = $('currencySelect'); if (!select) return;
  select.value = currency;
  select.addEventListener('change', event => { currency = event.target.value; localStorage.setItem('smeCurrency', currency); document.querySelectorAll('.record-currency').forEach(item => { item.textContent = currency; }); onChange?.(); });
  document.querySelectorAll('.record-currency').forEach(item => { item.textContent = currency; });
}

async function setupRecords() {
  if (page !== 'records') return;
  const date = $('date'); date.valueAsDate = new Date();
  $('recordForm').addEventListener('submit', async event => {
    event.preventDefault(); const toUsd = value => (Number(value) || 0) / rates[currency]; const message = $('formMessage');
    const record = { date: date.value, sales: toUsd($('sales').value), cashInvested: toUsd($('capital').value), cashEarned: toUsd($('output').value), productsSold: Number($('products').value) };
    try { const response = await fetch(`${API}/api/records`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) }); const responseText = await response.text(); let result = {}; try { result = responseText ? JSON.parse(responseText) : {}; } catch { throw new Error('The server returned an invalid response. Restart the server and try again.'); } if (!response.ok) throw new Error(result.error || `Record was not saved (server error ${response.status}).`); localStorage.setItem('smeRecordsUpdated', String(Date.now())); $('recordForm').reset(); date.valueAsDate = new Date(); message.textContent = 'Record saved successfully. Dashboard and analytics will use the new record.'; message.style.color = '#1caa72'; }
    catch (error) { message.textContent = error.message; message.style.color = '#cc3f4d'; }
  });
}

function addRow(container, fields, values = {}, markDirty = () => {}) {
  const row = document.createElement('div'); row.className = `repeat-row${fields.length === 3 ? ' team-row' : ''}`;
  row.innerHTML = fields.map(field => `<label>${field.label}<input class="${field.className}" maxlength="100" placeholder="${field.placeholder}" value="${escapeHtml(values[field.key] || '')}"></label>`).join('') + '<button class="remove-row" type="button" aria-label="Remove row">x</button>';
  row.querySelector('.remove-row').addEventListener('click', () => { row.remove(); markDirty(); }); row.querySelectorAll('input').forEach(input => input.addEventListener('input', markDirty)); container.append(row);
}

async function setupProfile() {
  if (page !== 'profile') return;
  const fields = { name: $('profileName'), bio: $('profileBio'), store: $('storeLink'), instagram: $('instagramLink'), linkedin: $('linkedinLink'), facebook: $('facebookLink'), publicListing: $('publicListing'), sharePrice: $('sharePrice'), sharesAvailable: $('sharesAvailable') }; const awards = $('awardsFields'); const team = $('teamFields'); const message = $('profileMessage'); const saveButtons = [...document.querySelectorAll('[data-profile-save]')]; let photo = ''; let dirty = false;
  const setDirty = () => { dirty = true; saveButtons.forEach(button => { button.disabled = false; }); message.textContent = 'Unsaved changes.'; message.style.color = '#637387'; };
  const clearDirty = () => { dirty = false; saveButtons.forEach(button => { button.disabled = true; }); };
  const awardFields = [{ label: 'Award', key: 'title', className: 'award-title', placeholder: 'e.g. SME of the Year' }, { label: 'Year / issuer', key: 'detail', className: 'award-detail', placeholder: 'e.g. 2026' }];
  const teamFields = [{ label: 'Name', key: 'name', className: 'team-name', placeholder: 'Full name' }, { label: 'Role', key: 'role', className: 'team-role', placeholder: 'Role' }, { label: 'Profile link', key: 'link', className: 'team-link', placeholder: 'https://...' }];
  const show = profile => { fields.name.value = profile.name || 'Your Business'; fields.bio.value = profile.bio || ''; fields.store.value = profile.links?.store || ''; fields.instagram.value = profile.links?.instagram || ''; fields.linkedin.value = profile.links?.linkedin || ''; fields.facebook.value = profile.links?.facebook || ''; fields.publicListing.checked = Boolean(profile.publicListing); fields.sharePrice.value = Number(profile.sharePrice || 0); fields.sharesAvailable.value = Number(profile.sharesAvailable || 0); photo = profile.photo || ''; $('profilePhotoPreview').src = photo || 'assets/bsi-logo.svg?v=5'; awards.innerHTML = ''; team.innerHTML = ''; (profile.awards?.length ? profile.awards : [{}]).forEach(item => addRow(awards, awardFields, item, setDirty)); (profile.team?.length ? profile.team : [{}]).forEach(item => addRow(team, teamFields, item, setDirty)); clearDirty(); };
  try { const response = await fetch(`${API}/api/profile`, { cache: 'no-store' }); show(response.ok ? await response.json() : {}); } catch { show({}); }
  Object.values(fields).forEach(field => { field.addEventListener('input', setDirty); field.addEventListener('change', setDirty); }); $('addAward').addEventListener('click', () => { addRow(awards, awardFields, {}, setDirty); setDirty(); }); $('addTeamMember').addEventListener('click', () => { addRow(team, teamFields, {}, setDirty); setDirty(); });
  $('profilePhoto').addEventListener('change', event => { const [file] = event.target.files; if (!file) return; if (file.size > 2 * 1024 * 1024) { message.textContent = 'Choose an image smaller than 2 MB.'; message.style.color = '#cc3f4d'; return; } const reader = new FileReader(); reader.addEventListener('load', () => { photo = reader.result; $('profilePhotoPreview').src = photo; setDirty(); }); reader.readAsDataURL(file); });
  $('publishBusiness').addEventListener('click', async event => { const button = event.currentTarget, status = $('publishMessage'); try { button.disabled = true; status.textContent = 'Publishing your business…'; status.style.color = '#637387'; const response = await fetch(`${API}/api/profile/publish`, { method: 'POST' }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Business could not be published.'); fields.publicListing.checked = true; clearDirty(); status.textContent = result.message; status.style.color = '#16845b'; } catch (error) { status.textContent = error.message; status.style.color = '#cc3f4d'; } finally { button.disabled = false; } });
  $('profileForm').addEventListener('submit', async event => { event.preventDefault(); if (!dirty) return; if (!fields.name.value.trim()) { message.textContent = 'Add your business name before saving.'; message.style.color = '#cc3f4d'; fields.name.focus(); return; } const link = value => value.trim() && !/^https?:\/\//i.test(value.trim()) ? `https://${value.trim()}` : value.trim(); const profile = { name: fields.name.value.trim(), bio: fields.bio.value.trim(), photo, links: { store: link(fields.store.value), instagram: link(fields.instagram.value), linkedin: link(fields.linkedin.value), facebook: link(fields.facebook.value) }, awards: [...awards.children].map(row => ({ title: row.querySelector('.award-title').value.trim(), detail: row.querySelector('.award-detail').value.trim() })).filter(item => item.title || item.detail), team: [...team.children].map(row => ({ name: row.querySelector('.team-name').value.trim(), role: row.querySelector('.team-role').value.trim(), link: row.querySelector('.team-link').value.trim() })).filter(item => item.name || item.role || item.link) }; profile.publicListing = fields.publicListing.checked; profile.sharePrice = Number(fields.sharePrice.value || 0); profile.sharesAvailable = Number(fields.sharesAvailable.value || 0); try { saveButtons.forEach(button => { button.disabled = true; }); message.textContent = 'Saving profileâ€¦'; message.style.color = '#637387'; const response = await fetch(`${API}/api/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Profile was not saved'); show(result); message.textContent = 'Business profile saved successfully.'; message.style.color = '#1caa72'; } catch (error) { message.textContent = error.message; message.style.color = '#cc3f4d'; if (dirty) saveButtons.forEach(button => { button.disabled = false; }); } });
}

async function setupAnalytics() {
  if (page !== 'analytics') return;
  let salesCapitalChart; let netOutputChart;
  const draw = async () => { const period = $('analyticsPeriod').value; const message = $('analyticsMessage'); try { const response = await fetch(`${API}/api/metrics?period=${period}`, { cache: 'no-store' }); const result = await response.json(); if (!response.ok) throw new Error('Analytics are unavailable.'); const labels = result.data.map(item => item.label); const sales = result.data.map(item => item.sales * rates[currency]); const capital = result.data.map(item => item.cashInvested * rates[currency]); const netOutput = result.data.map(item => (item.cashEarned - item.cashInvested) * rates[currency]); $('analyticsSales').textContent = money(result.summary.totalSales); $('analyticsCapital').textContent = money(result.summary.totalInvested); $('analyticsNetOutput').textContent = money(result.summary.netCash); const base = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: value => money(value / rates[currency]) } } } }; salesCapitalChart?.destroy(); netOutputChart?.destroy(); salesCapitalChart = new Chart($('salesCapitalChart'), { type: 'bar', data: { labels, datasets: [{ label: 'Sales', data: sales, backgroundColor: '#1769e0', borderRadius: 5 }, { label: 'Capital used', data: capital, backgroundColor: '#a8b5c3', borderRadius: 5 }] }, options: base }); netOutputChart = new Chart($('netOutputChart'), { type: 'bar', data: { labels, datasets: [{ label: 'Net output', data: netOutput, backgroundColor: netOutput.map(value => value >= 0 ? '#1caa72' : '#cc3f4d'), borderRadius: 5 }] }, options: { ...base, plugins: { legend: { display: false } } } }); message.textContent = ''; } catch (error) { message.textContent = error.message; message.style.color = '#cc3f4d'; } };
  $('analyticsPeriod').addEventListener('change', draw); setupCurrency(draw); window.addEventListener('storage', event => { if (event.key === 'smeRecordsUpdated') draw(); }); document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); }); window.setInterval(() => { if (!document.hidden) draw(); }, 5000); await draw();
}

async function setupBilling() { if (page !== 'billing') return; let method = 'card'; document.querySelectorAll('[data-payment-method]').forEach(button => button.addEventListener('click', () => { method = button.dataset.paymentMethod; document.querySelectorAll('[data-payment-method]').forEach(item => item.classList.toggle('selected', item === button)); $('mpesaPhoneLabel').classList.toggle('visible', method === 'mpesa'); })); try { const response = await fetch(`${API}/api/billing`, { cache: 'no-store' }); const billing = await response.json(); $('startSubscription').disabled = !billing.checkoutEnabled; $('billingMessage').textContent = billing.checkoutEnabled ? 'Secure checkout is ready.' : 'Checkout will be enabled after the Stripe Payment Link is configured.'; } catch { $('startSubscription').disabled = true; $('billingMessage').textContent = 'Billing service is unavailable.'; } }
function setupConnections() { if (page !== 'connections') return; const saved = JSON.parse(localStorage.getItem('smeConnection') || 'null'); if (saved) $('connectionStatus').textContent = `Connected - refreshes ${saved.interval}`; $('openConnection').addEventListener('click', () => $('connectionDialog').showModal()); $('closeConnection').addEventListener('click', () => $('connectionDialog').close()); $('connectionForm').addEventListener('submit', event => { event.preventDefault(); localStorage.setItem('smeConnection', JSON.stringify({ url: $('serverUrl').value, interval: $('interval').value })); $('connectionStatus').textContent = `Connected - refreshes ${$('interval').value}`; $('connectionDialog').close(); }); }

async function initializePage() {
  const token = localStorage.getItem('smeAccessToken');
  const returnTo = `${window.location.pathname.split('/').pop()}${window.location.search}`;
  if (token && localStorage.getItem('smeAccountType') === 'investor') { window.location.replace('home.html'); return; }
  if (!token) {
    sessionStorage.setItem('smeReturnTo', returnTo);
    window.location.replace('home.html?signIn=1&role=business');
    return;
  }
  try {
    const response = await originalFetch(`${API}/api/profile`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Your sign-in has expired.');
    const profile = await response.json();
    const businessName = document.querySelector('.company strong');
    if (businessName && profile.name) businessName.textContent = profile.name;
  } catch {
    localStorage.removeItem('smeSignedIn'); localStorage.removeItem('smeAccountEmail'); localStorage.removeItem('smeAccessToken');
    sessionStorage.setItem('smeReturnTo', returnTo);
    window.location.replace('home.html?signIn=1&role=business');
    return;
  }
  localStorage.setItem('smeAccountType', 'business');
  document.documentElement.classList.remove('auth-pending');
applyMistizenBrand(); setupNavigation(); if (page !== 'analytics') setupCurrency(); setupRecords(); setupProfile(); setupBilling(); setupConnections(); setupAnalytics();
}
initializePage();


