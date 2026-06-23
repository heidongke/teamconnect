/**
 * 成员管理路由 /api/members （仅管理员可用）
 * GET    /api/members          列出所有成员
 * POST   /api/members          管理员新建成员
 * DELETE /api/members/:id      管理员删除成员
 */

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db    = require('../db/database');
const authMiddleware = require('../middleware/auth');

// 所有操作都需要登录
router.use(authMiddleware);

// 管理员检查中间件（id === 1 或 username === 'admin' 视为管理员）
function adminOnly(req, res, next) {
  if (req.user && (req.user.id === 1 || req.user.username === 'admin')) return next();
  return res.status(403).json({ code: 403, message: '仅管理员可操作' });
}

// ── 生成随机密码 ──
function generatePassword() {
  return crypto.randomBytes(4).toString('hex'); // 8位随机密码
}

// ── 列出所有成员（所有已登录用户可查看）──
router.get('/', (req, res) => {
  try {
    const users = db.prepare('SELECT * FROM users ORDER BY id ASC').all();
    // 脱敏：不返回密码
    const safe = users.map(({ password, ...rest }) => rest);
    res.json({ code: 200, data: safe });
  } catch (e) {
    console.error('[members] list error:', e.message);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// ── 管理员新建成员 ──
router.post('/', adminOnly, (req, res) => {
  try {
    const { username, nickname, dept, team_group, email, phone } = req.body;

    // 校验必填字段
    if (!username || !username.trim()) return res.status(400).json({ code: 400, message: '请输入用户名' });
    if (!nickname || !nickname.trim()) return res.status(400).json({ code: 400, message: '请输入昵称' });

    const trimmed = username.trim();

    // 检查用户名是否已存在
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(trimmed);
    if (existing) return res.status(400).json({ code: 400, message: '用户名已存在' });

    // 检查手机号是否已被使用
    if (phone && phone.trim()) {
      const phoneExists = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone.trim());
      if (phoneExists) return res.status(400).json({ code: 400, message: '该手机号已被注册' });
    }

    // 默认密码 123
    const rawPassword = '123';
    const hashedPassword = bcrypt.hashSync(rawPassword, 10);

    const result = db.prepare(
      'INSERT INTO users (username, password, nickname, avatar, dept, team_group, email, phone, login_type) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(
      trimmed,
      hashedPassword,
      nickname.trim(),
      (nickname.trim() || 'U').charAt(0),
      dept || '',
      team_group || '',
      email || '',
      phone || '',
      'password'
    );

    res.json({
      code: 200,
      message: '成员创建成功',
      data: {
        id: result.lastInsertRowid,
        username: trimmed,
        nickname: nickname.trim(),
        rawPassword,          // 返回初始密码给管理员，由管理员告知成员
        dept: dept || '',
        team_group: team_group || '',
        email: email || '',
        phone: phone || '',
      }
    });
  } catch (e) {
    console.error('[members] create error:', e.message);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// ── 管理员删除成员 ──
router.delete('/:id', adminOnly, (req, res) => {
  try {
    const id = parseInt(req.params.id);

    // 不允许删除自己
    if (id === 1) return res.status(400).json({ code: 400, message: '不能删除管理员账号' });

    const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ code: 404, message: '成员不存在' });

    res.json({ code: 200, message: '成员已删除' });
  } catch (e) {
    console.error('[members] delete error:', e.message);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

module.exports = router;
