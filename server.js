const express = require('express');
const backendApp = require('./backend/server');
const app = express();

app.use(backendApp);

if (require.main === module && !process.env.VERCEL) {
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log(`SME Intelligence Platform running at http://localhost:${port}`));
}

module.exports = app;
