// When hosting the frontend separately, set this to the public backend URL.
// Leave blank when Express serves the frontend and API from the same origin.
window.BSI_API_URL = window.BSI_API_URL || '';
// Display rates are shared by the business dashboard and investor directory.
// Financial records remain stored in USD; these values only change presentation.
window.BSI_CURRENCY_RATES = window.BSI_CURRENCY_RATES || { USD: 1, KES: 130, EUR: .92, GBP: .79, UGX: 3700, TZS: 2600, ZAR: 18.2, NGN: 1600, INR: 84 };
