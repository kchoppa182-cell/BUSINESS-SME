// Supports both http://localhost:3001 and opening index.html directly from the file system.
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
let currentPeriod = 'month';
let revenueChart;
let roiChart;
let selectedCurrency = localStorage.getItem('smeCurrency') || 'USD';
let subscriptionActive = false;
let selectedPaymentMethod = 'card';
let selectedIndicator = 'revenue';
let latestMetricsData = [];
let authMode = 'signin';
// Records are stored in USD. Fixed display rates ensure the selected currency is used consistently.
const DISPLAY_RATES = window.BSI_CURRENCY_RATES;

function startNetworkBackground() {
  const canvas = document.getElementById('networkCanvas');
  const context = canvas.getContext('2d');
  const pointer = { x: -1000, y: -1000, active: false };
  const symbols = ['$', '€', '£', '¥', 'KSh', '₹'];
  let dots = [];
  let width = 0;
  let height = 0;

  function resize() {
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth; height = window.innerHeight;
    canvas.width = width * scale; canvas.height = height * scale;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    const count = Math.max(38, Math.min(95, Math.floor(width * height / 18000)));
    dots = Array.from({ length: count }, () => ({
      x: Math.random() * width, y: Math.random() * height,
      vx: (Math.random() - .5) * .22, vy: (Math.random() - .5) * .22,
      radius: 1.3 + Math.random() * 1.8, symbol: symbols[Math.floor(Math.random() * symbols.length)]
    }));
  }

  function draw() {
    context.clearRect(0, 0, width, height);
    const connectionDistance = 145;
    dots.forEach(dot => {
      dot.x += dot.vx; dot.y += dot.vy;
      if (dot.x < -10 || dot.x > width + 10) dot.vx *= -1;
      if (dot.y < -10 || dot.y > height + 10) dot.vy *= -1;
    });
    for (let i = 0; i < dots.length; i += 1) {
      for (let j = i + 1; j < dots.length; j += 1) {
        const first = dots[i]; const second = dots[j];
        const dx = first.x - second.x; const dy = first.y - second.y; const distance = Math.hypot(dx, dy);
        if (distance < connectionDistance) {
          context.beginPath(); context.moveTo(first.x, first.y); context.lineTo(second.x, second.y);
          context.strokeStyle = `rgba(29, 119, 207, ${.05 + (1 - distance / connectionDistance) * .17})`;
          context.lineWidth = .7; context.stroke();
        }
      }
    }
    dots.forEach(dot => {
      const x = dot.x; const y = dot.y;
      const distance = Math.hypot(x - pointer.x, y - pointer.y);
      const isCurrency = pointer.active && distance < 100;
      if (isCurrency) {
        const strength = 1 - distance / 100;
        context.font = `600 ${11 + strength * 6}px Inter, Segoe UI, Arial, sans-serif`;
        context.textAlign = 'center'; context.textBaseline = 'middle';
        context.fillStyle = `rgba(23, 105, 224, ${.55 + strength * .45})`;
        context.fillText(dot.symbol, x, y);
      } else {
        context.beginPath(); context.arc(x, y, dot.radius, 0, Math.PI * 2);
        context.fillStyle = 'rgba(23, 105, 224, .52)'; context.fill();
      }
    });
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', event => {
    pointer.x = event.clientX; pointer.y = event.clientY; pointer.active = true;
  });
  window.addEventListener('pointerleave', () => { pointer.active = false; });
  resize(); draw();
}

const $ = id => document.getElementById(id);
const ui = {
  revenue: $('revenueValue'), capital: $('capitalValue'), profit: $('profitValue'), products: $('productsValue'),
  roiChartValue: $('roiChartValue'), profitSub: $('profitSub'), revenueSub: $('revenueSub'), capitalSub: $('capitalSub'), productsSub: $('productsSub'), lastUpdated: $('lastUpdated'),
  insights: $('insights'), productList: $('productList'), form: $('recordForm'), message: $('formMessage'),
  date: $('date'), sales: $('sales'), capitalInput: $('capital'), output: $('output'), productsInput: $('products'),
  dialog: $('connectionDialog'), connectionForm: $('connectionForm'), connectionStatus: $('connectionStatus'),
  serverUrl: $('serverUrl'), interval: $('interval'), loginDialog: $('loginDialog'), currency: $('currencySelect'),
  profileForm: $('profileForm'), profileName: $('profileName'), profileBio: $('profileBio'), profilePhoto: $('profilePhoto'),
  profilePhotoPreview: $('profilePhotoPreview'), storeLink: $('storeLink'), instagramLink: $('instagramLink'), linkedinLink: $('linkedinLink'), facebookLink: $('facebookLink'), publicListing: $('publicListing'), sharePrice: $('sharePrice'), sharesAvailable: $('sharesAvailable'),
  awardsFields: $('awardsFields'), teamFields: $('teamFields'), profileMessage: $('profileMessage'),
  startSubscription: $('startSubscription'), billingMessage: $('billingMessage'), mpesaPhone: $('mpesaPhone'), mpesaPhoneLabel: $('mpesaPhoneLabel'), periodFrom: $('periodFrom'), periodTo: $('periodTo')
};

