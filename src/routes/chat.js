/**
 * 聊天 API 路由
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const db = require('../db/database');

router.use(auth);

// 获取会话列表
router.get('/conversations', (req, res) => {
  try {
    const convs = db.messages.getConversations(req.user.id);
    // 补全未读计数
    const online = req.app.get('onlineUsers') || new Map();
    const result = convs.map(c => ({
      ...c,
      online: online.has(c.peerId),
    }));
    res.json({ code: 200, data: result });
  } catch (e) {
    console.error('[chat/conversations]', e.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 获取与指定用户的聊天记录
router.get('/messages/:userId', (req, res) => {
  try {
    const peerId = parseInt(req.params.userId);
    const limit = parseInt(req.query.limit) || 50;
    const before = parseInt(req.query.before) || 0;
    let msgs = db.messages.getByUsers(req.user.id, peerId);
    if (before) msgs = msgs.filter(m => m.id < before);
    msgs = msgs.slice(-limit);
    res.json({ code: 200, data: msgs });
  } catch (e) {
    console.error('[chat/messages]', e.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 删除聊天消息
router.delete('/messages/:msgId', (req, res) => {
  try {
    const msgId = parseInt(req.params.msgId);
    // 找到消息验证权限
    const allMsgs = db.prepare('SELECT * FROM messages').all();
    const msg = allMsgs.find(m => m.id === msgId);
    if (!msg) return res.status(404).json({ code: 404, message: '消息不存在' });
    if (msg.from_user_id !== req.user.id) {
      return res.status(403).json({ code: 403, message: '只能删除自己发送的消息' });
    }
    const result = db.messages.delete(msgId);
    if (!result.changes) return res.status(404).json({ code: 404, message: '删除失败' });
    // 通知对方消息被删除
    const io = req.app.get('io');
    if (io) io.to('user:' + msg.to_user_id).emit('delete-message', { id: msgId });
    res.json({ code: 200, data: { id: msgId } });
  } catch (e) {
    console.error('[chat/delete]', e.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 搜索聊天消息
router.get('/messages/:userId/search', (req, res) => {
  try {
    const peerId = parseInt(req.params.userId);
    const q = (req.query.q || '').trim().toLowerCase();
    if (!q) return res.json({ code: 200, data: [] });
    let msgs = db.messages.getByUsers(req.user.id, peerId);
    msgs = msgs.filter(m => m.content && m.content.toLowerCase().includes(q));
    res.json({ code: 200, data: msgs.slice(-50) });
  } catch (e) {
    console.error('[chat/search]', e.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 上传聊天图片
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const uploadDir = path.join(__dirname, '..', '..', 'data', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('仅支持图片文件'));
  }
});

router.post('/upload-image', upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ code: 400, message: '请选择图片' });
    const url = '/uploads/' + req.file.filename;
    res.json({ code: 200, data: { url, filename: req.file.filename } });
  } catch (e) {
    console.error('[chat/upload]', e.message);
    res.status(500).json({ code: 500, message: '上传失败' });
  }
});

// 获取所有成员（用于聊天联系人列表）
router.get('/contacts', (req, res) => {
  try {
    // 获取所有用户并过滤掉自己（避开 SQL 解析器 != 问题）
    const allUsers = db.prepare('SELECT id, username, nickname, avatar, dept, team_group FROM users').all();
    const users = allUsers.filter(u => u.id !== req.user.id);
    const online = req.app.get('onlineUsers') || new Map();
    const result = users.map(u => ({
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      avatar: u.avatar || u.nickname?.charAt(0),
      dept: u.dept || '',
      team: u.team_group || '',
      online: online.has(u.id),
    }));
    res.json({ code: 200, data: result });
  } catch (e) {
    console.error('[chat/contacts]', e.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;
