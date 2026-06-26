/**
 * 会议记录 API /api/meetings
 */

const router = require('express').Router();
const db = require('../db/database');
const auth = require('../middleware/auth');

// ── 语音转录（需放在 auth 之前，因为 MediaRecorder 请求不带 JWT）──
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

router.post('/transcribe', (req, res) => {
  try {
    const { audio } = req.body;
    if (!audio) return res.status(400).json({ code: 400, message: '缺少音频数据' });

    const buffer = Buffer.from(audio, 'base64');
    const tmpDir = path.join(__dirname, '../../data/tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, `voice_${Date.now()}.webm`);
    fs.writeFileSync(tmpFile, buffer);

    const scriptPath = path.join(__dirname, '../../scripts/transcribe.py');
    execFile('python3', [scriptPath, tmpFile], {
      timeout: 600000,   // 10 min: medium model first load may take time
      maxBuffer: 10 * 1024 * 1024,  // 10MB buffer for full transcript output
      env: { ...process.env, HF_ENDPOINT: 'https://hf-mirror.com' }
    }, (err, stdout, stderr) => {
      if (err) {
        console.error('[transcribe] Python error:', stderr);
        try { fs.unlinkSync(tmpFile); } catch(e) {}
        return res.status(500).json({ code: 500, message: '转录失败' });
      }
      try {
        const result = JSON.parse(stdout.trim());
        if (result.error) {
          return res.status(500).json({ code: 500, message: result.error });
        }
        res.json({ code: 200, text: result.text, duration: result.duration, language: result.language });
      } catch (parseErr) {
        console.error('[transcribe] Parse error:', parseErr);
        res.status(500).json({ code: 500, message: '转录解析失败' });
      }
    });
  } catch (e) {
    console.error('[transcribe] error:', e);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// 所有路由需要登录
router.use(auth);

// ── 列表（支持按项目筛选）──
router.get('/', (req, res) => {
  try {
    let sql = 'SELECT * FROM meetings ORDER BY date DESC, id DESC';
    let rows = db.prepare(sql).all();

    // 关联项目名称和负责人信息
    const projects = db.prepare('SELECT * FROM projects').all();
    const projMap = {};
    for (const p of projects) projMap[p.id] = p;

    const users = db.prepare('SELECT id, nickname, avatar, dept FROM users').all();
    const userMap = {};
    for (const u of users) userMap[u.id] = u;

    rows = rows.map(r => ({
      ...r,
      project_name: r.project_id ? (projMap[r.project_id]?.name || null) : null,
      action_items: typeof r.action_items === 'string' ? JSON.parse(r.action_items || '[]') : (r.action_items || []),
    }));

    if (req.query.project_id) {
      rows = rows.filter(r => r.project_id === parseInt(req.query.project_id));
    }

    res.json({ code: 200, data: rows });
  } catch (e) {
    console.error('GET /meetings error:', e);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// ── 详情 ──
router.get('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM meetings WHERE id = ?').get(parseInt(req.params.id));
    if (!row) return res.status(404).json({ code: 404, message: '会议不存在' });
    row.action_items = typeof row.action_items === 'string' ? JSON.parse(row.action_items || '[]') : (row.action_items || []);
    res.json({ code: 200, data: row });
  } catch (e) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// ── 创建 ──
router.post('/', (req, res) => {
  try {
    const { title, date, time, location, attendees, agenda, minutes, action_items, transcript, status, project_id } = req.body;
    if (!title) return res.status(400).json({ code: 400, message: '会议标题不能为空' });

    const actionItemsJson = action_items ? JSON.stringify(action_items) : '[]';
    const id = db.nextId('meetings');
    const now = new Date().toISOString();

    db.prepare(`INSERT INTO meetings (title, date, time, location, attendees, agenda, minutes, action_items, transcript, status, project_id, user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(title, date || '', time || '', location || '', attendees || '', agenda || '', minutes || '',
        actionItemsJson, transcript || '', status || '待开始', project_id || null, req.user.id, now, now);

    const row = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);
    row.action_items = typeof row.action_items === 'string' ? JSON.parse(row.action_items || '[]') : (row.action_items || []);
    res.json({ code: 200, message: '创建成功', data: row });
  } catch (e) {
    console.error('POST /meetings error:', e);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// ── 更新 ──
router.put('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ code: 404, message: '会议不存在' });

    const allowedFields = ['title', 'date', 'time', 'location', 'attendees', 'agenda', 'minutes', 'action_items', 'transcript', 'status', 'project_id'];
    const setParts = [], values = [];
    for (const f of allowedFields) {
      if (req.body[f] !== undefined) {
        setParts.push(`${f} = ?`);
        values.push(f === 'action_items' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    }
    if (setParts.length === 0) return res.status(400).json({ code: 400, message: '参数不能为空' });
    setParts.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    db.prepare(`UPDATE meetings SET ${setParts.join(',')} WHERE id = ?`).run(...values);
    const row = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);
    row.action_items = typeof row.action_items === 'string' ? JSON.parse(row.action_items || '[]') : (row.action_items || []);
    res.json({ code: 200, message: '更新成功', data: row });
  } catch (e) {
    console.error('PUT /meetings error:', e);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// ── 删除 ──
router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = db.prepare('DELETE FROM meetings WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ code: 404, message: '会议不存在' });
    res.json({ code: 200, message: '删除成功' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// ── 智能摘要：从原始转录生成结构化会议纪要 ──
router.post('/:id/summarize', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ code: 404, message: '会议不存在' });

    const transcript = (req.body.transcript || existing.transcript || '').trim();
    if (!transcript) return res.status(400).json({ code: 400, message: '转录内容不能为空' });

    // ── 智能解析转录文本（增强版中文正则） ──
    const lines = transcript.split(/[\n\r]+/).filter(Boolean);

    // 时间戳清洗：移除 whisper 可能输出的 [00:00.000 --> 00:05.000] 格式
    const cleanLines = lines.map(l => l.replace(/\[\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}\.\d{3}\]/g, '').trim()).filter(Boolean);

    // 1. 讨论主题提取（丰富的会议用语模式）
    const topicPatterns = [
      /^(?:议题|主题|话题|议程|项目|关于|讨论|汇报|介绍|分享|演示|展示|评审|回顾|复盘|总结)[：:]\s*(.+)/,
      /^(?:第[一二三四五六七八九十\d]+[项个条点]?)(?:议题|主题|话题|事情)[：:是]?\s*(.+)/,
      /^(?:第[一二三四五六七八九十\d]+)[、.．]\s*(.+)/,
      /(?:下面|首先|接着|然后|接下来|最后|好|来)[，,]?\s*(?:我们|我)?(?:来)?(?:讨论|介绍|汇报|分享|看|说|讲|过|聊)(?:一下)?\s*(.+)/,
      /(?:现在|今天|本次)(?:讨论|聊|说|讲|介绍)[的]?(?:一下)?(.+)/,
      /(?:第一个|第二个|第三个|下一个)(?:议题|话题|问题|事情)[是]?(.+)/,
      /^(?:[一二三四五六七八九十\d]+)[、.．]\s*(?!.*[，,].*[，,].*[，,])(.+)/,  // 简单序号，但排除长句
    ];

    const topics = [];
    const decisions = [];
    const problems = [];
    const rawActionItems = [];
    const notes = [];  // 普通发言备注

    for (let i = 0; i < cleanLines.length; i++) {
      const line = cleanLines[i].trim();
      if (!line || line.length < 3) continue;

      // ── 检测讨论主题 ──
      let matchedTopic = false;
      for (const pat of topicPatterns) {
        const m = line.match(pat);
        if (m && m[1] && m[1].length >= 2) {
          topics.push(m[1].replace(/[，,。\.！!？?]+$/, ''));
          matchedTopic = true;
          break;
        }
      }
      // 如果上一行短且当前行以"是"或":"开头，可能是主题延续
      if (!matchedTopic && i > 0 && cleanLines[i-1].length <= 15 && /^(?:是|：|:)/.test(line)) {
        topics.push(line.replace(/^[：:是]\s*/, '').slice(0, 60));
      }

      // ── 检测决议/结论（扩展关键词） ──
      if (/(?:决定|结论|决议|确认|通过|达成|敲定|拍板|最终|定了|就这么|同意|批准|授权|指定|选定|选中|确定|明确|规定|要求|必须|务必|一定要)/.test(line)) {
        decisions.push(line);
      }

      // ── 检测问题/风险（扩展关键词） ──
      if (/(?:问题|风险|困难|挑战|阻塞|阻碍|卡住|延迟|延期|超时|异常|报错|失败|不行|不能|没法|没办法|搞不定|出了|遇到|发现.*[问题错误])/.test(line)) {
        problems.push(line);
      }

      // ── 检测待办/行动项（扩展关键词 + 智能提取负责人和截止日期） ──
      const taskKeywords = /(?:待办|任务|需要|负责[：:]?\s*[\u4e00-\u9fa5]{2,4}|跟进|处理|完成|执行|部署|发布|上线|开发|写|改|修复|优化|整理|准备|联系|沟通|协调|申请|提交|发送|测试|验证|检查|评审|上线|合并|提交|记录|文档|邮件)/;
      const isTopicIntro = /^(?:议题|主题|话题|议程|第[一二三四五六七八九十\d]+)/;
      if (taskKeywords.test(line) && !isTopicIntro.test(line)) {
        // 提取负责人 - 仅在明确指派语境下提取
        let assignee = '';
        const assigneePatterns = [
          // 明确指派: "让张三负责"
          /(?:由|让|叫|派|安排|交给|麻烦|请)\s*([\u4e00-\u9fa5]{2,4})(?:同学|老师|总|哥|姐)?\s*(?:来|去)?\s*(?:负责|做|处理|跟进|完成|搞|弄|写|提交|发|开发|改|修复|优化|准备|整理|对接)/,
          // 人名+来/去+动作: "张三来处理"
          /([\u4e00-\u9fa5]{2,4})(?:来|去)\s*(?:负责|做|处理|跟进|完成|写|开发|改|修复|优化|准备|整理|对接)/,
          // 句首/标点后的人名直接+负责: "王五负责..." "张三处理..."（限定2字，降低误判率）
          /(?:^|[，,。\.！!；;、])\s*([\u4e00-\u9fa5]{2})\s*(?:负责|处理|跟进|对接)/,
          // @人名
          /@([\u4e00-\u9fa5]{2,4})/,
        ];
        for (const ap of assigneePatterns) {
          const am = line.match(ap);
          if (am) {
            const name = am[1];
            // 过滤掉明显不是人名的词
            const notNames = /^(?:我们|你们|他们|大家|可以|需要|必须|应该|可能|已经|这个|那个|什么|怎么|因为|所以|但是|关于|对于|根据|通过|下面|上面|前面|后面|里面|外面|之前|之后|现在|今天|明天|昨天|本周|下周|上月|下月|一个|两个|三个|几个|一些|所有|全部|部分|任何|每个|其他|另外|还有|以及|而且|或者|不过|然后|接着|最后|首先|第二|第三|这是|那是|就是|不是|也是|还是|只有|只要|如果|虽然|尽快|马上|立刻|赶紧|争取|希望|需要|下面|问题|风险|困难|性能|优化|修复|连接|泄漏|反馈|数据|架构|预算|会议)$/;
            // 检查提取的词是否全由停用词组成
            const isNameValid = !notNames.test(name);
            if (isNameValid) {
              assignee = name;
              break;
            }
          }
        }

        // 提取截止日期 - 支持多种中文日期表达
        let deadline = '';
        const deadlinePatterns = [
          /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/,
          /(\d{1,2}月\d{1,2}[日号])/,
          /(\d{1,2}\.\d{1,2})/,
          /(下周[一二三四五六日])/,
          /(本周[一二三四五六日])/,
          /(周[一二三四五六日])/,
          /(明天|后天|大后天|今天)/,
          /(周五|周一|周二|周三|周四|周六|周日|星期六|星期天)/,
          /(本[周月]|下周|下月|月底|月初|周末)/,
        ];
        for (const dp of deadlinePatterns) {
          const dm = line.match(dp);
          if (dm) { deadline = dm[1]; break; }
        }

        rawActionItems.push({ line, assignee, deadline });

        // 顺便把有明确负责人的行也加入决议（双重归类）
        if (assignee && !decisions.includes(line)) {
          decisions.push(line);
        }
      }

      // ── 收集普通发言备注（用于生成会议概述） ──
      if (!matchedTopic && line.length >= 10 && line.length <= 200) {
        notes.push(line);
      }
    }

    // ── 去重 ──
    const uniqueTopics = [...new Set(topics)].slice(0, 12);
    const uniqueDecisions = [...new Set(decisions)].slice(0, 10);
    const uniqueProblems = [...new Set(problems)].slice(0, 8);

    // ── 智能摘要生成（从备注中提取关键句） ──
    const summarySentences = [];
    for (const note of notes) {
      // 提取包含关键词的重要句子
      if (/(?:重要|关键|核心|重点|注意|提醒|必须|务必|目标是|计划|方案是|建议|希望能|期望|目标是)/.test(note)) {
        summarySentences.push(note.length > 120 ? note.slice(0, 120) + '...' : note);
      }
    }
    const keySummary = summarySentences.slice(0, 5);

    // ── 构建结构化会议纪要 ──
    let minutes = '## 会议摘要\n\n';

    // 关键摘要（如果有）
    if (keySummary.length > 0) {
      minutes += '### 📌 会议概要\n\n';
      keySummary.forEach((s, i) => { minutes += `${i + 1}. ${s}\n`; });
      minutes += '\n';
    }

    if (uniqueTopics.length > 0) {
      minutes += '### 💬 讨论要点\n\n';
      uniqueTopics.forEach((t, i) => {
        minutes += `${i + 1}. ${t}\n`;
      });
      minutes += '\n';
    }

    if (uniqueDecisions.length > 0) {
      minutes += '### ✅ 决议与结论\n\n';
      uniqueDecisions.forEach((d, i) => {
        minutes += `${i + 1}. ${d.length > 150 ? d.slice(0, 150) + '...' : d}\n`;
      });
      minutes += '\n';
    }

    if (uniqueProblems.length > 0) {
      minutes += '### ⚠️ 待解决问题\n\n';
      uniqueProblems.forEach((p, i) => {
        minutes += `${i + 1}. ${p.length > 150 ? p.slice(0, 150) + '...' : p}\n`;
      });
      minutes += '\n';
    }

    // ── 构建 action_items（带负责人和截止日期） ──
    // 只保留有明确负责人或截止日期的真实待办项
    const actionItems = [];
    const seenTasks = new Set();
    for (const ai of rawActionItems) {
      // 必须有负责人或截止日期，否则不算真正的待办
      const hasRealAssignee = ai.assignee && ai.assignee.length >= 2;
      const hasDeadline = ai.deadline && ai.deadline.length >= 1;
      if (!hasRealAssignee && !hasDeadline) continue;
      
      const task = ai.line.length > 120 ? ai.line.slice(0, 120) + '...' : ai.line;
      if (seenTasks.has(task)) continue;
      seenTasks.add(task);
      actionItems.push({
        task: task,
        assignee: ai.assignee,
        deadline: ai.deadline,
      });
    }

    if (actionItems.length > 0) {
      minutes += '### 📋 待办事项\n\n';
      actionItems.forEach((ai, i) => {
        minutes += `${i + 1}. ${ai.task}`;
        if (ai.assignee) minutes += ` — **${ai.assignee}**`;
        if (ai.deadline) minutes += ` ⏰ ${ai.deadline}`;
        minutes += '\n';
      });
      minutes += '\n';
    }

    // 如果没有提取到任何结构化内容
    if (!uniqueTopics.length && !uniqueDecisions.length && !actionItems.length) {
      // 智能分段：按句子切分后标注为发言纪要
      const sentences = transcript.split(/[。！？\.!\?]+/).filter(s => s.trim().length > 5).slice(0, 15);
      if (sentences.length > 0) {
        minutes = '## 会议摘要\n\n### 📝 发言纪要\n\n';
        sentences.forEach((s, i) => {
          minutes += `${i + 1}. ${s.trim()}\n`;
        });
        minutes += '\n> 💡 提示：以上为智能分段结果，建议在编辑弹窗中补充议题和决议。\n';
      } else {
        minutes = '## 会议摘要\n\n（转录内容中未检测到结构化信息。建议手动整理或使用更清晰的表达重新录制。）\n\n> 💡 提示：说话时尽量使用清晰的表达，例如「第一个议题是...」「决定...」「请XX负责...下周三前完成」。';
      }
    }

    // 更新会议记录
    const actionItemsJson = JSON.stringify(actionItems);
    const now = new Date().toISOString();
    db.prepare('UPDATE meetings SET minutes = ?, action_items = ?, transcript = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(minutes, actionItemsJson, transcript, '进行中', now, id);

    const row = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);
    row.action_items = typeof row.action_items === 'string' ? JSON.parse(row.action_items || '[]') : (row.action_items || []);

    // ── 自动同步待办到关联项目 ──
    if (existing.project_id && actionItems.length > 0) {
      try {
        const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(existing.project_id);
        if (proj) {
          let plan = [];
          if (proj.plan) {
            try { plan = typeof proj.plan === 'string' ? JSON.parse(proj.plan) : proj.plan; } catch(e) { plan = []; }
          }
          const today = new Date().toISOString().slice(0, 10);
          // 合并：为每个待办创建一个计划节点（去重：同名+同负责人不重复添加）
          const existingKeys = new Set(plan.map(n => `${n.name||''}|${n.assignee||''}|${n.source||''}`));
          let added = 0;
          for (const ai of actionItems) {
            const key = `${ai.task}|${ai.assignee}|meeting`;
            if (existingKeys.has(key)) continue;
            existingKeys.add(key);
            // 截止日期转 end，无截止日期则默认 +7 天
            let endDate = today;
            if (ai.deadline) {
              // 尝试解析截止日期
              const dm = ai.deadline.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
              if (dm) endDate = dm[1].replace(/\//g, '-');
              else endDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
            } else {
              endDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
            }
            plan.push({
              name: `[会议] ${ai.task}`,
              start: today,
              end: endDate,
              status: '待开始',
              assignee: ai.assignee || '',
              source: 'meeting',
              meeting_id: id,
              meeting_title: existing.title || ''
            });
            added++;
          }
          if (added > 0) {
            db.prepare('UPDATE projects SET plan = ?, updated_at = ? WHERE id = ?')
              .run(JSON.stringify(plan), new Date().toISOString(), existing.project_id);
            row._syncedToProject = { project_id: existing.project_id, items_added: added };
          }
        }
      } catch (syncErr) {
        console.error('[summarize] Sync to project error:', syncErr);
        // 不影响主流程
      }
    }

    // ── 自动同步待办到责任人交接任务 ──
    if (actionItems.length > 0) {
      try {
        const users = db.prepare('SELECT id, nickname, username FROM users').all();
        const allHandovers = db.prepare('SELECT * FROM handovers').all();
        const io = req.app.get('io');
        let handoverAdded = 0;

        for (const ai of actionItems) {
          if (!ai.assignee) continue;

          // 通过 nickname 或 username 匹配用户
          const matchedUser = users.find(u => u.nickname === ai.assignee || u.username === ai.assignee);
          if (!matchedUser) continue;

          // 去重：同源＋同会议＋同责任人＋同任务标题
          const dup = allHandovers.find(h =>
            h.source === 'meeting' && h.source_id === id &&
            h.to_user_id === matchedUser.id &&
            h.title === `[会议待办] ${ai.task}`
          );
          if (dup) continue;

          const description = [
            `来源会议：${existing.title || '未命名会议'}`,
            `会议日期：${existing.date || ''} ${existing.time || ''}`,
            `会议地点：${existing.location || '线上'}`,
            `待办描述：${ai.task}`,
            `截止日期：${ai.deadline || '待定'}`
          ].join('\n');

          db.prepare(`INSERT INTO handovers (title, description, from_user, status, priority, to_user_id, project_id, user_id, source, source_id)
            VALUES (?,?,?,?,?,?,?,?,?,?)`)
            .run(
              `[会议待办] ${ai.task}`,
              description,
              '会议自动生成',
              '待接收',
              ai.priority || '中',
              matchedUser.id,
              existing.project_id || null,
              req.user.id,
              'meeting',
              id
            );
          handoverAdded++;

          // Socket.IO 通知责任人
          if (io) {
            const notifMsg = {
              id: db.nextId('messages'),
              from_user_id: req.user.id,
              to_user_id: matchedUser.id,
              content: `📋 新会议待办：${ai.task}（会议：${existing.title || ''}）`,
              type: 'system',
              created_at: now
            };
            db.messages.insert(notifMsg);
            io.to('user:' + matchedUser.id).emit('new-message', notifMsg);
          }
        }

        if (handoverAdded > 0) {
          row._syncedToHandover = { items_added: handoverAdded };
        }
      } catch (syncErr) {
        console.error('[summarize] Sync to handover error:', syncErr);
      }
    }

    res.json({ code: 200, message: 'AI 摘要已生成', data: row });
  } catch (e) {
    console.error('POST /meetings/:id/summarize error:', e);
    res.status(500).json({ code: 500, message: '服务器错误: ' + e.message });
  }
});

// ── POST /:id/sync-handovers  补录历史会议待办到责任人交接 ─────────────────────
router.post('/:id/sync-handovers', auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ code: 404, message: '会议不存在' });

    const actionItems = typeof existing.action_items === 'string'
      ? JSON.parse(existing.action_items || '[]')
      : (existing.action_items || []);

    if (actionItems.length === 0) {
      return res.json({ code: 200, message: '该会议没有待办事项', data: { added: 0 } });
    }

    const users = db.prepare('SELECT id, nickname, username FROM users').all();
    const allHandovers = db.prepare('SELECT * FROM handovers').all();
    const io = req.app.get('io');
    const now = new Date().toISOString();
    let added = 0, skipped = 0;

    for (const ai of actionItems) {
      if (!ai.task) continue;

      // 匹配责任人
      const matchedUser = ai.assignee
        ? users.find(u => u.nickname === ai.assignee || u.username === ai.assignee)
        : null;

      // 去重
      const dup = allHandovers.find(h =>
        h.source === 'meeting' && String(h.source_id) === String(id) &&
        h.title === `[会议待办] ${ai.task}`
      );
      if (dup) { skipped++; continue; }

      const description = [
        `来源会议：${existing.title || '未命名会议'}`,
        `会议日期：${existing.date || ''} ${existing.time || ''}`,
        `会议地点：${existing.location || '线上'}`,
        `待办描述：${ai.task}`,
        `截止日期：${ai.deadline || '待定'}`
      ].join('\n');

      db.prepare(`INSERT INTO handovers (title, description, from_user, status, priority, to_user_id, project_id, user_id, source, source_id)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(
          `[会议待办] ${ai.task}`,
          description,
          '会议自动生成',
          '待接收',
          ai.priority || '中',
          matchedUser ? matchedUser.id : null,
          existing.project_id || null,
          req.user.id,
          'meeting',
          id
        );
      added++;

      // Socket.IO 通知责任人
      if (io && matchedUser) {
        const notifMsg = {
          id: db.nextId('messages'),
          from_user_id: req.user.id,
          to_user_id: matchedUser.id,
          content: `📋 新会议待办：${ai.task}（会议：${existing.title || ''}）`,
          type: 'system',
          created_at: now
        };
        db.messages.insert(notifMsg);
        io.to('user:' + matchedUser.id).emit('new-message', notifMsg);
      }
    }

    res.json({ code: 200, message: `同步完成：新增 ${added} 条，已跳过 ${skipped} 条（重复）`, data: { added, skipped } });
  } catch (e) {
    console.error('POST /meetings/:id/sync-handovers error:', e);
    res.status(500).json({ code: 500, message: '服务器错误: ' + e.message });
  }
});

module.exports = router;