function clearDashboardValues() {
  ui.revenue.textContent = money(0); ui.capital.textContent = money(0); ui.profit.textContent = money(0); ui.products.textContent = '0';
  ui.roiChartValue.textContent = '0%'; ui.profit.style.color = '#111111';
  latestMetricsData = [];
  if (revenueChart) { revenueChart.data.labels = []; revenueChart.data.datasets.forEach(dataset => { dataset.data = []; }); revenueChart.update(); }
  if (roiChart) { roiChart.data.labels = []; roiChart.data.datasets.forEach(dataset => { dataset.data = []; }); roiChart.update(); }
}

const convertFromUsd = value => (Number(value) || 0) * (DISPLAY_RATES[selectedCurrency] || 1);
const convertToUsd = value => (Number(value) || 0) / (DISPLAY_RATES[selectedCurrency] || 1);
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: selectedCurrency, maximumFractionDigits: 2 }).format(convertFromUsd(value));
const escapeHtml = value => { const element = document.createElement('span'); element.textContent = value; return element.innerHTML; };
const intervalText = value => ({ hourly: 'every hour', weekly: 'every week', monthly: 'every month', yearly: 'every year' }[value] || 'on schedule');
const normaliseLink = value => {
  const trimmed = value.trim();
  return trimmed && !/^https?:\/\//i.test(trimmed) ? `https://${trimmed}` : trimmed;
};

function chartOptions(percent = false) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { boxWidth: 8, usePointStyle: true, color: '#637387' } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#7d8c9b', maxTicksLimit: 6 } },
      y: { grid: { color: '#edf0f4' }, ticks: { color: '#7d8c9b', callback: value => percent ? `${value}%` : new Intl.NumberFormat('en-US', { style: 'currency', currency: selectedCurrency, notation: 'compact', maximumFractionDigits: 1 }).format(value) } }
    }
  };
}

function createCharts() {
  revenueChart = new Chart($('revenueChart'), {
    type: 'line',
    data: { labels: [], datasets: [
      { label: 'Revenue', data: [], borderColor: '#111111', backgroundColor: 'rgba(0,0,0,.08)', fill: true, tension: .35, pointRadius: 0, borderWidth: 2 },
      { label: 'Capital used', data: [], borderColor: '#777777', tension: .35, pointRadius: 0, borderWidth: 2, borderDash: [5, 4] }
    ] }, options: chartOptions()
  });
  roiChart = new Chart($('roiChart'), {
    type: 'bar', data: { labels: [], datasets: [{ label: 'Return on capital', data: [], backgroundColor: '#222222', borderRadius: 4 }] },
    options: { ...chartOptions(true), plugins: { legend: { display: false } } }
  });
}

