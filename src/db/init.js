/**
 * 数据库初始化脚本（JSON 文件存储）
 * 运行：node src/db/init.js
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.resolve(process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : './data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = {
  users:        path.join(DATA_DIR, 'users.json'),
  verify_codes: path.join(DATA_DIR, 'verify_codes.json'),
  notices:      path.join(DATA_DIR, 'notices.json'),
  knowledge:    path.join(DATA_DIR, 'knowledge.json'),
  dynamics:     path.join(DATA_DIR, 'dynamics.json'),
  handovers:    path.join(DATA_DIR, 'handovers.json'),
  activities:   path.join(DATA_DIR, 'activities.json'),
  messages:     path.join(DATA_DIR, 'messages.json'),
  projects:     path.join(DATA_DIR, 'projects.json'),
  meetings:     path.join(DATA_DIR, 'meetings.json'),
};

function readJSON(fp) {
  if (!fs.existsSync(fp)) return [];
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { return []; }
}
function writeJSON(fp, data) {
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
}

// ── 初始化管理员账号 ──
const adminUser = process.env.ADMIN_USERNAME || 'admin';
const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
const adminNick = process.env.ADMIN_NICKNAME || '管理员';

let users = readJSON(FILES.users);
const adminExists = users.some(u => u.username === adminUser);

if (!adminExists) {
  const id = users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1;
  const hash = bcrypt.hashSync(adminPass, 10);
  users.push({
    id, phone: null, username: adminUser, nickname: adminNick,
    password: hash, avatar: '管', dept: '产品研发部', team_group: '用户体验组',
    email: 'admin@company.cn', login_type: 'password',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  });
  writeJSON(FILES.users, users);
  console.log(`✅ 管理员账号已创建: ${adminUser} / ${adminPass}`);
} else {
  console.log('ℹ️  管理员账号已存在，跳过');
}

// ── 初始化示例数据 ──
const adminId = users.find(u => u.username === adminUser)?.id || 1;
const now = () => new Date().toISOString();

function initTable(file, key, seedData, checkField = 'title') {
  let rows = readJSON(file);
  if (rows.length === 0) {
    let id = 1;
    const data = seedData.map(item => ({ id: id++, ...item, user_id: adminId }));
    writeJSON(file, data);
    console.log(`✅ ${key} 示例数据已写入`);
  }
}

initTable(FILES.verify_codes, '验证码', []);
initTable(FILES.notices, '公告', [
  { badge: '重要', title: '关于Q2季度工作计划的通知', description: '请各部门于本周五前提交Q2季度工作计划，包含目标、关键指标和资源需求。', meta: '2小时前 · 行政部', created_at: now(), updated_at: now() },
  { badge: '普通', title: '系统升级维护通知', description: '本周六凌晨2:00-4:00进行系统维护，期间服务暂停，请提前做好准备。', meta: '昨天 · IT部门', created_at: now(), updated_at: now() },
]);
initTable(FILES.knowledge, '知识共享', [
  { icon: '📋', title: '新员工入职指引手册', description: '包含公司制度、流程规范、系统使用指南等完整内容。', meta: '3天前 · HR部门', created_at: now(), updated_at: now() },
]);
initTable(FILES.dynamics, '工作动态', [
  { avatar: '王', avatar_color: '#F59E0B', content: '完成了客户端性能优化方案，首屏加载时间从4.2s降至1.8s，请大家review。', meta: '10分钟前', created_at: now() },
]);
initTable(FILES.handovers, '工作交接', [
  { title: '用户反馈系统对接', description: '需对接第三方反馈平台 API，完成数据同步和通知推送功能', from_user: '张工移交', status: '待接收', priority: '高', to_user_id: null, project_id: 1, created_at: now(), updated_at: now() },
]);
initTable(FILES.activities, '团队活动', [
  { tag: '培训', title: 'Q2技术分享：微服务架构实践', date: '06/20 周五', location: '腾讯会议', people: '36人报名', created_at: now(), updated_at: now() },
]);
initTable(FILES.messages, '聊天消息', []);
initTable(FILES.meetings, '会议记录', [
  { title: 'Q2 产品迭代评审会', date: '2026-06-16', time: '14:00-15:30', location: '3F 会议室 A', attendees: '张三,李四,王五', agenda: '1. Q2 迭代功能回顾\n2. 用户反馈数据分析\n3. Q3 产品规划讨论', minutes: '1. Q2 已完成 12 个功能点上线，用户满意度提升 15%\n2. 反馈系统对接需优先推进\n3. Q3 重点：AI 辅助功能、多端适配', action_items: '[{"task":"用户反馈系统对接","assignee":"张三","deadline":"2026-06-30"},{"task":"Q3 产品路线图绘制","assignee":"李四","deadline":"2026-07-05"}]', status: '已完成', project_id: 1 },
  { title: '技术架构升级方案讨论', date: '2026-06-18', time: '10:00-11:30', location: '腾讯会议（线上）', attendees: '王五,赵六,孙七', agenda: '1. 当前架构痛点分析\n2. 微服务拆分方案\n3. 数据库优化策略', minutes: '1. 确认采用渐进式微服务架构，优先拆分用户模块\n2. 数据库读写分离方案可行，7月启动实施\n3. 需补充性能基准测试报告', action_items: '[{"task":"微服务拆分 POC","assignee":"王五","deadline":"2026-07-01"},{"task":"数据库读写分离调研","assignee":"赵六","deadline":"2026-06-25"}]', status: '待开始', project_id: 2 },
]);
initTable(FILES.projects, '项目管理', [
  { name: '用户反馈系统升级', description: '对接第三方反馈平台 API，完成数据同步和通知推送功能的整体升级项目', status: '进行中', leader_id: adminId, team_members: [], plan: JSON.stringify([
    { name: '需求调研与分析', start: '2026-06-01', end: '2026-06-07', status: '已完成' },
    { name: 'API 接口对接', start: '2026-06-08', end: '2026-06-18', status: '进行中' },
    { name: '前端页面开发', start: '2026-06-15', end: '2026-06-25', status: '进行中' },
    { name: '联调测试', start: '2026-06-26', end: '2026-07-02', status: '待开始' },
    { name: '上线部署', start: '2026-07-03', end: '2026-07-05', status: '待开始' },
  ]) },
  { name: 'Q2 OKR 目标推进', description: 'Q2季度 OKR 目标管理，包含产品规划、技术攻坚、团队建设等核心事项', status: '进行中', leader_id: adminId, team_members: [], plan: JSON.stringify([
    { name: '产品路线图规划', start: '2026-05-01', end: '2026-05-15', status: '已完成' },
    { name: '技术架构升级', start: '2026-05-16', end: '2026-06-30', status: '进行中' },
    { name: '团队能力建设', start: '2026-06-01', end: '2026-06-30', status: '进行中' },
    { name: 'Q2 复盘总结', start: '2026-06-28', end: '2026-07-03', status: '待开始' },
  ]) },
]);

console.log('🎉 数据库初始化完成！');
