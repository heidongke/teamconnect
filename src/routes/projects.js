/**
 * 项目管理路由
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const db = require('../db/database');

// 所有项目路由需要登录
router.use(auth);

// 通用 CRUD 工厂
function makeResource(table, allowedFields) {
  const sub = express.Router();

  // 列表
  sub.get('/', (req, res) => {
    try {
      const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all();
      res.json({ code: 200, data: rows });
    } catch (e) {
      console.error(`GET /${table} error:`, e);
      res.status(500).json({ code: 500, message: '服务器错误' });
    }
  });

  // 创建
  sub.post('/', (req, res) => {
    try {
      const fields = [];
      const values = [];
      const placeholders = [];
      for (const f of allowedFields) {
        if (req.body[f] !== undefined) {
          fields.push(f);
          values.push(req.body[f]);
          placeholders.push('?');
        }
      }
      if (fields.length === 0) {
        return res.status(400).json({ code: 400, message: '参数不能为空' });
      }
      const sql = `INSERT INTO ${table} (${fields.join(',')}) VALUES (${placeholders.join(',')})`;
      const result = db.prepare(sql).run(...values);
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(result.lastInsertRowid);
      res.json({ code: 200, message: '创建成功', data: row });
    } catch (e) {
      console.error(`POST /${table} error:`, e);
      res.status(500).json({ code: 500, message: '服务器错误' });
    }
  });

  // 更新
  sub.put('/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
      if (!existing) return res.status(404).json({ code: 404, message: '记录不存在' });

      const setParts = [];
      const values = [];
      for (const f of allowedFields) {
        if (req.body[f] !== undefined) {
          setParts.push(`${f} = ?`);
          values.push(req.body[f]);
        }
      }
      if (setParts.length === 0) {
        return res.status(400).json({ code: 400, message: '参数不能为空' });
      }
      setParts.push('updated_at = ?');
      values.push(new Date().toISOString());
      const sql = `UPDATE ${table} SET ${setParts.join(',')} WHERE id = ?`;
      values.push(id);
      db.prepare(sql).run(...values);
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
      res.json({ code: 200, message: '更新成功', data: row });
    } catch (e) {
      console.error(`PUT /${table} error:`, e);
      res.status(500).json({ code: 500, message: '服务器错误' });
    }
  });

  // 删除
  sub.delete('/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const result = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      if (result.changes === 0) return res.status(404).json({ code: 404, message: '记录不存在' });
      res.json({ code: 200, message: '删除成功' });
    } catch (e) {
      console.error(`DELETE /${table} error:`, e);
      res.status(500).json({ code: 500, message: '服务器错误' });
    }
  });

  return sub;
}

// 项目 CRUD（增删改在根路由）
router.post('/', (req, res) => {
  try {
    const allowedFields = ['name', 'description', 'status', 'leader_id', 'nonstd_leader_id', 'std_leader_id', 'team_members', 'plan', 'plan_total', 'plan_nonstd', 'plan_std', 'start_date', 'end_date', 'color', 'tasks', 'milestones', 'risks'];
    const fields = [], values = [], placeholders = [];
    for (const f of allowedFields) {
      if (req.body[f] !== undefined) {
        fields.push(f);
        values.push(typeof req.body[f] === 'object' ? JSON.stringify(req.body[f]) : req.body[f]);
        placeholders.push('?');
      }
    }
    if (!req.body.name) return res.status(400).json({ code: 400, message: '项目名称不能为空' });
    fields.push('user_id'); values.push(req.user.id); placeholders.push('?');
    const sql = `INSERT INTO projects (${fields.join(',')}) VALUES (${placeholders.join(',')})`;
    const result = db.prepare(sql).run(...values);
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
    res.json({ code: 200, message: '创建成功', data: row });
  } catch (e) {
    console.error('POST /projects error:', e);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

router.put('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ code: 404, message: '项目不存在' });
    const allowedFields = ['name', 'description', 'status', 'leader_id', 'nonstd_leader_id', 'std_leader_id', 'team_members', 'plan', 'plan_total', 'plan_nonstd', 'plan_std', 'start_date', 'end_date', 'color', 'tasks', 'milestones', 'risks'];
    const setParts = [], values = [];
    for (const f of allowedFields) {
      if (req.body[f] !== undefined) {
        setParts.push(`${f} = ?`);
        values.push(typeof req.body[f] === 'object' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    }
    if (setParts.length === 0) return res.status(400).json({ code: 400, message: '参数不能为空' });
    setParts.push('updated_at = ?'); values.push(new Date().toISOString());
    values.push(id);
    db.prepare(`UPDATE projects SET ${setParts.join(',')} WHERE id = ?`).run(...values);
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.json({ code: 200, message: '更新成功', data: row });
  } catch (e) {
    console.error('PUT /projects error:', e);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// ─── 辅助函数：解析 JSON 字段 ───
function parseJSON(val, def = []) {
  if (!val) return def;
  try { return typeof val === 'string' ? JSON.parse(val) : val; } catch(e) { return def; }
}

// ─── 辅助函数：保存子数组到项目 ───
function saveSubArray(table, projId, key, arr) {
  const stmt = db.prepare(`UPDATE ${table} SET ${key} = ?, updated_at = ? WHERE id = ?`);
  stmt.run(JSON.stringify(arr), new Date().toISOString(), projId);
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(projId);
}

// ─── 项目子项 CRUD（tasks / milestones）───
function subItemRoutes(key) {
  const sub = express.Router({ mergeParams: true });

  // 列出子项
  sub.get('/', (req, res) => {
    try {
      const pid = parseInt(req.params.id);
      const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
      if (!proj) return res.status(404).json({ code: 404, message: '项目不存在' });
      const items = parseJSON(proj[key]);
      res.json({ code: 200, data: items });
    } catch(e) { res.status(500).json({ code: 500, message: '服务器错误' }); }
  });

  // 添加子项
  sub.post('/', (req, res) => {
    try {
      const pid = parseInt(req.params.id);
      const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
      if (!proj) return res.status(404).json({ code: 404, message: '项目不存在' });
      const items = parseJSON(proj[key]);
      const maxId = items.reduce((m, i) => Math.max(m, i.id || 0), 0);
      const now = new Date().toISOString();
      let newItem;
      if (key === 'tasks') {
        newItem = {
          id: maxId + 1,
          name: req.body.name || '',
          assignee: req.body.assignee || '',
          deadline: req.body.deadline || '',
          status: req.body.status || 'pending',
          progress: req.body.progress !== undefined ? parseInt(req.body.progress) : 0,
          progress_note: req.body.progress_note || '',
          progress_updated_at: '',
          created_at: now
        };
      } else if (key === 'risks') {
        newItem = {
          id: maxId + 1,
          name: req.body.name || '',
          level: req.body.level || '中',
          category: req.body.category || '成本风险',
          description: req.body.description || '',
          status: req.body.status || '未处理',
          dri: req.body.dri || '',           // 直接负责人 ID
          target_date: req.body.target_date || '', // 目标完成日期
          progress: [],                       // 进展日志 [{date, note, by}]
          confirmed: false,                   // 项目负责人确认
          confirmed_by: '',
          confirmed_at: '',
          created_at: now
        };
      } else { // milestones
        newItem = {
          id: maxId + 1,
          name: req.body.name || '',
          date: req.body.date || '',
          start: req.body.start || req.body.date || '',
          end: req.body.end || req.body.date || '',
          description: req.body.description || '',
          color: req.body.color || '#6366F1',
          created_at: now
        };
      }
      items.push(newItem);
      // 任务通知：如果指定了负责人，发送消息提醒
      if (key === 'tasks' && newItem.assignee) {
        const io = req.app.get('io');
        const users = db.prepare('SELECT id, nickname FROM users').all();
        const assigneeUser = users.find(u => u.nickname === newItem.assignee || u.username === newItem.assignee);
        if (assigneeUser && io) {
          const projName = proj.name || '';
          const notifMsg = {
            id: db.nextId('messages'),
            from_user_id: req.user.id,
            to_user_id: assigneeUser.id,
            content: `📋 新任务指派：${newItem.name}（项目：${projName}）`,
            type: 'system',
            created_at: now
          };
          db.messages.insert(notifMsg);
          io.to('user:' + assigneeUser.id).emit('new-message', notifMsg);
        }
      }
      // 任务通知：如果更新了负责人，发送消息提醒
      if (key === 'tasks' && req.body.assignee !== undefined && req.body.assignee) {
        const io = req.app.get('io');
        const users = db.prepare('SELECT id, nickname FROM users').all();
        const assigneeUser = users.find(u => u.nickname === req.body.assignee || u.username === req.body.assignee);
        if (assigneeUser && io) {
          const projName = proj.name || '';
          const notifMsg = {
            id: db.nextId('messages'),
            from_user_id: req.user.id,
            to_user_id: assigneeUser.id,
            content: `🔄 任务指派更新：${items[idx].name}（项目：${projName}）`,
            type: 'system',
            created_at: new Date().toISOString()
          };
          db.messages.insert(notifMsg);
          io.to('user:' + assigneeUser.id).emit('new-message', notifMsg);
        }
      }
      const updated = saveSubArray('projects', pid, key, items);
      res.json({ code: 200, message: '添加成功', data: parseJSON(updated[key]), item: newItem });
    } catch(e) { res.status(500).json({ code: 500, message: '服务器错误' }); }
  });

  // 更新子项
  sub.put('/:itemId', (req, res) => {
    try {
      const pid = parseInt(req.params.id);
      const itemId = parseInt(req.params.itemId);
      const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
      if (!proj) return res.status(404).json({ code: 404, message: '项目不存在' });
      const items = parseJSON(proj[key]);
      const idx = items.findIndex(i => i.id === itemId);
      if (idx === -1) return res.status(404).json({ code: 404, message: '子项不存在' });
      // 更新允许的字段
      if (key === 'tasks') {
        if (req.body.name !== undefined) items[idx].name = req.body.name;
        if (req.body.assignee !== undefined) items[idx].assignee = req.body.assignee;
        if (req.body.deadline !== undefined) items[idx].deadline = req.body.deadline;
        if (req.body.status !== undefined) items[idx].status = req.body.status;
        if (req.body.progress !== undefined) items[idx].progress = parseInt(req.body.progress);
        if (req.body.progress_note !== undefined) items[idx].progress_note = req.body.progress_note;
        if (req.body.progress !== undefined) items[idx].progress_updated_at = new Date().toISOString();
      } else if (key === 'risks') {
        if (req.body.name !== undefined) items[idx].name = req.body.name;
        if (req.body.level !== undefined) items[idx].level = req.body.level;
        if (req.body.category !== undefined) items[idx].category = req.body.category;
        if (req.body.description !== undefined) items[idx].description = req.body.description;
        if (req.body.status !== undefined) items[idx].status = req.body.status;
        if (req.body.dri !== undefined) items[idx].dri = req.body.dri;
        if (req.body.target_date !== undefined) items[idx].target_date = req.body.target_date;
      } else {
        if (req.body.name !== undefined) items[idx].name = req.body.name;
        if (req.body.date !== undefined) items[idx].date = req.body.date;
        if (req.body.start !== undefined) items[idx].start = req.body.start;
        if (req.body.end !== undefined) items[idx].end = req.body.end;
        if (req.body.description !== undefined) items[idx].description = req.body.description;
        if (req.body.color !== undefined) items[idx].color = req.body.color;
      }
      // 任务通知：如果更新了负责人，发送消息提醒
      if (key === 'tasks' && req.body.assignee !== undefined && req.body.assignee) {
        const io = req.app.get('io');
        const users = db.prepare('SELECT id, nickname FROM users').all();
        const assigneeUser = users.find(u => u.nickname === req.body.assignee || u.username === req.body.assignee);
        if (assigneeUser && io) {
          const projName = proj.name || '';
          const notifMsg = {
            id: db.nextId('messages'),
            from_user_id: req.user.id,
            to_user_id: assigneeUser.id,
            content: `🔄 任务指派更新：${items[idx].name}（项目：${projName}）`,
            type: 'system',
            created_at: new Date().toISOString()
          };
          db.messages.insert(notifMsg);
          io.to('user:' + assigneeUser.id).emit('new-message', notifMsg);
        }
      }
      const updated = saveSubArray('projects', pid, key, items);
      res.json({ code: 200, message: '更新成功', data: parseJSON(updated[key]) });
    } catch(e) { res.status(500).json({ code: 500, message: '服务器错误' }); }
  });

  // 删除子项
  sub.delete('/:itemId', (req, res) => {
    try {
      const pid = parseInt(req.params.id);
      const itemId = parseInt(req.params.itemId);
      const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
      if (!proj) return res.status(404).json({ code: 404, message: '项目不存在' });
      const items = parseJSON(proj[key]);
      const filtered = items.filter(i => i.id !== itemId);
      if (filtered.length === items.length) return res.status(404).json({ code: 404, message: '子项不存在' });
      const updated = saveSubArray('projects', pid, key, filtered);
      res.json({ code: 200, message: '删除成功', data: parseJSON(updated[key]) });
    } catch(e) { res.status(500).json({ code: 500, message: '服务器错误' }); }
  });

  return sub;
}

// 挂载子路由
router.use('/:id/tasks', subItemRoutes('tasks'));
router.use('/:id/milestones', subItemRoutes('milestones'));
router.use('/:id/risks', subItemRoutes('risks'));

// ─── 风险进展跟踪 ───
router.post('/:id/risks/:riskId/progress', (req, res) => {
  try {
    const pid = parseInt(req.params.id);
    const riskId = parseInt(req.params.riskId);
    const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
    if (!proj) return res.status(404).json({ code: 404, message: '项目不存在' });
    const risks = parseJSON(proj.risks);
    const idx = risks.findIndex(r => r.id === riskId);
    if (idx === -1) return res.status(404).json({ code: 404, message: '风险不存在' });
    if (!risks[idx].progress) risks[idx].progress = [];
    risks[idx].progress.push({
      date: new Date().toISOString().split('T')[0],
      note: req.body.note || '',
      by: req.body.by || ''
    });
    const updated = saveSubArray('projects', pid, 'risks', risks);
    res.json({ code: 200, message: '进展已记录', data: parseJSON(updated.risks)[idx] });
  } catch(e) { res.status(500).json({ code: 500, message: '服务器错误' }); }
});

// ─── 项目负责人确认风险完成 ───
router.post('/:id/risks/:riskId/confirm', (req, res) => {
  try {
    const pid = parseInt(req.params.id);
    const riskId = parseInt(req.params.riskId);
    const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
    if (!proj) return res.status(404).json({ code: 404, message: '项目不存在' });
    const risks = parseJSON(proj.risks);
    const idx = risks.findIndex(r => r.id === riskId);
    if (idx === -1) return res.status(404).json({ code: 404, message: '风险不存在' });
    risks[idx].confirmed = true;
    risks[idx].confirmed_by = req.body.confirmed_by || '';
    risks[idx].confirmed_at = new Date().toISOString();
    risks[idx].status = '已解决';
    const updated = saveSubArray('projects', pid, 'risks', risks);
    res.json({ code: 200, message: '风险已确认解决', data: parseJSON(updated.risks)[idx] });
  } catch(e) { res.status(500).json({ code: 500, message: '服务器错误' }); }
});

router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ code: 404, message: '项目不存在' });
    res.json({ code: 200, message: '删除成功' });
  } catch (e) {
    console.error('DELETE /projects error:', e);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// 获取所有项目（含关联统计）
router.get('/', (req, res) => {
  try {
    const projects = db.prepare('SELECT * FROM projects ORDER BY id DESC').all();
    const handovers = db.prepare('SELECT * FROM handovers').all();
    const meetings = db.prepare('SELECT * FROM meetings').all();
    const users = db.prepare('SELECT * FROM users').all();
    const userMap = {};
    users.forEach(u => { userMap[u.id] = { id: u.id, nickname: u.nickname, avatar: u.avatar || u.nickname?.charAt(0), dept: u.dept || '' }; });

    const data = projects.map(p => {
      const projectHandovers = handovers.filter(h => h.project_id === p.id);
      const statusCount = { '待接收': 0, '进行中': 0, '已移交': 0 };
      projectHandovers.forEach(h => {
        const s = h.status || '待接收';
        if (statusCount[s] !== undefined) statusCount[s]++;
      });
      // 解析 plan 字段
      let plan = [];
      if (p.plan) {
        try { plan = typeof p.plan === 'string' ? JSON.parse(p.plan) : p.plan; } catch(e) { plan = []; }
      }
      // 解析 tasks 和 milestones 字段
      const tasks = parseJSON(p.tasks);
      const milestones = parseJSON(p.milestones);
      const risks = parseJSON(p.risks);
      // 关联的会议及任务
      const projectMeetings = meetings.filter(m => m.project_id === p.id);
      const meetingTasks = [];
      projectMeetings.forEach(m => {
        let ai = [];
        try { ai = typeof m.action_items === 'string' ? JSON.parse(m.action_items || '[]') : (m.action_items || []); } catch(e) { ai = []; }
        ai.forEach(item => {
          meetingTasks.push({
            ...item,
            meeting_id: m.id,
            meeting_title: m.title || '',
            meeting_date: m.date || '',
          });
        });
      });
      return {
        ...p,
        plan,
        tasks,
        milestones,
        risks,
        leader: p.leader_id ? (userMap[p.leader_id] || null) : null,
        team_members: (p.team_members || []).map(id => userMap[id]).filter(Boolean),
        handover_count: projectHandovers.length,
        handover_status: statusCount,
        meeting_count: projectMeetings.length,
        meeting_tasks: meetingTasks,
      };
    });

    res.json({ code: 200, data });
  } catch (e) {
    console.error('GET /projects error:', e);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// 获取项目下的交接事项
router.get('/:id/handovers', (req, res) => {
  try {
    const pid = parseInt(req.params.id);
    const handovers = db.prepare('SELECT * FROM handovers').all();
    const projectHandovers = handovers.filter(h => h.project_id === pid);
    res.json({ code: 200, data: projectHandovers });
  } catch (e) {
    console.error('GET projects/:id/handovers error:', e);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// ─── 计划每日进展 ───
// PUT /api/projects/:id/plan-daily
// body: { planType?: 'total'|'nonstd'|'std', planIdx?: number, date: "YYYY-MM-DD", status?: string|null, note?: string }
//       或者: { ... nodeName?: string, nodeGroup?: string (按名称+分组查找) }
router.put('/:id/plan-daily', (req, res) => {
  try {
    const pid = parseInt(req.params.id);
    const { planType, planIdx, nodeName, nodeGroup, date, status, note } = req.body;

    if (!date) {
      return res.status(400).json({ code: 400, message: '缺少必要参数 date' });
    }

    const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
    if (!proj) return res.status(404).json({ code: 404, message: '项目不存在' });

    // 选择计划字段（新格式优先，空则回退到旧 plan 字段）
    const planKey = planType === 'nonstd' ? 'plan_nonstd' : planType === 'std' ? 'plan_std' : 'plan_total';
    let planData = proj[planKey];
    // 如果新字段为空或 null，回退到旧的 plan 字段
    if (!planData || (typeof planData === 'string' && planData.trim() === '[]') || (typeof planData === 'string' && planData.trim() === '')) {
      const fallbackPlan = parseJSON(proj['plan']);
      if (fallbackPlan.length > 0) {
        planData = JSON.stringify(fallbackPlan);
      }
    }
    const plan = parseJSON(planData);

    // 查找计划项：优先按 nodeName+nodeGroup，其次 planIdx
    let targetIdx = null;
    if (planIdx !== undefined) {
      if (planIdx >= 0 && planIdx < plan.length) targetIdx = planIdx;
    } else if (nodeName !== undefined) {
      targetIdx = plan.findIndex(p => {
        const nameMatch = (p.name || '').trim() === (nodeName || '').trim();
        const groupMatch = !nodeGroup || (p.group || '').trim() === nodeGroup.trim();
        return nameMatch && groupMatch;
      });
    }
    if (targetIdx === null || targetIdx < 0 || targetIdx >= plan.length) {
      return res.status(400).json({ code: 400, message: '未找到对应计划项' });
    }

    const planItem = plan[targetIdx];
    if (!planItem.daily) planItem.daily = [];

    // status 为 null 表示删除该日记录（回到未开始）
    if (status === null || status === undefined || !status) {
      planItem.daily = planItem.daily.filter(d => d.date !== date);
    } else {
      // 查找该日是否已有记录
      const existingIdx = planItem.daily.findIndex(d => d.date === date);
      if (existingIdx >= 0) {
        planItem.daily[existingIdx].status = status;
        if (note !== undefined) planItem.daily[existingIdx].note = note;
      } else {
        planItem.daily.push({ date, status, note: note || '' });
      }
    }

    // 按日期排序
    planItem.daily.sort((a, b) => a.date.localeCompare(b.date));

    // 保存
    saveSubArray('projects', pid, planKey, plan);
    res.json({
      code: 200,
      message: '进展已更新',
      data: { planIdx: targetIdx, daily: planItem.daily }
    });
  } catch (e) {
    console.error('PUT /projects/:id/plan-daily error:', e);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// GET /api/projects/:id/plan-daily
// 获取指定项目的全部计划每日进展
router.get('/:id/plan-daily', (req, res) => {
  try {
    const pid = parseInt(req.params.id);
    const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
    if (!proj) return res.status(404).json({ code: 404, message: '项目不存在' });

    const plan = parseJSON(proj.plan);
    const dailyMap = {};
    plan.forEach((item, idx) => {
      dailyMap[idx] = item.daily || [];
    });
    res.json({ code: 200, data: dailyMap });
  } catch (e) {
    console.error('GET /projects/:id/plan-daily error:', e);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

module.exports = router;