function chartLabels(data) {
  return data.map(item => item.label || (currentPeriod === 'live' ? `${String(item.hour || 0).padStart(2, '0')}:00` : new Date(`${item.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })));
}

function movingAverage(values, windowSize = 3) {
  return values.map((value, index) => {
    const sample = values.slice(Math.max(0, index - windowSize + 1), index + 1);
    return Math.round(sample.reduce((total, item) => total + item, 0) / sample.length);
  });
}

function updateBusinessMonitor() {
  if (!latestMetricsData.length || !revenueChart) return;
  const labels = chartLabels(latestMetricsData);
  const revenue = latestMetricsData.map(item => convertFromUsd(item.sales));
  const capital = latestMetricsData.map(item => convertFromUsd(item.cashInvested));
  const netOutput = latestMetricsData.map(item => convertFromUsd((item.cashEarned || 0) - (item.cashInvested || 0)));
  const roi = latestMetricsData.map(item => item.performance || 0);
  const average = movingAverage(revenue);
  const descriptions = {
    revenue: ['Revenue and capital', 'Revenue compared with capital used.', [{ label: 'Revenue', data: revenue, borderColor: '#111', backgroundColor: 'rgba(0,0,0,.08)', fill: true }, { label: 'Capital used', data: capital, borderColor: '#777', borderDash: [5, 4] }], false],
    capital: ['Capital usage', 'Capital deployed over the selected reporting period.', [{ label: 'Capital used', data: capital, borderColor: '#111', backgroundColor: 'rgba(0,0,0,.08)', fill: true }], false],
    profit: ['Profit and loss', 'Net result is output earned minus capital used. Green is profit; red is loss.', [{ label: 'Net result', data: netOutput, borderColor: '#16845b', segment: { borderColor: context => (context.p0.parsed.y + context.p1.parsed.y) / 2 < 0 ? '#d92d20' : '#16845b' }, pointBackgroundColor: context => context.parsed.y < 0 ? '#d92d20' : '#16845b', backgroundColor: 'rgba(22,132,91,.10)', fill: { target: 'origin', above: 'rgba(22,132,91,.12)', below: 'rgba(217,45,32,.12)' } }], false],
    roi: ['Net return on capital', 'ROI is net result divided by capital used. Positive is profit; negative is loss.', [{ label: 'Net ROI', data: roi, borderColor: '#16845b', segment: { borderColor: context => (context.p0.parsed.y + context.p1.parsed.y) / 2 < 0 ? '#d92d20' : '#16845b' }, pointBackgroundColor: context => context.parsed.y < 0 ? '#d92d20' : '#16845b', backgroundColor: 'rgba(22,132,91,.10)', fill: { target: 'origin', above: 'rgba(22,132,91,.12)', below: 'rgba(217,45,32,.12)' } }], true],
    average: ['Revenue moving average', 'A 3-period moving average smooths short-term revenue movement.', [{ label: 'Revenue', data: revenue, borderColor: '#999', borderDash: [4, 3] }, { label: '3-period average', data: average, borderColor: '#111', backgroundColor: 'rgba(0,0,0,.08)', fill: true }], false],
    band: ['Business trend band', 'A moving average with upper and lower business-performance bands.', [{ label: 'Upper band', data: average.map(value => Math.round(value * 1.15)), borderColor: '#999', borderDash: [3, 3] }, { label: 'Moving average', data: average, borderColor: '#111', backgroundColor: 'rgba(0,0,0,.08)', fill: true }, { label: 'Lower band', data: average.map(value => Math.round(value * .85)), borderColor: '#999', borderDash: [3, 3] }], false]
  };
  const [title, subtitle, datasets, percentage] = descriptions[selectedIndicator];
  $('monitorTitle').textContent = title; $('monitorSubtitle').textContent = subtitle; $('indicatorDescription').textContent = subtitle;
  revenueChart.data.labels = labels;
  revenueChart.data.datasets = datasets.map(dataset => ({ tension: .35, pointRadius: 0, borderWidth: 2, ...dataset }));
  revenueChart.options.scales.y.ticks.callback = value => percentage ? `${value}%` : new Intl.NumberFormat('en-US', { style: 'currency', currency: selectedCurrency, notation: 'compact', maximumFractionDigits: 1 }).format(value);
  revenueChart.update();
}

function renderProducts(items) {
  ui.productList.innerHTML = items.map((item, index) => `<div class="product"><span class="product-rank">${String(index + 1).padStart(2, '0')}</span><div><strong>${escapeHtml(item.name)}</strong><small>${Number(item.units || 0).toLocaleString()} units sold</small></div><span class="product-revenue">${money(item.revenue)}</span></div>`).join('');
}

function renderMarketItems(elementId, items, icon, leader = false) {
  $(elementId).innerHTML = items.map(item => `<div class="market-item${leader ? ' leader' : ''}">${leader ? '' : `<span class="market-icon">${icon}</span>`}<div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.detail)}</small></div></div>`).join('');
}

const defaultAvatar = 'assets/bsi-logo.svg?v=5';
let profilePhotoData = '';
function addAwardRow(award = {}) {
  const row = document.createElement('div'); row.className = 'repeat-row';
  row.innerHTML = `<label>Award<input class="award-title" maxlength="100" placeholder="e.g. SME of the Year" value="${escapeHtml(award.title || '')}"></label><label>Year / issuer<input class="award-detail" maxlength="100" placeholder="e.g. 2026 · Chamber of Commerce" value="${escapeHtml(award.detail || '')}"></label><button class="remove-row" type="button" aria-label="Remove award">x</button>`;
  row.querySelector('.remove-row').addEventListener('click', () => row.remove()); ui.awardsFields.append(row);
}
function addTeamRow(member = {}) {
  const row = document.createElement('div'); row.className = 'repeat-row team-row';
  row.innerHTML = `<label>Name<input class="team-name" maxlength="80" placeholder="Full name" value="${escapeHtml(member.name || '')}"></label><label>Role<input class="team-role" maxlength="80" placeholder="Role" value="${escapeHtml(member.role || '')}"></label><label>Profile link<input class="team-link" type="url" placeholder="https://..." value="${escapeHtml(member.link || '')}"></label><button class="remove-row" type="button" aria-label="Remove team member">x</button>`;
  row.querySelector('.remove-row').addEventListener('click', () => row.remove()); ui.teamFields.append(row);
}
function profileRows(selector, keys) {
  return [...document.querySelectorAll(selector)].map(row => Object.fromEntries(keys.map(key => [key, row.querySelector(`.${key}`).value.trim()]))).filter(item => Object.values(item).some(Boolean));
}
function showProfile(profile) {
  ui.profileName.value = profile.name || 'Your Business'; ui.profileBio.value = profile.bio || '';
  ui.storeLink.value = profile.links?.store || ''; ui.instagramLink.value = profile.links?.instagram || ''; ui.linkedinLink.value = profile.links?.linkedin || ''; ui.facebookLink.value = profile.links?.facebook || '';
  ui.publicListing.checked = Boolean(profile.publicListing); ui.sharePrice.value = Number(profile.sharePrice || 0); ui.sharesAvailable.value = Number(profile.sharesAvailable || 0);
  profilePhotoData = profile.photo || ''; ui.profilePhotoPreview.src = profilePhotoData || defaultAvatar;
  ui.awardsFields.innerHTML = ''; ui.teamFields.innerHTML = '';
  (profile.awards?.length ? profile.awards : [{}]).forEach(addAwardRow);
  (profile.team?.length ? profile.team : [{}]).forEach(addTeamRow);
}
async function loadProfile() {
  try { const response = await fetch(`${API}/api/profile`, { cache: 'no-store' }); if (!response.ok) throw new Error('Profile not available'); showProfile(await response.json()); }
  catch (error) { console.error('Profile load failed:', error); showProfile({}); }
}

async function loadBilling() {
  try {
    const response = await fetch(`${API}/api/billing`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Billing unavailable');
    const billing = await response.json();
    ui.startSubscription.disabled = !billing.checkoutEnabled;
    ui.billingMessage.style.color = billing.checkoutEnabled ? '#1caa72' : '#718096';
    ui.billingMessage.textContent = billing.checkoutEnabled ? 'Secure checkout is ready.' : 'Checkout will be enabled after the Stripe Payment Link is configured.';
  } catch (error) { ui.startSubscription.disabled = true; ui.billingMessage.style.color = '#cc3f4d'; ui.billingMessage.textContent = 'Billing service is unavailable.'; }
}

async function checkSubscription() {
  const email = localStorage.getItem('smeAccountEmail');
  if (!email) { subscriptionActive = false; return false; }
  try {
    const response = await fetch(`${API}/api/billing/status?email=${encodeURIComponent(email)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Subscription status unavailable');
    const status = await response.json(); subscriptionActive = Boolean(status.active);
  } catch (error) { subscriptionActive = false; }
  return subscriptionActive;
}

async function loadMarketIntelligence() {
  try {
    const [response, requestsResponse] = await Promise.all([fetch(`${API}/api/market-intelligence`, { cache: 'no-store' }), fetch(`${API}/api/business/share-requests`, { cache: 'no-store' })]);
    if (!response.ok) throw new Error('Market intelligence request failed');
    const market = await response.json();
    const requestData = requestsResponse.ok ? await requestsResponse.json() : { requests: [] };
    const incoming = (requestData.requests || []).map(request => ({ name: request.investorEmail, detail: `${request.shares} shares requested · ${request.status}` }));
    $('investorCount').textContent = incoming.length;
    renderMarketItems('investorList', incoming, '$');
    renderMarketItems('shareholderList', market.shareholders, '%');
    renderMarketItems('competitorList', market.competitors, '!');
    renderMarketItems('leaderList', market.leaders, '', true);
  } catch (error) {
    console.error('Market intelligence failed:', error);
    $('investorList').innerHTML = '<small>Market intelligence is unavailable.</small>';
  }
}

async function refreshDashboard() {
  try {
    const [metricsResponse, insightsResponse, productsResponse] = await Promise.all([
      fetch(`${API}/api/metrics?${dashboardPeriodQuery()}`, { cache: 'no-store' }),
      fetch(`${API}/api/insights?${dashboardPeriodQuery()}`, { cache: 'no-store' }),
      fetch(`${API}/api/products?period=${currentPeriod}`, { cache: 'no-store' })
    ]);
    if (![metricsResponse, insightsResponse, productsResponse].every(response => response.ok)) throw new Error('One or more analytics requests failed');
    const [metrics, intelligence, products] = await Promise.all([metricsResponse.json(), insightsResponse.json(), productsResponse.json()]);
    const { summary, data } = metrics;
    ui.revenue.textContent = money(summary.totalSales); ui.capital.textContent = money(summary.totalInvested);
    ui.profit.textContent = money(summary.netCash); ui.products.textContent = Number(summary.productsSold || 0).toLocaleString();
    ui.profit.style.color = !summary.hasRecords ? '#111111' : summary.netCash < 0 ? '#d92d20' : summary.netCash > 0 ? '#16845b' : '#667085';
    const periodNames = { live: 'the current day (24 hours)', week: 'the current month (4 weeks)', month: 'the current year (12 months)', year: 'the current year and five years back', custom: `${ui.periodFrom.value} to ${ui.periodTo.value}` };
    const periodLabels = { live: 'today', week: 'this month', month: 'year to date', year: 'the last six years', custom: `${ui.periodFrom.value} to ${ui.periodTo.value}` };
    $('revenueLabel').textContent = currentPeriod === 'custom' ? 'Revenue for selected dates' : currentPeriod === 'year' ? 'Six-year revenue' : currentPeriod === 'month' ? 'Year-to-date revenue' : 'Revenue';
    ui.revenueSub.textContent = `Sales for ${periodNames[currentPeriod]}`;
    ui.capitalSub.textContent = `Capital used ${periodLabels[currentPeriod]}`;
    ui.productsSub.textContent = `Products sold ${periodLabels[currentPeriod]}`;
    ui.profitSub.textContent = !summary.hasRecords ? `No records ${periodLabels[currentPeriod]}` : summary.netCash < 0 ? `Loss ${periodLabels[currentPeriod]} · output minus capital` : summary.netCash > 0 ? `Profit ${periodLabels[currentPeriod]} · output minus capital` : `Break-even ${periodLabels[currentPeriod]} · output equals capital`;
    ui.roiChartValue.textContent = `${summary.avgPerformance}% net return on capital`;
    ui.lastUpdated.textContent = `Updated ${new Date(metrics.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const labels = chartLabels(data);
    latestMetricsData = data; updateBusinessMonitor();
    roiChart.data.labels = labels; roiChart.data.datasets[0].data = data.map(item => item.performance); roiChart.data.datasets[0].backgroundColor = data.map(item => item.performance < 0 ? '#d92d20' : item.performance > 0 ? '#16845b' : '#98a2b3'); roiChart.update();
    ui.insights.innerHTML = intelligence.insights.map(item => `<div class="insight">${escapeHtml(item)}</div>`).join('');
    renderProducts(products.products || []);
  } catch (error) {
    console.error('Dashboard refresh failed:', error);
    clearDashboardValues();
    ui.lastUpdated.textContent = 'Analytics server unavailable';
    ui.insights.innerHTML = '<p>Start the backend server, then refresh this page.</p>';
  }
}

document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-period]').forEach(item => item.classList.remove('selected'));
  button.classList.add('selected'); currentPeriod = button.dataset.period; refreshDashboard();
}));
function dashboardPeriodQuery() {
  const params = new URLSearchParams({ period: currentPeriod });
  if (currentPeriod === 'custom') { params.set('from', ui.periodFrom.value); params.set('to', ui.periodTo.value); }
  return params.toString();
}
$('applyPeriod').addEventListener('click', () => {
  if (!ui.periodFrom.value || !ui.periodTo.value || ui.periodFrom.value > ui.periodTo.value) {
    ui.lastUpdated.textContent = 'Choose a valid start and end date'; return;
  }
  document.querySelectorAll('[data-period]').forEach(item => item.classList.remove('selected'));
  currentPeriod = 'custom'; refreshDashboard();
});
$('refresh').addEventListener('click', refreshDashboard);
$('refreshMarket').addEventListener('click', loadMarketIntelligence);
document.querySelectorAll('[data-indicator]').forEach(button => button.addEventListener('click', () => {
  selectedIndicator = button.dataset.indicator;
  document.querySelectorAll('[data-indicator]').forEach(item => item.classList.toggle('selected', item === button));
  updateBusinessMonitor();
}));
$('startSubscription').addEventListener('click', async () => {
  try {
    ui.startSubscription.disabled = true; ui.billingMessage.style.color = '#31506b'; ui.billingMessage.textContent = 'Opening secure checkout...';
    const email = localStorage.getItem('smeAccountEmail');
    const response = await fetch(`${API}/api/billing/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, paymentMethod: selectedPaymentMethod, mpesaPhone: ui.mpesaPhone.value.trim() }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Checkout is not available.');
    window.location.assign(result.checkoutUrl);
  } catch (error) { ui.startSubscription.disabled = false; ui.billingMessage.style.color = '#cc3f4d'; ui.billingMessage.textContent = error.message; }
});
document.querySelectorAll('[data-payment-method]').forEach(button => button.addEventListener('click', () => {
  selectedPaymentMethod = button.dataset.paymentMethod;
  document.querySelectorAll('[data-payment-method]').forEach(item => { const chosen = item === button; item.classList.toggle('selected', chosen); item.setAttribute('aria-pressed', String(chosen)); });
  ui.mpesaPhoneLabel.classList.toggle('visible', selectedPaymentMethod === 'mpesa');
}));
$('addAward').addEventListener('click', () => addAwardRow());
$('addTeamMember').addEventListener('click', () => addTeamRow());
ui.profilePhoto.addEventListener('change', event => {
  const [file] = event.target.files;
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { ui.profileMessage.style.color = '#cc3f4d'; ui.profileMessage.textContent = 'Choose an image smaller than 2 MB.'; event.target.value = ''; return; }
  const reader = new FileReader();
  reader.addEventListener('load', () => { profilePhotoData = reader.result; ui.profilePhotoPreview.src = profilePhotoData; });
  reader.readAsDataURL(file);
});
$('publishBusiness').addEventListener('click', async event => {
  const button = event.currentTarget, message = $('publishMessage');
  try {
    button.disabled = true; message.style.color = '#31506b'; message.textContent = 'Publishing your business…';
    const response = await fetch(`${API}/api/profile/publish`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Business could not be published.');
    ui.publicListing.checked = true; message.style.color = '#16845b'; message.textContent = result.message;
  } catch (error) { message.style.color = '#b42318'; message.textContent = error.message; }
  finally { button.disabled = false; }
});
ui.profileForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!ui.profileName.value.trim()) { ui.profileMessage.style.color = '#cc3f4d'; ui.profileMessage.textContent = 'Add your business name before saving.'; ui.profileName.focus(); return; }
  const awards = [...document.querySelectorAll('#awardsFields .repeat-row')].map(row => ({ title: row.querySelector('.award-title').value.trim(), detail: row.querySelector('.award-detail').value.trim() })).filter(item => item.title || item.detail);
  const team = [...document.querySelectorAll('#teamFields .repeat-row')].map(row => ({ name: row.querySelector('.team-name').value.trim(), role: row.querySelector('.team-role').value.trim(), link: row.querySelector('.team-link').value.trim() })).filter(item => item.name || item.role || item.link);
  const profile = { name: ui.profileName.value.trim(), bio: ui.profileBio.value.trim(), photo: profilePhotoData, links: { store: normaliseLink(ui.storeLink.value), instagram: normaliseLink(ui.instagramLink.value), linkedin: normaliseLink(ui.linkedinLink.value), facebook: normaliseLink(ui.facebookLink.value) }, awards, team, publicListing: ui.publicListing.checked, sharePrice: Number(ui.sharePrice.value || 0), sharesAvailable: Number(ui.sharesAvailable.value || 0) };
  const saveButtons = [...document.querySelectorAll('[form="profileForm"], #profileForm button[type="submit"]')];
  try {
    saveButtons.forEach(button => { button.disabled = true; }); ui.profileMessage.style.color = '#31506b'; ui.profileMessage.textContent = 'Saving profile...';
    const response = await fetch(`${API}/api/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
    const savedProfile = await response.json();
    if (!response.ok) throw new Error(savedProfile.error || 'Profile not saved');
    showProfile(savedProfile); ui.profileMessage.style.color = '#1caa72'; ui.profileMessage.textContent = 'Business profile saved successfully.';
  } catch (error) { ui.profileMessage.style.color = '#cc3f4d'; ui.profileMessage.textContent = error.message || 'Could not save the profile. Confirm the analytics server is running.'; }
  finally { saveButtons.forEach(button => { button.disabled = false; }); }
});
ui.currency.value = selectedCurrency;
ui.currency.addEventListener('change', event => {
  selectedCurrency = event.target.value;
  localStorage.setItem('smeCurrency', selectedCurrency);
  document.querySelectorAll('.record-currency').forEach(label => { label.textContent = selectedCurrency; });
  ui.revenue.textContent = money(0); ui.capital.textContent = money(0); ui.profit.textContent = money(0);
  refreshDashboard();
});
ui.form.addEventListener('submit', async event => {
  event.preventDefault();
  const sales = convertToUsd(ui.sales.value);
  const capital = convertToUsd(ui.capitalInput.value);
  const output = convertToUsd(ui.output.value);
  const productsSold = Number(ui.productsInput.value);
  const record = { date: ui.date.value, sales, cashInvested: capital, cashEarned: output, productsSold };
  try {
    const response = await fetch(`${API}/api/records`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) });
    if (!response.ok) throw new Error('Record was not saved');
    ui.message.style.color = '#31506b'; ui.message.textContent = 'Record saved. Updating dashboard...';
    ui.form.reset(); ui.date.valueAsDate = new Date();
    await refreshDashboard();
    ui.message.style.color = output < capital ? '#cc3f4d' : '#1caa72';
    ui.message.textContent = `Saved this entry: sales ${money(sales)}, capital ${money(capital)}, net ${money(output - capital)}, ${productsSold} products. Dashboard totals include all records in the selected period.`;
  } catch (error) { ui.message.style.color = '#cc3f4d'; ui.message.textContent = 'Could not save the record. Please start the analytics server.'; }
});
$('openConnection').addEventListener('click', () => ui.dialog.showModal());
ui.connectionForm.addEventListener('submit', event => {
  event.preventDefault();
  const connection = { url: ui.serverUrl.value, interval: ui.interval.value };
  localStorage.setItem('smeConnection', JSON.stringify(connection)); ui.connectionStatus.textContent = `Connected - refreshes ${intervalText(connection.interval)}`; ui.dialog.close();
});
$('signOut').addEventListener('click', () => { localStorage.removeItem('smeSignedIn'); localStorage.removeItem('smeAccountEmail'); localStorage.removeItem('smeAccessToken'); localStorage.removeItem('smeAccountType'); subscriptionActive = false; document.body.classList.add('auth-locked'); setAuthMode('signin'); if (!ui.loginDialog.open) ui.loginDialog.showModal(); });
function setAuthMode(mode) {
  authMode = mode;
  $('signInTab').classList.toggle('selected', mode === 'signin'); $('signUpTab').classList.toggle('selected', mode === 'signup');
  $('businessNameLabel').classList.toggle('visible', mode === 'signup'); $('businessName').required = mode === 'signup';
  $('authTitle').textContent = mode === 'signup' ? 'Create your business account' : 'Welcome back';
  $('authDescription').textContent = mode === 'signup' ? 'Create an account to access your business workspace.' : 'Sign in to continue to your business workspace.';
  $('submitAuth').textContent = mode === 'signup' ? 'Create account' : 'Sign in'; $('authMessage').textContent = '';
}
$('signInTab').addEventListener('click', () => setAuthMode('signin'));
$('signUpTab').addEventListener('click', () => setAuthMode('signup'));
$('googleSignIn').addEventListener('click', () => { sessionStorage.setItem('smeReturnTo', `${window.location.pathname.split('/').pop()}${window.location.search}`); window.location.assign('home.html?signIn=1&role=business'); });
$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const email = $('loginEmail').value.trim().toLowerCase(); const password = $('loginPassword').value; const submit = $('submitAuth');
  try {
    submit.disabled = true; $('authMessage').style.color = '#31506b'; $('authMessage').textContent = authMode === 'signup' ? 'Creating account...' : 'Signing in...';
    const endpoint = authMode === 'signup' ? '/api/auth/register' : '/api/auth/login';
    const body = authMode === 'signup' ? { email, password, businessName: $('businessName').value.trim() } : { email, password, accountType: 'business' };
    const response = await fetch(`${API}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not complete sign-in.');
    localStorage.setItem('smeSignedIn', 'true'); localStorage.setItem('smeAccountEmail', result.email); localStorage.setItem('smeAccessToken', result.accessToken); localStorage.setItem('smeAccountType', result.accountType || 'business');
    const returnTo = sessionStorage.getItem('smeReturnTo');
    if (returnTo && /^(analytics|records|profile|billing|connections)\.html(?:\?.*)?$/.test(returnTo)) { sessionStorage.removeItem('smeReturnTo'); window.location.replace(returnTo); return; }
    sessionStorage.removeItem('smeReturnTo'); ui.loginDialog.close(); initializeAccess();
  } catch (error) { $('authMessage').style.color = '#cc3f4d'; $('authMessage').textContent = error.message; }
  finally { submit.disabled = false; }
});
function setMenuOpen(isOpen) {
  document.querySelector('.sidebar').classList.toggle('open', isOpen);
  document.querySelector('.menu-button').setAttribute('aria-expanded', String(isOpen));
  $('menuOverlay').classList.toggle('visible', isOpen);
  $('menuOverlay').setAttribute('aria-hidden', String(!isOpen));
}
document.querySelector('.menu-button').addEventListener('click', () => setMenuOpen(!document.querySelector('.sidebar').classList.contains('open')));
$('menuExit').addEventListener('click', () => setMenuOpen(false));
$('menuOverlay').addEventListener('click', () => setMenuOpen(false));
$('closeConnection').addEventListener('click', () => ui.dialog.close());
$('backButton').addEventListener('click', () => {
  if (window.history.length > 1) window.history.back();
  else window.location.hash = 'dashboard';
});
const navigationLinks = [...document.querySelectorAll('.sidebar nav a')];
function setActiveNavigation(link) {
  navigationLinks.forEach(item => item.classList.toggle('active', item === link));
}
const pageNames = { dashboard: 'Business overview', analytics: 'Analytics', records: 'Add business records', profile: 'Business profile', billing: 'Billing and subscription', connections: 'Data connections' };
const requestedPage = new URLSearchParams(window.location.search).get('page');
const activePage = Object.hasOwn(pageNames, requestedPage) ? requestedPage : 'dashboard';
const pageViews = { dashboard: document.querySelector('.page-dashboard'), analytics: $('analytics'), records: $('records'), profile: $('profile'), billing: $('billing'), connections: $('connections') };
function renderPage(page) {
  const allowedPage = page;
  Object.entries(pageViews).forEach(([name, element]) => element.classList.toggle('page-view-hidden', name !== allowedPage));
  document.querySelector('header h1').textContent = pageNames[allowedPage];
  setActiveNavigation(navigationLinks.find(link => link.dataset.page === allowedPage));
  navigationLinks.forEach(link => { link.style.opacity = '1'; });
}
async function initializeAccess() {
  const token = localStorage.getItem('smeAccessToken');
  if (token && localStorage.getItem('smeAccountType') === 'investor') { window.location.replace('home.html'); return; }
  if (!token) {
    document.body.classList.add('auth-locked'); setAuthMode('signin');
    if (!ui.loginDialog.open) ui.loginDialog.showModal();
    return;
  }
  clearDashboardValues();
  let profile;
  try {
    const response = await fetch(`${API}/api/profile`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not verify your sign-in.');
    profile = result;
  } catch (error) {
    localStorage.removeItem('smeSignedIn'); localStorage.removeItem('smeAccountEmail'); localStorage.removeItem('smeAccessToken');
    document.body.classList.add('auth-locked'); setAuthMode('signin');
    $('authMessage').style.color = '#b42318'; $('authMessage').textContent = 'Please sign in again. ' + error.message;
    if (!ui.loginDialog.open) ui.loginDialog.showModal();
    return;
  }
  document.body.classList.remove('auth-locked');
  localStorage.setItem('smeAccountType', 'business');
  if (profile.name) { const businessName = document.querySelector('.company strong'); if (businessName) businessName.textContent = profile.name; }
  refreshDashboard(); loadMarketIntelligence(); loadProfile(); loadBilling();
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id'); const email = localStorage.getItem('smeAccountEmail');
  if (params.get('checkout') === 'success' && sessionId && email) {
    try { const response = await fetch(`${API}/api/billing/verify?email=${encodeURIComponent(email)}&sessionId=${encodeURIComponent(sessionId)}`); if (!response.ok) throw new Error(); } catch (error) { console.error('Checkout verification failed:', error); }
  }
  await checkSubscription();
  renderPage(activePage);
  if (!subscriptionActive) { ui.billingMessage.style.color = '#31506b'; ui.billingMessage.textContent = 'Your account is active. Subscription checkout will be available when billing is configured.'; }
}
ui.loginDialog.addEventListener('cancel', event => { if (document.body.classList.contains('auth-locked')) event.preventDefault(); });
navigationLinks.forEach(link => link.addEventListener('click', () => setMenuOpen(false)));
const savedConnection = JSON.parse(localStorage.getItem('smeConnection') || 'null');
if (savedConnection) ui.connectionStatus.textContent = `Connected - refreshes ${intervalText(savedConnection.interval)}`;
document.querySelectorAll('.record-currency').forEach(label => { label.textContent = selectedCurrency; });
startNetworkBackground();
ui.revenue.textContent = money(0); ui.capital.textContent = money(0); ui.profit.textContent = money(0);
ui.date.valueAsDate = new Date(); createCharts();
initializeAccess();
window.addEventListener('storage', event => { if (event.key === 'smeRecordsUpdated' && localStorage.getItem('smeAccessToken')) refreshDashboard(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && localStorage.getItem('smeAccessToken')) refreshDashboard(); });
setInterval(() => { if (localStorage.getItem('smeAccessToken') && !document.hidden) refreshDashboard(); }, 5 * 1000);
setInterval(() => { if (localStorage.getItem('smeAccessToken') && localStorage.getItem('smeAccountType') === 'business' && !document.hidden) loadMarketIntelligence(); }, 5 * 1000);
