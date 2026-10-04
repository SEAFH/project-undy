// Chạy thử trên máy: npm run dev  (trên Vercel không dùng file này)
const path = require('path');
const express = require('express');
const api = require('./api/index.js');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(api);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Project Undy (beta) chạy tại http://localhost:${PORT}`));
