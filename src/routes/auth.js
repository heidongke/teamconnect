/**
 * 认证路由 /api/auth
 * POST /api/auth/send-code    发送验证码
 * POST /api/auth/register     手机号注册
 * POST /api/auth/login        登录（账号密码 or 手机号+验证码）
 * POST /api/auth/logout       登出（前端清 token 即可，此接口记日志用）
 * GET  /api/auth/me           获取当前用户信息
 * PUT  /api/auth/profile      更新个人资料
 */

require('dotenv').config();
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../db/database');
const { sendSmsCode } = require('../sms');
const authMiddleware  = require('../middleware/auth');

// ── 工具函数 ──

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, phone: user.phone, username: user.username, nickname: user.nickname },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function sanitizeUser(user) {
  const { password, ...safe } = user;
  return safe;
}

// ── 发送验证码 ──
router.post('/send-code', async (req, res) => {
  const { phone, purpose = 'register' } = req.body;

  if (!phone || !/^1\d{10}$/.test(phone)) {
    return res.status(400).json({ code: 400, message: '手机号格式不正确' });
  }

  // 注册场景：检查手机号是否已注册
  if (purpose === 'register') {
    const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
    if (existing) {
      return res.status(409).json({ code: 409, message: '该手机号已注册，请直接登录' });
    }
  }

  // 限流：60秒内不能重复发送
  const recent = db.prepare(`
    SELECT id FROM verify_codes
    WHERE phone = ? AND purpose = ? AND used = 0
      AND datetime(created_at, '+60 seconds') > datetime('now')
  `).get(phone, purpose);

  if (recent) {
    return res.status(429).json({ code: 429, message: '操作频繁，请60秒后再试' });
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5分钟后过期

  // 存入数据库（先废弃旧验证码）
  db.prepare('UPDATE verify_codes SET used = 1 WHERE phone = ? AND purpose = ?').run(phone, purpose);
  db.prepare('INSERT INTO verify_codes (phone, code, purpose, expires_at) VALUES (?, ?, ?, ?)')
    .run(phone, code, purpose, expiresAt);

  // 调用腾讯云 SMS
  const result = await sendSmsCode(phone, code);
  if (!result.ok) {
    return res.status(502).json({ code: 502, message: `短信发送失败: ${result.error}` });
  }

  res.json({ code: 200, message: '验证码已发送，请注意查收' });
});

// ── 手机号注册 ──
router.post('/register', async (req, res) => {
  const { phone, code, nickname, password } = req.body;

  if (!phone || !code || !nickname || !password) {
    return res.status(400).json({ code: 400, message: '参数不完整' });
  }
  if (!/^1\d{10}$/.test(phone)) {
    return res.status(400).json({ code: 400, message: '手机号格式不正确' });
  }
  if (password.length < 6) {
    return res.status(400).json({ code: 400, message: '密码至少6位' });
  }

  // 校验验证码
  const record = db.prepare(`
    SELECT * FROM verify_codes
    WHERE phone = ? AND purpose = 'register' AND used = 0
      AND datetime(expires_at) > datetime('now')
    ORDER BY id DESC LIMIT 1
  `).get(phone);

  if (!record || record.code !== code) {
    return res.status(400).json({ code: 400, message: '验证码错误或已失效，请重新获取' });
  }

  // 标记验证码已使用
  db.prepare('UPDATE verify_codes SET used = 1 WHERE id = ?').run(record.id);

  // 检查手机号是否已被注册
  const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (existing) {
    return res.status(409).json({ code: 409, message: '该手机号已注册' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const avatar = nickname.charAt(0);

  const stmt = db.prepare(`
    INSERT INTO users (phone, username, nickname, password, avatar, login_type)
    VALUES (?, ?, ?, ?, ?, 'registered')
  `);
  const info = stmt.run(phone, phone, nickname, hash, avatar);

  const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = signToken(newUser);

  res.json({ code: 200, message: '注册成功', token, user: sanitizeUser(newUser) });
});

// ── 登录 ──
router.post('/login', async (req, res) => {
  const { username, password, phone, code, loginType = 'password' } = req.body;

  // 手机号+验证码 登录
  if (loginType === 'sms') {
    if (!phone || !code) {
      return res.status(400).json({ code: 400, message: '请提供手机号和验证码' });
    }

    const record = db.prepare(`
      SELECT * FROM verify_codes
      WHERE phone = ? AND purpose = 'login' AND used = 0
        AND datetime(expires_at) > datetime('now')
      ORDER BY id DESC LIMIT 1
    `).get(phone);

    if (!record || record.code !== code) {
      return res.status(400).json({ code: 400, message: '验证码错误或已失效' });
    }

    db.prepare('UPDATE verify_codes SET used = 1 WHERE id = ?').run(record.id);

    let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    if (!user) {
      // 自动注册
      const nick = '用户' + phone.slice(-4);
      const hash = bcrypt.hashSync(String(Math.random()), 10);
      const info = db.prepare(`
        INSERT INTO users (phone, username, nickname, password, avatar, login_type)
        VALUES (?, ?, ?, ?, ?, 'sms')
      `).run(phone, phone, nick, hash, nick.charAt(0));
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    }

    const token = signToken(user);
    return res.json({ code: 200, message: '登录成功', token, user: sanitizeUser(user) });
  }

  // 账号密码登录
  if (!username || !password) {
    return res.status(400).json({ code: 400, message: '请输入用户名和密码' });
  }

  const user = db.prepare(`
    SELECT * FROM users WHERE username = ? OR phone = ?
  `).get(username, username);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ code: 401, message: '用户名或密码错误' });
  }

  const token = signToken(user);
  res.json({ code: 200, message: '登录成功', token, user: sanitizeUser(user) });
});

// ── 获取当前用户信息 ──
router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });
  res.json({ code: 200, user: sanitizeUser(user) });
});

// ── 更新个人资料 ──
router.put('/profile', authMiddleware, (req, res) => {
  const { nickname, avatar, dept, team_group, email, phone, username } = req.body;
  const userId = req.user.id;

  // 如果改了用户名，检查是否已被占用
  if (username) {
    const dup = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, userId);
    if (dup) return res.status(409).json({ code: 409, message: '该用户名已被占用' });
  }

  db.prepare(`
    UPDATE users SET username  = COALESCE(?, username),
                     nickname = COALESCE(?, nickname),
                     avatar   = COALESCE(?, avatar),
                     dept     = COALESCE(?, dept),
                     team_group = COALESCE(?, team_group),
                     email    = COALESCE(?, email),
                     phone    = COALESCE(?, phone),
                     updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(username || null, nickname || null, avatar || null, dept || null, team_group || null, email || null, phone || null, userId);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  res.json({ code: 200, message: '资料已更新', user: sanitizeUser(updated) });
});

// ── 修改密码 ──
router.put('/password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ code: 400, message: '参数不完整' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ code: 400, message: '新密码至少6位' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(oldPassword, user.password)) {
    return res.status(400).json({ code: 400, message: '原密码错误' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(hash, req.user.id);

  res.json({ code: 200, message: '密码已修改' });
});

module.exports = router;
