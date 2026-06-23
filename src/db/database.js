/**
 * JSON 文件数据库（纯 JS，无原生依赖）
 * 提供与 better-sqlite3 兼容的 .prepare(sql).get()/.all()/.run() 接口
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.resolve(process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : './data');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── 文件路径 ──
const FILES = {
  users:       path.join(DATA_DIR, 'users.json'),
  verify_codes:path.join(DATA_DIR, 'verify_codes.json'),
  notices:     path.join(DATA_DIR, 'notices.json'),
  knowledge:   path.join(DATA_DIR, 'knowledge.json'),
  dynamics:    path.join(DATA_DIR, 'dynamics.json'),
  handovers:   path.join(DATA_DIR, 'handovers.json'),
  activities:  path.join(DATA_DIR, 'activities.json'),
  messages:    path.join(DATA_DIR, 'messages.json'),
  projects:    path.join(DATA_DIR, 'projects.json'),
  meetings:    path.join(DATA_DIR, 'meetings.json'),
};

// ── 读写 JSON 文件（原子写入 + 自动备份 + 损坏恢复）──

function readTable(table) {
  const fp = FILES[table];
  if (!fs.existsSync(fp)) return [];

  try {
    const raw = fs.readFileSync(fp, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    // 主文件损坏，尝试从备份恢复
    console.error(`[DATA] ${table}.json 损坏: ${e.message}，尝试从 .bak 恢复...`);
    const bakPath = fp + '.bak';
    if (fs.existsSync(bakPath)) {
      try {
        const bakRaw = fs.readFileSync(bakPath, 'utf-8');
        const bakData = JSON.parse(bakRaw);
        if (Array.isArray(bakData) && bakData.length > 0) {
          // 恢复成功：用备份覆盖损坏的主文件
          fs.writeFileSync(fp, bakRaw, 'utf-8');
          console.log(`[DATA] ${table}.json 已从 .bak 恢复 (${bakData.length} 条)`);
          return bakData;
        }
      } catch (bakErr) {
        console.error(`[DATA] ${table}.json.bak 也损坏: ${bakErr.message}`);
      }
    }
    // 备份也失败 → 返回空数组（避免覆盖，但数据已丢失）
    console.error(`[DATA] ⚠️ ${table}.json 数据无法恢复，返回空数组`);
    return [];
  }
}

function writeTable(table, rows) {
  const fp = FILES[table];
  const tmpPath = fp + '.tmp';
  const bakPath = fp + '.bak';
  const content = JSON.stringify(rows, null, 2);

  try {
    // Step 1: 先写临时文件（如果崩溃，不影响主文件）
    fs.writeFileSync(tmpPath, content, 'utf-8');

    // Step 2: 备份旧的主文件（如果存在且有效）
    if (fs.existsSync(fp)) {
      try {
        const oldContent = fs.readFileSync(fp, 'utf-8');
        JSON.parse(oldContent); // 验证旧文件是有效 JSON
        fs.writeFileSync(bakPath, oldContent, 'utf-8');
      } catch (e) {
        // 旧文件已损坏 → 不备份，直接覆盖
        console.warn(`[DATA] ${table}.json 旧文件已损坏，跳过备份`);
      }
    }

    // Step 3: 原子替换（rename 在同一个文件系统上是原子的）
    fs.renameSync(tmpPath, fp);
  } catch (e) {
    // rename 失败时，回退到直接写入
    console.error(`[DATA] ${table}.json 原子写入失败: ${e.message}，回退到直接写入`);
    try {
      fs.writeFileSync(fp, content, 'utf-8');
      // 清理临时文件
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (fallbackErr) {
      console.error(`[DATA] ${table}.json 直接写入也失败: ${fallbackErr.message}`);
      throw fallbackErr;
    }
  }
}

function nextId(table) {
  const rows = readTable(table);
  if (rows.length === 0) return 1;
  return Math.max(...rows.map(r => r.id || 0)) + 1;
}

function now() {
  return new Date().toISOString();
}

function nowSQL() {
  // 返回 SQLite 风格时间字符串，用于 datetime() 比较的兼容
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

// ── SQL 解析器 ──
// 支持本项目中使用的特定 SQL 模式

function parseSelect(sql, params) {
  // SELECT column FROM table WHERE ... ORDER BY ... LIMIT ...
  sql = sql.trim();
  const selectMatch = sql.match(/^SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?$/is);
  if (!selectMatch) throw new Error('Unsupported SELECT: ' + sql);

  const columns = selectMatch[1].trim();
  const table = selectMatch[2].trim().toLowerCase();
  const whereClause = selectMatch[3] || null;
  const orderBy = selectMatch[4] || null;
  const limit = selectMatch[5] ? parseInt(selectMatch[5]) : null;

  let rows = readTable(table);

  // 处理 WHERE 子句
  if (whereClause) {
    // 处理 WHERE col = ? AND datetime(col2, '+N seconds') > datetime('now')
    // 简化为 AND 分割
    const conditions = splitWhere(whereClause);
    let paramIdx = 0;

    for (const cond of conditions) {
      const trimmed = cond.trim();
      if (trimmed.includes('datetime(') && trimmed.includes("'now'")) {
        // 时间条件：datetime(col, '+N seconds') > datetime('now') 或类似
        const colMatch = trimmed.match(/datetime\((\w+),\s*'\+(\d+)\s*(\w+)'\)\s*([><=]+)\s*datetime\('now'\)/);
        if (colMatch) {
          const col = colMatch[1];
          const num = parseInt(colMatch[2]);
          const unit = colMatch[3];
          const op = colMatch[4];

          rows = rows.filter(r => {
            const val = new Date(r[col]);
            if (isNaN(val.getTime())) return false;
            const ms = unit === 'seconds' ? num * 1000 : unit === 'minutes' ? num * 60000 : unit === 'hours' ? num * 3600000 : num * 86400000;
            const threshold = new Date(val.getTime() + ms);
            if (op === '>' || op === '>=') return threshold > new Date();
            if (op === '<' || op === '<=') return threshold < new Date();
            return false;
          });
          continue;
        }
        // datetime(expires_at) > datetime('now')
        const simpleMatch = trimmed.match(/datetime\((\w+)\)\s*([><=]+)\s*datetime\('now'\)/);
        if (simpleMatch) {
          const col = simpleMatch[1];
          const op = simpleMatch[2];
          rows = rows.filter(r => {
            const val = new Date(r[col]);
            if (isNaN(val.getTime())) return false;
            if (op === '>') return val > new Date();
            if (op === '<') return val < new Date();
            return false;
          });
          continue;
        }
      }

      // 处理 col = ? 或 col = 'value'
      if (trimmed.includes('= ?')) {
        const col = trimmed.split('= ?')[0].trim();
        const val = params[paramIdx++];
        rows = rows.filter(r => String(r[col]) === String(val));
      } else if (trimmed.includes('= ')) {
        const parts = trimmed.split('=');
        const col = parts[0].trim();
        let val = parts.slice(1).join('=').trim().replace(/^'|'$/g, '');
        if (val === "'now'") continue;
        rows = rows.filter(r => String(r[col]) === String(val));
      } else if (trimmed.includes(' OR ')) {
        // col1 = ? OR col2 = ?
        const orParts = trimmed.split(/\s+OR\s+/i);
        rows = rows.filter(r => {
          return orParts.some(part => {
            if (part.includes('= ?')) {
              const col = part.split('= ?')[0].trim();
              const val = params[paramIdx] !== undefined ? params[paramIdx] : null;
              return String(r[col]) === String(val);
            }
            return false;
          });
        });
        if (trimmed.includes('= ?')) paramIdx += orParts.filter(p => p.includes('= ?')).length;
      }
    }
  }

  // 排序
  if (orderBy) {
    const [orderCol, orderDir] = orderBy.split(/\s+/);
    const dir = (orderDir || 'ASC').toUpperCase() === 'DESC' ? -1 : 1;
    rows.sort((a, b) => {
      if (a[orderCol] < b[orderCol]) return -dir;
      if (a[orderCol] > b[orderCol]) return dir;
      return 0;
    });
  } else {
    // 默认按 id DESC
    rows.sort((a, b) => b.id - a.id);
  }

  // LIMIT
  if (limit) rows = rows.slice(0, limit);

  // 处理 SELECT COUNT(*) as c
  if (columns === 'COUNT(*) as c') {
    return { __count: [{ c: rows.length }] };
  }

  return rows;
}

function splitWhere(whereClause) {
  // 简单的 AND 分割（不处理嵌套）
  return whereClause.split(/\s+AND\s+/i);
}

// ── 构建兼容接口 ──

const stmtCache = {};

function createStmt(sql) {
  sql = sql.trim();

  if (stmtCache[sql]) return stmtCache[sql];

  let handler;

  // SELECT
  if (/^SELECT/i.test(sql)) {
    handler = {
      get(...params) { const rows = parseSelect(sql, params); return rows.length > 0 ? rows[0] : undefined; },
      all(...params) { return parseSelect(sql, params); },
      run() { throw new Error('SELECT does not support run()'); },
    };
  }
  // INSERT
  else if (/^INSERT\s+INTO/i.test(sql)) {
    const tableMatch = sql.match(/INSERT\s+INTO\s+(\w+)/i);
    const table = tableMatch[1].toLowerCase();
    const colsMatch = sql.match(/\(([^)]+)\)/);
    const cols = colsMatch ? colsMatch[1].split(',').map(c => c.trim()) : [];

    handler = {
      run(...values) {
        const rows = readTable(table);
        const id = nextId(table);
        const row = { id };
        cols.forEach((col, i) => { row[col] = values[i] !== undefined ? values[i] : null; });
        // 自动添加时间戳
        if (cols.includes('created_at') === false) row.created_at = now();
        if (cols.includes('updated_at') === false && table !== 'verify_codes' && table !== 'dynamics' && table !== 'activities') row.updated_at = now();
        rows.push(row);
        writeTable(table, rows);
        return { changes: 1, lastInsertRowid: id };
      },
      get() { throw new Error('INSERT does not support get()'); },
      all() { throw new Error('INSERT does not support all()'); },
    };
  }
  // UPDATE
  else if (/^UPDATE/i.test(sql)) {
    const tableMatch = sql.match(/UPDATE\s+(\w+)/i);
    const table = tableMatch[1].toLowerCase();

    handler = {
      run(...values) {
        const rows = readTable(table);
        // 找到 WHERE id = ? 中的值（取最后一个参数）
        const idVal = values[values.length - 1];
        const setPart = sql.match(/SET\s+(.+?)\s+WHERE/is)[1];

        // 解析 SET 子句: col = COALESCE(?, col), col2 = ? 等
        const setItems = setPart.split(',').map(s => s.trim());
        let setValIdx = 0;

        const updateData = {};
        for (const item of setItems) {
          if (item.includes('COALESCE')) {
            const colMatch = item.match(/^(\w+)\s*=\s*COALESCE/i);
            if (colMatch) {
              updateData[colMatch[1]] = values[setValIdx++];
            }
          } else if (item.includes('= ?')) {
            const col = item.split('= ?')[0].trim();
            if (col !== 'updated_at') {
              updateData[col] = values[setValIdx++];
            }
          }
        }

        // updated_at
        if (setPart.includes('updated_at')) {
          updateData.updated_at = now();
        }

        let changed = 0;
        for (const r of rows) {
          if (String(r.id) === String(idVal)) {
            Object.assign(r, updateData);
            changed++;
          }
        }

        if (changed > 0) writeTable(table, rows);
        return { changes: changed, lastInsertRowid: 0 };
      },
      get() { throw new Error('UPDATE does not support get()'); },
      all() { throw new Error('UPDATE does not support all()'); },
    };
  }
  // DELETE
  else if (/^DELETE/i.test(sql)) {
    const tableMatch = sql.match(/DELETE\s+FROM\s+(\w+)/i);
    const table = tableMatch[1].toLowerCase();

    handler = {
      run(...values) {
        const rows = readTable(table);
        const idVal = values[0];
        const newRows = rows.filter(r => String(r.id) !== String(idVal));
        const changed = rows.length - newRows.length;
        if (changed > 0) writeTable(table, newRows);
        return { changes: changed, lastInsertRowid: 0 };
      },
      get() { throw new Error('DELETE does not support get()'); },
      all() { throw new Error('DELETE does not support all()'); },
    };
  }
  else {
    handler = {
      get() { throw new Error('Unsupported SQL: ' + sql); },
      all() { throw new Error('Unsupported SQL: ' + sql); },
      run() { throw new Error('Unsupported SQL: ' + sql); },
    };
  }

  // 对于 SELECT COUNT(*)，特殊处理
  if (/^SELECT\s+COUNT\(\*\)/i.test(sql)) {
    handler = {
      get(...params) {
        const rows = parseSelect(sql, params);
        return rows.__count ? rows.__count[0] : { c: 0 };
      },
      all(...params) {
        const rows = parseSelect(sql, params);
        return rows.__count || [{ c: 0 }];
      },
      run() { throw new Error('SELECT COUNT does not support run()'); },
    };
  }

  stmtCache[sql] = handler;
  return handler;
}

const db = {
  prepare(sql) {
    return createStmt(sql);
  },

  // 获取下一个 ID
  nextId(table) {
    return nextId(table);
  },

  // 消息直接插入（绕过 SQL 解析器）
  messages: {
    insert(msg) {
      const rows = readTable('messages');
      const id = msg.id || nextId('messages');
      rows.push({ id, ...msg, created_at: msg.created_at || now() });
      writeTable('messages', rows);
      return { changes: 1, lastInsertRowid: id };
    },
    getByUsers(uid1, uid2) {
      const rows = readTable('messages');
      return rows
        .filter(m => (m.from_user_id === uid1 && m.to_user_id === uid2) || (m.from_user_id === uid2 && m.to_user_id === uid1))
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    },
    delete(msgId) {
      const rows = readTable('messages');
      const idx = rows.findIndex(m => m.id === msgId);
      if (idx === -1) return { changes: 0 };
      rows.splice(idx, 1);
      writeTable('messages', rows);
      return { changes: 1 };
    },
    getConversations(userId) {
      const rows = readTable('messages');
      const users = readTable('users');
      const userMap = {};
      for (const u of users) userMap[u.id] = { id: u.id, nickname: u.nickname, avatar: u.avatar || u.nickname?.charAt(0), dept: u.dept || '' };

      const convMap = {};
      for (const m of rows) {
        if (m.from_user_id !== userId && m.to_user_id !== userId) continue;
        const peerId = m.from_user_id === userId ? m.to_user_id : m.from_user_id;
        if (!convMap[peerId] || new Date(m.created_at) > new Date(convMap[peerId].lastTime)) {
          convMap[peerId] = {
            peerId,
            peer: userMap[peerId] || { id: peerId, nickname: '未知', avatar: '?' },
            lastMsg: m.content?.slice(0, 50) || '',
            lastTime: m.created_at,
            lastFromMe: m.from_user_id === userId,
          };
        }
      }
      return Object.values(convMap).sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime));
    },
  },

  // 兼容方法：直接执行（用于 pragma）
  pragma(key, value) {
    // WAL / foreign_keys 不需要在 JSON 数据库中处理
    return true;
  },

  close() {
    // JSON 文件不需要关闭
  },
};

module.exports = db;
