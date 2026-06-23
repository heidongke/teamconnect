/**
 * 内容管理路由 /api/content
 * 公告 / 知识共享 / 工作动态 / 工作交接 / 团队活动
 */

const router = require('express').Router();
const db = require('../db/database');
const auth = require('../middleware/auth');

// ─── 通用 CRUD 工厂 ────────────────────────────────────────────────────────────

function makeResource(table, allowedFields) {
  const router = require('express').Router();

  // LIST
  router.get('/', auth, (req, res) => {
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all();
    res.json({ code: 200, data: rows });
  });

  // GET ONE
  router.get('/:id', auth, (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ code: 404, message: '记录不存在' });
    res.json({ code: 200, data: row });
  });

  // CREATE
  router.post('/', auth, (req, res) => {
    const fields = allowedFields.filter(f => req.body[f] !== undefined);
    if (fields.length === 0) {
      return res.status(400).json({ code: 400, message: '未提供有效字段' });
    }
    const cols = [...fields, 'user_id'].join(', ');
    const placeholders = [...fields.map(() => '?'), '?'].join(', ');
    const values = [...fields.map(f => req.body[f]), req.user.id];
    const info = db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`).run(...values);
    const created = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid);
    res.json({ code: 200, message: '创建成功', data: created });
  });

  // UPDATE
  router.put('/:id', auth, (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ code: 404, message: '记录不存在' });

    const fields = allowedFields.filter(f => req.body[f] !== undefined);
    if (fields.length === 0) {
      return res.status(400).json({ code: 400, message: '未提供有效字段' });
    }
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const hasUpdatedAt = allowedFields.includes('updated_at') === false; // always append for data tables

    const sql = `UPDATE ${table} SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    const values = [...fields.map(f => req.body[f]), req.params.id];

    try {
      db.prepare(sql).run(...values);
    } catch(e) {
      // dynamics 表没有 updated_at 列，退回不带时间戳的更新
      db.prepare(`UPDATE ${table} SET ${setClause} WHERE id = ?`).run(...values);
    }

    const updated = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    res.json({ code: 200, message: '更新成功', data: updated });
  });

  // DELETE
  router.delete('/:id', auth, (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ code: 404, message: '记录不存在' });
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
    res.json({ code: 200, message: '删除成功' });
  });

  return router;
}

// ─── 交接确认/退回（必须在 makeResource 之前注册，否则会被子路由拦截）────────────────

router.post('/handovers/:id/confirm', auth, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const row = db.prepare('SELECT * FROM handovers WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ code: 404, message: '交接记录不存在' });

    // 只有状态为"待接收"才能确认
    if (row.status !== '待接收') {
      return res.status(400).json({ code: 400, message: `当前状态为"${row.status}"，无需重复确认` });
    }

    // 只有指定的接收人可以确认
    if (row.to_user_id !== req.user.id) {
      return res.status(403).json({ code: 403, message: '只有指定的接收人才能确认此交接' });
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE handovers SET status = ?, confirmed_at = ?, confirmed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('已移交', now, req.user.id, id);

    const updated = db.prepare('SELECT * FROM handovers WHERE id = ?').get(id);
    res.json({ code: 200, message: '已确认接收', data: updated });
  } catch (e) {
    console.error('POST /handovers/:id/confirm error:', e);
    res.status(500).json({ code: 500, message: '服务器错误: ' + e.message });
  }
});

router.post('/handovers/:id/reject', auth, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const row = db.prepare('SELECT * FROM handovers WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ code: 404, message: '交接记录不存在' });

    if (row.status !== '待接收') {
      return res.status(400).json({ code: 400, message: `当前状态为"${row.status}"，无法退回` });
    }

    if (row.to_user_id !== req.user.id) {
      return res.status(403).json({ code: 403, message: '只有指定的接收人才能退回此交接' });
    }

    const reason = (req.body.reason || '').trim();
    const now = new Date().toISOString();
    db.prepare('UPDATE handovers SET status = ?, reject_reason = ?, rejected_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('已退回', reason, now, id);

    const updated = db.prepare('SELECT * FROM handovers WHERE id = ?').get(id);
    res.json({ code: 200, message: '已退回', data: updated });
  } catch (e) {
    console.error('POST /handovers/:id/reject error:', e);
    res.status(500).json({ code: 500, message: '服务器错误: ' + e.message });
  }
});

// ─── 挂载各资源 ───────────────────────────────────────────────────────────────

router.use('/notices',    makeResource('notices',   ['badge', 'title', 'description', 'meta']));
router.use('/knowledge',  makeResource('knowledge', ['icon', 'title', 'description', 'meta']));
router.use('/dynamics',   makeResource('dynamics',  ['avatar', 'avatar_color', 'content', 'meta']));
router.use('/handovers',  makeResource('handovers', ['title', 'description', 'from_user', 'status', 'priority', 'to_user_id', 'project_id']));
router.use('/activities', makeResource('activities',['tag', 'title', 'date', 'location', 'people']));

// ─── 聚合接口：一次拿回全部内容（首页用）──────────────────────────────────────

// JSON 字段解析（兼容字符串/数组 null）
function parseJSON(val, def = []) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') { try { const p = JSON.parse(val); return Array.isArray(p) ? p : (p === null ? def : p); } catch(e) { return def; } }
  return def;
}

router.get('/all', auth, (req, res) => {
  const notices    = db.prepare('SELECT * FROM notices    ORDER BY id DESC LIMIT 10').all();
  const knowledge  = db.prepare('SELECT * FROM knowledge  ORDER BY id DESC LIMIT 10').all();
  const dynamics   = db.prepare('SELECT * FROM dynamics   ORDER BY id DESC LIMIT 20').all();
  const handovers  = db.prepare('SELECT * FROM handovers  ORDER BY id DESC LIMIT 20').all();
  const activities = db.prepare('SELECT * FROM activities ORDER BY id DESC LIMIT 20').all();
  const rawProjects = db.prepare('SELECT * FROM projects   ORDER BY id DESC LIMIT 20').all();
  const rawMeetings = db.prepare('SELECT * FROM meetings   ORDER BY date DESC, id DESC LIMIT 20').all();

  // 解析项目的 JSON 字段（与 /api/projects 保持一致）
  const projects = rawProjects.map(p => ({
    ...p,
    plan: parseJSON(p.plan),
    tasks: parseJSON(p.tasks),
    milestones: parseJSON(p.milestones),
    risks: parseJSON(p.risks)
  }));

  // 解析会议的 JSON 字段
  const meetings = rawMeetings.map(m => ({
    ...m,
    action_items: typeof m.action_items === 'string' ? JSON.parse(m.action_items || '[]') : (m.action_items || [])
  }));

  // 收集所有项目任务（展平，含项目信息）
  const allTasks = [];
  projects.forEach(p => {
    (p.tasks || []).forEach(task => {
      allTasks.push({
        ...task,
        project_name: p.name || '',
        project_id: p.id
      });
    });
  });

  res.json({
    code: 200,
    data: { notices, knowledge, dynamics, handovers, activities, projects, meetings, allTasks }
  });
});

module.exports = router;
