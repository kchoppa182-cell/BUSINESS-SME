const app = require('./backend/server');

if (require.main === module && !process.env.VERCEL) {
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log(`SME Intelligence Platform running at http://localhost:${port}`));
}

module.exports = app;
