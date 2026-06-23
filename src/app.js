/**
 * TeamConnect 后端主入口
 */

require('dotenv').config();
const http   = require('http');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ── 信任 nginx 反向代理头（HTTPS、真实IP等）──
app.set('trust proxy', 1);

// ── 安全中间件 ──
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── 请求日志 ──
app.use(morgan('dev'));

// ── JSON 解析 ──
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ── 静态文件：上传图片 ──
app.use('/uploads', express.static(path.join(__dirname, '..', 'data', 'uploads')));

// ── 全局限流（每IP每15分钟最多300次请求）──
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { code: 429, message: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', globalLimiter);

// ── 短信发送专用限流（每IP每小时最多10次）──
const smsLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { code: 429, message: '短信发送过于频繁，请1小时后再试' },
  keyGenerator: (req) => req.ip + (req.body && req.body.phone ? ':' + req.body.phone : ''),
});
app.use('/api/auth/send-code', smsLimiter);

// ── Socket.IO ──
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'teamconnect-jwt-secret-2024';
const db = require('./db/database');

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
});

// 在线用户映射: userId -> Set<socketId>
const onlineUsers = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('未登录'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.id;
    socket.username = decoded.username;
    next();
  } catch { next(new Error('Token 无效')); }
});

io.on('connection', (socket) => {
  const uid = socket.userId;
  if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
  onlineUsers.get(uid).add(socket.id);
  io.emit('user-online', { userId: uid });

  // 加入个人房间
  socket.join('user:' + uid);

  // 发送消息
  socket.on('send-message', (data, ack) => {
    const { to, content, type } = data;
    if (!to || !content) { if (ack) ack({ error: '参数不完整' }); return; }
    const msg = {
      id: db.nextId('messages'),
      from_user_id: uid,
      to_user_id: parseInt(to),
      content: String(content).slice(0, 2000),
      type: type || 'text',
      created_at: new Date().toISOString(),
    };
    db.messages.insert(msg);
    // 自己确认
    if (ack) ack({ ok: true, message: msg });
    // 发给接收方
    io.to('user:' + to).emit('new-message', msg);
  });

  // 正在输入
  socket.on('typing', (data) => {
    io.to('user:' + data.to).emit('user-typing', { userId: uid, typing: data.typing });
  });

  // 删除消息
  socket.on('delete-message', (data, ack) => {
    const { msgId } = data;
    if (!msgId) { if (ack) ack({ error: '参数不完整' }); return; }
    const allMsgs = db.prepare('SELECT * FROM messages').all();
    const msg = allMsgs.find(m => m.id === msgId);
    if (!msg) { if (ack) ack({ error: '消息不存在' }); return; }
    if (msg.from_user_id !== uid) { if (ack) ack({ error: '只能删除自己的消息' }); return; }
    db.messages.delete(msgId);
    if (ack) ack({ ok: true, id: msgId });
    io.to('user:' + msg.to_user_id).emit('message-deleted', { id: msgId });
  });

  socket.on('disconnect', () => {
    if (onlineUsers.has(uid)) {
      onlineUsers.get(uid).delete(socket.id);
      if (onlineUsers.get(uid).size === 0) {
        onlineUsers.delete(uid);
        io.emit('user-offline', { userId: uid });
      }
    }
  });
});

// 暴露 io 给路由
app.set('io', io);
app.set('onlineUsers', onlineUsers);

// ── 路由 ──
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/content', require('./routes/content'));
app.use('/api/members', require('./routes/members'));
app.use('/api/chat',    require('./routes/chat'));
app.use('/api/projects',require('./routes/projects'));
app.use('/api/meetings',require('./routes/meetings'));

// ── 健康检查 ──
app.get('/api/health', (req, res) => {
  res.json({ code: 200, message: 'OK', timestamp: new Date().toISOString() });
});

// ── 静态文件（生产环境把 index.html 放在 public 目录）──
app.use(express.static(path.join(__dirname, '../public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── 错误处理 ──
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ code: 500, message: '服务器内部错误' });
});

// ── 启动 ──
server.listen(PORT, () => {
  console.log(`\n🚀 TeamConnect 服务已启动`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   环境: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   WebSocket: 已就绪`);
});
