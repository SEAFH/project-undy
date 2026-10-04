const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');
const { attachDatabasePool } = require('@vercel/functions');

// Vercel + Neon tự thêm DATABASE_URL (hoặc POSTGRES_URL)
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || 'postgres://postgres:dev@127.0.0.1:5432/darkchat';
const ONLINE_MS = 25_000; // seen within this window -> online
const TYPING_MS = 4_000;

// reuse one pool across invocations (serverless)
let pool = global._darkchatPool;
if (!pool) {
  pool = global._darkchatPool = new Pool({ connectionString: DATABASE_URL, max: 5, idleTimeoutMillis: 5000 });
  attachDatabasePool(pool);
}
const query = (text, params) => pool.query(text, params);
const one = async (text, params) => (await query(text, params)).rows[0];
const all = async (text, params) => (await query(text, params)).rows;

let ready = global._darkchatReady;
function setupDb() {
  if (!ready) {
    ready = global._darkchatReady = query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        username_lower TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        pass_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        color TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        last_seen BIGINT NOT NULL DEFAULT 0,
        typing_to INTEGER,
        typing_at BIGINT NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS friendships (
        id SERIAL PRIMARY KEY,
        pair TEXT NOT NULL UNIQUE,
        requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_friend_req ON friendships (requester_id);
      CREATE INDEX IF NOT EXISTS idx_friend_addr ON friendships (addressee_id);
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        pair TEXT NOT NULL,
        sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        read_at BIGINT
      );
      CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages (pair, id);
      CREATE INDEX IF NOT EXISTS idx_msg_unread ON messages (receiver_id, sender_id) WHERE read_at IS NULL;
    `).catch((e) => {
      ready = global._darkchatReady = null;
      throw e;
    });
  }
  return ready;
}

const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const COLORS = ['#7c5cff', '#00c2a8', '#ff5c8a', '#ffb547', '#4da3ff', '#a3e635', '#f472b6', '#22d3ee'];
const hashPassword = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');
const isOnline = (u) => Date.now() - Number(u.last_seen) < ONLINE_MS;
const publicUser = (u) => u && { id: u.id, username: u.username, displayName: u.display_name, color: u.color };
const formatMessage = (m) => m && {
  id: m.id, from: m.sender_id, to: m.receiver_id, content: m.content,
  createdAt: Number(m.created_at), readAt: m.read_at == null ? null : Number(m.read_at),
};
const findUserByName = (username) => one('SELECT * FROM users WHERE username_lower = $1', [String(username).trim().toLowerCase()]);
const findFriendship = (a, b) => one('SELECT * FROM friendships WHERE pair = $1', [pairKey(a, b)]);
// ids from URLs; anything invalid becomes 0 (matches nothing)
const toId = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 2 ** 31 ? Number(v) : 0);

async function areFriends(a, b) {
  const f = await findFriendship(a, b);
  return !!f && f.status === 'accepted';
}

const app = express();
app.use(express.json({ limit: '50kb' }));

// wraps async route handlers so errors become 500 responses
const h = (fn) => (req, res, next) => setupDb().then(() => fn(req, res, next)).catch(next);

const auth = h(async (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const user = token && (await one('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1', [token]));
  if (!user) return res.status(401).json({ error: 'Chưa đăng nhập' });
  req.user = user;
  req.token = token;
  next();
});

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await query('INSERT INTO sessions (token, user_id, created_at) VALUES ($1, $2, $3)', [token, userId, Date.now()]);
  return token;
}

app.post('/api/register', h(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const displayName = String(req.body.displayName || '').trim() || username;
  const password = String(req.body.password || '');
  if (!/^[a-zA-Z0-9_.]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username 3-20 ký tự, chỉ gồm chữ, số, _ và .' });
  if (displayName.length > 32) return res.status(400).json({ error: 'Tên hiển thị tối đa 32 ký tự' });
  if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });
  if (req.body.confirmPassword !== undefined && String(req.body.confirmPassword) !== password) return res.status(400).json({ error: 'Mật khẩu xác nhận không khớp' });
  const salt = crypto.randomBytes(16).toString('hex');
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const now = Date.now();
  const user = await one(
    `INSERT INTO users (username, username_lower, display_name, pass_hash, salt, color, created_at, last_seen)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7) ON CONFLICT (username_lower) DO NOTHING RETURNING *`,
    [username, username.toLowerCase(), displayName, hashPassword(password, salt), salt, color, now],
  );
  if (!user) return res.status(409).json({ error: 'Username đã có người dùng' });
  res.json({ token: await createSession(user.id), user: publicUser(user) });
}));

app.post('/api/login', h(async (req, res) => {
  const user = await findUserByName(req.body.username || '');
  const password = String(req.body.password || '');
  if (!user) return res.status(401).json({ error: 'Sai username hoặc mật khẩu' });
  const ok = crypto.timingSafeEqual(Buffer.from(hashPassword(password, user.salt), 'hex'), Buffer.from(user.pass_hash, 'hex'));
  if (!ok) return res.status(401).json({ error: 'Sai username hoặc mật khẩu' });
  res.json({ token: await createSession(user.id), user: publicUser(user) });
}));

app.post('/api/logout', auth, h(async (req, res) => {
  await query('DELETE FROM sessions WHERE token = $1', [req.token]);
  await query('UPDATE users SET last_seen = 0 WHERE id = $1', [req.user.id]);
  res.json({ ok: true });
}));

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

async function buildRelations(userId) {
  const rows = await all(`
    SELECT f.status, f.requester_id, u.*,
      (SELECT COUNT(*)::int FROM messages m WHERE m.sender_id = u.id AND m.receiver_id = $1 AND m.read_at IS NULL) AS unread,
      lm.id AS lm_id, lm.sender_id AS lm_sender, lm.receiver_id AS lm_receiver, lm.content AS lm_content,
      lm.created_at AS lm_created, lm.read_at AS lm_read
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
    LEFT JOIN LATERAL (SELECT * FROM messages m WHERE m.pair = f.pair ORDER BY m.id DESC LIMIT 1) lm ON f.status = 'accepted'
    WHERE f.requester_id = $1 OR f.addressee_id = $1`, [userId]);
  const friends = [], incoming = [], outgoing = [], typing = [];
  for (const r of rows) {
    const u = { ...publicUser(r), online: isOnline(r) };
    if (r.status === 'accepted') {
      u.lastMessage = r.lm_id ? formatMessage({
        id: r.lm_id, sender_id: r.lm_sender, receiver_id: r.lm_receiver, content: r.lm_content, created_at: r.lm_created, read_at: r.lm_read,
      }) : null;
      u.unread = r.unread;
      friends.push(u);
      if (r.typing_to === userId && Date.now() - Number(r.typing_at) < TYPING_MS) typing.push(r.id);
    } else if (r.requester_id === userId) outgoing.push(u);
    else incoming.push(u);
  }
  friends.sort((a, b) => (b.lastMessage?.id || 0) - (a.lastMessage?.id || 0) || a.displayName.localeCompare(b.displayName));
  return { friends, incoming, outgoing, typing };
}

app.get('/api/friends', auth, h(async (req, res) => res.json(await buildRelations(req.user.id))));

// polled by the client every ~2s: marks user online, returns relations, typing,
// and for the open chat: new messages after `after`, current message ids (to detect deletes) and read state
app.get('/api/poll', auth, h(async (req, res) => {
  const me = req.user.id;
  await query('UPDATE users SET last_seen = $1 WHERE id = $2', [Date.now(), me]);
  const out = await buildRelations(me);
  const chat = toId(req.query.chat);
  if (chat && out.friends.some((f) => f.id === chat)) {
    const pair = pairKey(me, chat);
    const after = toId(req.query.after);
    const oldest = toId(req.query.oldest);
    const [fresh, ids, lastRead] = await Promise.all([
      all('SELECT * FROM messages WHERE pair = $1 AND id > $2 ORDER BY id LIMIT 200', [pair, after]),
      oldest ? all('SELECT id FROM messages WHERE pair = $1 AND id BETWEEN $2 AND $3', [pair, oldest, after]) : [],
      one('SELECT MAX(read_at) AS at FROM messages WHERE sender_id = $1 AND receiver_id = $2', [me, chat]),
    ]);
    out.chat = {
      id: chat,
      messages: fresh.map(formatMessage),
      ids: ids.map((m) => m.id),
      readAt: lastRead.at == null ? null : Number(lastRead.at),
    };
  }
  res.json(out);
}));

app.post('/api/friends/request', auth, h(async (req, res) => {
  const me = req.user.id;
  const target = await findUserByName(req.body.username || '');
  if (!target) return res.status(404).json({ error: 'Không tìm thấy người dùng này' });
  if (target.id === me) return res.status(400).json({ error: 'Không thể kết bạn với chính mình' });
  const existing = await findFriendship(me, target.id);
  if (existing) {
    if (existing.status === 'accepted') return res.status(409).json({ error: 'Hai bạn đã là bạn bè' });
    if (existing.requester_id === me) return res.status(409).json({ error: 'Bạn đã gửi lời mời rồi' });
    await query("UPDATE friendships SET status = 'accepted' WHERE id = $1", [existing.id]); // they already invited us -> accept
  } else {
    await query(
      "INSERT INTO friendships (pair, requester_id, addressee_id, status, created_at) VALUES ($1, $2, $3, 'pending', $4) ON CONFLICT (pair) DO NOTHING",
      [pairKey(me, target.id), me, target.id, Date.now()],
    );
  }
  res.json({ ok: true });
}));

app.post('/api/friends/:id/accept', auth, h(async (req, res) => {
  const { rowCount } = await query(
    "UPDATE friendships SET status = 'accepted' WHERE pair = $1 AND status = 'pending' AND addressee_id = $2",
    [pairKey(req.user.id, toId(req.params.id)), req.user.id],
  );
  if (!rowCount) return res.status(404).json({ error: 'Không có lời mời' });
  res.json({ ok: true });
}));

// decline / cancel / unfriend
app.delete('/api/friends/:id', auth, h(async (req, res) => {
  const { rowCount } = await query('DELETE FROM friendships WHERE pair = $1', [pairKey(req.user.id, toId(req.params.id))]);
  if (!rowCount) return res.status(404).json({ error: 'Không tìm thấy' });
  res.json({ ok: true });
}));

app.get('/api/messages/:id', auth, h(async (req, res) => {
  const other = toId(req.params.id);
  if (!(await areFriends(req.user.id, other))) return res.status(403).json({ error: 'Chỉ chat được với bạn bè' });
  const before = toId(req.query.before) || 2 ** 31 - 1;
  const rows = (await all('SELECT * FROM messages WHERE pair = $1 AND id < $2 ORDER BY id DESC LIMIT 50', [pairKey(req.user.id, other), before])).reverse();
  res.json({ messages: rows.map(formatMessage), hasMore: rows.length === 50 });
}));

app.post('/api/messages/:id', auth, h(async (req, res) => {
  const me = req.user.id;
  const to = toId(req.params.id);
  const content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Tin nhắn trống' });
  if (content.length > 2000) return res.status(400).json({ error: 'Tin nhắn tối đa 2000 ký tự' });
  if (!(await areFriends(me, to))) return res.status(403).json({ error: 'Chỉ chat được với bạn bè' });
  const msg = await one(
    'INSERT INTO messages (pair, sender_id, receiver_id, content, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [pairKey(me, to), me, to, content, Date.now()],
  );
  await query('UPDATE users SET typing_to = NULL WHERE id = $1', [me]);
  res.json({ message: formatMessage(msg) });
}));

app.post('/api/messages/:id/read', auth, h(async (req, res) => {
  await query('UPDATE messages SET read_at = $1 WHERE sender_id = $2 AND receiver_id = $3 AND read_at IS NULL', [Date.now(), toId(req.params.id), req.user.id]);
  res.json({ ok: true });
}));

app.delete('/api/message/:msgId', auth, h(async (req, res) => {
  const { rowCount } = await query('DELETE FROM messages WHERE id = $1 AND sender_id = $2', [toId(req.params.msgId), req.user.id]);
  if (!rowCount) return res.status(404).json({ error: 'Không tìm thấy tin nhắn' });
  res.json({ ok: true });
}));

app.post('/api/typing', auth, h(async (req, res) => {
  await query('UPDATE users SET typing_to = $1, typing_at = $2 WHERE id = $3', [toId(req.body.to) || null, Date.now(), req.user.id]);
  res.json({ ok: true });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Lỗi máy chủ' });
});

module.exports = app;
