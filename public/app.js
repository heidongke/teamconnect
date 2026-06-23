// ╔══════════════════════════════════════════════════════════════╗

// ║  API 层 — 所有请求统一走这里                                  ║

// ╚══════════════════════════════════════════════════════════════╝



const API_BASE = '';   // 同域部署时留空；跨域时填 'http://your-server-ip:3000'

const TOKEN_KEY = 'tc_token';



function getToken() { return localStorage.getItem(TOKEN_KEY); }

function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }

function clearToken() { localStorage.removeItem(TOKEN_KEY); }



async function api(method, path, body) {

  const headers = { 'Content-Type': 'application/json' };

  const token = getToken();

  if (token) headers['Authorization'] = 'Bearer ' + token;



  const res = await fetch(API_BASE + path, {

    method,

    headers,

    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,

  });

  const json = await res.json();

  if (res.status === 401) {

    clearToken();

    document.getElementById('loginScreen').classList.remove('hidden');

    showToast('登录已过期，请重新登录');

    throw new Error('Unauthorized');

  }

  return json;

}



const GET    = (path)        => api('GET',    path);

const POST   = (path, body)  => api('POST',   path, body);

const PUT    = (path, body)  => api('PUT',    path, body);

const DELETE = (path)        => api('DELETE', path);



// ╔══════════════════════════════════════════════════════════════╗

// ║  状态管理                                                     ║

// ╚══════════════════════════════════════════════════════════════╝



let CURRENT_USER = null; let currentTab = 0;

let SOCKET = null;

let CHAT = { conversations: [], activePeer: null, contacts: [], convView: true, unreadCounts: {} };

let NOTIFY = { enabled: false, soundEnabled: true, bannerQueue: [] };

let NOTIFICATIONS = [];     // 通知中心消息

let INFO_UNREAD = 0;        // 信息广场未读计数

let CTX_MSG = null;         // 右键/长按的消息

let CONFIRM_CB = null;      // 确认回调



// ── Emoji 数据 ──

const EMOJIS = ['😀','😂','🤣','😍','😎','🤩','😘','🥰','😜','🤔','😴','😢','😡','👍','👎','👏','🙌','💪','🤝','❤️','💔','🔥','⭐','🎉','🎊','✨','💯','✅','❌','⚠️','📌','📎','💡','🔔','📢','📅','⏰','🚀','💻','📱','🎯','🏆','🥇','🥈','🥉','🍕','☕','🎂','🌈','💎','🫡','🤗','🙏','💀','🎵','📸','🔗','📝','💬','🗑','✏️','🔄'];



// 存储来自 API 的数据

let DATA = {

  profile: { avatar: '？', name: '', username: '', dept: '', team: '', email: '', phone: '' },

  notices: [], knowledge: [], dynamics: [],

  handovers: [], activities: [],

  members: [], projects: [], meetings: [], allTasks: [],

  s2: { filterTabs: ['待处理', '进行中', '已移交', '已退回'], activeFilter: 0 },

  s3: { filterTabs: ['即将开始', '往期回顾'], activeFilter: 0 },

  expandedProject: null, expandedMeeting: null,

  expandedPlanDaily: {},  // { "projId-planIdx": true } — 展开/折叠每日甘特图

  projectDetailId: null,  // 当前查看的项目详情ID，null=列表视图

  projectFilter: 'all',

  ganttView: 'day',     // day | month | year
  planGanttView: 'day', // 项目计划甘特图视图 day | month | year
  singleGanttView: 'month', // 单品甘特图视图 day | month | year
  planSubTab: 'total',  // total | nonstd | std 项目计划子标签
  copiedPlan: null,     // 计划编辑器复制/粘贴缓存

  s4: {

    menu: [

      { label: '项目总览',    badgeColor: 'primary', action: 'switchTo(5)' },

      { label: '甘特图总览',  badgeColor: 'blue',    action: 'switchTo(5);switchS6Sub(1)' },

      { label: '会议记录',    badgeColor: 'blue',    action: 'switchTo(2);switchS3Sub(1)' },

      { label: '我的交接记录', badgeColor: 'primary', action: 'switchTo(1)' },

      { label: '我的报名活动', badgeColor: 'green',   action: 'switchTo(2)' },

      { label: '消息通知中心', badgeColor: 'red', action: 'openNotifCenter()', badgeElement: 's4NotifBadge' },

      { label: '账号设置',    badgeColor: '', action: 'openPasswordModal()' }

    ]

  }

};



// ╔══════════════════════════════════════════════════════════════╗

// ║  登录                                                         ║

// ╚══════════════════════════════════════════════════════════════╝



// ── 密码登录 ──

async function doLogin() {

  const user  = document.getElementById('loginUser').value.trim();

  const pass  = document.getElementById('loginPass').value.trim();

  const errEl = document.getElementById('loginError');



  if (!user || !pass) { errEl.textContent = '请输入用户名和密码'; return; }

  errEl.textContent = '';



  try {

    const res = await POST('/api/auth/login', { username: user, password: pass, loginType: 'password' });

    if (res.code !== 200) { errEl.textContent = res.message; return; }

    setToken(res.token);

    CURRENT_USER = res.user;

    afterLogin();

    showToast('登录成功');

  } catch(e) {

    if (e.message !== 'Unauthorized') errEl.textContent = '网络错误，请稍后重试';

  }

}



// ── 登出 ──

function doLogout() {

  showConfirm('确定要退出登录吗？', () => {

    if (SOCKET) { SOCKET.disconnect(); SOCKET = null; }

    clearToken();

    CURRENT_USER = null;

    DATA.members = [];

    CHAT = { conversations: [], activePeer: null, contacts: [], convView: true };

    document.getElementById('loginScreen').classList.remove('hidden');

    document.getElementById('loginUser').value = '';

    document.getElementById('loginPass').value = '';

    document.getElementById('loginError').textContent = '';

    document.getElementById('loginUser').focus();

  });

}



// ── Enter 键 ──

document.addEventListener('keydown', e => {

  if (e.key === 'Enter' && !document.getElementById('loginScreen').classList.contains('hidden')) {

    doLogin();

  }

});



// ╔══════════════════════════════════════════════════════════════╗

// ║  登录后初始化                                                 ║

// ╚══════════════════════════════════════════════════════════════╝



async function afterLogin() {

  document.getElementById('loginScreen').classList.add('hidden');

  await fetchAllData();

  connectSocket();

  requestNotifyPermission();

  renderAll();

  startClock();

  setupDragScroll();

}


// ── 甘特图拖动滚动 ──
function setupDragScroll() {
  document.addEventListener('mousedown', function(e) {
    const wrapper = e.target.closest('.gantt-wrapper');
    if (!wrapper) return;
    const parent = wrapper.parentElement;
    if (!parent) return;
    const startX = e.clientX;
    const startScroll = parent.scrollLeft;
    const onMove = function(ev) {
      parent.scrollLeft = startScroll - (ev.clientX - startX);
    };
    const onUp = function() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}



// ╔══════════════════════════════════════════════════════════════╗

// ║  实时时钟 (精确到秒)                                           ║

// ╚══════════════════════════════════════════════════════════════╝



function updateClock() {

  const now = new Date();

  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  const m = now.getMonth() + 1;

  const d = now.getDate();

  const wd = weekDays[now.getDay()];

  const t = now.toLocaleTimeString('zh-CN', { hour12: false });

  const display = `${m}月${d}日 ${wd} ${t}`;

  document.querySelectorAll('.live-clock').forEach(el => el.textContent = display);

}



function startClock() {

  updateClock();

  setInterval(updateClock, 1000);

}



async function fetchAllData() {

  try {

    const [userRes, contentRes, membersRes] = await Promise.all([

      GET('/api/auth/me'),

      GET('/api/content/all'),

      GET('/api/members')

    ]);

    if (userRes.code === 200) {

      CURRENT_USER = userRes.user;

      DATA.profile = {

        avatar:   userRes.user.avatar || userRes.user.nickname.charAt(0),

        name:     userRes.user.nickname,

        username: userRes.user.username || '',

        dept:     userRes.user.dept || '',

        team:     userRes.user.team_group || '',

        email:    userRes.user.email || '',

        phone:    userRes.user.phone || ''

      };

    }

    if (contentRes.code === 200) {

      const d = contentRes.data;

      DATA.notices    = d.notices    || [];

      DATA.knowledge  = d.knowledge  || [];

      DATA.dynamics   = d.dynamics   || [];

      DATA.handovers  = d.handovers  || [];

      DATA.activities = d.activities || [];

      DATA.projects   = d.projects   || [];

      DATA.meetings   = d.meetings   || [];

      DATA.allTasks   = d.allTasks   || [];

    }

    if (membersRes.code === 200) {

      DATA.members = membersRes.data || [];

    }

  } catch(e) {

    console.error('获取数据失败', e);

  }

}



// ╔══════════════════════════════════════════════════════════════╗

// ║  Tab Bar                                                      ║

// ╚══════════════════════════════════════════════════════════════╝



function renderTabBar(containerId, activeIdx) {

  const tabs = [

    { label: '信息', icon: '<path d="M13 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V9L13 2Z"/><path d="M13 2V9H20"/>' },

    { label: '交接', icon: '<path d="M7 17L11 21L19 13"/><path d="M15 7H10C8.34 7 7 8.34 7 10V14"/>' },

    { label: '活动', icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },

    { label: '我的', icon: '<circle cx="12" cy="7" r="4"/><path d="M4 21V19C4 16.79 5.79 15 8 15H16C18.21 15 20 16.79 20 19V21"/>' },

    { label: '聊天', icon: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>' },

    { label: '项目', icon: '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>' }

  ];

  return `<div class="tab-bar-container">

    <div class="tab-pill">

      ${tabs.map((t, i) => `

        <button class="tab-item${i === activeIdx ? ' active' : ''}" onclick="switchTab(${i})" style="position:relative;">

          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg>

          <span class="tab-label">${t.label}</span>

          ${i === 0 ? `<span class="tab-badge" id="infoTabBadge" style="display:none;"></span>` : ''}

        </button>`).join('')}

    </div>

  </div>`;

}



function cardActions(editFn, deleteFn) {

  return `<div class="card-actions">

    <button class="card-action-btn" onclick="event.stopPropagation();${editFn}" title="编辑">

      <svg viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="2"><path d="M11 4H4C3.45 4 3 4.45 3 5V20C3 20.55 3.45 21 4 21H19C19.55 21 20 20.55 20 20V13"/><path d="M18.5 2.5C19.33 1.67 20.67 1.67 21.5 2.5C22.33 3.33 22.33 4.67 21.5 5.5L12 15L8 16L9 12L18.5 2.5Z"/></svg>

    </button>

    <button class="card-action-btn danger" onclick="event.stopPropagation();confirmCardDelete(()=>{${deleteFn}})" title="删除">

      <svg viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2"><path d="M3 6H21"/><path d="M8 6V4C8 3.45 8.45 3 9 3H15C15.55 3 16 3.45 16 4V6"/><path d="M19 6V20C19 20.55 18.55 21 18 21H6C5.45 21 5 20.55 5 20V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>

    </button>

  </div>`;

}



function confirmCardDelete(cb) {

  showConfirm('确定删除？此操作不可撤销。', cb);

}



function badgeClass(b) {

  if (!b) return '';

  const m = { '重要': 'red', '高': 'red', '即将开始': 'green', '低': 'green', '普通': 'blue', '知识': 'blue', '中': 'orange', '报名中': 'blue', '通知': 'blue', '公告': 'orange', '提醒': 'green', '培训': 'blue', '团建': 'green', '周报': 'green', '日报': 'blue' };

  return m[b] || 'blue';

}



// ── Screen 1: 信息广场 ──

function renderS1() {

  // 收集所有项目风险

  const allRisks = [];

  (DATA.projects || []).forEach(p => {

    safeArr(p.risks).forEach(r => {

      allRisks.push({ ...r, project_name: p.name, project_id: p.id });

    });

  });

  const riskCount = allRisks.length;

  const activeRisks = allRisks.filter(r => r.status !== '已解决');

  const highRisks = allRisks.filter(r => r.level === '高' && r.status !== '已解决');



  // 高风险醒目横幅

  const alertEl = document.getElementById('s1RiskAlert');

  if (highRisks.length > 0 && alertEl) {

    alertEl.style.display = '';

    alertEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">

      <span style="font-size:18px;">🚨</span>

      <span style="font-weight:700;color:#991B1B;font-size:13px;">${highRisks.length} 项高风险事项需要关注</span>

      ${highRisks.slice(0,2).map(r => `<span style="font-size:11px;color:#DC2626;background:#FEE2E2;padding:2px 8px;border-radius:4px;cursor:pointer;" onclick="document.getElementById('s1Risks').scrollIntoView({behavior:'smooth'});markInfoRead('risk')">${esc(r.name)}</span>`).join('')}

    </div>`;

    addNotification('🚨', '高风险预警', `${highRisks.length} 项高风险事项待处理`, 'switchTo(0)');

  } else if (alertEl) { alertEl.style.display = 'none'; }



  document.getElementById('s1Stats').innerHTML = `

    <div class="stat-card"><span class="stat-value primary">${DATA.notices.length}</span><span class="stat-label">公告</span></div>

    <div class="stat-card"><span class="stat-value green">${DATA.knowledge.length}</span><span class="stat-label">知识共享</span></div>

    <div class="stat-card"><span class="stat-value primary">${DATA.dynamics.length}</span><span class="stat-label">工作动态</span></div>

    <div class="stat-card"><span class="stat-value" style="color:var(--primary);">${(DATA.allTasks||[]).length}</span><span class="stat-label">项目任务</span></div>

    ${riskCount > 0 ? `<div class="stat-card" style="border-left:3px solid #EF4444;"><span class="stat-value" style="color:#EF4444;">${riskCount}</span><span class="stat-label">风险预警</span></div>` : ''}`;



  // 风险预警渲染

  if (activeRisks.length === 0) {

    document.getElementById('s1Risks').innerHTML = empty('暂无风险事项');

  } else {

    document.getElementById('s1Risks').innerHTML = activeRisks.sort((a, b) => {

      const order = { '高': 0, '中': 1, '低': 2 };

      return (order[a.level] || 1) - (order[b.level] || 1);

    }).map(r => {

      const levelColors = { '高': '#EF4444', '中': '#F59E0B', '低': '#10B981' };

      const levelBg = { '高': '#FEE2E2', '中': '#FEF3C7', '低': '#D1FAE5' };

      const statusColors = { '未处理': '#EF4444', '处理中': '#F59E0B', '已解决': '#10B981' };

      const overdue = isOverdue(r.target_date) && r.status !== '已解决';

      const todayDeadline = isToday(r.target_date) && r.status !== '已解决';

      return `

    <div class="card${todayDeadline ? ' deadline-today' : ''}" style="border-left:4px solid ${levelColors[r.level]};padding:12px 16px;cursor:pointer;" onclick="openRiskDetail(${r.project_id}, ${r.id})">

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">

        <div style="display:flex;align-items:center;gap:8px;">

          <span class="badge" style="background:${levelBg[r.level]};color:${levelColors[r.level]};border:1px solid ${levelColors[r.level]};">${r.level}风险</span>
          <span class="badge risk-cat-badge" style="background:${RISK_CATEGORY_BG[r.category||'成本风险']};color:${RISK_CATEGORY_COLORS[r.category||'成本风险']};font-size:11px;padding:2px 8px;">${RISK_CATEGORY_ICONS[r.category||'成本风险']||''} ${r.category||'成本风险'}</span>

          <span style="font-size:14px;font-weight:600;color:var(--title);">${esc(r.name)}</span>

        </div>

        <span style="font-size:11px;color:${statusColors[r.status]};font-weight:600;">${r.status} ›</span>

      </div>

      ${r.description ? `<div style="font-size:12px;color:var(--body);line-height:18px;margin-bottom:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${esc(r.description)}</div>` : ''}

      <div style="font-size:11px;color:var(--meta);display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;">

        <span>来自项目：<span style="color:var(--primary);font-weight:500;">${esc(r.project_name)}</span></span>

        ${r.target_date ? `<span class="${overdue ? 'deadline-overdue' : ''}" style="font-size:10px;">${overdue ? '⚠ 已逾期: ' : todayDeadline ? '⏰ 今日截止: ' : '📅 '}${r.target_date}</span>` : ''}

      </div>

    </div>`;

    }).join('');

  }



  document.getElementById('s1Notices').innerHTML = DATA.notices.map(item => `

    <div class="card">

      ${cardActions(`openNoticeModal(${item.id})`, `deleteItem('notices',${item.id})`)}

      <span class="badge ${badgeClass(item.badge)}">${item.badge}</span>

      <span class="card-title wrap">${esc(item.title)}</span>

      <span class="card-desc">${esc(item.description)}</span>

      <span class="card-meta">${esc(item.meta)}</span>

    </div>`).join('') || empty('暂无公告');



  document.getElementById('s1Knowledges').innerHTML = DATA.knowledge.map(item => `

    <div class="card">

      ${cardActions(`openKnowledgeModal(${item.id})`, `deleteItem('knowledge',${item.id})`)}

      <span class="badge blue">知识</span>

      <span class="card-title wrap">${esc(item.title)}</span>

      <span class="card-desc">${esc(item.description)}</span>

      <span class="card-meta">${esc(item.meta)}</span>

    </div>`).join('') || empty('暂无知识分享');



  document.getElementById('s1Dynamics').innerHTML = DATA.dynamics.map(item => `

    <div class="card">

      ${cardActions(`openDynamicModal(${item.id})`, `deleteItem('dynamics',${item.id})`)}

      <div style="display:flex;align-items:center;gap:10px;">

        <div style="width:32px;height:32px;border-radius:50%;background:${esc(item.avatar_color||'#6366F1')};display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;flex-shrink:0;">${esc(item.avatar)}</div>

        <div style="flex:1;min-width:0;">

          <div style="font-size:14px;font-weight:600;color:var(--title);line-height:20px;">${esc(item.content)}</div>

          <div style="font-size:11px;color:var(--meta);margin-top:2px;">${esc(item.meta)}</div>

        </div>

      </div>

    </div>`).join('') || empty('暂无工作动态');

  // 项目任务汇总

  const members = DATA.members || [];
  const allTasks = DATA.allTasks || [];

  const pendingTasks = allTasks.filter(t => t.status !== 'completed');

  const todayTasks = pendingTasks.filter(t => t.deadline && isToday(t.deadline));

  const overdueTasks = pendingTasks.filter(t => t.deadline && isOverdue(t.deadline));

  document.getElementById('s1Tasks').innerHTML = allTasks.length === 0 ? empty('暂无项目任务') :

    allTasks.sort((a, b) => {

      const statusOrder = { 'pending': 0, 'in_progress': 1, 'completed': 2 };

      return (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);

    }).map(task => {

      const isDone = task.status === 'completed';

      const taskToday = !isDone && task.deadline && isToday(task.deadline);

      const taskOverdue = !isDone && task.deadline && isOverdue(task.deadline);

      const dlClass = taskOverdue ? ' deadline-overdue' : taskToday ? ' deadline-today' : '';

      const dlTag = taskOverdue ? '<span class="deadline-tag overdue">已逾期</span>' : taskToday ? '<span class="deadline-tag today">今天到期</span>' : '';

      const pct = task.progress || 0;

      const pctColor = pct >= 100 ? '#059669' : pct >= 50 ? '#6366F1' : pct > 0 ? '#D97706' : '#CBD5E1';

      return `
    <div class="card info-task-card${dlClass}" style="cursor:pointer;" onclick="openTaskDetail('${task.project_id}','${task.id}')">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <div class="task-check${isDone ? ' done' : ''}" style="width:20px;height:20px;flex-shrink:0;"></div>
        <span style="font-size:14px;font-weight:600;color:var(--title);${isDone?'text-decoration:line-through;color:var(--meta);':''}">${esc(task.name)}</span>
        <span class="badge" style="font-size:10px;background:${isDone?'#D1FAE5':task.status==='in_progress'?'#FEF3C7':'#E0E7FF'};color:${isDone?'#065F46':task.status==='in_progress'?'#92400E':'#3730A3'};">${isDone?'完成':task.status==='in_progress'?'进行中':'待处理'}</span>
      </div>
      ${pct > 0 || isDone ? `<div style="margin-bottom:6px;"><div style="height:4px;background:#F1F5F9;border-radius:2px;overflow:hidden;"><div style="height:100%;width:${isDone?100:pct}%;background:${pctColor};border-radius:2px;transition:width 0.3s;"></div></div><span style="font-size:10px;color:${pctColor};">${isDone?'100%':pct+'%'}</span></div>` : ''}
      <div style="font-size:11px;color:var(--meta);display:flex;flex-wrap:wrap;gap:8px;">
        <span>📂 <span style="color:var(--primary);font-weight:500;">${esc(task.project_name)}</span></span>
        ${task.assignee ? '<span>👤 '+esc(task.assignee)+'</span>' : ''}
        ${task.deadline ? '<span class="'+(taskOverdue?'deadline-overdue':'')+'" style="font-size:10px;">'+(taskOverdue?'⚠ 已逾期: ':taskToday?'⏰ 今日截止: ':'📅 ')+esc(task.deadline)+'</span>'+dlTag : ''}
      </div>
    </div>`;

    }).join('');



}



// ── Screen 2: 工作交接 ──

function renderS2() {

  const af = DATA.s2.activeFilter;

  const myId = CURRENT_USER.id;

  const memberMap = {};

  (DATA.members||[]).forEach(m => { memberMap[m.id] = m; });



  // 筛选逻辑

  const filtered = DATA.handovers.filter(h => {

    switch (af) {

      case 0: return h.to_user_id === myId && h.status === '待接收';  // 待处理：分配给我的

      case 1: return h.to_user_id !== myId && h.status === '待接收';  // 进行中：分配给别人的

      case 2: return h.status === '已移交';                            // 已完成

      case 3: return h.status === '已退回';                            // 已退回

      default: return true;

    }

  });



  document.getElementById('s2Filters').innerHTML = DATA.s2.filterTabs.map((t, i) => {

    const countMap = {

      0: DATA.handovers.filter(h => h.to_user_id === myId && h.status === '待接收').length,

      1: DATA.handovers.filter(h => h.to_user_id !== myId && h.status === '待接收').length,

      2: DATA.handovers.filter(h => h.status === '已移交').length,

      3: DATA.handovers.filter(h => h.status === '已退回').length,

    };

    return `<button class="filter-tab${i === af ? ' active' : ''}" onclick="DATA.s2.activeFilter=${i};renderS2()">${t} ${countMap[i]}</button>`;

  }).join('');



  document.getElementById('s2Items').innerHTML = filtered.map(item => {

    const assignee = item.to_user_id ? memberMap[item.to_user_id] : null;

    const isMine = item.to_user_id === myId && item.status === '待接收';

    const fromUser = item.from_user || '';



    // 状态徽章

    let statusBadge = '';

    if (item.status === '待接收') {

      statusBadge = isMine

        ? '<span class="badge" style="background:#FEF3C7;color:#92400E;">⏳ 待你确认</span>'

        : '<span class="badge" style="background:#E0E7FF;color:#3730A3;">⏳ 等待对方</span>';

    } else if (item.status === '已移交') {

      statusBadge = '<span class="badge" style="background:#D1FAE5;color:#065F46;">✅ 已移交</span>';

    } else if (item.status === '已退回') {

      statusBadge = '<span class="badge" style="background:#FEE2E2;color:#991B1B;">↩ 已退回</span>';

    }



    // 确认/退回按钮（仅分配给当前用户的待接收项显示）

    const confirmBtns = isMine ? `

      <div style="display:flex;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">

        <button class="modal-btn confirm" style="flex:1;padding:8px 0;font-size:13px;" onclick="event.stopPropagation();confirmHandover(${item.id})">

          ✅ 确认接收

        </button>

        <button class="modal-btn danger" style="flex:1;padding:8px 0;font-size:13px;" onclick="event.stopPropagation();rejectHandover(${item.id})">

          ↩ 退回

        </button>

      </div>` : '';



    // 退回原因

    const rejectInfo = item.status === '已退回' && item.reject_reason

      ? `<div style="margin-top:8px;padding:8px 10px;background:#FEF2F2;border-radius:6px;font-size:12px;color:#991B1B;">📝 退回原因：${esc(item.reject_reason)}</div>`

      : '';



    return `

    <div class="card" style="${isMine ? 'border-left:3px solid #F59E0B;background:#FFFDF5;' : ''}">

      ${cardActions(`openHandoverModal(${item.id})`, `deleteItem('handovers',${item.id})`)}

      <div class="card-header">

        <span class="card-title">${esc(item.title)}</span>

        <div style="display:flex;gap:4px;">

          <span class="badge ${badgeClass(item.priority)}">${esc(item.priority)}</span>

          ${statusBadge}

        </div>

      </div>

      <span class="card-desc">${esc(item.description)}</span>

      <div class="card-footer">

        ${assignee ? `<span class="card-meta" style="display:flex;align-items:center;gap:4px;">

          <span style="width:20px;height:20px;border-radius:50%;background:#6366F1;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;">${esc(assignee.avatar||assignee.nickname.charAt(0))}</span>

          ${esc(assignee.nickname)}

        </span>` : `<span class="card-meta">未指定</span>`}

        <span class="card-meta">${esc(fromUser)} · ${item.created_at ? item.created_at.slice(0,16) : ''}</span>

      </div>

      ${confirmBtns}

      ${rejectInfo}

    </div>`}).join('') || empty('暂无交接事项');

}



// ── 确认 / 退回交接 ──

async function confirmHandover(id) {

  showConfirm('确认接收此交接？确认后状态将变为"已移交"。', async () => {

    try {

      const res = await POST(`/api/content/handovers/${id}/confirm`, {});

      if (res.code === 200) {

        showToast('✅ 已确认接收');

        await fetchAllData();

        renderAll();

      } else {

        showToast(res.message || '确认失败');

      }

    } catch(e) {

      showToast('确认操作出错');

    }

  });

}



async function rejectHandover(id) {

  const reason = prompt('请输入退回原因（可选）：');

  if (reason === null) return; // 用户取消

  try {

    const res = await POST(`/api/content/handovers/${id}/reject`, { reason: reason || '' });

    if (res.code === 200) {

      showToast('已退回');

      await fetchAllData();

      renderAll();

    } else {

      showToast(res.message || '退回失败');

    }

  } catch(e) {

    showToast('退回操作出错');

  }

}



// ── Screen 3 子视图切换: 活动 / 会议 ──

function switchS3Sub(idx) {

  document.getElementById('s3ActivityContent').style.display = idx === 0 ? '' : 'none';

  document.getElementById('s3MeetingContent').style.display = idx === 1 ? '' : 'none';

  document.querySelectorAll('#s3SubTabs .sub-tab').forEach((btn, i) => btn.classList.toggle('active', i === idx));

  if (idx === 1) renderMeetings();

}



// ── Screen 3: 活动 / 会议记录 ──

function renderS3() {

  // 活动子视图

  const af = DATA.s3.activeFilter;

  const filtered = DATA.activities.filter((a, i) => {

    if (af === 0) return a.tag !== '已结束';

    return a.tag === '已结束';

  });



  document.getElementById('s3Filters').innerHTML = DATA.s3.filterTabs.map((t, i) => {

    const cnt = DATA.activities.filter(a => (i === 0 ? a.tag !== '已结束' : a.tag === '已结束')).length;

    return `<button class="filter-tab${i === af ? ' active' : ''}" onclick="DATA.s3.activeFilter=${i};renderS3()">${t} ${cnt}</button>`;

  }).join('');



  document.getElementById('s3Items').innerHTML = filtered.map(item => `

    <div class="card">

      ${cardActions(`openActivityModal(${item.id})`, `deleteItem('activities',${item.id})`)}

      <div class="card-header">

        <span class="card-title">${esc(item.title)}</span>

        <span class="badge ${badgeClass(item.tag)}">${esc(item.tag)}</span>

      </div>

      <div class="info-row">

        <span style="font-size:12px;font-weight:600;color:var(--primary);">${esc(item.date)}</span>

        <span style="font-size:12px;color:var(--meta);">${esc(item.location)}</span>

        <span style="font-size:12px;color:var(--body);">${esc(item.people)}</span>

      </div>

    </div>`).join('') || empty('暂无活动');



  // 同时渲染会议子视图

  renderMeetings();

}



// ── Screen 4: 我的 ──

function renderS4() {

  const p = DATA.profile;



  document.getElementById('s4Profile').innerHTML = `

    <div class="profile-card">

      <div class="avatar-row">

        <div class="avatar-circle">${esc(p.avatar)}</div>

        <div class="profile-info">

          <span class="profile-name">${esc(p.name)}</span>

          <span class="profile-dept">${esc(p.dept)}</span>

          <span class="profile-team">${esc(p.team)}</span>

        </div>

      </div>

      <div class="contact-row">

        <div class="contact-item">

          <svg viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 6L12 13L22 6"/></svg>

          <span>${esc(p.email) || '未填写'}</span>

        </div>

        <div class="contact-item">

          <svg viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18.01"/></svg>

          <span>${esc(p.phone) || '未填写'}</span>

        </div>

      </div>

    </div>`;



  const pending     = DATA.handovers.filter(h => h.to_user_id === CURRENT_USER.id && h.status === '待接收').length;

  const activeActs  = DATA.activities.filter(a => a.tag !== '已结束').length;

  const totalInfo   = DATA.notices.length + DATA.knowledge.length + DATA.dynamics.length;



  document.getElementById('s4Stats').innerHTML = `

    <div class="stat-card"><span class="stat-value primary">${pending}</span><span class="stat-label">待处理交接</span></div>

    <div class="stat-card"><span class="stat-value green">${activeActs}</span><span class="stat-label">进行中活动</span></div>

    <div class="stat-card"><span class="stat-value primary">${totalInfo}</span><span class="stat-label">消息动态</span></div>`;



  document.getElementById('s4Menu').innerHTML = `

    <div class="menu-card">

      ${DATA.s4.menu.map((m, i) => `

        ${i > 0 ? '<div class="menu-divider"></div>' : ''}

        <div class="menu-item" ${m.action ? `onclick="${m.action}"` : ''}>

          <svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="${m.badgeColor==='green'?'#059669':m.badgeColor==='red'?'#DC2626':'#6366F1'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">

            ${i===0?'<path d="M7 17L11 21L19 13"/><path d="M15 7H10C8.34 7 7 8.34 7 10V14"/>':i===1?'<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>':i===2?'<path d="M18 8C18 6.41 17.37 4.88 16.24 3.76C15.12 2.63 13.59 2 12 2C10.41 2 8.88 2.63 7.76 3.76C6.63 4.88 6 6.41 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z"/><path d="M13.73 21C13.55 21.3 13.3 21.55 12.998 21.73C12.694 21.9 12.35 21.99 12 21.99C11.65 21.99 11.306 21.9 11.002 21.73C10.698 21.55 10.45 21.3 10.27 21"/>':'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'}

          </svg>

          <span class="menu-label">${m.label}</span>

          ${m.badgeElement ? `<span class="tab-badge" id="${m.badgeElement}" style="display:none;position:static;margin-left:auto;"></span>` : ''}

          <span class="menu-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="2" stroke-linecap="round"><path d="M9 18L15 12L9 6"/></svg></span>

        </div>`).join('')}

    </div>`;



  // 成员管理区域

  renderMembers();

}



function renderAll() {

  ['tabBar1','tabBar2','tabBar3','tabBar4','tabBar5','tabBar6'].forEach((id, i) => {

    document.getElementById(id).innerHTML = renderTabBar(id, i);

  });

  renderS1(); renderS2(); renderS3(); renderS4(); renderS5(); renderS6();

}



// ╔══════════════════════════════════════════════════════════════╗

// ║  成员管理                                                     ║

// ╚══════════════════════════════════════════════════════════════╝



function renderMembers() {

  const isAdmin = CURRENT_USER && CURRENT_USER.id === 1;

  const members = DATA.members || [];



  if (members.length === 0) {

    document.getElementById('s4Members').innerHTML = empty('暂无成员');

    // 非管理员隐藏添加按钮

    if (!isAdmin) {

      const addBtn = document.querySelector('#s4Members').previousElementSibling?.querySelector('.section-add');

      if (addBtn) addBtn.style.display = 'none';

    }

    return;

  }



  document.getElementById('s4Members').innerHTML = members.map(m => `

    <div class="card" style="padding:14px;">

      <div style="display:flex;align-items:center;gap:12px;">

        <div style="width:40px;height:40px;border-radius:50%;background:${m.id===1?'#F59E0B':'#6366F1'};display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;font-weight:700;flex-shrink:0;">${esc(m.avatar || m.nickname.charAt(0))}</div>

        <div style="flex:1;min-width:0;">

          <div style="font-size:14px;font-weight:600;color:var(--title);line-height:20px;">${esc(m.nickname)} ${m.id===1 ? '<span class="badge orange" style="display:inline-flex;font-size:10px;padding:2px 6px;border-radius:8px;margin-left:4px;">管理员</span>' : ''}</div>

          <div style="font-size:12px;color:var(--body);line-height:18px;">${esc(m.dept||'')} ${m.team_group ? '· '+esc(m.team_group) : ''}</div>

          <div style="font-size:11px;color:var(--meta);line-height:16px;">${esc(m.email||'')} ${m.phone ? '· '+esc(m.phone) : ''}</div>

        </div>

        ${isAdmin && m.id !== 1 ? `<button class="card-action-btn danger" onclick="deleteMember(${m.id},'${esc(m.nickname)}')" title="删除成员" style="flex-shrink:0;position:static;opacity:1;">

          <svg viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2"><path d="M3 6H21"/><path d="M8 6V4C8 3.45 8.45 3 9 3H15C15.55 3 16 3.45 16 4V6"/><path d="M19 6V20C19 20.55 18.55 21 18 21H6C5.45 21 5 20.55 5 20V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>

        </button>` : ''}

      </div>

    </div>`).join('');

}



function openNewMemberModal() {

  showModal('添加新成员', `

    <div class="modal-field"><label>用户名 *</label><input id="mf_username" placeholder="登录账号（英文+数字）" maxlength="20"></div>

    <div class="modal-field"><label>昵称 *</label><input id="mf_nickname" placeholder="显示名称" maxlength="12"></div>

    <div class="modal-field"><label>部门/职位</label><input id="mf_dept" placeholder="如: 产品研发部" maxlength="30"></div>

    <div class="modal-field"><label>团队</label><input id="mf_team" placeholder="如: 用户体验组" maxlength="20"></div>

    <div class="modal-field"><label>邮箱</label><input id="mf_email" placeholder="user@company.com" maxlength="50"></div>

    <div class="modal-field"><label>手机号</label><input id="mf_phone" placeholder="选填" maxlength="11"></div>

    <div class="modal-field"><div class="hint">系统将自动生成初始密码，创建后请告知成员及时修改</div></div>`,

    `<button class="modal-btn cancel" onclick="closeModal()">取消</button>

    <button class="modal-btn confirm" onclick="saveNewMember()">创建</button>`);

}



async function saveNewMember() {

  const body = {

    username:  document.getElementById('mf_username').value.trim(),

    nickname:  document.getElementById('mf_nickname').value.trim(),

    dept:      document.getElementById('mf_dept').value.trim(),

    team_group: document.getElementById('mf_team').value.trim(),

    email:     document.getElementById('mf_email').value.trim(),

    phone:     document.getElementById('mf_phone').value.trim(),

  };



  if (!body.username) { showToast('请输入用户名'); return; }

  if (!body.nickname) { showToast('请输入昵称'); return; }



  const res = await POST('/api/members', body);

  if (res.code === 200) {

    const d = res.data;

    closeModal();

    showToast('成员创建成功！');



    // 显示初始密码给管理员

    const passwordInfo = `初始密码: ${d.rawPassword}\n用户名: ${d.username}\n请告知成员登录后修改密码`;

    showModal('✅ 成员创建成功', `

      <div style="text-align:center;padding:10px 0;">

        <div style="font-size:36px;margin-bottom:10px;">🎉</div>

        <div style="font-size:13px;color:var(--body);line-height:1.8;">

          <div><strong>初始密码：</strong><span style="background:#FEF3C7;padding:2px 8px;border-radius:4px;font-family:monospace;font-size:14px;">${esc(d.rawPassword)}</span></div>

          <div><strong>用户名：</strong>${esc(d.username)}</div>

          <div style="margin-top:6px;font-size:11px;color:var(--meta);">请将此信息告知 ${esc(d.nickname)}，成员登录后应尽快修改密码。</div>

        </div>

      </div>`,

      `<button class="modal-btn confirm" onclick="closeModal();fetchAllData().then(()=>renderAll())">确定</button>`);

    return;

  } else {

    showToast(res.message || '创建失败');

  }

}



async function deleteMember(id, nickname) {

  showConfirm(`确定要删除成员「${nickname}」吗？此操作不可撤销。`, async () => {

    const res = await DELETE('/api/members/' + id);

    if (res.code === 200) {

      await fetchAllData();

      renderAll();

      showToast(`已删除成员「${nickname}」`);

    } else {

      showToast(res.message || '删除失败');

    }

  });

}



// ╔══════════════════════════════════════════════════════════════╗

// ║  CRUD Modal                                                   ║

// ╚══════════════════════════════════════════════════════════════╝



function showModal(title, bodyHTML, footerHTML) {

  document.getElementById('modalTitle').textContent = title;

  document.getElementById('modalBody').innerHTML = bodyHTML;

  document.getElementById('modalFooter').innerHTML = footerHTML;

  document.getElementById('modalOverlay').classList.add('show');

}

function closeModal() { document.getElementById('modalOverlay').classList.remove('show'); }



function showToast(msg) {

  const t = document.getElementById('toast');

  t.textContent = msg; t.classList.add('show');

  setTimeout(() => t.classList.remove('show'), 2000);

}



function esc(s) {

  if (!s) return '';

  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

}



function safeArr(v) {

  if (Array.isArray(v)) return v;

  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch(e) { return []; } }

  return [];

}



function empty(msg) {

  return `<div style="color:var(--meta);font-size:13px;padding:20px;text-align:center;">${msg}</div>`;

}



// ── 加载条 ──

function showLoading() {

  document.getElementById('loadingBar').style.display = '';

}

function hideLoading() {

  document.getElementById('loadingBar').style.display = 'none';

}



// ── 确认对话框 ──

function showConfirm(msg, cb) {

  document.getElementById('confirmMsg').textContent = msg;

  document.getElementById('confirmOkBtn').onclick = () => { closeConfirm(); cb(); };

  document.getElementById('confirmOverlay').style.display = '';

  CONFIRM_CB = cb;

}

function closeConfirm() {

  document.getElementById('confirmOverlay').style.display = 'none';

  CONFIRM_CB = null;

}



// ── 上下文菜单 ──

let _ctxMsg = null;

function showCtxMenu(e, msg) {

  e.preventDefault(); e.stopPropagation();

  const menu = document.getElementById('ctxMenu');

  menu.style.display = ''; menu.style.left = Math.min(e.clientX, window.innerWidth - 130) + 'px';

  menu.style.top = Math.min(e.clientY, window.innerHeight - 80) + 'px';

  _ctxMsg = msg;

}

function hideCtxMenu() { document.getElementById('ctxMenu').style.display = 'none'; _ctxMsg = null; }

function ctxCopyMsg() {

  if (!_ctxMsg) return;

  navigator.clipboard?.writeText(_ctxMsg.content).then(() => showToast('已复制'));

  hideCtxMenu();

}

function ctxDeleteMsg() {

  if (!_ctxMsg) return;

  hideCtxMenu();

  showConfirm('确定要删除这条消息吗？', () => deleteChatMessage(_ctxMsg.id));

}



// ── 聊天消息删除 ──

async function deleteChatMessage(msgId) {

  showLoading();

  try {

    const res = await api('DELETE', '/api/chat/messages/' + msgId);

    if (res.code === 200) {

      document.getElementById('msg-' + msgId)?.remove();

      SOCKET?.emit('delete-message', { msgId });

      showToast('消息已删除');

    } else {

      showToast(res.message || '删除失败');

    }

  } catch(e) { showToast('网络错误'); }

  hideLoading();

}



// ── Emoji 选择器 ──

function toggleEmojiPicker() {

  const p = document.getElementById('emojiPicker');

  const wasHidden = p.style.display === 'none';

  p.style.display = wasHidden ? '' : 'none';

  if (wasHidden && !p.innerHTML) {

    p.innerHTML = EMOJIS.map(e => `<span onclick="insertEmoji('${e}')">${e}</span>`).join('');

  }

}

function insertEmoji(emoji) {

  const inp = document.getElementById('chatInput');

  inp.value += emoji; inp.focus();

}



// ── 聊天图片发送 ──

async function _uploadAndSendImage(file) {

  if (!file || !CHAT.activePeer) return;

  if (file.size > 5 * 1024 * 1024) { showToast('图片不能超过5MB'); return; }

  showLoading();

  try {

    const formData = new FormData(); formData.append('image', file);

    const res = await fetch('/api/chat/upload-image', { method:'POST', body:formData, headers:{ Authorization:'Bearer '+getToken() } });

    const json = await res.json();

    if (json.code === 200) {

      SOCKET.emit('send-message', { to: CHAT.activePeer.id, content: json.data.url, type: 'image' }, (ack) => {

        if (ack?.ok) appendMessage(ack.message);

      });

      showToast('图片已发送');

    } else { showToast(json.message || '上传失败'); }

  } catch(e) { showToast('上传失败'); }

  hideLoading();

}

async function sendChatImage() {

  const input = document.getElementById('chatImageInput');

  const file = input.files[0];

  if (!file) { input.value = ''; return; }

  await _uploadAndSendImage(file);

  input.value = '';

}

// Ctrl+V 粘贴图片

document.addEventListener('paste', (e) => {

  // 只在聊天 tab 且聊天窗口打开时处理

  if (document.getElementById('screen5')?.style.display === 'none') return;

  if (!CHAT.activePeer) return;

  // 如果焦点在文本输入框，文字粘贴走浏览器默认行为

  const activeEl = document.activeElement;

  const chatInput = document.getElementById('chatInput');

  const searchInput = document.getElementById('chatSearchInput');

  if (activeEl === searchInput) return; // 搜索框粘贴不拦截

  const items = e.clipboardData?.items;

  if (!items) return;

  for (const item of items) {

    if (item.type.startsWith('image/')) {

      e.preventDefault();

      const blob = item.getAsFile();

      if (blob) _uploadAndSendImage(blob);

      return;

    }

  }

  // 不是图片则允许默认文字粘贴

});



// ── 通知系统 ──

function addNotification(icon, title, desc, action) {

  NOTIFICATIONS.unshift({ icon, title, desc, action, time: new Date().toISOString(), read: false });

  if (NOTIFICATIONS.length > 50) NOTIFICATIONS.length = 50;

  updateInfoBadge();

}



function updateInfoBadge() {

  const unread = NOTIFICATIONS.filter(n => !n.read).length;

  INFO_UNREAD = unread;

  // 更新信息 Tab 角标

  const badge = document.getElementById('infoTabBadge');

  if (badge) {

    if (unread > 0) { badge.textContent = unread > 99 ? '99+' : unread; badge.style.display = ''; }

    else badge.style.display = 'none';

  }

  // 更新 s4 菜单角标

  const s4Badge = document.getElementById('s4NotifBadge');

  if (s4Badge) {

    if (unread > 0) { s4Badge.textContent = unread > 99 ? '99+' : unread; s4Badge.style.display = ''; }

    else s4Badge.style.display = 'none';

  }

}



function openNotifCenter() {

  // 全部标记已读

  NOTIFICATIONS.forEach(n => n.read = true);

  updateInfoBadge();

  const el = document.getElementById('notifCenter');

  el.style.display = '';

  // 遮罩

  const overlay = document.createElement('div');

  overlay.className = 'notif-overlay'; overlay.id = 'notifOverlay';

  overlay.onclick = closeNotifCenter;

  document.body.appendChild(overlay);

  renderNotifCenter();

}



function closeNotifCenter() {

  document.getElementById('notifCenter').style.display = 'none';

  document.getElementById('notifOverlay')?.remove();

}



function renderNotifCenter() {

  const el = document.getElementById('notifList');

  if (NOTIFICATIONS.length === 0) {

    el.innerHTML = '<div class="notif-empty">📭 暂无通知</div>';

    return;

  }

  el.innerHTML = NOTIFICATIONS.map(n => `

    <div class="notif-item" onclick="${n.action || ''}" style="${n.read ? '' : 'background:#EEF2FF;'}">

      <div class="notif-icon">${n.icon}</div>

      <div class="notif-body">

        <div class="notif-title">${esc(n.title)}</div>

        ${n.desc ? `<div class="notif-desc">${esc(n.desc)}</div>` : ''}

        <div class="notif-time">${new Date(n.time).toLocaleString('zh-CN')}</div>

      </div>

    </div>`).join('');

}



// ── 截止日期判断 ──

function isToday(d) {

  if (!d) return false;

  const t = new Date(d), n = new Date();

  return t.getFullYear() === n.getFullYear() && t.getMonth() === n.getMonth() && t.getDate() === n.getDate();

}

function isOverdue(d) {

  if (!d) return false;

  return new Date(d) < new Date(new Date().toDateString());

}



// 标记通知已读（信息/项目/风险类）

function markInfoRead(type) {

  NOTIFICATIONS.filter(n => n._type === type && !n.read).forEach(n => n.read = true);

  updateInfoBadge();

}



async function deleteItem(resource, id) {

  showConfirm('确定要删除此项吗？此操作不可撤销。', async () => {

    showLoading();

    const pathMap = { meetings: '/api/meetings', projects: '/api/projects' };

    const basePath = pathMap[resource] || `/api/content/${resource}`;

    const res = await DELETE(`${basePath}/${id}`);

    if (res.code === 200) {

      await fetchAllData();

      renderAll();

      showToast('已删除');

    } else {

      showToast('删除失败: ' + res.message);

    }

    hideLoading();

  });

}



// ── 公告 ──

function openNoticeModal(id) {

  const item = id ? DATA.notices.find(n => n.id === id) || {} : {};

  const isEdit = !!id;

  showModal(isEdit ? '编辑公告' : '发布公告', `

    <div class="modal-field"><label>公告标题</label><input id="mf_title" value="${esc(item.title||'')}" placeholder="请输入标题"></div>

    <div class="modal-field"><label>标签</label><select id="mf_badge">

      <option value="重要" ${(item.badge||'重要')==='重要'?'selected':''}>重要</option>

      <option value="通知" ${item.badge==='通知'?'selected':''}>通知</option>

      <option value="公告" ${item.badge==='公告'?'selected':''}>公告</option>

      <option value="提醒" ${item.badge==='提醒'?'selected':''}>提醒</option>

    </select></div>

    <div class="modal-field"><label>详细内容</label><textarea id="mf_desc" placeholder="请输入内容">${esc(item.description||'')}</textarea></div>

    <div class="modal-field"><label>署名</label><input id="mf_meta" value="${esc(item.meta||'')}" placeholder="如: 行政部"></div>`,

    `${isEdit ? `<button class="modal-btn danger" onclick="deleteItem('notices',${id});closeModal()">删除</button>` : ''}

    <button class="modal-btn cancel" onclick="closeModal()">取消</button>

    <button class="modal-btn confirm" onclick="saveNotice(${id||0})">${isEdit ? '保存' : '发布'}</button>`);

}

async function saveNotice(id) {

  const body = { badge: document.getElementById('mf_badge').value, title: document.getElementById('mf_title').value.trim(), description: document.getElementById('mf_desc').value.trim(), meta: document.getElementById('mf_meta').value.trim() };

  if (!body.title) { showToast('请输入标题'); return; }

  const res = id ? await PUT(`/api/content/notices/${id}`, body) : await POST('/api/content/notices', body);

  if (res.code === 200) { await fetchAllData(); renderAll(); closeModal(); showToast(id ? '已更新' : '已发布'); }

  else showToast(res.message);

}



// ── 知识 ──

function openKnowledgeModal(id) {

  const item = id ? DATA.knowledge.find(n => n.id === id) || {} : {};

  const isEdit = !!id;

  showModal(isEdit ? '编辑知识' : '分享知识', `

    <div class="modal-field"><label>标题</label><input id="mf_title" value="${esc(item.title||'')}" placeholder="请输入标题"></div>

    <div class="modal-field"><label>内容</label><textarea id="mf_desc" placeholder="请输入内容">${esc(item.description||'')}</textarea></div>

    <div class="modal-field"><label>署名/时间</label><input id="mf_meta" value="${esc(item.meta||'')}" placeholder="如: 06/10 · 王晓明"></div>`,

    `${isEdit ? `<button class="modal-btn danger" onclick="deleteItem('knowledge',${id});closeModal()">删除</button>` : ''}

    <button class="modal-btn cancel" onclick="closeModal()">取消</button>

    <button class="modal-btn confirm" onclick="saveKnowledge(${id||0})">${isEdit ? '保存' : '分享'}</button>`);

}

async function saveKnowledge(id) {

  const body = { title: document.getElementById('mf_title').value.trim(), description: document.getElementById('mf_desc').value.trim(), meta: document.getElementById('mf_meta').value.trim() };

  if (!body.title) { showToast('请输入标题'); return; }

  const res = id ? await PUT(`/api/content/knowledge/${id}`, body) : await POST('/api/content/knowledge', body);

  if (res.code === 200) { await fetchAllData(); renderAll(); closeModal(); showToast(id ? '已更新' : '已分享'); }

  else showToast(res.message);

}



// ── 动态 ──

function openDynamicModal(id) {

  const item = id ? DATA.dynamics.find(n => n.id === id) || {} : {};

  const isEdit = !!id;

  showModal(isEdit ? '编辑动态' : '发布动态', `

    <div class="modal-field"><label>头像文字</label><input id="mf_avatar" value="${esc(item.avatar||'协')}" maxlength="2" placeholder="1-2个汉字"></div>

    <div class="modal-field"><label>内容</label><textarea id="mf_content" placeholder="请输入工作动态">${esc(item.content||'')}</textarea></div>

    <div class="modal-field"><label>时间/署名</label><input id="mf_meta" value="${esc(item.meta||'')}" placeholder="如: 10分钟前"></div>`,

    `${isEdit ? `<button class="modal-btn danger" onclick="deleteItem('dynamics',${id});closeModal()">删除</button>` : ''}

    <button class="modal-btn cancel" onclick="closeModal()">取消</button>

    <button class="modal-btn confirm" onclick="saveDynamic(${id||0})">${isEdit ? '保存' : '发布'}</button>`);

}

async function saveDynamic(id) {

  const body = { avatar: document.getElementById('mf_avatar').value.trim()||'协', content: document.getElementById('mf_content').value.trim(), meta: document.getElementById('mf_meta').value.trim() };

  if (!body.content) { showToast('请输入内容'); return; }

  const res = id ? await PUT(`/api/content/dynamics/${id}`, body) : await POST('/api/content/dynamics', body);

  if (res.code === 200) { await fetchAllData(); renderAll(); closeModal(); showToast(id ? '已更新' : '已发布'); }

  else showToast(res.message);

}



// ── 交接 ──

function openHandoverModal(id) {

  const item = id ? DATA.handovers.find(n => n.id === id) || {} : {};

  const isEdit = !!id;

  const members = DATA.members || [];

  const memberOpts = members.map(m =>

    `<option value="${m.id}" ${item.to_user_id==m.id?'selected':''}>${esc(m.nickname)} (${esc(m.dept||'')})</option>`

  ).join('');

  const projects = DATA.projects || [];

  const projectOpts = projects.map(p =>

    `<option value="${p.id}" ${item.project_id==p.id?'selected':''}>${esc(p.name)}</option>`

  ).join('');

  showModal(isEdit ? '编辑交接' : '新建交接', `

    <div class="modal-field"><label>任务标题 *</label><input id="mf_title" value="${esc(item.title||'')}" placeholder="请输入标题"></div>

    <div class="modal-field"><label>所属项目</label><select id="mf_project">

      <option value="">不关联项目</option>

      ${projectOpts}

    </select></div>

    <div class="modal-field"><label>优先级</label>

      <div class="priority-row">

        <div class="priority-opt red ${(item.priority||'中')==='高'?'selected':''}" onclick="selectPriority(this,'高','red')">高</div>

        <div class="priority-opt orange ${(item.priority||'中')==='中'?'selected':''}" onclick="selectPriority(this,'中','orange')">中</div>

        <div class="priority-opt green ${item.priority==='低'?'selected':''}" onclick="selectPriority(this,'低','green')">低</div>

      </div>

      <input type="hidden" id="mf_priority" value="${esc(item.priority||'中')}">

    </div>

    <div class="modal-field"><label>详细描述</label><textarea id="mf_desc" placeholder="请输入描述">${esc(item.description||'')}</textarea></div>

    <div class="modal-field"><label>接收人 *</label><select id="mf_to_user">

      <option value="">请选择接收人</option>

      ${memberOpts}

    </select></div>

    <div class="modal-field"><label>移交人</label><input id="mf_from" value="${esc(item.from_user||'')}" placeholder="如: 刘主管移交"></div>

    <div class="modal-field"><label>状态</label>

      <div style="padding:8px 12px;background:var(--bg);border-radius:8px;font-size:13px;color:var(--meta);">

        当前状态：<b style="color:var(--title);">${esc(item.status||'待接收')}</b>

        <span style="font-size:11px;color:var(--meta);margin-left:4px;">（由接收人确认后自动变更）</span>

      </div>

    </div>`,

    `${isEdit ? `<button class="modal-btn danger" onclick="deleteItem('handovers',${id});closeModal()">删除</button>` : ''}

    <button class="modal-btn cancel" onclick="closeModal()">取消</button>

    <button class="modal-btn confirm" onclick="saveHandover(${id||0})">${isEdit ? '保存' : '创建'}</button>`);

}

function selectPriority(el, val) {

  el.parentElement.querySelectorAll('.priority-opt').forEach(o => o.classList.remove('selected'));

  el.classList.add('selected');

  document.getElementById('mf_priority').value = val;

}

async function saveHandover(id) {

  const toUserId = document.getElementById('mf_to_user').value;

  const projectId = document.getElementById('mf_project') ? document.getElementById('mf_project').value : '';

  const body = { title: document.getElementById('mf_title').value.trim(), priority: document.getElementById('mf_priority').value, description: document.getElementById('mf_desc').value.trim(), from_user: document.getElementById('mf_from').value.trim(), to_user_id: toUserId ? parseInt(toUserId) : null, project_id: projectId ? parseInt(projectId) : null };

  if (!body.title) { showToast('请输入标题'); return; }

  if (!body.to_user_id) { showToast('请选择接收人'); return; }

  // 新建时默认状态为"待接收"，编辑时保持原状态（不手动改状态）

  if (!id) body.status = '待接收';

  const res = id ? await PUT(`/api/content/handovers/${id}`, body) : await POST('/api/content/handovers', body);

  if (res.code === 200) { await fetchAllData(); renderAll(); closeModal(); showToast(id ? '已更新' : '已创建'); }

  else showToast(res.message);

}



// ── 活动 ──

function openActivityModal(id) {

  const item = id ? DATA.activities.find(n => n.id === id) || {} : {};

  const isEdit = !!id;

  showModal(isEdit ? '编辑活动' : '发布活动', `

    <div class="modal-field"><label>活动标题</label><input id="mf_title" value="${esc(item.title||'')}" placeholder="请输入标题"></div>

    <div class="modal-field"><label>分类标签</label><select id="mf_tag">

      <option value="培训" ${(item.tag||'培训')==='培训'?'selected':''}>培训</option>

      <option value="团建" ${item.tag==='团建'?'selected':''}>团建</option>

      <option value="分享" ${item.tag==='分享'?'selected':''}>分享</option>

      <option value="已结束" ${item.tag==='已结束'?'selected':''}>已结束</option>

    </select></div>

    <div class="modal-field"><label>日期</label><input id="mf_date" value="${esc(item.date||'')}" placeholder="如: 06/15 周六"></div>

    <div class="modal-field"><label>地点</label><input id="mf_location" value="${esc(item.location||'')}" placeholder="如: 3楼会议室"></div>

    <div class="modal-field"><label>参与人数</label><input id="mf_people" value="${esc(item.people||'')}" placeholder="如: 15人报名"></div>`,

    `${isEdit ? `<button class="modal-btn danger" onclick="deleteItem('activities',${id});closeModal()">删除</button>` : ''}

    <button class="modal-btn cancel" onclick="closeModal()">取消</button>

    <button class="modal-btn confirm" onclick="saveActivity(${id||0})">${isEdit ? '保存' : '发布'}</button>`);

}

async function saveActivity(id) {

  const body = { title: document.getElementById('mf_title').value.trim(), tag: document.getElementById('mf_tag').value, date: document.getElementById('mf_date').value.trim(), location: document.getElementById('mf_location').value.trim(), people: document.getElementById('mf_people').value.trim() };

  if (!body.title) { showToast('请输入标题'); return; }

  const res = id ? await PUT(`/api/content/activities/${id}`, body) : await POST('/api/content/activities', body);

  if (res.code === 200) { await fetchAllData(); renderAll(); closeModal(); showToast(id ? '已更新' : '已发布'); }

  else showToast(res.message);

}



// ── 个人资料 ──

function openProfileModal() {

  const p = DATA.profile;

  showModal('编辑个人资料', `

    <div class="modal-field"><label>登录用户名</label><input id="mf_username" value="${esc(p.username || '')}" placeholder="修改后需用新用户名登录"></div>

    <div class="modal-field"><label>头像文字</label><input id="mf_avatar" value="${esc(p.avatar)}" maxlength="2" placeholder="1-2个汉字"></div>

    <div class="modal-field"><label>姓名</label><input id="mf_name" value="${esc(p.name)}" placeholder="请输入姓名"></div>

    <div class="modal-field"><label>部门/职位</label><input id="mf_dept" value="${esc(p.dept)}" placeholder="如: 产品研发部 · 高级工程师"></div>

    <div class="modal-field"><label>团队</label><input id="mf_team" value="${esc(p.team)}" placeholder="如: 用户体验组"></div>

    <div class="modal-field"><label>邮箱</label><input id="mf_email" value="${esc(p.email)}" placeholder="请输入邮箱"></div>

    <div class="modal-field"><label>手机号</label><input id="mf_phone" value="${esc(p.phone)}" placeholder="请输入手机号"></div>`,

    `<button class="modal-btn cancel" onclick="closeModal()">取消</button>

    <button class="modal-btn confirm" onclick="saveProfile()">保存</button>`);

}

async function saveProfile() {

  const body = { username: document.getElementById('mf_username').value.trim(), nickname: document.getElementById('mf_name').value.trim(), avatar: document.getElementById('mf_avatar').value.trim(), dept: document.getElementById('mf_dept').value.trim(), team_group: document.getElementById('mf_team').value.trim(), email: document.getElementById('mf_email').value.trim(), phone: document.getElementById('mf_phone').value.trim() };

  if (!body.nickname) { showToast('请输入姓名'); return; }

  const res = await PUT('/api/auth/profile', body);

  if (res.code === 200) {

    CURRENT_USER = res.user;

    DATA.profile = { avatar: res.user.avatar || res.user.nickname.charAt(0), name: res.user.nickname, username: res.user.username || '', dept: res.user.dept || '', team: res.user.team_group || '', email: res.user.email || '', phone: res.user.phone || '' };

    renderS4(); closeModal(); showToast('资料已更新');

  } else showToast(res.message);

}



// ── 修改密码 ──

function openPasswordModal() {

  showModal('修改密码', `

    <div class="modal-field"><label>当前密码</label><input type="password" id="mp_old" placeholder="请输入当前密码"></div>

    <div class="modal-field"><label>新密码</label><input type="password" id="mp_new" placeholder="请输入新密码（至少6位）"></div>

    <div class="modal-field"><label>确认新密码</label><input type="password" id="mp_confirm" placeholder="请再次输入新密码"></div>`,

    `<button class="modal-btn cancel" onclick="closeModal()">取消</button>

    <button class="modal-btn confirm" onclick="savePassword()">确认修改</button>`);

}

async function savePassword() {

  const oldPassword = document.getElementById('mp_old').value;

  const newPassword = document.getElementById('mp_new').value;

  const confirmPassword = document.getElementById('mp_confirm').value;

  if (!oldPassword || !newPassword || !confirmPassword) { showToast('请填写完整'); return; }

  if (newPassword.length < 6) { showToast('新密码至少6位'); return; }

  if (newPassword !== confirmPassword) { showToast('两次输入的新密码不一致'); return; }

  const res = await PUT('/api/auth/password', { oldPassword, newPassword });

  if (res.code === 200) { closeModal(); showToast('密码已修改，请重新登录'); setTimeout(doLogout, 1500); }

  else showToast(res.message);

}



// ╔══════════════════════════════════════════════════════════════╗

// ║  实时聊天 (Socket.IO)                                         ║

// ╚══════════════════════════════════════════════════════════════╝



function connectSocket() {

  if (SOCKET && SOCKET.connected) return;

  SOCKET = io({ auth: { token: getToken() }, transports: ['websocket', 'polling'] });



  SOCKET.on('connect', () => { console.log('[WS] connected'); });

  SOCKET.on('disconnect', () => { console.log('[WS] disconnected'); });



  SOCKET.on('new-message', (msg) => {

    const isMine = msg.from_user_id === CURRENT_USER.id;

    const peerId = isMine ? msg.to_user_id : msg.from_user_id;



    // 1. 如果正在和这个人聊天，追加到消息列表

    if (CHAT.activePeer && CHAT.activePeer.id === peerId) {

      appendMessage(msg);

    }



    // 2. 如果不是自己发的，且不在当前聊天界面，增加未读数

    if (!isMine) {

      const isChatActive = CHAT.activePeer && CHAT.activePeer.id === peerId && currentTab === 4;

      if (!isChatActive) {

        CHAT.unreadCounts[peerId] = (CHAT.unreadCounts[peerId] || 0) + 1;

        // 触发通知

        triggerNotification(msg);

      }

    }



    // 3. 刷新会话列表和 Tab 角标

    loadConversations();

    updateChatTabBadge();

  });



  SOCKET.on('user-online', (d) => { if (d.userId !== CURRENT_USER.id) { updateOnlineStatus(d.userId, true); loadConversations(); } });

  SOCKET.on('user-offline', (d) => { updateOnlineStatus(d.userId, false); loadConversations(); });



  SOCKET.on('user-typing', (d) => {

    if (CHAT.activePeer && d.userId === CHAT.activePeer.id) {

      document.getElementById('chatTyping').style.display = d.typing ? 'block' : 'none';

      if (d.typing) { clearTimeout(window._typingTimer); window._typingTimer = setTimeout(() => { document.getElementById('chatTyping').style.display = 'none'; }, 3000); }

    }

  });



  // 消息被对方删除

  SOCKET.on('message-deleted', (d) => {

    document.getElementById('msg-' + d.id)?.remove();

    loadConversations();

  });



  // 初始加载会话列表

  loadConversations();

}



function updateOnlineStatus(userId, online) {

  // 更新会话列表中的在线状态

  document.querySelectorAll('.chat-conv-item').forEach(el => {

    if (parseInt(el.dataset.peerId) === userId) {

      const dot = el.querySelector('.chat-conv-online');

      if (dot) dot.style.display = online ? 'block' : 'none';

    }

  });

  // 更新聊天头部

  if (CHAT.activePeer && CHAT.activePeer.id === userId) {

    const st = document.getElementById('chatPeerStatus');

    if (st) st.textContent = online ? '在线' : '离线';

  }

}



async function loadConversations() {

  try {

    const res = await GET('/api/chat/conversations');

    if (res.code === 200) {

      CHAT.conversations = res.data;

      renderConvList();

    }

  } catch(e) {}

}



// ── 未读计数 & 通知 ──



function getTotalUnread() {

  return Object.values(CHAT.unreadCounts).reduce((a, b) => a + b, 0);

}



function updateChatTabBadge() {

  const total = getTotalUnread();

  // 更新所有 Tab 栏中的聊天角标

  document.querySelectorAll('.tab-item .tab-badge').forEach(b => b.remove());

  if (total > 0) {

    document.querySelectorAll('.tab-item').forEach(item => {

      if (item.querySelector('.tab-label')?.textContent === '聊天') {

        const badge = document.createElement('span');

        badge.className = 'tab-badge';

        badge.textContent = total > 99 ? '99+' : total;

        item.appendChild(badge);

        item.style.position = 'relative';

      }

    });

  }

}



function triggerNotification(msg) {

  const peer = findPeerInfo(msg.from_user_id);

  const senderName = peer ? peer.nickname : '用户';

  const preview = (msg.content || '').slice(0, 40) + ((msg.content || '').length > 40 ? '...' : '');



  // 1. 顶部横幅通知

  showBanner(senderName, preview, msg.from_user_id);



  // 2. 浏览器桌面通知

  if (NOTIFY.enabled && document.hidden) {

    showDesktopNotification(senderName, preview, msg.from_user_id);

  }



  // 3. 提示音

  if (NOTIFY.soundEnabled) {

    playMessageSound();

  }

}



function findPeerInfo(peerId) {

  // 从会话列表中查找

  const conv = CHAT.conversations.find(c => c.peerId === peerId);

  if (conv) return conv.peer;

  // 从联系人中查找

  const contact = CHAT.contacts.find(c => c.id === peerId);

  if (contact) return contact;

  return null;

}



function showBanner(senderName, preview, peerId) {

  // 移除已有横幅

  const existing = document.querySelector('.notify-banner');

  if (existing) existing.remove();



  const banner = document.createElement('div');

  banner.className = 'notify-banner';

  banner.innerHTML = `

    <div class="notify-banner-avatar" style="background:#6366F1;">${esc(senderName.charAt(0))}</div>

    <div class="notify-banner-body" onclick="dismissBanner();switchTo(4);openChat(${peerId})">

      <div class="notify-banner-name">${esc(senderName)}</div>

      <div class="notify-banner-text">${esc(preview)}</div>

    </div>

    <button class="notify-banner-close" onclick="dismissBanner()">&times;</button>

  `;

  document.body.appendChild(banner);



  // 5秒后自动消失

  clearTimeout(window._bannerTimer);

  window._bannerTimer = setTimeout(dismissBanner, 5000);

}



function dismissBanner() {

  const banner = document.querySelector('.notify-banner');

  if (banner) banner.remove();

}



async function showDesktopNotification(senderName, preview, peerId) {

  if (!('Notification' in window)) return;

  if (Notification.permission === 'granted') {

    const n = new Notification(`${senderName} 发来消息`, {

      body: preview,

      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%236366F1" width="100" height="100" rx="20"/><text fill="white" x="50" y="65" text-anchor="middle" font-size="45" font-family="Arial">💬</text></svg>',

      tag: 'teamconnect-msg',

    });

    n.onclick = () => { window.focus(); switchTo(4); openChat(peerId); };

  } else if (Notification.permission === 'default') {

    // 首次请求权限

    const perm = await Notification.requestPermission();

    NOTIFY.enabled = perm === 'granted';

  }

}



function requestNotifyPermission() {

  if (!('Notification' in window)) return;

  if (Notification.permission === 'default') {

    Notification.requestPermission().then(perm => {

      NOTIFY.enabled = perm === 'granted';

      if (perm === 'granted') showToast('✅ 桌面通知已开启');

      else if (perm === 'denied') showToast('桌面通知已关闭，可在浏览器设置中开启');

    });

  } else {

    NOTIFY.enabled = Notification.permission === 'granted';

  }

}



function playMessageSound() {

  try {

    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    const osc = ctx.createOscillator();

    const gain = ctx.createGain();

    osc.connect(gain);

    gain.connect(ctx.destination);

    osc.type = 'sine';

    // 双音提示

    osc.frequency.setValueAtTime(880, ctx.currentTime);

    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.15, ctx.currentTime);

    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

    osc.start(ctx.currentTime);

    osc.stop(ctx.currentTime + 0.2);

  } catch(e) { /* 静默失败 */ }

}



function renderConvList() {

  const el = document.getElementById('chatConvList');

  if (!el) return;

  if (CHAT.conversations.length === 0) {

    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--meta);font-size:13px;">暂无会话<br><span style="font-size:11px;">点击 + 开始聊天</span></div>';

    return;

  }

  el.innerHTML = CHAT.conversations.map(c => {

    const unread = CHAT.unreadCounts[c.peerId] || 0;

    return `

    <div class="chat-conv-item${CHAT.activePeer && CHAT.activePeer.id === c.peerId ? ' active' : ''}" data-peer-id="${c.peerId}" onclick="openChat(${c.peerId})">

      <div class="chat-conv-avatar" style="background:#6366F1;">${c.peer.avatar || '?'}

        ${c.online ? '<span class="chat-conv-online"></span>' : ''}

        ${unread > 0 ? `<span class="chat-conv-badge">${unread > 99 ? '99+' : unread}</span>` : ''}

      </div>

      <div class="chat-conv-info">

        <div class="chat-conv-name">${esc(c.peer.nickname)}</div>

        <div class="chat-conv-preview" style="${unread > 0 ? 'font-weight:600;color:var(--title);' : ''}">${c.lastFromMe ? '你: ' : ''}${esc(c.lastMsg || '')}</div>

      </div>

      <div class="chat-conv-time">${fmtTime(c.lastTime)}</div>

    </div>`;

  }).join('');

}



function fmtTime(ts) {

  if (!ts) return '';

  const d = new Date(ts);

  const now = new Date();

  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });

}



async function showContactsList() {

  try {

    const res = await GET('/api/chat/contacts');

    if (res.code !== 200) return;

    CHAT.contacts = res.data;

    showModal('选择联系人', `

      <div class="contact-list">

        ${CHAT.contacts.length === 0 ? '<div style="text-align:center;color:var(--meta);padding:20px;">暂无可聊天的成员</div>' :

          CHAT.contacts.map(c => `

            <div class="contact-item" onclick="openChat(${c.id});closeModal();">

              <div class="chat-conv-avatar" style="background:#6366F1;width:36px;height:36px;position:relative;">

                ${c.avatar || '?'}

                ${c.online ? '<span class="chat-conv-online"></span>' : ''}

              </div>

              <div style="flex:1;">

                <div style="font-size:13px;font-weight:600;color:var(--title);">${esc(c.nickname)}</div>

                <div style="font-size:11px;color:var(--meta);">${esc(c.dept)} ${c.online ? '· 在线' : ''}</div>

              </div>

            </div>`).join('')}

      </div>`, '<button class="modal-btn cancel" onclick="closeModal()">取消</button>');

  } catch(e) { showToast('加载联系人失败'); }

}



async function openChat(peerId) {

  CHAT.activePeer = { id: peerId };

  // 清除该会话的未读计数

  delete CHAT.unreadCounts[peerId];

  updateChatTabBadge();

  // 关闭横幅

  dismissBanner();

  // 移动端：隐藏会话列表，显示聊天窗口

  document.getElementById('chatConvPanel').classList.add('hidden-on-mobile');

  document.getElementById('chatWindow').classList.remove('hidden-on-mobile');

  document.getElementById('chatEmpty').style.display = 'none';

  document.getElementById('chatHeader').style.display = 'flex';

  document.getElementById('chatInput').focus();



  // 获取对方信息

  try {

    const res = await GET('/api/chat/messages/' + peerId + '?limit=50');

    if (res.code === 200) {

      // 获取用户信息

      const contacts = CHAT.contacts.length ? CHAT.contacts : [];

      let peer = contacts.find(c => c.id === peerId);

      if (!peer) {

        const convs = CHAT.conversations;

        const conv = convs.find(c => c.peerId === peerId);

        peer = conv ? conv.peer : { id: peerId, nickname: '用户', avatar: '?' };

      }

      document.getElementById('chatPeerInfo').innerHTML = `

        <div class="chat-peer-avatar" style="background:#6366F1;">${peer.avatar || '?'}</div>

        <div><div class="chat-peer-name">${esc(peer.nickname)}</div><div class="chat-peer-status" id="chatPeerStatus">${peer.online ? '在线' : '离线'}</div></div>`;



      renderMessages(res.data);



      // 搜索栏

      let searchBar = document.getElementById('chatSearchBar');

      if (!searchBar) {

        searchBar = document.createElement('div');

        searchBar.id = 'chatSearchBar';

        searchBar.className = 'chat-search-bar';

        searchBar.innerHTML = `<input type="text" id="chatSearchInput" placeholder="🔍 搜索聊天记录..." oninput="searchChatMessages()" onkeydown="if(event.key==='Escape'){this.value='';searchChatMessages();}">

          <button class="chat-search-clear" onclick="clearChatSearch()">✕</button>`;

        document.getElementById('chatMessages').parentNode.insertBefore(searchBar, document.getElementById('chatMessages'));

      }

    }

  } catch(e) {}

  renderConvList();

}



function showConvList() {

  document.getElementById('chatConvPanel').classList.remove('hidden-on-mobile');

  document.getElementById('chatWindow').classList.add('hidden-on-mobile');

  CHAT.activePeer = null;

  renderConvList();

}



function renderMessages(msgs) {

  const el = document.getElementById('chatMessages');

  let lastDate = '';

  el.innerHTML = msgs.map(m => {

    const mine = m.from_user_id === CURRENT_USER.id;

    const d = new Date(m.created_at);

    const dateStr = d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });

    let dateLabel = '';

    if (dateStr !== lastDate) { lastDate = dateStr; dateLabel = `<div class="chat-msg-time">${dateStr}</div>`; }

    const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    const content = m.type === 'image'

      ? `<img src="${esc(m.content)}" class="chat-msg-img" onclick="window.open('${esc(m.content)}')" onerror="this.style.display='none'">`

      : esc(m.content);

    return dateLabel + `<div class="chat-msg-row${mine ? ' mine' : ''}" id="msg-${m.id}" oncontextmenu="showCtxMenu(event,{id:${m.id},content:'${esc(m.content).replace(/'/g,"\\'")}'})">

      <div class="chat-msg-actions">

        <button class="chat-msg-action-btn" onclick="navigator.clipboard?.writeText('${esc(m.content).replace(/'/g,"\\'")}');showToast('已复制')" title="复制">📋</button>

        ${mine ? `<button class="chat-msg-action-btn danger" onclick="showConfirm('确定删除这条消息？',()=>deleteChatMessage(${m.id}))" title="删除">🗑</button>` : ''}

      </div>

      <div class="chat-msg-bubble">${content}<div style="font-size:10px;opacity:0.6;margin-top:2px;">${time}</div></div>

    </div>`;

  }).join('');

  el.scrollTop = el.scrollHeight;

}



function appendMessage(msg) {

  const el = document.getElementById('chatMessages');

  const mine = msg.from_user_id === CURRENT_USER.id;

  const d = new Date(msg.created_at);

  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  const content = msg.type === 'image'

    ? `<img src="${esc(msg.content)}" class="chat-msg-img" onclick="window.open('${esc(msg.content)}')" onerror="this.style.display='none'">`

    : esc(msg.content);

  el.insertAdjacentHTML('beforeend', `<div class="chat-msg-row${mine ? ' mine' : ''}" id="msg-${msg.id}" oncontextmenu="showCtxMenu(event,{id:${msg.id},content:'${esc(msg.content).replace(/'/g,"\\'")}'})">

    <div class="chat-msg-actions">

      <button class="chat-msg-action-btn" onclick="navigator.clipboard?.writeText('${esc(msg.content).replace(/'/g,"\\'")}');showToast('已复制')" title="复制">📋</button>

      ${mine ? `<button class="chat-msg-action-btn danger" onclick="showConfirm('确定删除这条消息？',()=>deleteChatMessage(${msg.id}))" title="删除">🗑</button>` : ''}

    </div>

    <div class="chat-msg-bubble">${content}<div style="font-size:10px;opacity:0.6;margin-top:2px;">${time}</div></div>

  </div>`);

  el.scrollTop = el.scrollHeight;

}



function sendChatMessage() {

  const input = document.getElementById('chatInput');

  const content = input.value.trim();

  if (!content || !CHAT.activePeer || !SOCKET) return;

  SOCKET.emit('send-message', { to: CHAT.activePeer.id, content, type: 'text' }, (ack) => {

    if (ack && ack.ok) {

      appendMessage(ack.message);

      input.value = '';

    }

  });

}



// ── 聊天消息搜索 ──

let _searchTimer = null;

function searchChatMessages() {

  clearTimeout(_searchTimer);

  _searchTimer = setTimeout(() => _doSearchChat(), 200);

}

function _doSearchChat() {

  const q = document.getElementById('chatSearchInput')?.value.trim().toLowerCase();

  if (!CHAT.activePeer) return;

  if (!q) { _clearSearchHighlights(); return; }

  // 客户端过滤 + 高亮

  const rows = document.querySelectorAll('#chatMessages .chat-msg-row');

  const wrapper = document.getElementById('chatMessages');

  let hasMatch = false, firstMatch = null;

  rows.forEach(row => {

    const bubble = row.querySelector('.chat-msg-bubble');

    if (!bubble) { row.style.display = ''; return; }

    // 还原原始文本（移除之前的 mark 标签）

    const rawText = (bubble.dataset.rawText || bubble.textContent).toLowerCase();

    if (!bubble.dataset.rawText) bubble.dataset.rawText = bubble.textContent;

    if (rawText.includes(q)) {

      row.style.display = '';

      if (!firstMatch) firstMatch = row;

      hasMatch = true;

      // 高亮：用 mark 包裹匹配词

      _highlightBubble(bubble, q);

    } else {

      row.style.display = 'none';

      // 还原高亮

      if (bubble.dataset.rawText) {

        const inner = bubble.querySelector('.chat-msg-bubble-inner');

        if (inner) inner.innerHTML = esc(bubble.dataset.rawText);

      }

    }

  });

  // 显示/隐藏"无结果"提示

  let noResult = document.getElementById('chatSearchNoResult');

  if (!hasMatch && q) {

    if (!noResult) {

      noResult = document.createElement('div');

      noResult.id = 'chatSearchNoResult';

      noResult.style.cssText = 'text-align:center;padding:20px;color:var(--meta);font-size:13px;';

      wrapper.appendChild(noResult);

    }

    noResult.textContent = '未找到匹配的消息';

    noResult.style.display = '';

  } else if (noResult) {

    noResult.style.display = 'none';

  }

  // 滚动到第一个匹配

  if (firstMatch) firstMatch.scrollIntoView({ block: 'center', behavior: 'smooth' });

}

function _highlightBubble(bubble, q) {

  const rawText = bubble.dataset.rawText || '';

  const inner = bubble.querySelector('.chat-msg-bubble-inner');

  const target = inner || bubble;

  // 使用正则高亮，保留大小写

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const regex = new RegExp(`(${escaped})`, 'gi');

  const html = esc(rawText).replace(regex, '<mark class="search-highlight">$1</mark>');

  if (inner) {

    inner.innerHTML = html;

  } else {

    // 需要保留原有的内部结构（时间标签等），只替换文本部分

    const origHTML = target.innerHTML;

    const timeTag = origHTML.match(/<div style="font-size:10px[^>]*>.*?<\/div>$/);

    const timeHTML = timeTag ? timeTag[0] : '';

    target.innerHTML = `<span class="chat-msg-bubble-inner">${html}</span>${timeHTML}`;

  }

}

function _clearSearchHighlights() {

  document.querySelectorAll('#chatMessages .chat-msg-row').forEach(row => {

    row.style.display = '';

    const bubble = row.querySelector('.chat-msg-bubble');

    if (bubble && bubble.dataset.rawText) {

      const inner = bubble.querySelector('.chat-msg-bubble-inner');

      if (inner) inner.innerHTML = esc(bubble.dataset.rawText);

    }

  });

  const noResult = document.getElementById('chatSearchNoResult');

  if (noResult) noResult.style.display = 'none';

}

function clearChatSearch() {

  const inp = document.getElementById('chatSearchInput');

  if (inp) inp.value = '';

  _clearSearchHighlights();

  if (CHAT.activePeer) {

    // 滚动到底部

    const el = document.getElementById('chatMessages');

    if (el) el.scrollTop = el.scrollHeight;

  }

}



// 输入时发送正在输入状态

document.addEventListener('DOMContentLoaded', () => {

  const input = document.getElementById('chatInput');

  if (input) {

    let typingTimeout;

    input.addEventListener('input', () => {

      if (!CHAT.activePeer || !SOCKET) return;

      SOCKET.emit('typing', { to: CHAT.activePeer.id, typing: true });

      clearTimeout(typingTimeout);

      typingTimeout = setTimeout(() => {

        if (SOCKET) SOCKET.emit('typing', { to: CHAT.activePeer.id, typing: false });

      }, 1500);

    });

  }

});



function renderS5() {

  renderConvList();

  updateChatTabBadge();

  // 确保 tabBar5 已渲染

  if (!document.getElementById('tabBar5').innerHTML) {

    document.getElementById('tabBar5').innerHTML = renderTabBar('tabBar5', 4);

  }

}



// ── Screen 6 子视图切换: 列表 / 甘特图 ──

function switchS6Sub(idx) {

  // 切换到列表时，如果正在查看详情，先返回列表

  if (idx === 0 && DATA.projectDetailId) {

    DATA.projectDetailId = null;

  }

  document.getElementById('s6ListContent').style.display = idx === 0 ? '' : 'none';

  document.getElementById('s6GanttContent').style.display = idx === 1 ? '' : 'none';

  document.querySelectorAll('#s6SubTabs .sub-tab').forEach((btn, i) => btn.classList.toggle('active', i === idx));

  if (idx === 0) {

    document.getElementById('s6PageHeader').style.display = '';

    document.getElementById('s6Items').style.display = '';

    document.getElementById('projectDetail').style.display = 'none';

    renderS6();

  } else if (idx === 1) {

    renderGantt();

  }

}



// ── Screen 6: 项目 / 甘特图 ──

function filterProject(status) {

  DATA.projectFilter = status;

  renderS6();

}



function renderS6() {

  const projects = DATA.projects || [];



  // ── 如果正在查看项目详情 ──

  if (DATA.projectDetailId) {

    const proj = projects.find(p => p.id == DATA.projectDetailId);

    if (!proj) { DATA.projectDetailId = null; }

    else { renderProjectDetail(proj); return; }

  }



  const handovers = DATA.handovers || [];
  const risks = (DATA.projects || []).flatMap(p => safeArr(p.risks));

  const memberMap = {};

  (DATA.members||[]).forEach(m => { memberMap[m.id] = m; });



  // 隐藏详情、显示列表

  document.getElementById('s6PageHeader').style.display = '';

  document.getElementById('s6Items').style.display = '';

  document.getElementById('projectDetail').style.display = 'none';



  // ── 统计概览栏 ──

  const total = projects.length;

  const active = projects.filter(p => p.status === '进行中').length;

  const done = projects.filter(p => p.status === '已完成').length;

  const paused = projects.filter(p => p.status === '暂停' || p.status === '待启动').length;

  const filter = DATA.projectFilter || 'all';

  const statsHTML = `

    <div class="project-stats-bar">

      <div class="project-stat-card all ${filter==='all'?'active':''}" onclick="filterProject('all')">

        <div class="project-stat-num">${total}</div>

        <div class="project-stat-label">全部项目</div>

      </div>

      <div class="project-stat-card active-stat ${filter==='进行中'?'active':''}" onclick="filterProject('进行中')">

        <div class="project-stat-num">${active}</div>

        <div class="project-stat-label">进行中</div>

      </div>

      <div class="project-stat-card done-stat ${filter==='已完成'?'active':''}" onclick="filterProject('已完成')">

        <div class="project-stat-num">${done}</div>

        <div class="project-stat-label">已完成</div>

      </div>

      <div class="project-stat-card paused-stat ${filter==='暂停'?'active':''}" onclick="filterProject('暂停')">

        <div class="project-stat-num">${paused}</div>

        <div class="project-stat-label">暂停/待启动</div>

      </div>

    </div>`;



  // 筛选项目

  const filteredProjects = filter === 'all' ? projects : projects.filter(p => {

    if (filter === '暂停') return p.status === '暂停' || p.status === '待启动';

    return p.status === filter;

  });



  if (filteredProjects.length === 0) {

    document.getElementById('s6Items').innerHTML = statsHTML + (filter !== 'all' 

      ? `<div style="text-align:center;padding:30px;color:var(--meta);">没有「${filter}」状态的项目 <br><button class="modal-btn confirm" style="margin-top:12px;padding:6px 16px;font-size:12px;" onclick="filterProject('all')">查看全部</button></div>`

      : empty('暂无项目，点击右上角新建'));

    return;

  }



  // ── 卡片网格渲染 ──

  document.getElementById('s6Items').innerHTML = statsHTML + '<div class="project-card-grid">' + filteredProjects.map(proj => {

    const leader = proj.leader_id ? memberMap[proj.leader_id] : null;

    const statusColors = { '进行中': 'blue', '已完成': 'green', '暂停': 'orange', '待启动': 'orange' };

    const statusCls = statusColors[proj.status] || 'blue';

    const plan = safeArr(proj.plan_total).length > 0
      ? [...safeArr(proj.plan_total), ...safeArr(proj.plan_nonstd), ...safeArr(proj.plan_std)]
      : safeArr(proj.plan);

    const activeRisks = risks.filter(r => r.status !== '已解决');

    const related = handovers.filter(h => h.project_id === proj.id);



    // 计算计划进度

    const donePlans = plan.filter(n => n.status === '已完成').length;

    const planProgress = plan.length > 0 ? Math.round(donePlans / plan.length * 100) : 0;



    // 计算任务进度

    const tasks = safeArr(proj.tasks);

    const doneTasks = tasks.filter(t => t.status === 'completed').length;

    const taskProgress = tasks.length > 0 ? Math.round(doneTasks / tasks.length * 100) : 0;



    return `

    <div class="card project-card status-${statusCls === 'blue' ? 'active' : statusCls === 'green' ? 'done' : 'paused'}" onclick="openProjectDetail('${proj.id}')">

      ${cardActions(`event.stopPropagation();openProjectModal('${proj.id}')`, `event.stopPropagation();deleteItem('projects','${proj.id}')`)}

      <div class="card-header" style="pointer-events:none;">

        <span class="card-title" style="font-size:15px;">${esc(proj.name)}</span>

        <span class="badge ${statusCls}">${esc(proj.status)}</span>

      </div>

      <div class="card-desc" style="font-size:12px;line-height:18px;margin-top:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:36px;">${esc(proj.description) || '暂无描述'}</div>

      ${(plan.length > 0 || tasks.length > 0) ? `

      <div class="card-body-preview" style="margin-top:8px;">

        ${plan.length > 0 ? `

        <div class="mini-progress">

          <div class="mini-progress-bar"><div class="mini-progress-fill" style="width:${planProgress}%;background:#6366F1;"></div></div>

          <span class="mini-progress-text" style="font-size:10px;">计划 ${donePlans}/${plan.length}</span>

        </div>` : ''}

        ${tasks.length > 0 ? `

        <div class="mini-progress">

          <div class="mini-progress-bar"><div class="mini-progress-fill" style="width:${taskProgress}%;background:#059669;"></div></div>

          <span class="mini-progress-text" style="font-size:10px;">任务 ${doneTasks}/${tasks.length}</span>

        </div>` : ''}

      </div>` : '<div class="card-body-preview" style="margin-top:8px;color:var(--meta);font-size:11px;">暂无计划/任务</div>'}

      <div class="card-footer" style="margin-top:8px;">

        ${leader ? `<span class="card-meta" style="display:flex;align-items:center;gap:4px;">

          <span style="width:18px;height:18px;border-radius:50%;background:#6366F1;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:9px;font-weight:700;">${esc(leader.avatar||leader.nickname.charAt(0))}</span>

          ${esc(leader.nickname)}

        </span>` : '<span class="card-meta">未指定负责人</span>'}

        <div class="card-meta-icons" style="font-size:10px;gap:3px;">

          ${plan.length > 0 ? `<span style="color:#6366F1;">📅${plan.length}</span>` : ''}

          ${tasks.length > 0 ? `<span style="color:#059669;">✅${tasks.length}</span>` : ''}

          ${activeRisks.length > 0 ? `<span style="color:#EF4444;">⚠️${activeRisks.length}</span>` : ''}

          ${(proj.meeting_count||0) > 0 ? `<span style="color:#EC4899;">🎤${proj.meeting_count}</span>` : ''}

        </div>

      </div>

    </div>`;

  }).join('') + '</div>';



  // 同时渲染甘特图子视图

  renderGantt();

}



function toggleProjectExpand(id) {

  // 现在改为打开详情视图

  openProjectDetail(id);

}



function openProjectDetail(id) {

  const nid = +id;

  DATA.projectDetailId = nid;

  DATA.expandedProject = nid; // 保持兼容

  renderS6();

}



function backToProjectList() {

  DATA.projectDetailId = null;

  DATA.expandedProject = null;

  renderS6();

}



// ── 项目详情视图（卡片式） ──

function renderProjectDetail(proj) {

  const handovers = DATA.handovers || [];

  const memberMap = {};

  (DATA.members||[]).forEach(m => { memberMap[m.id] = m; });



  const leader = proj.leader_id ? memberMap[proj.leader_id] : null;

  const statusColors = { '进行中': 'blue', '已完成': 'green', '暂停': 'orange', '待启动': 'orange' };

  const statusCls = statusColors[proj.status] || 'blue';

  const plan = getCurrentPlan(proj);

  const tasks = safeArr(proj.tasks);

  const milestones = safeArr(proj.milestones);

  const risks = safeArr(proj.risks);

  const meetingTasks = safeArr(proj.meeting_tasks);

  const related = handovers.filter(h => h.project_id === proj.id);



  // 切换显示

  document.getElementById('s6PageHeader').style.display = 'none';

  document.getElementById('s6Items').style.display = 'none';

  const detailEl = document.getElementById('projectDetail');

  detailEl.style.display = '';



  // 状态徽章颜色映射

  const riskSevColors = { '高': '#EF4444', '中': '#D97706', '低': '#059669' };



  detailEl.innerHTML = `

  <!-- 顶部导航栏 -->

  <div class="project-detail-header">

    <button class="detail-back-btn" onclick="backToProjectList()">← 返回</button>

    <span class="detail-title">${esc(proj.name)}</span>

    <span class="badge ${statusCls}" style="margin-left:auto;margin-right:8px;">${esc(proj.status)}</span>

    <button class="detail-edit-btn" onclick="openProjectModal('${proj.id}')">✏️ 编辑</button>

  </div>



  <!-- 项目元信息卡片 -->

  <div class="detail-card">

    <div class="detail-card-header">

      <span>📋 项目信息</span>

    </div>

    <div class="detail-card-body">

      <div class="detail-meta-grid">

        <div class="detail-meta-item">

          <span class="meta-label">负责人</span>

          <span class="meta-value">${leader ? esc(leader.nickname) : '未指定'}</span>

        </div>

        <div class="detail-meta-item">

          <span class="meta-label">状态</span>

          <span class="meta-value" style="color:${statusCls==='blue'?'#6366F1':statusCls==='green'?'#059669':'#D97706'}">${esc(proj.status)}</span>

        </div>

        <div class="detail-meta-item">

          <span class="meta-label">计划节点</span>

          <span class="meta-value">${plan.length} 个</span>

        </div>

        <div class="detail-meta-item">

          <span class="meta-label">任务</span>

          <span class="meta-value">${tasks.filter(t=>t.status==='completed').length}/${tasks.length} 完成</span>

        </div>

        <div class="detail-meta-item">

          <span class="meta-label">风险</span>

          <span class="meta-value" style="color:${risks.filter(r=>r.status!=='已解决').length > 0 ? '#EF4444' : ''}">${risks.filter(r=>r.status!=='已解决').length} 活跃</span>

        </div>

        <div class="detail-meta-item">

          <span class="meta-label">关联会议</span>

          <span class="meta-value">${proj.meeting_count||0} 场</span>

        </div>

      </div>

      ${proj.description ? `<div style="margin-top:12px;font-size:13px;color:var(--body);line-height:20px;padding:10px 12px;background:var(--bg);border-radius:8px;">${esc(proj.description)}</div>` : ''}

    </div>

  </div>



  <!-- 🎯 卡片1: 项目甘特图（优先展示） -->

  <div class="detail-card gantt-priority">

    <div class="detail-card-header">

      <span>📊 项目甘特图</span>

      <div style="display:flex;align-items:center;gap:8px;">
        <div class="pg-view-toggle" style="display:flex;gap:0;">
          <button class="pg-view-btn${DATA.singleGanttView==='day'?' active':''}" onclick="event.stopPropagation();switchSingleGanttView('day','${proj.id}')">📆 日</button>
          <button class="pg-view-btn${DATA.singleGanttView==='month'?' active':''}" onclick="event.stopPropagation();switchSingleGanttView('month','${proj.id}')">📅 月</button>
          <button class="pg-view-btn${DATA.singleGanttView==='year'?' active':''}" onclick="event.stopPropagation();switchSingleGanttView('year','${proj.id}')">📊 年</button>
        </div>
        <span class="card-badge" style="background:var(--primary);color:#fff;">优先</span>
      </div>

    </div>

    <div class="detail-card-body">

      ${buildSingleProjectGantt(proj, todayDate(), DATA.singleGanttView||'month')}

    </div>

  </div>



  <!-- 📅 卡片2: 项目计划 -->
  <div class="detail-card">
    <div class="detail-card-header">
      <span>📅 项目计划 (${plan.length})</span>
      <button class="plan-edit-btn" onclick="openPlanEditor('${proj.id}')">✏️ 编辑</button>
    </div>
    <!-- 计划子标签切换 -->
    <div class="plan-sub-tab-bar" style="display:flex;gap:0;padding:0 14px;margin-bottom:0;">
      <button class="plan-sub-tab${DATA.planSubTab==='total'?' active':''}" onclick="event.stopPropagation();switchPlanSubTab('total','${proj.id}')" style="flex:1;padding:8px 0;font-size:12px;border:none;border-bottom:2px solid ${DATA.planSubTab==='total'?'var(--blue,#3B82F6)':'transparent'};background:none;color:${DATA.planSubTab==='total'?'var(--blue,#3B82F6)':'var(--meta)'};cursor:pointer;transition:all 0.2s;font-weight:${DATA.planSubTab==='total'?600:400};">总项目计划</button>
      <button class="plan-sub-tab${DATA.planSubTab==='nonstd'?' active':''}" onclick="event.stopPropagation();switchPlanSubTab('nonstd','${proj.id}')" style="flex:1;padding:8px 0;font-size:12px;border:none;border-bottom:2px solid ${DATA.planSubTab==='nonstd'?'var(--blue,#3B82F6)':'transparent'};background:none;color:${DATA.planSubTab==='nonstd'?'var(--blue,#3B82F6)':'var(--meta)'};cursor:pointer;transition:all 0.2s;font-weight:${DATA.planSubTab==='nonstd'?600:400};">非标设备</button>
      <button class="plan-sub-tab${DATA.planSubTab==='std'?' active':''}" onclick="event.stopPropagation();switchPlanSubTab('std','${proj.id}')" style="flex:1;padding:8px 0;font-size:12px;border:none;border-bottom:2px solid ${DATA.planSubTab==='std'?'var(--blue,#3B82F6)':'transparent'};background:none;color:${DATA.planSubTab==='std'?'var(--blue,#3B82F6)':'var(--meta)'};cursor:pointer;transition:all 0.2s;font-weight:${DATA.planSubTab==='std'?600:400};">标准设备</button>
    </div>
    <div class="detail-card-body${plan.length === 0 ? '' : ' no-padding'}">
      ${plan.length > 0 ? renderDetailPlan(proj) : '<div style="font-size:12px;color:var(--meta);text-align:center;padding:20px 0;">暂无计划，点右上角编辑添加</div>'}
    </div>
  </div>



  <!-- 🎯 卡片3: 项目任务 -->

  <div class="detail-card">

    <div class="detail-card-header">

      <span>🎯 项目任务 (${tasks.length})</span>

      <button class="section-add-btn" onclick="addProjectTask('${proj.id}')">+ 添加</button>

    </div>

    <div class="detail-card-body">

      ${renderTasksHTML(proj) || '<div style="font-size:12px;color:var(--meta);text-align:center;padding:20px 0;">暂无任务</div>'}

    </div>

  </div>



  <!-- 🏁 卡片4: 里程碑 -->

  <div class="detail-card">

    <div class="detail-card-header">

      <span>🏁 项目里程碑 (${milestones.length})</span>

      <button class="section-add-btn" onclick="addProjectMilestone('${proj.id}')">+ 添加</button>

    </div>

    <div class="detail-card-body">

      ${renderMilestonesHTML(proj) || '<div style="font-size:12px;color:var(--meta);text-align:center;padding:20px 0;">暂无里程碑</div>'}

    </div>

  </div>



  <!-- ⚠️ 卡片5: 风险 -->

  <div class="detail-card">

    <div class="detail-card-header">

      <span>⚠️ 项目风险 (${risks.length})</span>

      <button class="section-add-btn" onclick="addProjectRisk('${proj.id}')">+ 添加</button>

    </div>

    <div class="detail-card-body">

      ${renderRisksHTML(proj) || '<div style="font-size:12px;color:var(--meta);text-align:center;padding:20px 0;">暂无风险</div>'}

    </div>

  </div>



  <!-- 🎤 卡片6: 关联会议待办 -->

  ${meetingTasks.length > 0 ? `

  <div class="detail-card">

    <div class="detail-card-header">

      <span>🎤 关联会议待办 (${meetingTasks.length})</span>

    </div>

    <div class="detail-card-body">

      ${meetingTasks.map(mt => {

        const mtStatusCls = mt.status === '已完成' ? 'green' : mt.status === '进行中' ? 'blue' : '';

        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-light);">

          <div style="flex:1;min-width:0;">

            <div style="font-size:13px;color:var(--title);font-weight:500;">${esc(mt.task||'')}</div>

            <div style="font-size:11px;color:var(--meta);margin-top:3px;">

              📋 ${esc(mt.meeting_title||'')} · ${mt.meeting_date||''}

              ${mt.assignee ? ' · 👤 ' + esc(mt.assignee) : ''}

              ${mt.deadline ? ' · ⏰ ' + esc(mt.deadline) : ''}

            </div>

          </div>

          ${mt.status ? `<span class="badge ${mtStatusCls}" style="font-size:10px;padding:2px 8px;flex-shrink:0;">${esc(mt.status)}</span>` : ''}

        </div>`;

      }).join('')}

    </div>

  </div>` : ''}



  <!-- 🔄 卡片7: 关联交接 -->

  <div class="detail-card">

    <div class="detail-card-header">

      <span>🔄 关联交接事项 (${related.length})</span>

      <button class="section-add-btn" onclick="openHandoverModalForProject('${proj.id}')">+ 添加</button>

    </div>

    <div class="detail-card-body">

      ${related.length > 0 ? related.map(h => {

        const assignee = h.to_user_id ? memberMap[h.to_user_id] : null;

        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-light);">

          <div style="flex:1;min-width:0;">

            <div style="font-size:13px;color:var(--title);font-weight:500;">${esc(h.title)}</div>

            <div style="font-size:11px;color:var(--meta);margin-top:2px;">${assignee ? esc(assignee.nickname) : '未指定'} · ${h.status}</div>

          </div>

          <span class="badge ${badgeClass(h.priority)}" style="font-size:10px;padding:2px 8px;">${esc(h.priority)}</span>

        </div>`;

      }).join('') : '<div style="font-size:12px;color:var(--meta);text-align:center;padding:20px 0;">暂无关联交接</div>'}

    </div>

  </div>



  <!-- 底部间距 -->

  <div style="height:24px;"></div>

  `;

}



// ── 单项甘特图生成 ──

function buildSingleProjectGantt(proj, today, view) {
  view = view || 'month';
  const plan = safeArr(proj.plan_total).length > 0
    ? [...safeArr(proj.plan_total), ...safeArr(proj.plan_nonstd), ...safeArr(proj.plan_std)]
    : safeArr(proj.plan);
  const milestones = safeArr(proj.milestones);

  if (plan.length === 0 && milestones.length === 0) {
    return '<div style="text-align:center;padding:30px;color:var(--meta);">📭 暂无计划数据<br><span style="font-size:11px;">请先编辑项目计划以生成甘特图</span></div>';
  }

  // 收集所有日期
  const allDates = [];
  plan.forEach(node => {
    if (node.start) allDates.push(new Date(node.start));
    if (node.end) allDates.push(new Date(node.end));
  });
  milestones.forEach(ms => {
    const msStart = ms.start || ms.date;
    const msEnd = ms.end || ms.date;
    if (msStart) allDates.push(new Date(msStart));
    if (msEnd) allDates.push(new Date(msEnd));
  });
  if (allDates.length === 0) {
    return '<div style="text-align:center;padding:30px;color:var(--meta);">暂无有效日期</div>';
  }

  const minDate = new Date(Math.min(...allDates));
  const maxDate = new Date(Math.max(...allDates));
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (view === 'day') return buildSingleGanttDay(plan, milestones, minDate, maxDate, todayDate);
  if (view === 'year') return buildSingleGanttYear(plan, milestones, minDate, maxDate, todayDate);
  return buildSingleGanttMonth(plan, milestones, minDate, maxDate, todayDate);
}

// ── 单品甘特图月视图 ──
function buildSingleGanttMonth(plan, milestones, minDate, maxDate, today) {
  let cm = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  let ce = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 0);
  const months = [];
  const cur = new Date(cm);
  while (cur <= ce) {
    const y = cur.getFullYear();
    const m = cur.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    months.push({ year: y, month: m, label: `${y}/${m+1}`, days: daysInMonth });
    cur.setMonth(cur.getMonth() + 1);
  }

  const MONTH_WIDTH = 60;
  const labelWidth = 100;
  const totalWidth = labelWidth + months.length * MONTH_WIDTH;

  function dateToX(date) {
    const monthIndex = (date.getFullYear() - cm.getFullYear()) * 12 + date.getMonth() - cm.getMonth();
    const daysInThatMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const fraction = (date.getDate() - 1) / daysInThatMonth;
    return labelWidth + (monthIndex + fraction) * MONTH_WIDTH;
  }

  const todayOffset = dateToX(today);
  const headerHeight = 32;

  let html = `<div class="gantt-wrapper" style="position:relative;width:${totalWidth}px;font-size:11px;min-width:100%;">`;

  // 月份表头
  html += '<div class="gantt-header-row" style="display:flex;">';
  html += `<div class="gantt-project-name-col" style="width:${labelWidth}px;height:32px;font-size:11px;color:var(--meta);flex-shrink:0;display:flex;align-items:center;padding-left:8px;">节点 \\ 时间</div>`;
  months.forEach(m => {
    const isCurrentMonth = m.year === today.getFullYear() && m.month === today.getMonth();
    html += `<div class="gantt-month-cell" style="width:${MONTH_WIDTH}px;text-align:center;font-size:11px;padding:7px 0;border-left:1px solid var(--border);background:${isCurrentMonth ? 'rgba(239,68,68,0.08)' : 'var(--bg)'};">${m.label}</div>`;
  });
  html += '</div>';

  // 计划行
  plan.forEach((node, i) => {
    const s = node.start ? new Date(node.start) : null;
    const e = node.end ? new Date(node.end) : null;
    const left = s ? dateToX(s) : labelWidth;
    const width = s && e ? Math.max(8, dateToX(e) - dateToX(s)) : 8;
    const isDone = node.status === '已完成';
    const isProgress = node.status === '进行中';
    const isOverdue = !isDone && e && e < today;
    const barColor = isDone ? '#059669' : isProgress ? '#6366F1' : '#CBD5E1';
    const barBorder = isOverdue ? '2px solid #EF4444' : 'none';
    const barLabel = width > 60 ? `${node.start||'?'} → ${node.end||'?'}` : (width > 30 ? node.name||`节点${i+1}` : '');

    html += `<div class="gantt-row" style="display:flex;align-items:center;height:32px;border-bottom:1px solid #F1F5F9;">
      <div style="width:${labelWidth}px;padding:0 8px;font-size:11px;color:var(--title);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;" title="${esc(node.name||'节点')}">${esc(node.name||`节点${i+1}`)}</div>
      <div style="flex:1;position:relative;height:100%;">
        <div style="position:absolute;left:${left - labelWidth}px;top:6px;height:20px;width:${width}px;background:${barColor};border-radius:4px;border:${barBorder};display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;overflow:hidden;white-space:nowrap;padding:0 4px;" title="${node.start||'?'} → ${node.end||'?'}">
          ${barLabel}
        </div>
      </div>
    </div>`;
  });

  // 里程碑行
  milestones.forEach(ms => {
    const msStart = ms.start || ms.date;
    const msEnd = ms.end || ms.date;
    if (!msStart && !msEnd) return;
    const s = msStart ? new Date(msStart) : null;
    const e = msEnd ? new Date(msEnd) : null;
    const left = s ? dateToX(s) : labelWidth;
    const width = s && e ? Math.max(6, dateToX(e) - dateToX(s)) : 6;
    const isOverdue = e && e < today;
    const msColor = ms.color || '#D97706';
    const msLabel = width > 60 ? `${msStart||'?'} → ${msEnd||'?'}` : (width > 24 ? ms.name||'' : '');

    html += `<div class="gantt-row" style="display:flex;align-items:center;height:28px;border-bottom:1px solid #F1F5F9;">
      <div style="width:${labelWidth}px;padding:0 8px;font-size:10px;color:var(--meta);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;" title="🏁 ${esc(ms.name||'')}">🏁 ${esc(ms.name||'里程碑')}</div>
      <div style="flex:1;position:relative;height:100%;">
        <div style="position:absolute;left:${left - labelWidth}px;top:6px;height:16px;width:${width}px;background:${msColor};border-radius:4px;border:${isOverdue ? '2px solid #EF4444' : 'none'};opacity:0.85;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff;overflow:hidden;white-space:nowrap;padding:0 2px;" title="🏁 ${esc(ms.name||'')}: ${msStart||'?'} → ${msEnd||'?'}">
          ${msLabel}
        </div>
      </div>
    </div>`;
  });

  // 今日红线
  const rowCount = plan.length + milestones.length;
  const chartHeight = rowCount * 32 + 4;
  html += `<div style="position:absolute;top:${headerHeight}px;left:${todayOffset}px;width:2px;height:${chartHeight}px;background:#EF4444;z-index:5;pointer-events:none;" title="今日"></div>`;

  html += '</div>';

  // 图例
  html += `<div class="plan-legend" style="margin-top:10px;display:flex;gap:12px;font-size:10px;color:var(--meta);padding:0 12px;">
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#059669;margin-right:4px;"></span>已完成</span>
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#6366F1;margin-right:4px;"></span>进行中</span>
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#CBD5E1;margin-right:4px;"></span>待开始</span>
    <span><span style="display:inline-block;width:2px;height:10px;background:#EF4444;margin-right:4px;"></span>今日</span>
  </div>`;

  return html;
}

// ── 单品甘特图日视图 ──
function buildSingleGanttDay(plan, milestones, minDate, maxDate, today) {
  const DAY_WIDTH = 28;
  const labelWidth = 100;
  const allDays = [];
  const cur = new Date(minDate);
  cur.setDate(cur.getDate() - 1);
  const ce = new Date(maxDate);
  ce.setDate(ce.getDate() + 1);
  while (cur <= ce) {
    allDays.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }

  // 月份分组
  const monthGroups = [];
  let lastMonth = '';
  allDays.forEach((d, idx) => {
    const mk = `${d.getFullYear()}-${d.getMonth()}`;
    if (mk !== lastMonth) {
      monthGroups.push({ label: `${d.getMonth()+1}月`, start: idx, count: 1 });
      lastMonth = mk;
    } else {
      monthGroups[monthGroups.length-1].count++;
    }
  });

  const totalWidth = labelWidth + allDays.length * DAY_WIDTH;
  const headerHeight = 52;

  let html = `<div class="gantt-wrapper" style="position:relative;width:${totalWidth}px;font-size:10px;min-width:100%;">`;

  // 月份表头行
  html += '<div class="gantt-header-row" style="display:flex;">';
  html += `<div class="gantt-project-name-col" style="width:${labelWidth}px;height:24px;font-size:11px;color:var(--meta);flex-shrink:0;display:flex;align-items:center;padding-left:8px;">节点 \\ 日期</div>`;
  monthGroups.forEach(g => {
    html += `<div class="gantt-month-cell" style="width:${g.count * DAY_WIDTH}px;text-align:center;font-size:11px;padding:4px 0;border-left:1px solid var(--border);">${g.label}</div>`;
  });
  html += '</div>';

  // 日期行
  html += '<div class="gantt-day-header" style="display:flex;">';
  html += `<div style="width:${labelWidth}px;height:22px;flex-shrink:0;"></div>`;
  allDays.forEach(d => {
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const isToday = d.getTime() === today.getTime();
    html += `<div class="gantt-day-col${isWeekend?' weekend':''}${isToday?' today':''}" style="width:${DAY_WIDTH}px;text-align:center;font-size:9px;padding:3px 0;border-left:1px solid #F1F5F9;">${d.getDate()}<br><span style="font-size:7px;color:var(--meta);">${['日','一','二','三','四','五','六'][d.getDay()]}</span></div>`;
  });
  html += '</div>';

  function dateToX(date) {
    const days = Math.round((date - allDays[0]) / 86400000);
    return labelWidth + days * DAY_WIDTH;
  }

  // 计划行
  plan.forEach((node, i) => {
    const s = node.start ? new Date(node.start) : null;
    const e = node.end ? new Date(node.end) : null;
    const left = s ? dateToX(s) : labelWidth;
    const width = s && e ? Math.max(DAY_WIDTH * 0.8, dateToX(e) - dateToX(s) + DAY_WIDTH) : DAY_WIDTH * 0.8;
    const isDone = node.status === '已完成';
    const isProgress = node.status === '进行中';
    const isOverdue = !isDone && e && e < today;
    const barColor = isDone ? '#059669' : isProgress ? '#6366F1' : '#CBD5E1';
    const barBorder = isOverdue ? '2px solid #EF4444' : 'none';
    const barLabel = width > 60 ? `${node.start||'?'} → ${node.end||'?'}` : (width > 30 ? node.name||`节点${i+1}` : '');

    html += `<div class="gantt-row" style="display:flex;align-items:center;height:32px;border-bottom:1px solid #F1F5F9;">
      <div style="width:${labelWidth}px;padding:0 8px;font-size:11px;color:var(--title);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;" title="${esc(node.name||'节点')}">${esc(node.name||`节点${i+1}`)}</div>
      <div style="flex:1;position:relative;height:100%;">
        <div style="position:absolute;left:${Math.round(left - labelWidth)}px;top:6px;height:20px;width:${Math.round(width)}px;background:${barColor};border-radius:4px;border:${barBorder};display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;overflow:hidden;white-space:nowrap;padding:0 4px;" title="${node.start||'?'} → ${node.end||'?'}">
          ${barLabel}
        </div>
      </div>
    </div>`;
  });

  // 里程碑行
  milestones.forEach(ms => {
    const msStart = ms.start || ms.date;
    const msEnd = ms.end || ms.date;
    if (!msStart && !msEnd) return;
    const s = msStart ? new Date(msStart) : null;
    const e = msEnd ? new Date(msEnd) : null;
    const left = s ? dateToX(s) : labelWidth;
    const width = s && e ? Math.max(6, dateToX(e) - dateToX(s) + DAY_WIDTH) : 6;
    const isOverdue = e && e < today;
    const msColor = ms.color || '#D97706';
    const msLabel = width > 60 ? `${msStart||'?'} → ${msEnd||'?'}` : (width > 24 ? ms.name||'' : '');

    html += `<div class="gantt-row" style="display:flex;align-items:center;height:28px;border-bottom:1px solid #F1F5F9;">
      <div style="width:${labelWidth}px;padding:0 8px;font-size:10px;color:var(--meta);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;" title="🏁 ${esc(ms.name||'')}">🏁 ${esc(ms.name||'里程碑')}</div>
      <div style="flex:1;position:relative;height:100%;">
        <div style="position:absolute;left:${Math.round(left - labelWidth)}px;top:6px;height:16px;width:${Math.round(width)}px;background:${msColor};border-radius:4px;border:${isOverdue ? '2px solid #EF4444' : 'none'};opacity:0.85;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff;overflow:hidden;white-space:nowrap;padding:0 2px;" title="🏁 ${esc(ms.name||'')}: ${msStart||'?'} → ${msEnd||'?'}">
          ${msLabel}
        </div>
      </div>
    </div>`;
  });

  // 今日红线
  const todayOffset = dateToX(today);
  const rowCount = plan.length + milestones.length;
  const chartHeight = rowCount * 32 + 4;
  html += `<div style="position:absolute;top:${headerHeight}px;left:${todayOffset}px;width:2px;height:${chartHeight}px;background:#EF4444;z-index:5;pointer-events:none;" title="今日"></div>`;

  html += '</div>';

  html += `<div class="plan-legend" style="margin-top:10px;display:flex;gap:12px;font-size:10px;color:var(--meta);padding:0 12px;">
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#059669;margin-right:4px;"></span>已完成</span>
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#6366F1;margin-right:4px;"></span>进行中</span>
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#CBD5E1;margin-right:4px;"></span>待开始</span>
    <span><span style="display:inline-block;width:2px;height:10px;background:#EF4444;margin-right:4px;"></span>今日</span>
  </div>`;

  return html;
}

// ── 单品甘特图年视图 ──
function buildSingleGanttYear(plan, milestones, minDate, maxDate, today) {
  const MONTH_WIDTH = 36;
  const labelWidth = 100;
  const startYear = minDate.getFullYear();
  const startMonth = minDate.getMonth();
  const endYear = maxDate.getFullYear();
  const endMonth = maxDate.getMonth();
  const totalMonths = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;

  // 年份分组
  const yearGroups = [];
  for (let i = 0; i < totalMonths; i++) {
    const y = startYear + Math.floor((startMonth + i) / 12);
    const m = (startMonth + i) % 12;
    if (!yearGroups.length || yearGroups[yearGroups.length-1].year !== y) {
      yearGroups.push({ year: y, months: 0, width: 0 });
    }
    yearGroups[yearGroups.length-1].months++;
    yearGroups[yearGroups.length-1].width += MONTH_WIDTH;
  }
  const totalWidth = labelWidth + totalMonths * MONTH_WIDTH;
  const headerHeight = 52;

  let html = `<div class="gantt-wrapper" style="position:relative;width:${totalWidth}px;font-size:10px;min-width:100%;">`;

  // 年份表头
  html += '<div class="gantt-header-row" style="display:flex;">';
  html += `<div class="gantt-project-name-col" style="width:${labelWidth}px;height:24px;font-size:11px;color:var(--meta);flex-shrink:0;display:flex;align-items:center;padding-left:8px;">节点 \\ 年份</div>`;
  yearGroups.forEach(g => {
    html += `<div class="gantt-month-cell" style="width:${g.width}px;text-align:center;font-size:11px;padding:4px 0;border-left:1px solid var(--border);">${g.year}年</div>`;
  });
  html += '</div>';

  // 月份行
  const todayMonthIndex = (today.getFullYear() - startYear) * 12 + (today.getMonth() - startMonth);
  html += '<div class="gantt-day-header" style="display:flex;">';
  html += `<div style="width:${labelWidth}px;height:22px;flex-shrink:0;"></div>`;
  for (let i = 0; i < totalMonths; i++) {
    const m = (startMonth + i) % 12;
    const isCurrentMonth = todayMonthIndex === i;
    html += `<div class="gantt-day-col${isCurrentMonth?' today':''}" style="width:${MONTH_WIDTH}px;text-align:center;font-size:9px;padding:3px 0;border-left:1px solid #F1F5F9;">${m+1}月</div>`;
  }
  html += '</div>';

  function dateToX(date) {
    const monthIndex = (date.getFullYear() - startYear) * 12 + date.getMonth() - startMonth;
    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const fraction = (date.getDate() - 1) / daysInMonth;
    return labelWidth + (monthIndex + fraction) * MONTH_WIDTH;
  }

  // 计划行
  plan.forEach((node, i) => {
    const s = node.start ? new Date(node.start) : null;
    const e = node.end ? new Date(node.end) : null;
    const left = s ? dateToX(s) : labelWidth;
    const width = s && e ? Math.max(4, dateToX(e) - dateToX(s)) : 4;
    const isDone = node.status === '已完成';
    const isProgress = node.status === '进行中';
    const isOverdue = !isDone && e && e < today;
    const barColor = isDone ? '#059669' : isProgress ? '#6366F1' : '#CBD5E1';
    const barBorder = isOverdue ? '2px solid #EF4444' : 'none';
    const barLabel = width > 40 ? (node.name||`节点${i+1}`) : '';

    html += `<div class="gantt-row" style="display:flex;align-items:center;height:32px;border-bottom:1px solid #F1F5F9;">
      <div style="width:${labelWidth}px;padding:0 8px;font-size:11px;color:var(--title);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;" title="${esc(node.name||'节点')}">${esc(node.name||`节点${i+1}`)}</div>
      <div style="flex:1;position:relative;height:100%;">
        <div style="position:absolute;left:${Math.round(left - labelWidth)}px;top:6px;height:20px;width:${Math.round(width)}px;background:${barColor};border-radius:4px;border:${barBorder};display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;overflow:hidden;white-space:nowrap;padding:0 4px;" title="${node.start||'?'} → ${node.end||'?'}">
          ${barLabel}
        </div>
      </div>
    </div>`;
  });

  // 里程碑行
  milestones.forEach(ms => {
    const msStart = ms.start || ms.date;
    const msEnd = ms.end || ms.date;
    if (!msStart && !msEnd) return;
    const s = msStart ? new Date(msStart) : null;
    const e = msEnd ? new Date(msEnd) : null;
    const left = s ? dateToX(s) : labelWidth;
    const width = s && e ? Math.max(4, dateToX(e) - dateToX(s)) : 4;
    const isOverdue = e && e < today;
    const msColor = ms.color || '#D97706';
    const msLabel = width > 30 ? ms.name||'' : '';

    html += `<div class="gantt-row" style="display:flex;align-items:center;height:28px;border-bottom:1px solid #F1F5F9;">
      <div style="width:${labelWidth}px;padding:0 8px;font-size:10px;color:var(--meta);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;" title="🏁 ${esc(ms.name||'')}">🏁 ${esc(ms.name||'里程碑')}</div>
      <div style="flex:1;position:relative;height:100%;">
        <div style="position:absolute;left:${Math.round(left - labelWidth)}px;top:6px;height:16px;width:${Math.round(width)}px;background:${msColor};border-radius:4px;border:${isOverdue ? '2px solid #EF4444' : 'none'};opacity:0.85;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff;overflow:hidden;white-space:nowrap;padding:0 2px;" title="🏁 ${esc(ms.name||'')}: ${msStart||'?'} → ${msEnd||'?'}">
          ${msLabel}
        </div>
      </div>
    </div>`;
  });

  // 今日红线（本月标记）
  if (todayMonthIndex >= 0 && todayMonthIndex < totalMonths) {
    const todayOffset = labelWidth + todayMonthIndex * MONTH_WIDTH + MONTH_WIDTH / 2;
    const rowCount = plan.length + milestones.length;
    const chartHeight = rowCount * 32 + 4;
    html += `<div style="position:absolute;top:${headerHeight}px;left:${todayOffset}px;width:2px;height:${chartHeight}px;background:#EF4444;z-index:5;pointer-events:none;" title="本月"></div>`;
  }

  html += '</div>';

  html += `<div class="plan-legend" style="margin-top:10px;display:flex;gap:12px;font-size:10px;color:var(--meta);padding:0 12px;">
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#059669;margin-right:4px;"></span>已完成</span>
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#6366F1;margin-right:4px;"></span>进行中</span>
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#CBD5E1;margin-right:4px;"></span>待开始</span>
    <span><span style="display:inline-block;width:2px;height:10px;background:#EF4444;margin-right:4px;"></span>今日</span>
  </div>`;

  return html;
}

// ── 详情页计划甘特图（日/月/年视图 + 里程碑标记）──

function renderDetailPlan(proj) {
  const plan = getCurrentPlan(proj);
  const milestones = safeArr(proj.milestones);

  // 收集所有日期（计划 + 里程碑）
  const dates = plan.flatMap(n => [n.start, n.end].filter(Boolean));
  milestones.forEach(m => {
    const msStart = m.start || m.date || '';
    const msEnd = m.end || m.date || '';
    if (msStart) dates.push(msStart);
    if (msEnd && msEnd !== msStart) dates.push(msEnd);
  });

  if (dates.length === 0) return '<div style="font-size:12px;color:var(--meta);padding:12px;">计划节点无有效日期</div>';

  const view = DATA.planGanttView || 'day';
  const todayStr = new Date().toISOString().split('T')[0];

  // 日期范围
  const minDate = new Date(Math.min(...dates.map(d => new Date(d))));
  const maxDate = new Date(Math.max(...dates.map(d => new Date(d))));
  minDate.setDate(minDate.getDate() - 1);
  maxDate.setDate(maxDate.getDate() + 1);

  const toggleHTML = planGanttToggle(proj.id, view);

  if (view === 'month') return toggleHTML + renderPlanGanttMonth(proj, plan, milestones, minDate, maxDate, todayStr);
  if (view === 'year')  return toggleHTML + renderPlanGanttYear(proj, plan, milestones, minDate, maxDate, todayStr);

  // day view (default)
  const allDays = [];
  const cur = new Date(minDate);
  while (cur <= maxDate) { allDays.push(cur.toISOString().split('T')[0]); cur.setDate(cur.getDate() + 1); }
  return toggleHTML + renderPlanGanttDay(proj, plan, milestones, allDays, todayStr);
}

// ── 视图切换按钮 ──
function planGanttToggle(projId, view) {
  const views = ['day','month','year'];
  const labels = { day: '📅 日', month: '📆 月', year: '🗓 年' };
  return '<div class="pg-view-toggle">' + views.map(v =>
    '<button class="pg-view-btn' + (view===v?' active':'') + '" onclick="event.stopPropagation();switchPlanGanttView(\'' + v + '\',' + projId + ')">' + labels[v] + '</button>'
  ).join('') + '</div>';
}

// ── 日视图 ──
function renderPlanGanttDay(proj, plan, milestones, allDays, todayStr) {
  // 构建里程碑日期映射（按日期 → 里程碑列表）
  const msByDate = {};
  milestones.forEach(m => {
    const msStart = m.start || m.date || '';
    const msEnd = m.end || m.date || '';
    if (!msStart) return;
    // 里程碑日期范围内的每一天都打标
    const s = new Date(msStart);
    const e = msEnd ? new Date(msEnd) : new Date(msStart);
    const c = new Date(s);
    while (c <= e) {
      const ds = c.toISOString().split('T')[0];
      if (!msByDate[ds]) msByDate[ds] = [];
      msByDate[ds].push(m);
      c.setDate(c.getDate() + 1);
    }
  });

  // 表头
  const monthGroups = [];
  let lastMonth = '', lastIdx = -1;
  allDays.forEach((ds, idx) => {
    const m = ds.slice(0, 7);
    if (m !== lastMonth) {
      monthGroups.push({ label: ds.slice(5,7)+'月', start: idx, count: 1 });
      lastMonth = m; lastIdx = monthGroups.length - 1;
    } else { monthGroups[lastIdx].count++; }
  });
  const thMonths = monthGroups.map(g => '<th colspan="'+g.count+'" class="pg-th-month">'+g.label+'</th>').join('');
  const thDays = allDays.map(ds => {
    const d = new Date(ds);
    return '<th class="pg-th-day'+(d.getDay()===0||d.getDay()===6?' weekend':'')+(ds===todayStr?' today':'')+'" title="'+ds+'">'+ds.slice(8)+'</th>';
  }).join('');

  // 计划 + 实际行
    // 检测分组变化，插入分组标题行
  let lastGroup = '__init__';
  const rows = plan.map((node, i) => {
    const curGroup = node.group || '';
    let groupDivider = '';
    if (curGroup !== lastGroup) {
      lastGroup = curGroup;
      if (curGroup) {
        const colSpan = 3 + allDays.length;
        groupDivider = '<tr class="pg-row-group"><td colspan="' + colSpan + '" class="pg-td-group"><span class="pg-group-icon">📂</span> ' + esc(curGroup) + '</td></tr>';
      }
    }
    const s = node.start || null, e = node.end || null;

    const planCells = allDays.map(ds => {
      const inPlan = s && e && ds >= s && ds <= e;
      const d = new Date(ds);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6, isToday = ds === todayStr, isStart = ds === s, isEnd = ds === e;
      let cls = 'pg-cell';
      if (isWeekend) cls += ' weekend';
      if (isToday) cls += ' today-col';
      if (inPlan) {
        const sc = node.status==='已完成'?'plan-done':node.status==='进行中'?'plan-progress':'plan-pending';
        const od = node.status!=='已完成'&&e<todayStr?' overdue':'';
        cls += ' plan-filled '+sc+od;
        if (isStart) cls += ' bar-start';
        if (isEnd) cls += ' bar-end';
      }

      // 里程碑标记
      const msHere = msByDate[ds];
      let msMarker = '';
      if (msHere && msHere.length > 0) {
        const m0 = msHere[0];
        msMarker = '<span class="pg-ms-marker" style="color:'+esc(m0.color||'#F59E0B')+'" title="'+esc(m0.name||'里程碑')+'">◆</span>';
      }
      return '<td class="'+cls+'" title="'+(inPlan?(node.status||'待开始'):'')+' '+ds+'"'+(msMarker?' data-milestone="1"':'')+'>'+msMarker+'</td>';
    }).join('');

    const dailyArr = safeArr(node.daily), dailyMap = {};
    dailyArr.forEach(d => { dailyMap[d.date] = d; });

    const actualCells = allDays.map(ds => {
      const entry = dailyMap[ds];
      const d = new Date(ds);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6, isToday = ds === todayStr;
      let cls = 'pg-cell pg-actual clickable';
      if (isWeekend) cls += ' weekend';
      if (isToday) cls += ' today-col';
      if (entry) {
        const sc = entry.status==='已完成'?'actual-done':entry.status==='进行中'?'actual-progress':entry.status==='延期'?'actual-blocked':'';
        if (sc) cls += ' '+sc;
        if (entry.note) cls += ' has-note';
      }
      const clickFn = isToday ? 'editPlanDailyNote('+proj.id+','+i+',\''+ds+'\')' : 'setPlanDailyStatus('+proj.id+','+i+',\''+ds+'\')';
      const title = entry ? ds+' '+entry.status+(entry.note?' — '+entry.note:'') : ds;
      return '<td class="'+cls+'" title="'+esc(title)+'" data-projid="'+proj.id+'" data-planidx="'+i+'" data-date="'+ds+'" onclick="event.stopPropagation();'+clickFn+'"></td>';
    }).join('');

    const statusBg = node.status==='已完成'?'#059669':node.status==='进行中'?'#6366F1':'#94A3B8';
    const nameTip = esc(node.name||'节点'+i)+' ('+(s||'?')+' ~ '+(e||'?')+')';
    return groupDivider + '<tr class="pg-row-plan"><td class="pg-td-no" rowspan="2">'+(i+1)+'</td><td class="pg-td-name" rowspan="2" title="'+nameTip+'"><div class="pg-name-inner"><span class="pg-status-dot" style="background:'+statusBg+';"></span><span class="pg-name-text">'+esc(node.name||'节点'+i)+'</span></div></td><td class="pg-td-rowtype plan-type">计划</td>'+planCells+'</tr><tr class="pg-row-actual"><td class="pg-td-rowtype actual-type">实际</td>'+actualCells+'</tr>';
  }).join('');


  const colgroup = '<col style="width:24px"><col style="width:96px"><col style="width:28px">'+allDays.map(() => '<col style="width:28px">').join('');

  return '<div class="pg-wrapper"><table class="pg-table" cellspacing="0" cellpadding="0"><colgroup>'+colgroup+'</colgroup><thead><tr class="pg-head-month"><th class="pg-th-fixed" rowspan="2" style="min-width:24px;"></th><th class="pg-th-fixed-name" rowspan="2">任务</th><th class="pg-th-fixed-type" rowspan="2">类别</th>'+thMonths+'</tr><tr class="pg-head-day">'+thDays+'</tr></thead><tbody>'+rows+'</tbody></table><div class="pg-legend"><span class="pg-legend-item"><span class="pg-swatch plan-pending"></span>待开始（计划）</span><span class="pg-legend-item"><span class="pg-swatch plan-progress"></span>进行中（计划）</span><span class="pg-legend-item"><span class="pg-swatch plan-done"></span>已完成（计划）</span><span class="pg-legend-item"><span class="pg-swatch actual-progress"></span>进行中（实际）</span><span class="pg-legend-item"><span class="pg-swatch actual-done"></span>已完成（实际）</span><span class="pg-legend-item"><span class="pg-swatch actual-blocked"></span>延期（实际）</span><span class="pg-legend-item"><span class="pg-ms-dot">◆</span> 里程碑</span></div></div>';
}

// ── 月视图 ──
function renderPlanGanttMonth(proj, plan, milestones, minDate, maxDate, todayStr) {
  // 构建月份列
  const months = [];
  const cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  while (cur <= maxDate) {
    const ds = cur.toISOString().split('T')[0];
    const label = (cur.getMonth()+1)+'月';
    // 计算当月天数
    const nextMonth = new Date(cur.getFullYear(), cur.getMonth()+1, 1);
    const daysInMonth = (nextMonth - cur) / 86400000;
    const endDs = new Date(nextMonth.getTime() - 86400000).toISOString().split('T')[0];
    months.push({ label, ds, endDs, daysInMonth });
    cur.setMonth(cur.getMonth() + 1);
  }

  // 构建里程碑月份映射
  const msByMonth = {};
  milestones.forEach(m => {
    const msStart = m.start || m.date || '';
    const msEnd = m.end || m.date || '';
    if (!msStart) return;
    const s = new Date(msStart), e = msEnd ? new Date(msEnd) : new Date(msStart);
    months.forEach(col => {
      const colStart = new Date(col.ds), colEnd = new Date(col.endDs);
      if (s <= colEnd && e >= colStart) {
        if (!msByMonth[col.ds]) msByMonth[col.ds] = [];
        msByMonth[col.ds].push(m);
      }
    });
  });

  const todayMonth = todayStr.slice(0, 7);

  const thMonths = months.map(m => '<th class="pg-th-month pg-mth-cell" title="'+m.ds+' ~ '+m.endDs+'">'+m.label+'</th>').join('');

  // 图例（月视图简化）
  const legend = '<div class="pg-legend"><span class="pg-legend-item"><span class="pg-swatch plan-progress"></span>计划进度</span><span class="pg-legend-item"><span class="pg-swatch actual-progress"></span>实际进度</span><span class="pg-legend-item"><span class="pg-ms-dot">◆</span> 里程碑</span></div>';

  const colgroup = '<col style="width:24px"><col style="width:96px"><col style="width:28px">'+months.map(() => '<col style="width:72px">').join('');

  // 检测分组变化，插入分组标题行
  let lastGroup = '__init__';
  const rows = plan.map((node, i) => {
    const curGroup = node.group || '';
    let groupDivider = '';
    if (curGroup !== lastGroup) {
      lastGroup = curGroup;
      if (curGroup) {
        const colSpan = 3 + months.length;
        groupDivider = '<tr class="pg-row-group"><td colspan="' + colSpan + '" class="pg-td-group"><span class="pg-group-icon">📂</span> ' + esc(curGroup) + '</td></tr>';
      }
    }
    const s = node.start || null, e = node.end || null;
    const dailyArr = safeArr(node.daily);

    // 计划行：按月份计算覆盖天数占比
    const planCells = months.map(col => {
      if (!s || !e) return '<td class="pg-cell pg-mth-cell"></td>';
      const colStart = new Date(col.ds), colEnd = new Date(col.endDs);
      const planStart = new Date(s), planEnd = new Date(e);
      const overlapStart = planStart > colStart ? planStart : colStart;
      const overlapEnd = planEnd < colEnd ? planEnd : colEnd;
      const overlapDays = overlapStart <= overlapEnd ? (overlapEnd - overlapStart) / 86400000 + 1 : 0;
      const pct = Math.min(100, Math.round(overlapDays / col.daysInMonth * 100));
      const isCurrentMonth = col.ds.slice(0, 7) === todayMonth;
      let cls = 'pg-cell pg-mth-cell';
      if (isCurrentMonth) cls += ' today-col';
      if (pct > 0) {
        const sc = node.status==='已完成'?'plan-done':node.status==='进行中'?'plan-progress':'plan-pending';
        cls += ' plan-filled '+sc;
      }
      // 里程碑标记
      const msHere = msByMonth[col.ds];
      let msMarker = '';
      if (msHere && msHere.length > 0) {
        msMarker = '<span class="pg-ms-marker" style="color:'+esc(msHere[0].color||'#F59E0B')+'" title="'+esc(msHere[0].name||'里程碑')+'">◆</span>';
      }
      return '<td class="'+cls+'" title="'+(node.status||'')+' '+col.ds+' '+pct+'%"'+(msMarker?' data-milestone=\"1\"':'')+'>'+msMarker+(pct>0?'<div class="pg-mth-fill" style="width:'+pct+'%;background:'+(node.status==='已完成'?'#6EE7B7':node.status==='进行中'?'#A5B4FC':'#C7D2FE')+'"></div>':'')+'</td>';
    }).join('');

    // 实际行：按月份统计 daily 数据
    const actualCells = months.map(col => {
      const colStart = new Date(col.ds), colEnd = new Date(col.endDs);
      const inMonth = dailyArr.filter(d => {
        const dd = new Date(d.date);
        return dd >= colStart && dd <= colEnd;
      });
      const doneCount = inMonth.filter(d => d.status === '已完成').length;
      const progressCount = inMonth.filter(d => d.status === '进行中').length;
      const blockedCount = inMonth.filter(d => d.status === '延期').length;
      const totalInPlan = s && e ? (() => {
        const ps = new Date(s), pe = new Date(e);
        const os = ps > colStart ? ps : colStart;
        const oe = pe < colEnd ? pe : colEnd;
        return os <= oe ? (oe - os) / 86400000 + 1 : 0;
      })() : 0;
      const totalDays = Math.max(totalInPlan, inMonth.length);
      const donePct = totalDays > 0 ? Math.min(100, Math.round(doneCount / totalDays * 100)) : 0;
      const progressPct = totalDays > 0 ? Math.min(100 - donePct, Math.round(progressCount / totalDays * 100)) : 0;
      const blockedPct = totalDays > 0 ? Math.min(100 - donePct - progressPct, Math.round(blockedCount / totalDays * 100)) : 0;
      const isCurrentMonth = col.ds.slice(0, 7) === todayMonth;
      let cls = 'pg-cell pg-mth-cell pg-actual';
      if (isCurrentMonth) cls += ' today-col';

      let bars = '';
      if (donePct > 0) bars += '<div class="pg-mth-fill" style="width:'+donePct+'%;background:#059669;"></div>';
      if (progressPct > 0) bars += '<div class="pg-mth-fill" style="width:'+progressPct+'%;background:#818CF8;left:'+donePct+'%;"></div>';
      if (blockedPct > 0) bars += '<div class="pg-mth-fill" style="width:'+blockedPct+'%;background:#F87171;left:'+(donePct+progressPct)+'%;"></div>';

      return '<td class="'+cls+'" title="'+col.ds+' 完成:'+doneCount+' 进行:'+progressCount+' 延期:'+blockedCount+'">'+bars+'</td>';
    }).join('');

    const statusBg = node.status==='已完成'?'#059669':node.status==='进行中'?'#6366F1':'#94A3B8';
    const nameTip = esc(node.name||'节点'+i)+' ('+(s||'?')+' ~ '+(e||'?')+')';
    return groupDivider + '<tr class="pg-row-plan"><td class="pg-td-no" rowspan="2">'+(i+1)+'</td><td class="pg-td-name" rowspan="2" title="'+nameTip+'"><div class="pg-name-inner"><span class="pg-status-dot" style="background:'+statusBg+';"></span><span class="pg-name-text">'+esc(node.name||'节点'+i)+'</span></div></td><td class="pg-td-rowtype plan-type">计划</td>'+planCells+'</tr><tr class="pg-row-actual"><td class="pg-td-rowtype actual-type">实际</td>'+actualCells+'</tr>';
  }).join('');

  return '<div class="pg-wrapper"><table class="pg-table" cellspacing="0" cellpadding="0"><colgroup>'+colgroup+'</colgroup><thead><tr class="pg-head-month"><th class="pg-th-fixed" rowspan="2" style="min-width:24px;"></th><th class="pg-th-fixed-name" rowspan="2">任务</th><th class="pg-th-fixed-type" rowspan="2">类别</th>'+thMonths+'</tr></thead><tbody>'+rows+'</tbody></table>'+legend+'</div>';
}

// ── 年视图 ──
function renderPlanGanttYear(proj, plan, milestones, minDate, maxDate, todayStr) {
  const todayYear = todayStr.slice(0, 4);
  const years = [];
  for (let y = minDate.getFullYear(); y <= maxDate.getFullYear(); y++) {
    years.push({ label: y+'年', start: y+'-01-01', end: y+'-12-31' });
  }

  // 里程碑年份映射
  const msByYear = {};
  milestones.forEach(m => {
    const msStart = m.start || m.date || '';
    if (!msStart) return;
    const y = msStart.slice(0, 4);
    if (!msByYear[y]) msByYear[y] = [];
    msByYear[y].push(m);
  });

  const thYears = years.map(y => '<th class="pg-th-month pg-yr-cell'+(y.start.slice(0,4)===todayYear?' today-col':'')+'" title="'+y.start+' ~ '+y.end+'">'+y.label+'</th>').join('');
  const legend = '<div class="pg-legend"><span class="pg-legend-item"><span class="pg-swatch plan-progress"></span>计划</span><span class="pg-legend-item"><span class="pg-swatch actual-progress"></span>实际</span><span class="pg-legend-item"><span class="pg-ms-dot">◆</span> 里程碑</span></div>';
  const colgroup = '<col style="width:24px"><col style="width:96px"><col style="width:28px">'+years.map(() => '<col style="width:80px">').join('');

  // 检测分组变化，插入分组标题行
  let lastGroup = '__init__';
  const rows = plan.map((node, i) => {
    const curGroup = node.group || '';
    let groupDivider = '';
    if (curGroup !== lastGroup) {
      lastGroup = curGroup;
      if (curGroup) {
        const colSpan = 3 + years.length;
        groupDivider = '<tr class="pg-row-group"><td colspan="' + colSpan + '" class="pg-td-group"><span class="pg-group-icon">📂</span> ' + esc(curGroup) + '</td></tr>';
      }
    }
    const s = node.start || null, e = node.end || null;
    const dailyArr = safeArr(node.daily);

    const planCells = years.map(y => {
      if (!s || !e) return '<td class="pg-cell pg-yr-cell'+(y.start.slice(0,4)===todayYear?' today-col':'')+'"></td>';
      const sy = s.slice(0,4), ey = e.slice(0,4);
      const yNum = y.start.slice(0,4);
      const inYear = yNum >= sy && yNum <= ey;
      let cls = 'pg-cell pg-yr-cell';
      if (y.start.slice(0,4) === todayYear) cls += ' today-col';
      if (inYear) {
        const sc = node.status==='已完成'?'plan-done':node.status==='进行中'?'plan-progress':'plan-pending';
        cls += ' plan-filled '+sc;
      }
      // 里程碑
      const msHere = msByYear[y.start.slice(0,4)];
      let msMarker = '';
      if (msHere && msHere.length > 0) {
        msMarker = '<span class="pg-ms-marker" style="color:'+esc(msHere[0].color||'#F59E0B')+'" title="'+esc(msHere[0].name||'里程碑')+'">◆</span>';
      }
      return '<td class="'+cls+'" title="'+y.label+' '+(node.status||'')+'"'+(msMarker?' data-milestone=\"1\"':'')+'>'+msMarker+(inYear?'<div class="pg-mth-fill" style="background:'+(node.status==='已完成'?'#6EE7B7':node.status==='进行中'?'#A5B4FC':'#C7D2FE')+'"></div>':'')+'</td>';
    }).join('');

    const actualCells = years.map(y => {
      const yNum = y.start.slice(0,4);
      const inYear = dailyArr.filter(d => d.date && d.date.slice(0,4) === yNum);
      const doneCount = inYear.filter(d => d.status==='已完成').length;
      const progressCount = inYear.filter(d => d.status==='进行中').length;
      const blockedCount = inYear.filter(d => d.status==='延期').length;
      const total = inYear.length || 1;
      const donePct = Math.min(100, Math.round(doneCount/total*100));
      const progPct = Math.min(100-donePct, Math.round(progressCount/total*100));
      const blkPct = Math.min(100-donePct-progPct, Math.round(blockedCount/total*100));
      let cls = 'pg-cell pg-yr-cell pg-actual';
      if (y.start.slice(0,4) === todayYear) cls += ' today-col';

      let bars = '';
      if (donePct > 0) bars += '<div class="pg-mth-fill" style="width:'+donePct+'%;background:#059669;"></div>';
      if (progPct > 0) bars += '<div class="pg-mth-fill" style="width:'+progPct+'%;background:#818CF8;left:'+donePct+'%;"></div>';
      if (blkPct > 0) bars += '<div class="pg-mth-fill" style="width:'+blkPct+'%;background:#F87171;left:'+(donePct+progPct)+'%;"></div>';
      return '<td class="'+cls+'" title="'+y.label+' 完成:'+doneCount+' 进行:'+progressCount+' 延期:'+blockedCount+'">'+bars+'</td>';
    }).join('');

    const statusBg = node.status==='已完成'?'#059669':node.status==='进行中'?'#6366F1':'#94A3B8';
    const nameTip = esc(node.name||'节点'+i)+' ('+(s||'?')+' ~ '+(e||'?')+')';
    return groupDivider + '<tr class="pg-row-plan"><td class="pg-td-no" rowspan="2">'+(i+1)+'</td><td class="pg-td-name" rowspan="2" title="'+nameTip+'"><div class="pg-name-inner"><span class="pg-status-dot" style="background:'+statusBg+';"></span><span class="pg-name-text">'+esc(node.name||'节点'+i)+'</span></div></td><td class="pg-td-rowtype plan-type">计划</td>'+planCells+'</tr><tr class="pg-row-actual"><td class="pg-td-rowtype actual-type">实际</td>'+actualCells+'</tr>';
  }).join('');

  return '<div class="pg-wrapper"><table class="pg-table" cellspacing="0" cellpadding="0"><colgroup>'+colgroup+'</colgroup><thead><tr class="pg-head-month"><th class="pg-th-fixed" rowspan="2" style="min-width:24px;"></th><th class="pg-th-fixed-name" rowspan="2">任务</th><th class="pg-th-fixed-type" rowspan="2">类别</th>'+thYears+'</tr></thead><tbody>'+rows+'</tbody></table>'+legend+'</div>';
}
// ── 计划甘特图视图切换 ──
function switchPlanGanttView(view, projId) {
  DATA.planGanttView = view;
  const proj = DATA.projects.find(p => p.id == projId);
  if (proj) renderProjectDetail(proj);
}

// ── 单品甘特图视图切换（日/月/年）──
function switchSingleGanttView(view, projId) {
  DATA.singleGanttView = view;
  const proj = DATA.projects.find(p => p.id == projId);
  if (proj) renderProjectDetail(proj);
}

// ── 计划子标签切换（总/非标/标准） ──
function switchPlanSubTab(type, projId) {
  DATA.planSubTab = type;
  const proj = DATA.projects.find(p => p.id == projId);
  if (proj) renderProjectDetail(proj);
}

// 获取当前选中计划字段的数据
function getCurrentPlan(proj) {
  if (DATA.planSubTab === 'nonstd') return safeArr(proj.plan_nonstd);
  if (DATA.planSubTab === 'std')    return safeArr(proj.plan_std);
  // total 或 fallback 到 plan
  return safeArr(proj.plan_total).length > 0 ? safeArr(proj.plan_total) : safeArr(proj.plan);
}

// 获取当前计划字段名（用于API写入）
function getCurrentPlanKey() {
  if (DATA.planSubTab === 'nonstd') return 'plan_nonstd';
  if (DATA.planSubTab === 'std')    return 'plan_std';
  return 'plan_total';
}

// 获取当前计划类型的"组"标签（线体/非标设备线段/标准设备）
function getGroupLabel() {
  if (DATA.planSubTab === 'nonstd') return '非标设备线段';
  if (DATA.planSubTab === 'std')    return '标准设备';
  return '线体';
}

// 将扁平计划按 group 字段分组，未分组的归入默认组
function groupPlanItems(plan) {
  const groups = [];
  const groupMap = {};
  plan.forEach((item, origIdx) => {
    const gname = item.group || '默认分组';
    if (!groupMap[gname]) {
      groupMap[gname] = { name: gname, items: [], origIndices: [] };
      groups.push(groupMap[gname]);
    }
    groupMap[gname].items.push(item);
    groupMap[gname].origIndices.push(origIdx);
  });
  return groups;
}






// ── 辅助：今日日期 ──

function todayDate() {

  const d = new Date();

  d.setHours(0, 0, 0, 0);

  return d;

}



// ── 每日甘特图展开/折叠 ──

function togglePlanDaily(projId, planIdx) {

  const key = `${projId}-${planIdx}`;

  DATA.expandedPlanDaily[key] = !DATA.expandedPlanDaily[key];

  renderS6();

}



// ── 每日进展状态切换（循环：未开始→进行中→已完成→延期→未开始）──

async function setPlanDailyStatus(projId, planIdx, date) {

  const nid = Number(projId);

  const proj = DATA.projects.find(p => p.id === nid);

  if (!proj) return;

  const plan = getCurrentPlan(proj);

  if (!plan[planIdx]) return;

  const node = plan[planIdx];

  const daily = node.daily || [];

  const entry = daily.find(d => d.date === date);



  // 确定下一个状态

  const cycle = ['未开始', '进行中', '已完成', '延期'];

  let nextStatus;

  if (!entry) {

    nextStatus = '进行中';

  } else {

    const curIdx = cycle.indexOf(entry.status);

    nextStatus = cycle[(curIdx + 1) % cycle.length];

  }



  // 即时更新本地数据（乐观更新）

  if (!node.daily) node.daily = [];

  const existing = node.daily.find(d => d.date === date);

  if (existing) {

    existing.status = nextStatus;

  } else {

    node.daily.push({ date, status: nextStatus, note: '' });

  }

  node.daily.sort((a, b) => a.date.localeCompare(b.date));



  // 更新 DOM（即时反馈，无需整页重绘）
  // 兼容新表格型甘特图：data-projid / data-planidx / data-date 挂在 <td> 上

  const cell = document.querySelector(`.pg-actual[data-projid="${projId}"][data-planidx="${planIdx}"][data-date="${date}"]`)
            || document.querySelector(`.plan-daily-cell[data-projid="${projId}"][data-planidx="${planIdx}"][data-date="${date}"]`);

  if (cell) {

    // 重算 className：保留基础类，替换状态类
    const base = cell.className
      .split(' ')
      .filter(c => !['actual-done','actual-progress','actual-blocked','daily-done','daily-progress','daily-blocked','daily-none'].includes(c))
      .join(' ');

    const statusCls = nextStatus === '已完成' ? 'actual-done' :
                      nextStatus === '进行中' ? 'actual-progress' :
                      nextStatus === '延期'   ? 'actual-blocked' : '';

    cell.className = (base + (statusCls ? ' ' + statusCls : '')).trim();

    cell.title = `${date} ${nextStatus}`;

  }



  // 异步保存到服务器

  try {

    const res = await PUT(`/api/projects/${projId}/plan-daily`, { planType: DATA.planSubTab, planIdx, date, status: nextStatus });

    if (res.code !== 200) {

      showToast('保存失败: ' + (res.message || '服务器错误'));

      // 回滚本地数据：重新获取后刷新当前详情页（不踢回列表）

      await fetchAllData();

      const p2 = DATA.projects.find(p => p.id === nid);

      if (p2) renderProjectDetail(p2);

    }

  } catch (e) {

    showToast('网络错误，请重试');

  }

}





// ── 当日进展编辑面板（点击今日单元格弹出）──

async function editPlanDailyNote(projId, planIdx, date) {

  // 关闭已存在的面板

  const existing = document.querySelector('.daily-note-popover');

  if (existing) existing.remove();


  const nid = Number(projId);

  const proj = DATA.projects.find(p => p.id === nid);

  if (!proj) return;

  const plan = getCurrentPlan(proj);

  if (!plan[planIdx]) return;

  const node = plan[planIdx];

  const daily = node.daily || [];

  const entry = daily.find(d => d.date === date);

  const curStatus = entry ? entry.status : '未开始';

  const curNote = entry ? (entry.note || '') : '';


  // 定位到点击的单元格

  const cell = document.querySelector(`.pg-actual[data-projid="${projId}"][data-planidx="${planIdx}"][data-date="${date}"]`)
            || document.querySelector(`.plan-daily-cell[data-projid="${projId}"][data-planidx="${planIdx}"][data-date="${date}"]`);

  if (!cell) return;

  const rect = cell.getBoundingClientRect();

  const strip = cell.closest('.plan-daily-strip') || cell.closest('.pg-wrapper');

  const stripRect = strip ? strip.getBoundingClientRect() : rect;


  // 创建浮层面板

  const popover = document.createElement('div');

  popover.className = 'daily-note-popover';

  popover.innerHTML = `

    <div class="daily-note-header">

      <span>📝 ${date} 当日进展</span>

      <button class="daily-note-close" onclick="this.closest('.daily-note-popover').remove()">✕</button>

    </div>

    <div class="daily-note-body">

      <div class="daily-note-label">状态</div>

      <div class="daily-note-status-btns" id="dailyStatusBtns_${projId}_${planIdx}">

        ${['未开始','进行中','已完成','延期'].map(s => {

          const active = s === curStatus;

          const colors = { '未开始':'#CBD5E1','进行中':'#6366F1','已完成':'#10B981','延期':'#EF4444' };

          return `<button class="daily-status-btn${active ? ' active' : ''}" data-status="${s}" style="${active ? 'background:'+colors[s]+';color:#fff;' : ''}" onclick="dailyNoteSelectStatus('${projId}',${planIdx},'${s}')">${s === '已完成' ? '✓' : s === '进行中' ? '●' : s === '延期' ? '!' : '○'} ${s}</button>`;

        }).join('')}

      </div>

      <div class="daily-note-label">备注</div>

      <textarea class="daily-note-textarea" id="dailyNoteText_${projId}_${planIdx}" placeholder="今天进展如何？遇到了什么问题？">${esc(curNote)}</textarea>

    </div>

    <div class="daily-note-footer">

      <button class="daily-note-cancel" onclick="this.closest('.daily-note-popover').remove()">取消</button>

      <button class="daily-note-save" onclick="savePlanDailyNote('${projId}',${planIdx},'${date}')">💾 保存</button>

    </div>

  `;


  // 定位：紧贴单元格，优先显示在上方（避免被底部截断）

  document.body.appendChild(popover);

  popover.style.position = 'fixed';

  popover.style.width = '280px';

  popover.style.zIndex = '9999';

  const popH = 320; // 预估弹窗高度

  const spaceBelow = window.innerHeight - rect.bottom;

  const spaceAbove = rect.top;

  // 下方空间足够 → 显示在单元格下方；否则显示在上方

  if (spaceBelow >= popH || spaceBelow >= spaceAbove) {

    popover.style.top = Math.min(rect.bottom + 6, window.innerHeight - 10) + 'px';

  } else {

    popover.style.top = Math.max(rect.top - popH - 6, 10) + 'px';

  }

  popover.style.left = Math.max(10, Math.min(rect.left + rect.width / 2 - 140, window.innerWidth - 290)) + 'px';


  // 点击外部关闭

  setTimeout(() => {

    const closeHandler = (e) => {

      if (!popover.contains(e.target) && !e.target.closest('.pg-actual') && !e.target.closest('.plan-daily-cell')) {

        popover.remove();

        document.removeEventListener('click', closeHandler);

      }

    };

    document.addEventListener('click', closeHandler);

  }, 100);

}


// 状态按钮选中

function dailyNoteSelectStatus(projId, planIdx, status) {

  const container = document.getElementById('dailyStatusBtns_' + projId + '_' + planIdx);

  if (!container) return;

  const colors = { '未开始':'#CBD5E1','进行中':'#6366F1','已完成':'#10B981','延期':'#EF4444' };

  container.querySelectorAll('.daily-status-btn').forEach(btn => {

    const s = btn.dataset.status;

    if (s === status) {

      btn.className = 'daily-status-btn active';

      btn.style.background = colors[s];

      btn.style.color = '#fff';

    } else {

      btn.className = 'daily-status-btn';

      btn.style.background = '';

      btn.style.color = '';

    }

  });

  // 存储选中状态

  container.dataset.selected = status;

}


// 保存当日进展（状态+备注）

async function savePlanDailyNote(projId, planIdx, date) {

  const nid = Number(projId);

  const container = document.getElementById('dailyStatusBtns_' + nid + '_' + planIdx);

  const selectedStatus = container ? (container.dataset.selected || '进行中') : '进行中';

  const textarea = document.getElementById('dailyNoteText_' + nid + '_' + planIdx);

  const note = textarea ? textarea.value.trim() : '';


  // 更新本地数据

  const proj = DATA.projects.find(p => p.id === nid);

  if (!proj) return;

  const plan = getCurrentPlan(proj);

  if (!plan[planIdx]) return;

  const node = plan[planIdx];

  if (!node.daily) node.daily = [];

  const existing = node.daily.find(d => d.date === date);

  if (existing) {

    existing.status = selectedStatus;

    existing.note = note;

  } else {

    node.daily.push({ date, status: selectedStatus, note });

  }

  node.daily.sort((a, b) => a.date.localeCompare(b.date));


  // 更新 DOM 色块（兼容新表格型甘特图和旧条形甘特图）

  const cell = document.querySelector(`.pg-actual[data-projid="${projId}"][data-planidx="${planIdx}"][data-date="${date}"]`)
            || document.querySelector(`.plan-daily-cell[data-projid="${projId}"][data-planidx="${planIdx}"][data-date="${date}"]`);

  if (cell) {

    const base = cell.className
      .split(' ')
      .filter(c => !['actual-done','actual-progress','actual-blocked','daily-done','daily-progress','daily-blocked','daily-none','has-note'].includes(c))
      .join(' ');

    const statusCls = selectedStatus === '已完成' ? 'actual-done' :
                      selectedStatus === '进行中' ? 'actual-progress' :
                      selectedStatus === '延期'   ? 'actual-blocked' : '';

    cell.className = (base + (statusCls ? ' ' + statusCls : '') + (note ? ' has-note' : '')).trim();

    cell.title = `${date} ${selectedStatus}${note ? ' — ' + note : ''}`;

  }


  // 关闭面板

  const popover = document.querySelector('.daily-note-popover');

  if (popover) popover.remove();


  // 保存到服务器

  try {

    const res = await PUT(`/api/projects/${projId}/plan-daily`, { planType: DATA.planSubTab, planIdx, date, status: selectedStatus, note });

    if (res.code !== 200) {

      showToast('保存失败: ' + (res.message || '服务器错误'));

      await fetchAllData();

      renderS6();

    }

  } catch (e) {

    showToast('网络错误，请重试');

  }

}

// ╔══════════════════════════════════════════════════════════════╗

// ║  项目任务管理                                                  ║

// ╚══════════════════════════════════════════════════════════════╝



const TASK_FORM = {};

const TASK_EDIT = {}; // { projId: taskId } — 正在编辑的任务



async function addProjectTask(projId) {

  TASK_FORM[+projId] = true;

  renderS6();

}



function cancelAddTask(projId) {

  TASK_FORM[+projId] = false;

  renderS6();

}



async function submitProjectTask(projId) {

  const nid = +projId;

  const name = document.getElementById(`taskName_${nid}`)?.value.trim();

  if (!name) return showToast('请输入任务名称');

  const assignee = document.getElementById(`taskAssignee_${nid}`)?.value.trim() || '';

  const deadline = document.getElementById(`taskDeadline_${nid}`)?.value || '';

  const progress = parseInt(document.getElementById(`taskProgress_${nid}`)?.value || '0') || 0;



  try {

    const res = await POST(`/api/projects/${nid}/tasks`, { name, assignee, deadline, progress, status: 'pending' });

    if (res.code === 200) {

      TASK_FORM[nid] = false;

      await fetchAllData();

      renderS6();

      showToast('任务已添加');

    }

  } catch(e) { showToast('添加失败'); }

}



async function toggleTaskStatus(projId, taskId) {

  const nid = Number(projId);

  const proj = DATA.projects.find(p => p.id === nid);

  if (!proj) return;

  const task = (proj.tasks||[]).find(t => t.id === taskId);

  if (!task) return;

  const isCompleting = task.status !== 'completed';

  const newStatus = isCompleting ? 'completed' : 'pending';

  try {

    await PUT(`/api/projects/${projId}/tasks/${taskId}`, { status: newStatus, progress: isCompleting ? 100 : (task.progress || 0) });

    await fetchAllData();

    renderS6();

  } catch(e) { showToast('更新失败'); }

}



async function deleteProjectTask(projId, taskId) {

  showConfirm('确定删除此任务？', async () => {

    try {

      await DELETE(`/api/projects/${projId}/tasks/${taskId}`);

      await fetchAllData();

      renderS6();

    } catch(e) { showToast('删除失败'); }

  });

}



// ── 信息广场任务详情弹窗（风险预警同款交互） ──
function openTaskDetail(projId, taskId) {
  const nid = +projId;
  const task = (DATA.allTasks || []).find(t => t.id == taskId && t.project_id == nid);
  if (!task) return showToast('任务未找到');

  const members = DATA.members || [];
  const memberMap = {};
  members.forEach(m => { memberMap[m.id] = m; });

  const isDone = task.status === 'completed';
  const pct = task.progress || 0;
  const pctColor = pct >= 100 ? '#059669' : pct >= 50 ? '#6366F1' : pct > 0 ? '#D97706' : '#CBD5E1';
  const statusColors = { 'pending': '#3730A3', 'in_progress': '#92400E', 'completed': '#065F46' };
  const statusBg = { 'pending': '#E0E7FF', 'in_progress': '#FEF3C7', 'completed': '#D1FAE5' };
  const statusLabels = { 'pending': '待处理', 'in_progress': '进行中', 'completed': '已完成' };
  const statusIcons = { 'pending': '⏳', 'in_progress': '🔄', 'completed': '✅' };

  const taskOverdue = task.deadline && !isDone && (new Date(task.deadline) < new Date().setHours(0,0,0,0));
  const taskToday = task.deadline && !isDone && (new Date(task.deadline).toDateString() === new Date().toDateString());

  // Progress note display
  const noteHTML = task.progress_note ? `
    <div>
      <div style="font-size:12px;font-weight:600;color:var(--meta-alt);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">进度备注</div>
      <div style="font-size:14px;color:var(--body);line-height:1.7;padding:12px 14px;background:#F8FAFC;border-radius:10px;white-space:pre-wrap;">${esc(task.progress_note)}</div>
      ${task.progress_updated_at ? `<div style="font-size:10px;color:var(--meta);margin-top:4px;text-align:right;">更新于 ${new Date(task.progress_updated_at).toLocaleDateString('zh-CN')}</div>` : ''}
    </div>` : '';

  const bodyHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <!-- 状态+名称 -->
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="background:${statusBg[task.status]||'#E0E7FF'};color:${statusColors[task.status]||'#3730A3'};font-size:13px;font-weight:700;padding:4px 14px;border-radius:20px;">${statusIcons[task.status]||''} ${statusLabels[task.status]||task.status}</span>
        <span style="font-size:18px;font-weight:700;color:var(--title);">${esc(task.name)}</span>
      </div>

      <!-- 进度条 -->
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:12px;font-weight:600;color:var(--meta-alt);">进度</span>
          <span style="font-size:14px;font-weight:700;color:${pctColor};">${pct}%</span>
        </div>
        <div style="height:8px;background:#F1F5F9;border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${pctColor};border-radius:4px;transition:width 0.4s;"></div>
        </div>
      </div>

      <!-- 元数据行 -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <div style="flex:1;min-width:140px;display:flex;align-items:center;gap:8px;padding:10px 14px;background:#FEF3C7;border-radius:10px;">
          <span style="font-size:13px;color:var(--meta);">👤 负责人：</span>
          <span style="font-size:13px;font-weight:600;color:var(--title);">${task.assignee ? esc(task.assignee) : '未指定'}</span>
        </div>
        <div style="flex:1;min-width:140px;display:flex;align-items:center;gap:8px;padding:10px 14px;background:${taskOverdue ? '#FEE2E2' : (taskToday ? '#FEF3C7' : '#EFF6FF')};border-radius:10px;">
          <span style="font-size:13px;color:var(--meta);">📅 截止：</span>
          <span style="font-size:13px;font-weight:600;color:${taskOverdue ? '#EF4444' : 'var(--title)'};">${task.deadline || '未设置'}${taskOverdue ? ' (已逾期)' : taskToday ? ' (今日)' : ''}</span>
        </div>
      </div>

      <!-- 进度备注 -->
      ${noteHTML}

      <!-- 来源项目 -->
      <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:#EFF6FF;border-radius:10px;">
        <span style="font-size:13px;color:var(--meta);">关联项目：</span>
        <span style="font-size:14px;font-weight:600;color:var(--primary);">${esc(task.project_name||'')}</span>
        <span style="font-size:11px;color:var(--meta);margin-left:auto;">${task.created_at ? new Date(task.created_at).toLocaleDateString('zh-CN') : ''}</span>
      </div>
    </div>`;

  const footerHTML = `
    <div style="display:flex;gap:8px;width:100%;flex-wrap:wrap;">
      <button class="modal-btn" style="background:#8B5CF6;color:#fff;" onclick="closeModal();addTaskProgress('${projId}','${taskId}')">📝 添加进展</button>
      ${task.status === 'completed' ? `<button class="modal-btn confirm" onclick="taskDetailToggleStatus(${projId},${taskId})">🔄 重新打开</button>` : `<button class="modal-btn confirm" onclick="taskDetailToggleStatus(${projId},${taskId})">✅ 标记完成</button>`}
      <button class="modal-btn" style="background:var(--primary);color:#fff;" onclick="closeModal();switchTo(5);openProjectDetail('${projId}')">📋 查看项目</button>
      <button class="modal-btn" style="background:#EF4444;color:#fff;" onclick="showConfirm('确定删除该任务？',()=>{deleteTaskFromDetail(${projId},${taskId})})">✕ 删除</button>
      <button class="modal-btn cancel" onclick="closeModal()">关闭</button>
    </div>`;

  showModal('📋 任务详情', bodyHTML, footerHTML);
}

// ── 添加任务进展（同款风险预警交互） ──
function addTaskProgress(projId, taskId) {
  const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });

  const nid = +projId;
  const task = (DATA.allTasks || []).find(t => t.id == taskId && t.project_id == nid);
  const curPct = task ? (task.progress || 0) : 0;

  showModal('添加任务进展', `
    <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:#F0FDF4;border-radius:10px;margin-bottom:14px;font-size:13px;color:#166534;">
      <span style="font-size:18px;">📅</span>
      <span>日期自动记录：<strong>${today}</strong></span>
    </div>
    <div class="modal-field" style="margin-bottom:12px;">
      <label style="font-size:13px;font-weight:600;color:var(--meta-alt);margin-bottom:4px;display:block;">当前进度：${curPct}%</label>
      <div style="display:flex;align-items:center;gap:8px;">
        <input id="tpg_progress" type="range" min="0" max="100" value="${curPct}" style="flex:1;"
          oninput="document.getElementById('tpg_pct_disp').textContent=this.value+'%'">
        <span id="tpg_pct_disp" style="font-size:14px;font-weight:700;min-width:40px;text-align:right;">${curPct}%</span>
      </div>
    </div>
    <div class="modal-field"><label style="font-size:13px;font-weight:600;color:var(--meta-alt);margin-bottom:4px;display:block;">进展备注 *</label><textarea id="tpg_note" placeholder="请输入今日进展描述..." style="width:100%;height:80px;border:1px solid #E5E7EB;border-radius:8px;padding:10px;font-size:13px;resize:vertical;"></textarea></div>`,

    `<button class="modal-btn cancel" onclick="closeModal()">取消</button>
     <button class="modal-btn confirm" onclick="submitTaskProgress('${projId}','${taskId}')">💾 保存进展</button>`);
}

async function submitTaskProgress(projId, taskId) {
  const nid = +projId;
  const progress = parseInt(document.getElementById('tpg_progress')?.value || '0') || 0;
  const note = document.getElementById('tpg_note')?.value?.trim();
  if (!note) return showToast('请输入进展备注');

  // Build progress log entry
  const today = new Date().toLocaleDateString('zh-CN');
  const logEntry = today + ': ' + note;
  const task = (DATA.allTasks || []).find(t => t.id == taskId && t.project_id == nid);
  let newNote = logEntry;
  if (task && task.progress_note) {
    newNote = logEntry + '\n' + task.progress_note;
  }

  try {
    const res = await PUT('/api/projects/' + nid + '/tasks/' + taskId, { progress, progress_note: newNote });
    if (res.code === 200) {
      await fetchAllData();
      renderS1();
      showToast('进展已记录');
      openTaskDetail(projId, taskId);
    } else {
      showToast(res.message || '记录失败');
    }
  } catch(e) { showToast('记录失败'); }
}

// ── 从详情弹窗切换任务状态 ──
async function taskDetailToggleStatus(projId, taskId) {
  const nid = +projId;
  const task = (DATA.allTasks||[]).find(t=>t.id===taskId&&t.project_id==nid);
  if (!task) return;
  const isCompleting = task.status !== 'completed';
  const newStatus = isCompleting ? 'completed' : 'pending';
  try {
    await PUT('/api/projects/'+projId+'/tasks/'+taskId, { status:newStatus, progress:isCompleting?100:(task.progress||0) });
    await fetchAllData(); renderS1(); showToast(isCompleting?'任务已标记完成':'任务已重新打开');
    openTaskDetail(projId, taskId);
  } catch(e) { showToast('操作失败'); }
}

// ── 从详情弹窗删除任务 ──
async function deleteTaskFromDetail(projId, taskId) {
  try {
    await DELETE('/api/projects/'+projId+'/tasks/'+taskId);
    closeModal();
    await fetchAllData(); renderS1();
    showToast('任务已删除');
  } catch(e) { showToast('删除失败'); }
}
// ╔══════════════════════════════════════════════════════════════╗

// ║  项目里程碑管理                                                ║

// ╚══════════════════════════════════════════════════════════════╝



const MS_COLORS = ['#6366F1','#059669','#DC2626','#D97706','#7C3AED','#0891B2','#DB2777','#0F172A'];



const MS_FORM = {};

const MS_EDIT = {}; // { projId: msId } 正在编辑的里程碑



async function addProjectMilestone(projId) {

  MS_FORM[projId] = true;

  MS_EDIT[projId] = null;

  renderS6();

}



function cancelAddMilestone(projId) {

  MS_FORM[projId] = false;

  renderS6();

}



async function editProjectMilestone(projId, msId) {

  MS_EDIT[projId] = msId;

  MS_FORM[projId] = false;

  renderS6();

  // 滚动到编辑表单

  setTimeout(() => {

    const el = document.getElementById(`msEditForm_${projId}`);

    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  }, 100);

}



function cancelEditMilestone(projId) {

  MS_EDIT[projId] = null;

  renderS6();

}



async function submitEditMilestone(projId, msId) {

  const name = document.getElementById(`msEdName_${projId}`)?.value.trim();

  if (!name) return showToast('请输入里程碑名称');

  const date = document.getElementById(`msEdDate_${projId}`)?.value || '';

  const start = document.getElementById(`msEdStart_${projId}`)?.value || date;

  const end = document.getElementById(`msEdEnd_${projId}`)?.value || date;

  const desc = document.getElementById(`msEdDesc_${projId}`)?.value.trim() || '';

  const color = document.getElementById(`msEdColor_${projId}`)?.value || '#6366F1';



  try {

    const res = await PUT(`/api/projects/${projId}/milestones/${msId}`, { name, date, start, end, description: desc, color });

    if (res.code === 200) {

      MS_EDIT[projId] = null;

      await fetchAllData();

      renderS6();

      showToast('里程碑已更新');

    }

  } catch(e) { showToast('更新失败'); }

}



async function submitProjectMilestone(projId) {

  const name = document.getElementById(`msName_${projId}`)?.value.trim();

  if (!name) return showToast('请输入里程碑名称');

  const date = document.getElementById(`msDate_${projId}`)?.value || '';

  const start = document.getElementById(`msStart_${projId}`)?.value || date;

  const end = document.getElementById(`msEnd_${projId}`)?.value || date;

  const desc = document.getElementById(`msDesc_${projId}`)?.value.trim() || '';

  const color = document.getElementById(`msColor_${projId}`)?.value || '#6366F1';



  try {

    const res = await POST(`/api/projects/${projId}/milestones`, { name, date, start, end, description: desc, color });

    if (res.code === 200) {

      MS_FORM[projId] = false;

      await fetchAllData();

      renderS6();

      showToast('里程碑已添加');

    }

  } catch(e) { showToast('添加失败'); }

}



async function deleteProjectMilestone(projId, msId) {

  showConfirm('确定删除此里程碑？', async () => {

    try {

      await DELETE(`/api/projects/${projId}/milestones/${msId}`);

      await fetchAllData();

      renderS6();

    } catch(e) { showToast('删除失败'); }

  });

}



// ╔══════════════════════════════════════════════════════════════╗

// ║  渲染工具函数                                                  ║

// ╚══════════════════════════════════════════════════════════════╝



function renderTasksHTML(proj) {

  const tasks = proj.tasks || [];

  const showForm = TASK_FORM[proj.id];

  const members = DATA.members || [];

  let html = '';



  // 成员选项（下拉）

  const memberOptions = '<option value="">选择负责人</option>' + members.map(m =>

    `<option value="${esc(m.nickname||m.name)}">${esc(m.nickname||m.name)}</option>`

  ).join('');



  if (showForm) {

    html += `

    <div class="inline-form">

      <input class="if-name" id="taskName_${proj.id}" placeholder="任务名称">

      <select class="if-assignee" id="taskAssignee_${proj.id}">${memberOptions}</select>

      <input class="if-deadline" type="date" id="taskDeadline_${proj.id}">

      <input class="if-progress" type="number" min="0" max="100" id="taskProgress_${proj.id}" placeholder="进度%" style="width:60px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:11px;">

      <button class="if-submit" onclick="event.stopPropagation();submitProjectTask('${proj.id}')">确定</button>

      <button class="if-cancel" onclick="event.stopPropagation();cancelAddTask('${proj.id}')">取消</button>

    </div>`;

  }



  tasks.forEach(task => {

    const editing = TASK_EDIT[proj.id] === task.id;

    const isDone = task.status === 'completed';

    const taskIsToday = !isDone && task.deadline && isToday(task.deadline);

    const taskIsOverdue = !isDone && task.deadline && isOverdue(task.deadline);

    const dlClass = taskIsOverdue ? ' deadline-overdue' : taskIsToday ? ' deadline-today' : '';

    const dlTag = taskIsOverdue ? '<span class="deadline-tag overdue">已逾期</span>' : taskIsToday ? '<span class="deadline-tag today">今天到期</span>' : '';



    if (editing) {

      const selAssignee = task.assignee || '';

      const memberOptionsEdit = '<option value="">选择负责人</option>' + members.map(m =>

        `<option value="${esc(m.nickname||m.name)}" ${(m.nickname||m.name) === selAssignee ? 'selected' : ''}>${esc(m.nickname||m.name)}</option>`

      ).join('');

      html += `

    <div class="inline-form edit-form">

      <input class="if-name" id="etaskName_${proj.id}_${task.id}" placeholder="任务名称" value="${esc(task.name)}">

      <select class="if-assignee" id="etaskAssignee_${proj.id}_${task.id}">${memberOptionsEdit}</select>

      <input class="if-deadline" type="date" id="etaskDeadline_${proj.id}_${task.id}" value="${task.deadline||''}">

      <input class="if-progress" type="number" min="0" max="100" id="etaskProgress_${proj.id}_${task.id}" placeholder="进度%" value="${task.progress||0}" style="width:60px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:11px;">

      <button class="if-submit" onclick="event.stopPropagation();submitEditProjectTask('${proj.id}',${task.id})">保存</button>

      <button class="if-cancel" onclick="event.stopPropagation();cancelEditTask('${proj.id}')">取消</button>

    </div>`;

    } else {

      html += `

    <div class="task-item${dlClass}">

      <div class="task-check${isDone ? ' done' : ''}" onclick="event.stopPropagation();toggleTaskStatus('${proj.id}',${task.id})"></div>

      <div class="task-info" style="cursor:pointer;" onclick="event.stopPropagation();editProjectTask('${proj.id}',${task.id})" title="点击编辑任务">

        <div class="task-name" style="${isDone?'text-decoration:line-through;color:var(--meta);':''}">${esc(task.name)}</div>

        <div class="task-meta">

          ${task.assignee ? '👤 ' + esc(task.assignee) + ' · ' : ''}

          ${task.deadline ? '⏰ <span' + (taskIsOverdue?' style="color:#DC2626;font-weight:600;"':taskIsToday?' style="color:#D97706;font-weight:600;"':'') + '>' + esc(task.deadline) + '</span>' + dlTag : ''}

        </div>

        ${(task.progress > 0 || isDone) ? '<div style="margin-top:4px;"><div style="height:3px;background:#F1F5F9;border-radius:2px;overflow:hidden;"><div style="height:100%;width:' + (isDone ? '100' : (task.progress || 0)) + '%;background:' + (isDone ? '#059669' : (task.progress >= 50 ? '#6366F1' : '#D97706')) + ';border-radius:2px;"></div></div><span style="font-size:10px;color:' + (isDone ? '#059669' : (task.progress >= 50 ? '#6366F1' : '#D97706')) + ';">' + (isDone ? '100%' : (task.progress || 0) + '%') + '</span></div>' : ''}

      </div>

      <button class="task-delete" onclick="event.stopPropagation();deleteProjectTask('${proj.id}',${task.id})">✕</button>

    </div>`;

    }

  });



  return html;

}



// ── 编辑已有任务 ──

function editProjectTask(projId, taskId) {

  TASK_EDIT[+projId] = taskId;

  renderS6();

}



function cancelEditTask(projId) {

  TASK_EDIT[+projId] = null;

  renderS6();

}



async function submitEditProjectTask(projId, taskId) {

  const nid = +projId;

  const name = document.getElementById(`etaskName_${nid}_${taskId}`)?.value.trim();

  if (!name) return showToast('请输入任务名称');

  const assignee = document.getElementById(`etaskAssignee_${nid}_${taskId}`)?.value.trim() || '';

  const deadline = document.getElementById(`etaskDeadline_${nid}_${taskId}`)?.value || '';

  const progress = parseInt(document.getElementById(`etaskProgress_${nid}_${taskId}`)?.value || '0') || 0;



  try {

    const res = await PUT(`/api/projects/${nid}/tasks/${taskId}`, { name, assignee, deadline, progress });

    if (res.code === 200) {

      TASK_EDIT[nid] = null;

      await fetchAllData();

      renderS6();

      showToast('任务已更新');

    }

  } catch(e) { showToast('更新失败'); }

}



// ── 折叠状态卡片预览区：进度条 + 里程碑迷你时间轴 ──

function renderCardBodyPreview(proj) {

  const tasks = proj.tasks || [];

  const milestones = proj.milestones || [];

  if (tasks.length === 0 && milestones.length === 0) return '';

  let html = '<div class="card-body-preview">';



  // 任务进度条

  if (tasks.length > 0) {

    const done = tasks.filter(t => t.status === '已完成').length;

    const overdue = tasks.filter(t => t.status !== '已完成' && t.deadline && isOverdue(t.deadline)).length;

    const todayDue = tasks.filter(t => t.status !== '已完成' && t.deadline && isToday(t.deadline)).length;

    const pct = Math.round(done / tasks.length * 100);

    let warnHtml = '';

    if (overdue > 0) warnHtml = `<span class="deadline-tag overdue" style="font-size:9px;">${overdue}个逾期</span>`;

    else if (todayDue > 0) warnHtml = `<span class="deadline-tag today" style="font-size:9px;">${todayDue}个今日到期</span>`;

    html += `<div class="mini-progress">

      <div class="mini-progress-bar"><div class="mini-progress-fill" style="width:${pct}%;background:${pct===100?'#059669':(overdue>0?'#DC2626':'#6366F1')};"></div></div>

      <span class="mini-progress-text" style="color:${pct===100?'#059669':(overdue>0?'#DC2626':'var(--meta)')};">${done}/${tasks.length} 已完成</span>

      ${warnHtml}

    </div>`;

  }



  // 里程碑迷你时间轴

  if (milestones.length > 0) {

    const now = new Date();

    const sorted = [...milestones].sort((a, b) => {

      const da = a.end || a.date || '';

      const db = b.end || b.date || '';

      return new Date(da) - new Date(db);

    });

    const upcoming = sorted.find(m => new Date(m.end || m.date) >= now);

    html += '<div class="mini-milestones">';

    sorted.forEach((ms, i) => {

      const d = new Date(ms.end || ms.date);

      const dateStr = `${d.getMonth()+1}/${d.getDate()}`;

      const isUpcoming = upcoming && ms.id === upcoming.id;

      const prevD = sorted[i-1] ? new Date(sorted[i-1].end || sorted[i-1].date) : null;

      html += `<span class="mini-ms-dot" style="background:${esc(ms.color||'#6366F1')};${isUpcoming ? 'box-shadow:0 0 0 3px rgba(217,119,6,0.25);' : ''}" title="${esc(ms.name)} · ${esc(ms.end||ms.date)}${isUpcoming?' 🔜 最近':''}">${i===0 || prevD && (d-prevD)/86400000>30 ? '<span class="mini-ms-label">'+dateStr+'</span>' : ''}</span>`;

    });

    if (upcoming) {

      html += `<span class="mini-ms-next" style="color:#D97706;">🔜 ${esc(upcoming.name)} · ${esc(upcoming.end||upcoming.date)}</span>`;

    }

    html += '</div>';

  }



  html += '</div>';

  return html;

}



function renderMilestonesHTML(proj) {

  const milestones = proj.milestones || [];

  const showForm = MS_FORM[proj.id];

  const editingMsId = MS_EDIT[proj.id];

  let html = '';



  if (showForm) {

    html += `

    <div class="inline-form" id="msEditForm_${proj.id}">

      <input class="if-name" id="msName_${proj.id}" placeholder="里程碑名称">

      <input class="if-date" type="date" id="msStart_${proj.id}" placeholder="开始日期" title="开始日期">

      <span style="font-size:11px;color:var(--meta);">→</span>

      <input class="if-date" type="date" id="msEnd_${proj.id}" placeholder="结束日期" title="结束日期">

      <input class="if-name" id="msDesc_${proj.id}" placeholder="描述(可选)" style="flex:1;min-width:80px;">

      <select class="if-color" id="msColor_${proj.id}" style="width:auto;padding:2px 4px;border-radius:6px;font-size:11px;">

        ${MS_COLORS.map(c => `<option value="${c}" style="background:${c};color:#fff;">${c}</option>`).join('')}

      </select>

      <button class="if-submit" onclick="event.stopPropagation();submitProjectMilestone('${proj.id}')">确定</button>

      <button class="if-cancel" onclick="event.stopPropagation();cancelAddMilestone('${proj.id}')">取消</button>

    </div>`;

  }



  milestones.forEach(ms => {

    if (editingMsId === ms.id) {

      // 编辑模式 — 内联表单

      html += `

    <div class="inline-form ms-edit-form" id="msEditForm_${proj.id}">

      <input class="if-name" id="msEdName_${proj.id}" value="${esc(ms.name||'')}" placeholder="里程碑名称">

      <input class="if-date" type="date" id="msEdStart_${proj.id}" value="${esc(ms.start||ms.date||'')}" title="开始日期">

      <span style="font-size:11px;color:var(--meta);">→</span>

      <input class="if-date" type="date" id="msEdEnd_${proj.id}" value="${esc(ms.end||ms.date||'')}" title="结束日期">

      <input class="if-name" id="msEdDesc_${proj.id}" value="${esc(ms.description||'')}" placeholder="描述(可选)" style="flex:1;min-width:80px;">

      <select class="if-color" id="msEdColor_${proj.id}" style="width:auto;padding:2px 4px;border-radius:6px;font-size:11px;">

        ${MS_COLORS.map(c => `<option value="${c}" style="background:${c};color:#fff;" ${(ms.color||'#6366F1')===c?'selected':''}>${c}</option>`).join('')}

      </select>

      <button class="if-submit" onclick="event.stopPropagation();submitEditMilestone('${proj.id}',${ms.id})">保存</button>

      <button class="if-cancel" onclick="event.stopPropagation();cancelEditMilestone('${proj.id}')">取消</button>

    </div>`;

    } else {

      // 显示模式

      const msStart = ms.start || ms.date;

      const msEnd = ms.end || ms.date;

      const msIsToday = msEnd && isToday(msEnd);

      const msIsOverdue = msEnd && isOverdue(msEnd);

      const msDlClass = msIsOverdue ? ' deadline-overdue' : msIsToday ? ' deadline-today' : '';

      const msDlTag = msIsOverdue ? '<span class="deadline-tag overdue">已逾期</span>' : msIsToday ? '<span class="deadline-tag today">今天到期</span>' : '';

      const dateDisplay = msStart && msEnd && msStart !== msEnd

        ? `📅 ${esc(msStart)} → ${esc(msEnd)}`

        : (ms.date ? `📅 ${esc(ms.date)}` : '');

      html += `

    <div class="milestone-item${msDlClass}">

      <span class="color-dot" style="background:${esc(ms.color||'#6366F1')};"></span>

      <div class="ms-info" style="cursor:pointer;" onclick="event.stopPropagation();editProjectMilestone('${proj.id}',${ms.id})" title="点击编辑">

        <div class="ms-name">${esc(ms.name)}</div>

        <div class="ms-meta">

          ${dateDisplay ? '<span' + (msIsOverdue?' style="color:#DC2626;font-weight:600;"':msIsToday?' style="color:#D97706;font-weight:600;"':'') + '>' + dateDisplay + '</span>' + msDlTag + ' · ' : ''}

          ${ms.description ? esc(ms.description) : ''}

        </div>

      </div>

      <button class="ms-edit" onclick="event.stopPropagation();editProjectMilestone('${proj.id}',${ms.id})" title="编辑">✎</button>

      <button class="ms-delete" onclick="event.stopPropagation();deleteProjectMilestone('${proj.id}',${ms.id})">✕</button>

    </div>`;

    }

  });



  return html;

}



// ╔══════════════════════════════════════════════════════════════╗

// ║  项目风险管理                                                  ║

// ╚══════════════════════════════════════════════════════════════╝



const RISK_FORM = {};

const RISK_EDIT = {};

const RISK_LEVELS = ['高', '中', '低'];

const RISK_STATUSES = ['未处理', '处理中', '已解决'];

const RISK_LEVEL_COLORS = { '高': '#EF4444', '中': '#F59E0B', '低': '#10B981' };

const RISK_LEVEL_BG = { '高': '#FEE2E2', '中': '#FEF3C7', '低': '#D1FAE5' };

const RISK_CATEGORIES = ['成本风险', '时间风险', '技术风险'];

const RISK_CATEGORY_COLORS = { '成本风险': '#F59E0B', '时间风险': '#EF4444', '技术风险': '#6366F1' };

const RISK_CATEGORY_BG = { '成本风险': '#FEF3C7', '时间风险': '#FEE2E2', '技术风险': '#EEF2FF' };

const RISK_CATEGORY_ICONS = { '成本风险': '💰', '时间风险': '⏰', '技术风险': '🔧' };



function addProjectRisk(projId) {

  RISK_FORM[projId] = true;

  renderS6();

}



function cancelAddRisk(projId) {

  RISK_FORM[projId] = false;

  renderS6();

}



async function submitProjectRisk(projId) {

  const name = document.getElementById(`riskName_${projId}`)?.value?.trim();

  const level = document.getElementById(`riskLevel_${projId}`)?.value || '中';

  const description = document.getElementById(`riskDesc_${projId}`)?.value?.trim();

  const dri = document.getElementById(`riskDri_${projId}`)?.value || '';
  const category = document.getElementById(`riskCategory_${projId}`)?.value || '成本风险';
  const target_date = document.getElementById(`riskTarget_${projId}`)?.value || '';

  if (!name) return showToast('请输入风险名称');

  const resp = await POST(`/api/projects/${projId}/risks`, { name, level, category, description, dri, target_date, status: '未处理' });

  if (resp.code === 200) {

    const proj = DATA.projects.find(p => p.id == projId);

    if (proj) proj.risks = resp.data;

    cancelAddRisk(projId);

    renderS1();

  } else {

    showToast(resp.message || '添加失败');

  }

}



function editProjectRisk(projId, riskId) {

  RISK_EDIT[`${projId}_${riskId}`] = true;

  renderS6();

}



function cancelEditRisk(projId, riskId) {

  delete RISK_EDIT[`${projId}_${riskId}`];

  renderS6();

}



async function submitEditRisk(projId, riskId) {

  const name = document.getElementById(`reName_${projId}_${riskId}`)?.value?.trim();

  const level = document.getElementById(`reLevel_${projId}_${riskId}`)?.value || '中';

  const description = document.getElementById(`reDesc_${projId}_${riskId}`)?.value?.trim();

  const status = document.getElementById(`reStatus_${projId}_${riskId}`)?.value || '未处理';

  const dri = document.getElementById(`reDri_${projId}_${riskId}`)?.value || '';
  const category = document.getElementById(`reCategory_${projId}_${riskId}`)?.value || '成本风险';
  const target_date = document.getElementById(`reTarget_${projId}_${riskId}`)?.value || '';

  if (!name) return showToast('请输入风险名称');

  const resp = await PUT(`/api/projects/${projId}/risks/${riskId}`, { name, level, category, description, status, dri, target_date });

  if (resp.code === 200) {

    const proj = DATA.projects.find(p => p.id == projId);

    if (proj) proj.risks = resp.data;

    cancelEditRisk(projId, riskId);

    renderS1();

  } else {

    showToast(resp.message || '更新失败');

  }

}



// ── 风险详情弹窗 ──

function openRiskDetail(pId, rId) {

  const proj = DATA.projects.find(p => p.id === pId);

  if (!proj) return;

  const r = safeArr(proj.risks).find(rr => rr.id === rId);

  if (!r) return;



  const members = DATA.members || [];

  const memberMap = {};

  members.forEach(m => { memberMap[m.id] = m; });

  const driMember = r.dri ? memberMap[r.dri] : null;

  const leaderMember = proj.leader_id ? memberMap[proj.leader_id] : null;

  const currentUserId = CURRENT_USER.id;



  const levelColors = { '高': '#EF4444', '中': '#F59E0B', '低': '#10B981' };

  const levelBg = { '高': '#FEE2E2', '中': '#FEF3C7', '低': '#D1FAE5' };

  const statusColors = { '未处理': '#EF4444', '处理中': '#F59E0B', '已解决': '#10B981' };

  const statusIcons = { '未处理': '⚠️', '处理中': '🔄', '已解决': '✅' };



  // 进展日志

  const progress = safeArr(r.progress);

  const progressHTML = progress.length > 0 ? `

    <div>

      <div style="font-size:12px;font-weight:600;color:var(--meta-alt);margin-bottom:8px;">📋 进展跟踪 (${progress.length})</div>

      <div style="display:flex;flex-direction:column;gap:8px;max-height:160px;overflow-y:auto;">

        ${progress.slice().reverse().map((p, i) => {

          const byMember = p.by ? memberMap[p.by] : null;

          return `<div style="display:flex;gap:10px;padding:8px 10px;background:#F8FAFC;border-radius:8px;font-size:12px;">

            <div style="min-width:18px;text-align:center;color:var(--meta);">${progress.length - i}</div>

            <div style="flex:1;">

              <div style="color:var(--body);line-height:1.5;">${esc(p.note||'')}</div>

              <div style="color:var(--meta);font-size:10px;margin-top:3px;">${p.date||''}${byMember ? ' · ' + esc(byMember.nickname) : ''}</div>

            </div>

          </div>`;

        }).join('')}

      </div>

    </div>` : '<div style="font-size:12px;color:var(--meta);padding:6px 0;">暂无进展记录</div>';



  // 确认状态

  const confirmHTML = r.confirmed ? `

    <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:#D1FAE5;border-radius:10px;">

      <span style="font-size:18px;">✅</span>

      <span style="font-size:13px;font-weight:600;color:#065F46;">已由负责人确认解决</span>

      ${r.confirmed_by ? `<span style="font-size:11px;color:#047857;">(${esc(memberMap[r.confirmed_by]?.nickname || r.confirmed_by)} · ${r.confirmed_at ? new Date(r.confirmed_at).toLocaleDateString('zh-CN') : ''})</span>` : ''}

    </div>` : '';



  const bodyHTML = `

    <div style="display:flex;flex-direction:column;gap:16px;">

      <!-- 等级+名称 -->

      <div style="display:flex;align-items:center;gap:10px;">

        <span style="background:${levelBg[r.level]};color:${levelColors[r.level]};font-size:13px;font-weight:700;padding:4px 14px;border-radius:20px;">${r.level}风险</span>
        <span class="badge risk-cat-badge" style="background:${RISK_CATEGORY_BG[r.category||'成本风险']};color:${RISK_CATEGORY_COLORS[r.category||'成本风险']};font-size:13px;font-weight:700;padding:4px 14px;border-radius:20px;">${RISK_CATEGORY_ICONS[r.category||'成本风险']||''} ${r.category||'成本风险'}</span>

        <span style="font-size:18px;font-weight:700;color:var(--title);">${esc(r.name)}</span>

      </div>



      <!-- 状态 + DRI + 截止日期 -->

      <div style="display:flex;gap:10px;flex-wrap:wrap;">

        <div style="flex:1;min-width:140px;display:flex;align-items:center;gap:8px;padding:10px 14px;background:#F8FAFC;border-radius:10px;">

          <span style="font-size:18px;">${statusIcons[r.status]||''}</span>

          <span style="font-size:14px;font-weight:700;color:${statusColors[r.status]||'#6B7280'};">${r.status}</span>

        </div>

        <div style="flex:1;min-width:140px;display:flex;align-items:center;gap:8px;padding:10px 14px;background:#FEF3C7;border-radius:10px;">

          <span style="font-size:13px;color:var(--meta);">👤 DRI：</span>

          <span style="font-size:13px;font-weight:600;color:var(--title);">${driMember ? esc(driMember.nickname) : (r.dri || '未指定')}</span>

        </div>

        <div style="flex:1;min-width:140px;display:flex;align-items:center;gap:8px;padding:10px 14px;background:${r.target_date && new Date(r.target_date) < new Date() ? '#FEE2E2' : '#EFF6FF'};border-radius:10px;">

          <span style="font-size:13px;color:var(--meta);">📅 截止：</span>

          <span style="font-size:13px;font-weight:600;color:${r.target_date && new Date(r.target_date) < new Date() ? '#EF4444' : 'var(--title)'};">${r.target_date || '未设置'}</span>

        </div>

      </div>



      <!-- 详细描述 -->

      <div>

        <div style="font-size:12px;font-weight:600;color:var(--meta-alt);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">详细描述</div>

        <div style="font-size:14px;color:var(--body);line-height:1.7;padding:12px 14px;background:#F8FAFC;border-radius:10px;white-space:pre-wrap;">${esc(r.description || '暂无详细描述')}</div>

      </div>



      <!-- 确认状态 -->

      ${confirmHTML}



      <!-- 进展跟踪 -->

      ${progressHTML}



      <!-- 来源项目 -->

      <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:#EFF6FF;border-radius:10px;">

        <span style="font-size:13px;color:var(--meta);">关联项目：</span>

        <span style="font-size:14px;font-weight:600;color:var(--primary);">${esc(proj.name)}</span>

        <span style="font-size:11px;color:var(--meta);margin-left:auto;">${r.created_at ? new Date(r.created_at).toLocaleDateString('zh-CN') : ''}</span>

      </div>

    </div>`;



  const footerHTML = `

    <div style="display:flex;gap:8px;width:100%;flex-wrap:wrap;">

      ${r.status !== '已解决' ? `<button class="modal-btn" style="background:#8B5CF6;color:#fff;" onclick="closeModal();addRiskProgress(${pId},${rId})">📝 添加进展</button>` : ''}

      ${r.status === '未处理' ? `<button class="modal-btn confirm" onclick="riskDetailStatus(${pId},${rId},'处理中')">🔄 标记处理中</button>` : ''}

      ${r.status === '处理中' ? `<button class="modal-btn confirm" onclick="riskDetailStatus(${pId},${rId},'已解决')">✅ 标记已解决</button>` : ''}

      ${r.status === '已解决' && !r.confirmed ? `<button class="modal-btn" style="background:#10B981;color:#fff;" onclick="confirmRisk(${pId},${rId})">✅ 负责人确认完成</button>` : ''}

      ${r.status === '已解决' && r.confirmed ? `<button class="modal-btn" style="background:#F59E0B;color:#fff;" onclick="riskDetailStatus(${pId},${rId},'未处理')">⚠️ 重新打开</button>` : ''}

      <button class="modal-btn" style="background:var(--primary);color:#fff;" onclick="closeModal();switchTo(5);setTimeout(()=>{const card=document.getElementById('projectCard_${pId}');if(card&&!card.classList.contains('expanded'))card.click();},300)">📋 查看项目</button>

      <button class="modal-btn" style="background:#EF4444;color:#fff;" onclick="showConfirm('确定删除该风险事项？',()=>{deleteRiskFromDetail(${pId},${rId})})">✕ 删除</button>

      <button class="modal-btn cancel" onclick="closeModal()">关闭</button>

    </div>`;



  showModal('风险详情', bodyHTML, footerHTML);

}



// 添加进展记录

function addRiskProgress(pId, rId) {

  const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });

  showModal('添加每日进展', `

    <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:#F0FDF4;border-radius:10px;margin-bottom:14px;font-size:13px;color:#166534;">

      <span style="font-size:18px;">📅</span>

      <span>日期自动记录：<strong>${today}</strong></span>

    </div>

    <div class="modal-field"><label>进展内容 *</label><textarea id="mpg_note" placeholder="请输入今日进展描述..." style="width:100%;height:80px;"></textarea></div>`,

    `<button class="modal-btn cancel" onclick="closeModal()">取消</button>

     <button class="modal-btn confirm" onclick="submitRiskProgress(${pId},${rId})">保存进展</button>`);

}



async function submitRiskProgress(pId, rId) {

  const note = document.getElementById('mpg_note')?.value?.trim();

  if (!note) return showToast('请输入进展内容');

  const resp = await POST(`/api/projects/${pId}/risks/${rId}/progress`, { note, by: CURRENT_USER.id });

  if (resp.code === 200) {

    const proj = DATA.projects.find(p => p.id === pId);

    if (proj) {

      const risks = safeArr(proj.risks);

      const idx = risks.findIndex(r => r.id === rId);

      if (idx !== -1 && resp.data) risks[idx] = resp.data;

      proj.risks = risks;

    }

    closeModal();

    renderS1(); renderS6();

    openRiskDetail(pId, rId);

    showToast('进展已记录');

  } else {

    showToast('记录失败: ' + (resp.message || '未知错误'));

  }

}



// 负责人确认风险完成

function confirmRisk(pId, rId) {

  const proj = DATA.projects.find(p => p.id === pId);

  if (!proj) return;

  const currentUserId = CURRENT_USER.id;

  if (currentUserId != proj.leader_id) {

    const leader = (DATA.members||[]).find(m => m.id == proj.leader_id);

    return showToast(`只有项目负责人${leader ? ' ' + leader.nickname : ''}可以确认完成`);

  }

  showConfirm('确认该风险已全部解决？确认后风险状态将锁定为"已解决"。', () => {

    submitConfirmRisk(pId, rId);

  });

}



async function submitConfirmRisk(pId, rId) {

  const resp = await POST(`/api/projects/${pId}/risks/${rId}/confirm`, { confirmed_by: CURRENT_USER.id });

  if (resp.code === 200) {

    const proj = DATA.projects.find(p => p.id === pId);

    if (proj) {

      const risks = safeArr(proj.risks);

      const idx = risks.findIndex(r => r.id === rId);

      if (idx !== -1 && resp.data) risks[idx] = resp.data;

      proj.risks = risks;

    }

    closeModal();

    renderS1(); renderS6();

    openRiskDetail(pId, rId);

    showToast('✅ 风险已确认解决');

  } else {

    showToast('确认失败: ' + (resp.message || '未知错误'));

  }

}



// 从详情弹窗中修改状态

async function riskDetailStatus(pId, rId, newStatus) {

  const resp = await PUT(`/api/projects/${pId}/risks/${rId}`, { status: newStatus });

  if (resp.code === 200) {

    const proj = DATA.projects.find(p => p.id === pId);

    if (proj) proj.risks = resp.data;

    renderS1(); renderS6();

    // 重新打开详情弹窗（数据已更新）

    openRiskDetail(pId, rId);

  } else {

    showToast('操作失败: ' + (resp.message || '未知错误'));

  }

}



// 从详情弹窗中删除

async function deleteRiskFromDetail(pId, rId) {

  const resp = await DELETE(`/api/projects/${pId}/risks/${rId}`);

  if (resp.code === 200) {

    const proj = DATA.projects.find(p => p.id === pId);

    if (proj) proj.risks = resp.data;

    closeModal();

    renderS1(); renderS6();

    showToast('已删除');

  } else {

    showToast('删除失败: ' + (resp.message || '未知错误'));

  }

}



async function quickRiskStatus(projId, riskId, newStatus) {

  const resp = await PUT(`/api/projects/${projId}/risks/${riskId}`, { status: newStatus });

  if (resp.code === 200) {

    const proj = DATA.projects.find(p => p.id == projId);

    if (proj) proj.risks = resp.data;

    renderS1(); renderS6();

  }

}



async function deleteProjectRisk(projId, riskId) {

  showConfirm('确定删除该风险事项？', async () => {

    const resp = await DELETE(`/api/projects/${projId}/risks/${riskId}`);

    if (resp.code === 200) {

      const proj = DATA.projects.find(p => p.id == projId);

      if (proj) proj.risks = resp.data;

      renderS1(); renderS6();

    } else {

      showToast(resp.message || '删除失败');

    }

  });

}



function renderRisksHTML(proj) {

  const risks = safeArr(proj.risks);

  const showForm = RISK_FORM[proj.id];

  const members = DATA.members || [];

  const memberOpts = members.map(m => `<option value="${m.id}">${esc(m.nickname)}</option>`).join('');

  let html = '';



  if (showForm) {

    html += `

    <div class="inline-form risk-form">

      <input class="if-name" id="riskName_${proj.id}" placeholder="风险名称" style="flex:2;min-width:120px;">

      <select class="if-color" id="riskLevel_${proj.id}" style="width:auto;padding:2px 4px;border-radius:6px;font-size:11px;">

        ${RISK_LEVELS.map(l => `<option value="${l}">${l}</option>`).join('')}

      </select>

      <select id="riskCategory_${proj.id}" style="padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:11px;background:var(--card);color:var(--title);min-width:80px;">

        ${RISK_CATEGORIES.map(c => `<option value="${c}">${RISK_CATEGORY_ICONS[c]||''} ${c}</option>`).join('')}

      </select>

      <select id="riskDri_${proj.id}" style="padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:11px;background:var(--card);color:var(--title);min-width:80px;">

        <option value="">DRI(可选)</option>

        ${memberOpts}

      </select>

      <input type="date" id="riskTarget_${proj.id}" style="padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:11px;background:var(--card);color:var(--title);min-width:100px;" title="目标完成日期">

      <input class="if-name" id="riskDesc_${proj.id}" placeholder="描述(可选)" style="flex:1;min-width:80px;">

      <button class="if-submit" onclick="event.stopPropagation();submitProjectRisk('${proj.id}')">确定</button>

      <button class="if-cancel" onclick="event.stopPropagation();cancelAddRisk('${proj.id}')">取消</button>

    </div>`;

  }



  risks.forEach(r => {

    const editing = RISK_EDIT[`${proj.id}_${r.id}`];

    if (editing) {

      html += `

    <div class="inline-form risk-form">

      <input class="if-name" id="reName_${proj.id}_${r.id}" value="${esc(r.name||'')}" placeholder="风险名称" style="flex:2;min-width:120px;">

      <select class="if-color" id="reLevel_${proj.id}_${r.id}" style="width:auto;padding:2px 4px;border-radius:6px;font-size:11px;">

        ${RISK_LEVELS.map(l => `<option value="${l}" ${r.level===l?'selected':''}>${l}</option>`).join('')}

      </select>

      <select id="reCategory_${proj.id}_${r.id}" style="padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:11px;background:var(--card);color:var(--title);min-width:80px;">

        ${RISK_CATEGORIES.map(c => `<option value="${c}" ${(r.category||'成本风险')===c?'selected':''}>${RISK_CATEGORY_ICONS[c]||''} ${c}</option>`).join('')}

      </select>

      <select id="reDri_${proj.id}_${r.id}" style="padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:11px;background:var(--card);color:var(--title);min-width:80px;">

        <option value="">DRI</option>

        ${members.map(m => `<option value="${m.id}" ${r.dri==m.id?'selected':''}>${esc(m.nickname)}</option>`).join('')}

      </select>

      <input type="date" id="reTarget_${proj.id}_${r.id}" value="${esc(r.target_date||'')}" style="padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:11px;background:var(--card);color:var(--title);min-width:100px;" title="目标完成日期">

      <input class="if-name" id="reDesc_${proj.id}_${r.id}" value="${esc(r.description||'')}" placeholder="描述(可选)" style="flex:1;min-width:80px;">

      <select class="if-color" id="reStatus_${proj.id}_${r.id}" style="width:auto;padding:2px 4px;border-radius:6px;font-size:11px;">

        ${RISK_STATUSES.map(s => `<option value="${s}" ${r.status===s?'selected':''}>${s}</option>`).join('')}

      </select>

      <button class="if-submit" onclick="event.stopPropagation();submitEditRisk('${proj.id}',${r.id})">保存</button>

      <button class="if-cancel" onclick="event.stopPropagation();cancelEditRisk('${proj.id}',${r.id})">取消</button>

    </div>`;

    } else {

      const driMember = r.dri ? (members.find(m => m.id == r.dri) || {}) : {};

      const driName = driMember.nickname || r.dri || '';

      html += `

    <div class="milestone-item" onclick="event.stopPropagation();editProjectRisk('${proj.id}',${r.id})" style="cursor:pointer;">

      <span class="color-dot" style="background:${esc(RISK_LEVEL_COLORS[r.level]||'#F59E0B')};"></span>

      <div class="ms-info">

        <div class="ms-name">${esc(r.name)} <span class="badge" style="background:${esc(RISK_LEVEL_BG[r.level]||'#FEF3C7')};color:${esc(RISK_LEVEL_COLORS[r.level]||'#F59E0B')};font-size:9px;padding:1px 6px;">${esc(r.level)}</span><span class="badge risk-cat-badge" style="background:${esc(RISK_CATEGORY_BG[r.category||'成本风险']||'#FEF3C7')};color:${esc(RISK_CATEGORY_COLORS[r.category||'成本风险']||'#F59E0B')};font-size:9px;padding:1px 6px;">${esc(RISK_CATEGORY_ICONS[r.category||'成本风险']||'')} ${esc(r.category||'成本风险')}</span></div>

        <div class="ms-meta">

          ${r.description ? esc(r.description).substring(0,40) + (r.description.length>40?'…':'') + ' · ' : ''}

          状态: ${esc(r.status||'未处理')}

          ${driName ? ' · DRI: ' + esc(driName) : ''}

          ${r.target_date ? ' · 截止: ' + esc(r.target_date) : ''}

          ${r.confirmed ? ' · ✅ 已确认' : ''}

        </div>

      </div>

      <div style="display:flex;align-items:center;gap:4px;">

        ${r.status !== '已解决' ? `<button class="ms-edit" onclick="event.stopPropagation();quickRiskStatus('${proj.id}',${r.id},'${r.status==='未处理'?'处理中':'已解决'}')" title="${r.status==='未处理'?'标记处理中':'标记已解决'}">${r.status==='未处理'?'▶':'✔'}</button>` : ''}

        <button class="ms-edit" onclick="event.stopPropagation();editProjectRisk('${proj.id}',${r.id})">✎</button>

        <button class="ms-delete" onclick="event.stopPropagation();deleteProjectRisk('${proj.id}',${r.id})">✕</button>

      </div>

    </div>`;

    }

  });



  return html;

}



function openProjectModal(id) {

  const nid = +id;

  const item = nid ? DATA.projects.find(p => p.id === nid) || {} : {};

  const isEdit = !!nid;

  const members = DATA.members || [];

  const memberOpts = members.map(m =>

    `<option value="${m.id}" ${item.leader_id==m.id?'selected':''}>${esc(m.nickname)} (${esc(m.dept||'')})</option>`

  ).join('');



  // 计划节点

  const plan = safeArr(item.plan);

  const planHtml = `

    <div class="modal-field"><label>项目计划 (里程碑)</label></div>

    <div id="planEditor" style="margin-bottom:12px;">

      ${plan.length > 0 ? plan.map((node, i) => `

        <div class="plan-row" data-idx="${i}" style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">

          <input class="plan-name" value="${esc(node.name||'')}" placeholder="节点名称" style="flex:2;min-width:100px;padding:6px 8px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--title);">

          <input class="plan-start" type="date" value="${esc(node.start||'')}" style="flex:1;min-width:90px;padding:6px 4px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--title);">

          <span style="font-size:11px;color:var(--meta);">→</span>

          <input class="plan-end" type="date" value="${esc(node.end||'')}" style="flex:1;min-width:90px;padding:6px 4px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--title);">

          <select class="plan-status" style="flex:1;min-width:70px;padding:6px 4px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--title);">

            <option value="待开始" ${node.status==='待开始'?'selected':''}>待开始</option>

            <option value="进行中" ${node.status==='进行中'?'selected':''}>进行中</option>

            <option value="已完成" ${node.status==='已完成'?'selected':''}>已完成</option>

          </select>

          <button class="plan-del" onclick="this.closest('.plan-row').remove()" style="width:28px;height:28px;border-radius:50%;border:1px solid var(--border);background:var(--card);color:var(--red);font-size:14px;cursor:pointer;flex-shrink:0;">✕</button>

        </div>

      `).join('') : '<div style="font-size:12px;color:var(--meta);padding:6px 0;">暂无计划节点</div>'}

    </div>

    <button class="modal-btn" style="padding:5px 12px;font-size:12px;width:100%;margin-bottom:12px;" onclick="addPlanRow()">+ 添加计划节点</button>`;



  showModal(isEdit ? '编辑项目' : '新建项目', `

    <div class="modal-field"><label>项目名称 *</label><input id="mf_pname" value="${esc(item.name||'')}" placeholder="请输入项目名称"></div>

    <div class="modal-field"><label>项目描述</label><textarea id="mf_pdesc" placeholder="请输入项目描述">${esc(item.description||'')}</textarea></div>

    <div class="modal-field"><label>状态</label><select id="mf_pstatus">

      <option value="待启动" ${(item.status||'')==='待启动'?'selected':''}>待启动</option>

      <option value="进行中" ${(item.status||'进行中')==='进行中'?'selected':''}>进行中</option>

      <option value="已完成" ${item.status==='已完成'?'selected':''}>已完成</option>

      <option value="暂停" ${item.status==='暂停'?'selected':''}>暂停</option>

    </select></div>

    <div class="modal-field"><label>负责人</label><select id="mf_leader">

      <option value="">请选择负责人</option>

      ${memberOpts}

    </select></div>

    ${planHtml}`,

    `${isEdit ? `<button class="modal-btn danger" onclick="deleteItem('projects',${nid});closeModal()">删除</button>` : ''}

    <button class="modal-btn cancel" onclick="closeModal()">取消</button>

    <button class="modal-btn confirm" onclick="saveProject(${id||0})">${isEdit ? '保存' : '创建'}</button>`);

}



function openHandoverModalForProject(projectId) {

  const proj = DATA.projects.find(p => p.id === projectId);

  const members = DATA.members || [];

  const memberOpts = members.map(m =>

    `<option value="${m.id}">${esc(m.nickname)} (${esc(m.dept||'')})</option>`

  ).join('');

  showModal('新建交接事项', `

    <div class="modal-field"><label>任务标题 *</label><input id="mf_title" value="" placeholder="请输入标题"></div>

    <div class="modal-field"><label>优先级</label>

      <div class="priority-row">

        <div class="priority-opt orange selected" onclick="selectPriority(this,'中','orange')">中</div>

        <div class="priority-opt red" onclick="selectPriority(this,'高','red')">高</div>

        <div class="priority-opt green" onclick="selectPriority(this,'低','green')">低</div>

      </div>

      <input type="hidden" id="mf_priority" value="中">

    </div>

    <div class="modal-field"><label>详细描述</label><textarea id="mf_desc" placeholder="请输入描述"></textarea></div>

    <div class="modal-field"><label>接收人 *</label><select id="mf_to_user">

      <option value="">请选择接收人</option>

      ${memberOpts}

    </select></div>

    <div class="modal-field"><label>所属项目</label><input id="mf_project_name" value="${esc(proj?proj.name:'')}" disabled style="background:var(--bg);color:var(--meta);">

      <input type="hidden" id="mf_project_id" value="${projectId}">

    </div>

    <div class="modal-field"><label>移交人</label><input id="mf_from" value="" placeholder="如: 刘主管移交"></div>`,

    `<button class="modal-btn cancel" onclick="closeModal()">取消</button>

    <button class="modal-btn confirm" onclick="saveHandoverForProject()">创建</button>`);

}



async function saveHandoverForProject() {

  const toUserId = document.getElementById('mf_to_user').value;

  const projectId = document.getElementById('mf_project_id').value;

  const body = {

    title: document.getElementById('mf_title').value.trim(),

    priority: document.getElementById('mf_priority').value,

    description: document.getElementById('mf_desc').value.trim(),

    from_user: document.getElementById('mf_from').value.trim(),

    status: '待接收',

    to_user_id: toUserId ? parseInt(toUserId) : null,

    project_id: projectId ? parseInt(projectId) : null

  };

  if (!body.title) { showToast('请输入标题'); return; }

  if (!body.to_user_id) { showToast('请选择接收人'); return; }

  const res = await POST('/api/content/handovers', body);

  if (res.code === 200) { await fetchAllData(); renderAll(); closeModal(); showToast('已创建'); }

  else showToast(res.message);

}



async function saveProject(id) {

  const nid = +id;

  const leaderId = document.getElementById('mf_leader').value;

  // 收集计划节点

  const planRows = document.querySelectorAll('#planEditor .plan-row');

  const oldPlan = nid ? safeArr((DATA.projects.find(p => p.id === nid) || {}).plan) : [];

  const plan = [];

  planRows.forEach(row => {

    const name = row.querySelector('.plan-name')?.value?.trim();

    const start = row.querySelector('.plan-start')?.value;

    const end = row.querySelector('.plan-end')?.value;

    const status = row.querySelector('.plan-status')?.value;

    if (name) {

      // 保留旧数据中的 daily 字段

      const oldIdx = parseInt(row.dataset.idx);

      const daily = (!isNaN(oldIdx) && oldPlan[oldIdx] && oldPlan[oldIdx].name === name && oldPlan[oldIdx].daily) ? oldPlan[oldIdx].daily : [];

      plan.push({ name, start, end, status: status || '待开始', daily });

    }

  });

  const body = {

    name: document.getElementById('mf_pname').value.trim(),

    description: document.getElementById('mf_pdesc').value.trim(),

    status: document.getElementById('mf_pstatus').value,

    leader_id: leaderId ? parseInt(leaderId) : null,

    plan: plan.length > 0 ? plan : null

  };

  if (!body.name) { showToast('请输入项目名称'); return; }

  const res = nid ? await PUT(`/api/projects/${nid}`, body) : await POST('/api/projects', body);

  if (res.code === 200) { await fetchAllData(); renderAll(); closeModal(); showToast(nid ? '已更新' : '已创建'); }

  else showToast(res.message || '操作失败');

}



// 添加计划节点行

// addPlanRow() removed — use addPlanGroup() / addPlanRowToGroup(gIdx) instead



// addPlanRow() removed — use addPlanGroup() / addPlanRowToGroup(gIdx) instead


// ── 独立编辑项目计划（支持分组）──

function openPlanEditor(projectId) {

  const nid = +projectId;

  const proj = DATA.projects.find(p => p.id === nid);

  if (!proj) { showToast('项目不存在'); return; }

  const plan = getCurrentPlan(proj);
  const planLabel = DATA.planSubTab==='nonstd'?'非标设备计划':DATA.planSubTab==='std'?'标准设备计划':'总项目计划';
  const groupLabel = getGroupLabel();

  // 按分组整理
  const groups = groupPlanItems(plan);
  if (groups.length === 0) {
    groups.push({ name: '', items: [], origIndices: [] });
  }

  const groupsHtml = groups.map((g, gi) => `
    <div class="plan-group-section" style="margin-bottom:10px;border:1px solid #E2E8F0;border-radius:11px;overflow:hidden;">
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#F1F5F9;border-bottom:1px solid #E2E8F0;">
        <input class="plan-group-name" value="${esc(g.name)}" placeholder="输入${groupLabel}名称" data-gidx="${gi}" style="flex:1;padding:6px 10px;font-size:13px;font-weight:600;border:1px solid var(--border);border-radius:7px;background:var(--card);color:var(--title);">
        <button class="plan-group-del" onclick="this.closest('.plan-group-section').remove()" title="删除整个${groupLabel}" style="width:26px;height:26px;min-width:26px;border-radius:50%;border:1px solid var(--border);background:var(--card);color:var(--red);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
      </div>
      <div class="plan-group-items" data-gidx="${gi}" style="padding:8px 10px;">
        ${g.items.length > 0 ? g.items.map((node, ii) => `
          <div class="plan-row" data-idx="${ii}" data-group="${esc(g.name)}" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:9px;padding:10px;margin-bottom:8px;">
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:7px;">
              <input class="plan-name" value="${esc(node.name||'')}" placeholder="节点名称" style="flex:1;padding:8px 10px;font-size:13px;border:1px solid var(--border);border-radius:7px;background:var(--card);color:var(--title);">
              <button class="plan-del" onclick="this.closest('.plan-row').remove()" style="width:30px;height:30px;min-width:30px;border-radius:50%;border:1px solid var(--border);background:var(--card);color:var(--red);font-size:16px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;line-height:1;">✕</button>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <input class="plan-start" type="date" value="${esc(node.start||'')}" style="flex:1;min-width:0;padding:7px 5px;font-size:12px;border:1px solid var(--border);border-radius:7px;background:var(--card);color:var(--title);">
              <span style="font-size:13px;color:var(--meta);flex-shrink:0;line-height:1;">→</span>
              <input class="plan-end" type="date" value="${esc(node.end||'')}" style="flex:1;min-width:0;padding:7px 5px;font-size:12px;border:1px solid var(--border);border-radius:7px;background:var(--card);color:var(--title);">
              <select class="plan-status" style="width:80px;min-width:80px;padding:7px 4px;font-size:12px;border:1px solid var(--border);border-radius:7px;background:var(--card);color:var(--title);">
                <option value="待开始" ${node.status==='待开始'?'selected':''}>待开始</option>
                <option value="进行中" ${node.status==='进行中'?'selected':''}>进行中</option>
                <option value="已完成" ${node.status==='已完成'?'selected':''}>已完成</option>
              </select>
            </div>
          </div>
        `).join('') : '<div class="plan-group-empty" style="font-size:12px;color:var(--meta);padding:6px 0;text-align:center;">此' + groupLabel + '暂无计划节点</div>'}
        <button class="modal-btn plan-add-to-group" onclick="addPlanRowToGroup(${gi})" style="padding:5px 12px;font-size:12px;width:100%;margin-top:4px;">+ 添加计划节点</button>
      </div>
    </div>
  `).join('');

  const planHtml = `
    <div class="modal-field"><label>项目：${esc(proj.name)} · ${planLabel}</label></div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <label style="font-size:13px;font-weight:600;color:var(--title);">${groupLabel}分组</label>
      <button class="modal-btn" style="padding:4px 10px;font-size:11px;" onclick="addPlanGroup()">+ 新建${groupLabel}</button>
      <button class="modal-btn" style="padding:4px 10px;font-size:11px;margin-left:4px;" onclick="copyPlan()">📋 复制全部</button>
      <button class="modal-btn" style="padding:4px 10px;font-size:11px;margin-left:4px;" onclick="pastePlan()" id="btnPastePlan" ${!DATA.copiedPlan ? 'disabled' : ''}>📄 粘贴</button>
    </div>

    <div id="planEditor" style="margin-bottom:12px;">
      ${groups.length > 0 && plan.length > 0 ? groupsHtml : '<div style="font-size:12px;color:var(--meta);padding:6px 0;">暂无分组和计划节点，点击上方按钮新建' + groupLabel + '</div>'}
    </div>`;

  showModal('编辑项目计划', planHtml, `
    <button class="modal-btn cancel" onclick="closeModal()">取消</button>
    <button class="modal-btn confirm" onclick="savePlan(${projectId})">保存计划</button>`);
}

// ── 复制当前计划编辑器全部内容 ──
function copyPlan() {
  const editor = document.getElementById('planEditor');
  if (!editor) return;
  const groups = [];
  const sections = editor.querySelectorAll('.plan-group-section');
  sections.forEach(section => {
    const gnameInput = section.querySelector('.plan-group-name');
    const groupName = gnameInput ? gnameInput.value : '';
    const items = [];
    const rows = section.querySelectorAll('.plan-row');
    rows.forEach(row => {
      const nameEl = row.querySelector('.plan-name');
      const startEl = row.querySelector('.plan-start');
      const endEl = row.querySelector('.plan-end');
      const statusEl = row.querySelector('.plan-status');
      items.push({
        name: nameEl ? nameEl.value.trim() : '',
        start: startEl ? startEl.value : '',
        end: endEl ? endEl.value : '',
        status: statusEl ? statusEl.value : '待开始'
      });
    });
    if (groupName || items.length > 0) {
      groups.push({ name: groupName, items });
    }
  });
  DATA.copiedPlan = groups;
  showToast('计划已复制（共 ' + groups.length + ' 个分组）');
  // 启用粘贴按钮
  const pasteBtn = document.getElementById('btnPastePlan');
  if (pasteBtn) pasteBtn.disabled = false;
}

// ── 粘贴已复制的计划到当前编辑器 ──
function pastePlan() {
  if (!DATA.copiedPlan || DATA.copiedPlan.length === 0) {
    showToast('没有可粘贴的计划，请先复制');
    return;
  }
  const editor = document.getElementById('planEditor');
  if (!editor) return;
  const groupLabel = getGroupLabel();
  let html = '';
  DATA.copiedPlan.forEach((g, gi) => {
    const itemsHtml = g.items.length > 0 ? g.items.map((node, ii) => `
      <div class="plan-row" data-idx="${ii}" data-group="${esc(g.name)}" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:9px;padding:10px;margin-bottom:8px;">
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:7px;">
          <input class="plan-name" value="${esc(node.name||'')}" placeholder="节点名称" style="flex:1;padding:8px 10px;font-size:13px;border:1px solid var(--border);border-radius:7px;background:var(--card);color:var(--title);">
          <button class="plan-del" onclick="this.closest('.plan-row').remove()" style="width:30px;height:30px;min-width:30px;border-radius:50%;border:1px solid var(--border);background:var(--card);color:var(--red);font-size:16px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;line-height:1;">✕</button>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <input class="plan-start" type="date" value="${esc(node.start||'')}" style="flex:1;min-width:0;padding:7px 5px;font-size:12px;border:1px solid var(--border);border-radius:7px;background:var(--card);color:var(--title);">
          <span style="font-size:13px;color:var(--meta);flex-shrink:0;line-height:1;">→</span>
          <input class="plan-end" type="date" value="${esc(node.end||'')}" style="flex:1;min-width:0;padding:7px 5px;font-size:12px;border:1px solid var(--border);border-radius:7px;background:var(--card);color:var(--title);">
          <select class="plan-status" style="width:80px;min-width:80px;padding:7px 4px;font-size:12px;border:1px solid var(--border);border-radius:7px;background:var(--card);color:var(--title);">
            <option value="待开始" ${node.status==='待开始'?'selected':''}>待开始</option>
            <option value="进行中" ${node.status==='进行中'?'selected':''}>进行中</option>
            <option value="已完成" ${node.status==='已完成'?'selected':''}>已完成</option>
          </select>
        </div>
      </div>
    `).join('') : '<div class="plan-group-empty" style="font-size:12px;color:var(--meta);padding:6px 0;text-align:center;">此' + groupLabel + '暂无计划节点</div>';
    html += `
      <div class="plan-group-section" style="margin-bottom:10px;border:1px solid #E2E8F0;border-radius:11px;overflow:hidden;">
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#F1F5F9;border-bottom:1px solid #E2E8F0;">
          <input class="plan-group-name" value="${esc(g.name||'')}" placeholder="输入${groupLabel}名称" data-gidx="${gi}" style="flex:1;padding:6px 10px;font-size:13px;font-weight:600;border:1px solid var(--border);border-radius:7px;background:var(--card);color:var(--title);">
          <button class="plan-group-del" onclick="this.closest('.plan-group-section').remove()" title="删除整个${groupLabel}" style="width:26px;height:26px;min-width:26px;border-radius:50%;border:1px solid var(--border);background:var(--card);color:var(--red);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
        </div>
        <div class="plan-group-items" data-gidx="${gi}" style="padding:8px 10px;">
          ${itemsHtml}
          <button class="modal-btn plan-add-to-group" onclick="addPlanRowToGroup(${gi})" style="padding:5px 12px;font-size:12px;width:100%;margin-top:4px;">+ 添加计划节点</button>
        </div>
      </div>`;
  });
  editor.innerHTML = html;
  showToast('计划已粘贴（共 ' + DATA.copiedPlan.length + ' 个分组）');
}

// 新建一个分组
function addPlanGroup() {
  const editor = document.getElementById('planEditor');
  const groupLabel = getGroupLabel();
  const gIdx = editor.querySelectorAll('.plan-group-section').length;

  // 如果当前只有空状态提示，先清空
  const emptyHint = editor.querySelector('.plan-group-section') === null;
  if (emptyHint) editor.innerHTML = '';

  const section = document.createElement('div');
  section.className = 'plan-group-section';
  section.style.cssText = 'margin-bottom:10px;border:1px solid #E2E8F0;border-radius:11px;overflow:hidden;';
  section.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#F1F5F9;border-bottom:1px solid #E2E8F0;">
      <input class="plan-group-name" placeholder="输入${groupLabel}名称" data-gidx="${gIdx}" style="flex:1;padding:6px 10px;font-size:13px;font-weight:600;border:1px solid var(--border);border-radius:7px;background:var(--card);color:var(--title);">
      <button onclick="this.closest('.plan-group-section').remove()" title="删除整个${groupLabel}" style="width:26px;height:26px;min-width:26px;border-radius:50%;border:1px solid var(--border);background:var(--card);color:var(--red);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
    </div>
    <div class="plan-group-items" data-gidx="${gIdx}" style="padding:8px 10px;">
      <div class="plan-group-empty" style="font-size:12px;color:var(--meta);padding:6px 0;text-align:center;">此${groupLabel}暂无计划节点</div>
      <button class="modal-btn plan-add-to-group" onclick="addPlanRowToGroup(${gIdx})" style="padding:5px 12px;font-size:12px;width:100%;margin-top:4px;">+ 添加计划节点</button>
    </div>`;
  editor.appendChild(section);
}

// 在指定分组中添加计划节点
function addPlanRowToGroup(gIdx) {
  const container = document.querySelector('.plan-group-items[data-gidx="' + gIdx + '"]');
  if (!container) { console.warn('Group container not found:', gIdx); return; }

  // 移除空状态提示
  const empty = container.querySelector('.plan-group-empty');
  if (empty) empty.remove();

  // 找到添加按钮
  const addBtn = container.querySelector('.plan-add-to-group');

  const row = document.createElement('div');
  row.className = 'plan-row';
  row.style.cssText = 'background:#F8FAFC;border:1px solid #E2E8F0;border-radius:9px;padding:10px;margin-bottom:8px;';
  row.innerHTML = `
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:7px;">
      <input class="plan-name" placeholder="节点名称" style="flex:1;padding:8px 10px;font-size:13px;border:1px solid var(--border);border-radius:7px;background:var(--card);color:var(--title);">
      <button class="plan-del" onclick="this.closest('.plan-row').remove()" style="width:30px;height:30px;min-width:30px;border-radius:50%;border:1px solid var(--border);background:var(--card);color:var(--red);font-size:16px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;line-height:1;">✕</button>
    </div>
    <div style="display:flex;gap:6px;align-items:center;">
      <input class="plan-start" type="date" style="flex:1;min-width:0;padding:7px 5px;font-size:12px;border:1px solid var(--border);border-radius:7px;background:var(--card);color:var(--title);">
      <span style="font-size:13px;color:var(--meta);flex-shrink:0;line-height:1;">→</span>
      <input class="plan-end" type="date" style="flex:1;min-width:0;padding:7px 5px;font-size:12px;border:1px solid var(--border);border-radius:7px;background:var(--card);color:var(--title);">
      <select class="plan-status" style="width:80px;min-width:80px;padding:7px 4px;font-size:12px;border:1px solid var(--border);border-radius:7px;background:var(--card);color:var(--title);">
        <option value="待开始">待开始</option>
        <option value="进行中">进行中</option>
        <option value="已完成">已完成</option>
      </select>
    </div>`;

  // 插入到添加按钮之前
  if (addBtn) {
    container.insertBefore(row, addBtn);
  } else {
    container.appendChild(row);
  }
}

async function savePlan(projectId) {

  const sections = document.querySelectorAll('#planEditor .plan-group-section');
  const nid = +projectId;
  const proj = DATA.projects.find(p => p.id === nid);
  const oldPlan = proj ? getCurrentPlan(proj) : [];
  const planKey = getCurrentPlanKey();

  // 构建旧数据的 name→daily 映射（用于保留每日进展）
  const oldDailyMap = {};
  oldPlan.forEach(item => {
    if (item.name) oldDailyMap[item.name] = item.daily || [];
  });

  const plan = [];
  sections.forEach(section => {
    const groupName = section.querySelector('.plan-group-name')?.value?.trim() || '';
    const rows = section.querySelectorAll('.plan-row');
    rows.forEach(row => {
      const name = row.querySelector('.plan-name')?.value?.trim();
      const start = row.querySelector('.plan-start')?.value;
      const end = row.querySelector('.plan-end')?.value;
      const status = row.querySelector('.plan-status')?.value;
      if (name) {
        const daily = oldDailyMap[name] || [];
        plan.push({ name, group: groupName, start, end, status: status || '待开始', daily });
      }
    });
  });

  const res = await PUT(`/api/projects/${projectId}`, { [planKey]: plan });

  if (res.code === 200) { await fetchAllData(); renderAll(); closeModal(); showToast('计划已保存'); }
  else showToast(res.message || '保存失败');

}

// ── Screen 3 (会议子视图): 会议记录渲染 ──

function renderMeetings() {

  const meetings = DATA.meetings || [];

  const memberMap = {};

  (DATA.members||[]).forEach(m => { memberMap[m.id] = m; });



  if (meetings.length === 0) {

    document.getElementById('s3Meetings').innerHTML = empty('暂无会议记录，点击右上角新建') +

      `<div style="text-align:center;margin-top:16px;">

        <button class="modal-btn confirm" onclick="openMeetingQuickTemplate()" style="font-size:13px;">📋 使用快捷模板快速生成</button>

      </div>`;

    return;

  }



  document.getElementById('s3Meetings').innerHTML = `

    <div style="text-align:right;margin-bottom:8px;">

      <button class="header-btn" onclick="openMeetingQuickTemplate()" style="font-size:12px;">📋 快捷模板</button>

    </div>` +

    meetings.map(m => {

    const actionItems = typeof m.action_items === 'string' ? JSON.parse(m.action_items || '[]') : (m.action_items || []);

    const isExpanded = DATA.expandedMeeting === m.id;

    const statusColors = { '已完成': 'green', '进行中': 'blue', '待开始': 'orange', '已取消': 'red' };

    const statusCls = statusColors[m.status] || 'orange';

    const attendees = (m.attendees || '').split(/[,，]/).filter(Boolean);



    return `

    <div class="card${m.date && isToday(m.date) ? ' meeting-card deadline-today' : ''}" style="padding:14px;">

      ${cardActions(`openMeetingModal(${m.id})`, `deleteItem('meetings',${m.id})`)}

      <div style="display:flex;align-items:flex-start;justify-content:space-between;cursor:pointer;" onclick="toggleMeetingExpand(${m.id})">

        <div style="flex:1;min-width:0;">

          <div style="font-size:15px;font-weight:600;color:var(--title);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(m.title)}</div>

          <div style="font-size:12px;color:var(--meta);margin-top:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">

            <span>📅 ${m.date && isToday(m.date) ? '<span class="meeting-date-today">' + esc(m.date) + '</span>' : (m.date||'--')} ${m.time||''}</span>

            <span>📍 ${esc(m.location||'--')}</span>

            ${m.project_name ? `<span style="color:#6366F1;">🔗 ${esc(m.project_name)}</span>` : ''}

            ${m.transcript ? `<span style="color:#EC4899;">🎤 语音转录</span>` : ''}

          </div>

        </div>

        <span class="badge ${statusCls}" style="flex-shrink:0;margin-left:8px;">${esc(m.status)}</span>

      </div>

      ${attendees.length > 0 ? `<div style="margin-top:8px;display:flex;align-items:center;gap:4px;flex-wrap:wrap;">

        ${attendees.map(a => {

          const member = memberMap[a.trim()] || Object.values(memberMap).find(mm => mm.nickname === a.trim());

          return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px;color:var(--meta);background:var(--bg);padding:2px 8px;border-radius:10px;">

            <span style="width:16px;height:16px;border-radius:50%;background:#6366F1;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:8px;font-weight:700;">${member ? esc(member.avatar||member.nickname.charAt(0)) : '👤'}</span>

            ${esc(a.trim())}

          </span>`;

        }).join('')}

      </div>` : ''}

      ${isExpanded ? `

      <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px;" onclick="event.stopPropagation();">

        ${m.agenda ? `<div style="margin-bottom:10px;">

          <div style="font-size:12px;font-weight:600;color:var(--title);margin-bottom:4px;">📋 会议议程</div>

          <div style="font-size:12px;color:var(--body);line-height:1.6;white-space:pre-wrap;background:var(--bg);padding:8px 10px;border-radius:6px;">${esc(m.agenda)}</div>

        </div>` : ''}

        ${m.minutes ? `<div style="margin-bottom:10px;">

          <div style="font-size:12px;font-weight:600;color:var(--title);margin-bottom:4px;">📝 会议纪要/决议</div>

          <div style="font-size:12px;color:var(--body);line-height:1.6;white-space:pre-wrap;background:var(--bg);padding:8px 10px;border-radius:6px;">${esc(m.minutes)}</div>

        </div>` : ''}

        ${m.transcript ? `<div style="margin-bottom:10px;">

          <div style="font-size:12px;font-weight:600;color:var(--title);margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;">

            <span>🎤 语音转录</span>

            <button onclick="event.stopPropagation();openVoiceModal(${m.id})" style="background:none;border:1px solid #EC4899;color:#EC4899;border-radius:4px;cursor:pointer;font-size:10px;padding:2px 6px;">重新录制</button>

          </div>

          <div style="font-size:11px;color:var(--meta);line-height:1.6;white-space:pre-wrap;background:#FDF2F8;padding:8px 10px;border-radius:6px;max-height:150px;overflow-y:auto;">${esc(m.transcript)}</div>

        </div>` : ''}

        ${actionItems.length > 0 ? `<div>

          <div style="font-size:12px;font-weight:600;color:var(--title);margin-bottom:4px;">✅ 待办事项</div>

          ${actionItems.map((ai, i) => `

            <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;font-size:12px;border-bottom:1px dashed var(--border-light);">

              <span style="flex:1;color:var(--body);">${i+1}. ${esc(ai.task)}</span>

              <span style="color:var(--meta);font-size:11px;margin:0 8px;">${esc(ai.assignee||'')}</span>

              <span style="color:${isOverdue(ai.deadline) ? '#DC2626' : isToday(ai.deadline) ? '#D97706' : 'var(--meta)'};font-size:11px;white-space:nowrap;${isOverdue(ai.deadline)||isToday(ai.deadline)?'font-weight:600;':''}">${esc(ai.deadline||'')}${isOverdue(ai.deadline)?' ⚠️':isToday(ai.deadline)?' 🔔':''}</span>

            </div>`).join('')}

        </div>` : ''}

        ${!m.transcript ? `<div style="text-align:center;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);">

          <button onclick="event.stopPropagation();openVoiceModal(${m.id})" style="background:none;border:1px solid #EC4899;color:#EC4899;border-radius:6px;cursor:pointer;font-size:11px;padding:4px 12px;">🎤 语音补录会议内容</button>

        </div>` : ''}

      </div>` : ''}

    </div>`;

  }).join('') +

  `<div style="text-align:center;margin-top:8px;">

    <button class="modal-btn confirm" onclick="openMeetingQuickTemplate()" style="font-size:12px;">📋 使用快捷模板快速生成</button>

  </div>`;

}



// ── Screen 6 (甘特图子视图): 项目总览甘特图 ──

// ── 甘特图视图切换 ──

function switchGanttView(view) {

  DATA.ganttView = view;

  // 更新按钮状态

  document.querySelectorAll('.gvt-btn').forEach(b => {

    b.classList.toggle('active', b.dataset.view === view);

  });

  renderGantt();

}



async function renderGantt() {

  const ganttContainer = document.getElementById('ganttContainer');

  const ganttLegend = document.getElementById('ganttLegend');



  // 同步视图按钮状态

  const view = DATA.ganttView || 'month';

  document.querySelectorAll('.gvt-btn').forEach(b => {

    b.classList.toggle('active', b.dataset.view === view);

  });



  // 图例

  ganttLegend.innerHTML = `

    <div class="gantt-legend-item"><span class="gantt-legend-dot done"></span>已完成</div>

    <div class="gantt-legend-item"><span class="gantt-legend-dot progress"></span>进行中</div>

    <div class="gantt-legend-item"><span class="gantt-legend-dot pending"></span>待开始</div>

    <div class="gantt-legend-item"><span class="gantt-legend-dot delayed"></span>已延期</div>

    <div class="gantt-legend-item"><span style="display:inline-block;width:12px;height:8px;background:#D97706;border-radius:2px;opacity:0.75;vertical-align:middle;margin-right:4px;"></span>里程碑</div>`;



  ganttContainer.innerHTML = '<div class="gantt-empty">加载中...</div>';



  try {

    const res = await GET('/api/projects');

    if (res.code !== 200) {

      ganttContainer.innerHTML = '<div class="gantt-empty">加载项目数据失败</div>';

      return;

    }

    const projects = res.data || [];



    // 只保留有计划或里程碑的项目
    // 对于有多个计划类型的项目（plan_total/plan_nonstd/plan_std），展开为多个虚拟行
    const projectsWithPlan = [];
    projects.forEach(p => {
      const milestones = safeArr(p.milestones);
      const planTypes = [
        { key: 'plan_total', label: '总' },
        { key: 'plan_nonstd', label: '非标' },
        { key: 'plan_std', label: '标准' }
      ];
      const hasMultiPlan = planTypes.some(t => safeArr(p[t.key]).length > 0);
      
      if (hasMultiPlan) {
        // 展开为多行
        planTypes.forEach(t => {
          const subPlan = safeArr(p[t.key]);
          if (subPlan.length > 0) {
            projectsWithPlan.push({ ...p, _plan: subPlan, _displayName: p.name + ' · ' + t.label, _planType: t.key });
          }
        });
      } else {
        // 普通单计划项目
        const plan = safeArr(p.plan);
        if (plan.length > 0 || milestones.length > 0) {
          projectsWithPlan.push(p);
        }
      }
    });



    if (projectsWithPlan.length === 0) {

      ganttContainer.innerHTML = '<div class="gantt-empty">暂无项目计划数据<br><span style="font-size:11px;color:var(--meta-alt);">请先在「项目」标签页中添加项目计划</span></div>';

      return;

    }



    // 收集所有日期

    const allDates = [];

    projectsWithPlan.forEach(p => {
      const plan = p._plan || safeArr(p.plan);
      plan.forEach(node => {
        if (node.start) allDates.push(new Date(node.start));
        if (node.end) allDates.push(new Date(node.end));
      });
      (p.milestones || []).forEach(ms => {

        const msStart = ms.start || ms.date;

        const msEnd = ms.end || ms.date;

        if (msStart) allDates.push(new Date(msStart));

        if (msEnd) allDates.push(new Date(msEnd));

      });

    });



    if (allDates.length === 0) {

      ganttContainer.innerHTML = '<div class="gantt-empty">暂无有效日期数据</div>';

      return;

    }



    // 计算日期范围并扩展到整月

    let minDate = new Date(Math.min(...allDates));

    let maxDate = new Date(Math.max(...allDates));

    const today = new Date();

    today.setHours(0, 0, 0, 0);



    if (maxDate < today) maxDate = new Date(today);

    if (minDate > today) minDate = new Date(today);

    maxDate.setMonth(maxDate.getMonth() + 1);

    minDate = new Date(minDate.getFullYear(), minDate.getMonth(), 1);

    maxDate = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 0);



    const projectColWidth = 110;

    let html;



    if (view === 'day') {

      html = buildGanttDay(projectsWithPlan, minDate, maxDate, today, projectColWidth);

    } else if (view === 'year') {

      html = buildGanttYear(projectsWithPlan, minDate, maxDate, today, projectColWidth);

    } else {

      html = buildGanttMonth(projectsWithPlan, minDate, maxDate, today, projectColWidth);

    }



    ganttContainer.innerHTML = html;



  } catch (e) {

    console.error('Gantt render error:', e);

    ganttContainer.innerHTML = '<div class="gantt-empty">加载失败，请重试</div>';

  }

}



// ── 月视图 ──

function buildGanttMonth(projects, minDate, maxDate, today, projectColWidth) {

  const totalDays = Math.max(1, Math.ceil((maxDate - minDate) / 86400000));

  const DAY_WIDTH = 3.5;



  const months = [];

  let cursor = new Date(minDate);

  while (cursor <= maxDate) {

    const year = cursor.getFullYear();

    const month = cursor.getMonth();

    const daysInMonth = new Date(year, month + 1, 0).getDate();

    months.push({

      label: `${year}年${month + 1}月`,

      days: daysInMonth,

      width: Math.round(daysInMonth * DAY_WIDTH)

    });

    cursor.setMonth(cursor.getMonth() + 1);

  }



  const totalWidth = Math.round(totalDays * DAY_WIDTH);

  const todayOffset = Math.round(Math.max(0, ((today - minDate) / 86400000) * DAY_WIDTH));



  let html = '<div class="gantt-wrapper" style="position:relative;width:' + (projectColWidth + totalWidth) + 'px;">';



  // 月份表头

  html += '<div class="gantt-header-row">';

  html += '<div class="gantt-project-name-col" style="height:36px;font-size:12px;color:var(--meta);">项目 \\ 时间</div>';

  months.forEach(m => {

    html += '<div class="gantt-month-cell" style="width:' + m.width + 'px;">' + m.label + '</div>';

  });

  html += '</div>';



  // 今天竖线

  html += '<div class="gantt-today-line" style="left:' + (projectColWidth + todayOffset) + 'px;"><span class="gantt-today-label">今天</span></div>';



  // 项目行

  projects.forEach(proj => {

    html += '<div class="gantt-row">';
    const displayName = proj._displayName || proj.name;
    html += '<div class="gantt-project-name-col" style="font-size:12px;" title="' + esc(displayName) + '">' + esc(displayName.length > 8 ? displayName.substring(0, 7) + '...' : displayName) + '</div>';

    html += '<div class="gantt-bar-area" style="width:' + totalWidth + 'px;">';

    const planData = proj._plan || safeArr(proj.plan);
    planData.forEach(node => {

      if (!node.start) return;

      const startDate = new Date(node.start);

      const endDate = node.end ? new Date(node.end) : new Date(startDate.getTime() + 86400000);

      const left = Math.max(0, Math.round(((startDate - minDate) / 86400000) * DAY_WIDTH));

      const barWidth = Math.max(4, Math.round(((endDate - startDate) / 86400000) * DAY_WIDTH));

      let cls = 'pending';

      if (node.status === '已完成') cls = 'done';

      else if (node.status === '进行中') cls = 'progress';

      else if (endDate < today) cls = 'delayed';

      html += '<div class="gantt-bar ' + cls + '" style="left:' + left + 'px;width:' + barWidth + 'px;" title="' + esc(node.name || '') + '&#10;' + (node.start || '?') + ' → ' + (node.end || '?') + '&#10;状态: ' + (node.status || '待开始') + '">' + esc(node.name || '') + '</div>';

    });



    (proj.milestones || []).forEach(ms => {

      const msStart = ms.start || ms.date;

      const msEnd = ms.end || ms.date;

      if (!msStart && !msEnd) return;

      const s = msStart ? new Date(msStart) : null;

      const e = msEnd ? new Date(msEnd) : null;

      const msLeft = Math.round(Math.max(0, ((s || e) - minDate) / 86400000 * DAY_WIDTH));

      const msWidth = s && e ? Math.max(3, Math.round(((e - s) / 86400000) * DAY_WIDTH)) : 3;

      const isOverdue = e && e < today;

      html += '<div class="gantt-bar" style="left:' + msLeft + 'px;width:' + msWidth + 'px;background:' + esc(ms.color||'#6366F1') + ';opacity:0.75;border-radius:3px;' + (isOverdue ? 'border:2px solid #EF4444;' : '') + '" title="🏁 ' + esc(ms.name) + '&#10;📅 ' + (msStart||'?') + ' → ' + (msEnd||'?') + (ms.description ? '&#10;📝 ' + esc(ms.description) : '') + '">' + esc(ms.name || '') + '</div>';

    });



    html += '</div></div>';

  });



  html += '</div>';

  return html;

}



// ── 日视图 ──

function buildGanttDay(projects, minDate, maxDate, today, projectColWidth) {

  const totalDays = Math.max(1, Math.ceil((maxDate - minDate) / 86400000));

  const DAY_WIDTH = 20;



  // 生成月份组

  const months = [];

  let cursor = new Date(minDate);

  while (cursor <= maxDate) {

    const year = cursor.getFullYear();

    const month = cursor.getMonth();

    const daysInMonth = new Date(year, month + 1, 0).getDate();

    months.push({

      label: `${month + 1}月`,

      days: daysInMonth,

      width: Math.round(daysInMonth * DAY_WIDTH)

    });

    cursor.setMonth(cursor.getMonth() + 1);

  }



  const totalWidth = Math.round(totalDays * DAY_WIDTH);

  const todayOffset = Math.round(Math.max(0, ((today - minDate) / 86400000) * DAY_WIDTH));



  let html = '<div class="gantt-wrapper" style="position:relative;width:' + (projectColWidth + totalWidth) + 'px;">';



  // 月份表头

  html += '<div class="gantt-header-row">';

  html += '<div class="gantt-project-name-col" style="height:28px;font-size:12px;color:var(--meta);">项目 \\ 日期</div>';

  months.forEach(m => {

    html += '<div class="gantt-month-cell" style="width:' + m.width + 'px;font-size:11px;">' + m.label + '</div>';

  });

  html += '</div>';



  // 日期行

  html += '<div class="gantt-day-header">';

  html += '<div class="gantt-project-name-col" style="height:22px;font-size:10px;color:var(--meta-alt);line-height:22px;">日期</div>';

  for (let d = 0; d < totalDays; d++) {

    const date = new Date(minDate.getTime() + d * 86400000);

    const dayNum = date.getDate();

    const dayOfWeek = date.getDay();

    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const isToday = date.getTime() === today.getTime();

    html += '<div class="gantt-day-col' + (isWeekend ? ' weekend' : '') + (isToday ? ' today' : '') + '" style="width:20px;" title="' + (date.getMonth()+1) + '/' + dayNum + '">' + dayNum + '<br><span style="font-size:7px;">' + ['日','一','二','三','四','五','六'][dayOfWeek] + '</span></div>';

  }

  html += '</div>';



  // 今天竖线

  html += '<div class="gantt-today-line" style="left:' + (projectColWidth + todayOffset) + 'px;top:64px;"><span class="gantt-today-label">今天</span></div>';



  // 项目行

  projects.forEach(proj => {

    html += '<div class="gantt-row">';
    const displayName = proj._displayName || proj.name;
    html += '<div class="gantt-project-name-col" style="font-size:12px;" title="' + esc(displayName) + '">' + esc(displayName.length > 8 ? displayName.substring(0, 7) + '...' : displayName) + '</div>';

    html += '<div class="gantt-bar-area" style="width:' + totalWidth + 'px;">';

    const planData = proj._plan || safeArr(proj.plan);
    planData.forEach(node => {

      if (!node.start) return;

      const startDate = new Date(node.start);

      const endDate = node.end ? new Date(node.end) : new Date(startDate.getTime() + 86400000);

      const left = Math.max(0, Math.round(((startDate - minDate) / 86400000) * DAY_WIDTH));

      const barWidth = Math.max(16, Math.round(((endDate - startDate) / 86400000) * DAY_WIDTH));

      let cls = 'pending';

      if (node.status === '已完成') cls = 'done';

      else if (node.status === '进行中') cls = 'progress';

      else if (endDate < today) cls = 'delayed';

      html += '<div class="gantt-bar ' + cls + '" style="left:' + left + 'px;width:' + barWidth + 'px;" title="' + esc(node.name || '') + '&#10;' + (node.start || '?') + ' → ' + (node.end || '?') + '&#10;状态: ' + (node.status || '待开始') + '">' + esc(node.name || '') + '</div>';

    });



    (proj.milestones || []).forEach(ms => {

      const msStart = ms.start || ms.date;

      const msEnd = ms.end || ms.date;

      if (!msStart && !msEnd) return;

      const s = msStart ? new Date(msStart) : null;

      const e = msEnd ? new Date(msEnd) : null;

      const msLeft = Math.round(Math.max(0, ((s || e) - minDate) / 86400000 * DAY_WIDTH));

      const msWidth = s && e ? Math.max(3, Math.round(((e - s) / 86400000) * DAY_WIDTH)) : 3;

      const isOverdue = e && e < today;

      html += '<div class="gantt-bar" style="left:' + msLeft + 'px;width:' + msWidth + 'px;background:' + esc(ms.color||'#6366F1') + ';opacity:0.75;border-radius:3px;' + (isOverdue ? 'border:2px solid #EF4444;' : '') + '" title="🏁 ' + esc(ms.name) + '&#10;📅 ' + (msStart||'?') + ' → ' + (msEnd||'?') + (ms.description ? '&#10;📝 ' + esc(ms.description) : '') + '">' + esc(ms.name || '') + '</div>';

    });



    html += '</div></div>';

  });



  html += '</div>';

  return html;

}



// ── 年视图 ──

function buildGanttYear(projects, minDate, maxDate, today, projectColWidth) {

  const MONTH_WIDTH = 30;

  const startYear = minDate.getFullYear();

  const startMonth = minDate.getMonth();

  const endYear = maxDate.getFullYear();

  const endMonth = maxDate.getMonth();

  const totalMonths = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;



  // 年份分组

  const yearGroups = [];

  for (let i = 0; i < totalMonths; i++) {

    const y = startYear + Math.floor((startMonth + i) / 12);

    const m = (startMonth + i) % 12;

    if (!yearGroups.length || yearGroups[yearGroups.length-1].year !== y) {

      yearGroups.push({ year: y, months: 0, width: 0 });

    }

    yearGroups[yearGroups.length-1].months++;

    yearGroups[yearGroups.length-1].width += MONTH_WIDTH;

  }



  const totalWidth = totalMonths * MONTH_WIDTH;

  const todayMonthIndex = (today.getFullYear() - startYear) * 12 + (today.getMonth() - startMonth);

  const todayOffset = Math.round(todayMonthIndex * MONTH_WIDTH + MONTH_WIDTH / 2);



  let html = '<div class="gantt-wrapper" style="position:relative;width:' + (projectColWidth + totalWidth) + 'px;">';



  // 年份表头

  html += '<div class="gantt-header-row">';

  html += '<div class="gantt-project-name-col" style="height:28px;font-size:12px;color:var(--meta);">项目 \\ 年份</div>';

  yearGroups.forEach(g => {

    html += '<div class="gantt-month-cell" style="width:' + g.width + 'px;">' + g.year + '年</div>';

  });

  html += '</div>';



  // 月份行

  html += '<div class="gantt-day-header">';

  html += '<div class="gantt-project-name-col" style="height:22px;font-size:10px;color:var(--meta-alt);line-height:22px;">月份</div>';

  for (let i = 0; i < totalMonths; i++) {

    const m = (startMonth + i) % 12;

    const isCurrentMonth = todayMonthIndex === i;

    html += '<div class="gantt-day-col' + (isCurrentMonth ? ' today' : '') + '" style="width:' + MONTH_WIDTH + 'px;font-size:10px;" title="' + (m+1) + '月">' + (m+1) + '月</div>';

  }

  html += '</div>';



  // 今天竖线

  if (todayMonthIndex >= 0 && todayMonthIndex < totalMonths) {

    html += '<div class="gantt-today-line" style="left:' + (projectColWidth + todayOffset) + 'px;top:64px;"><span class="gantt-today-label">本月</span></div>';

  }



  // 项目行

  projects.forEach(proj => {

    html += '<div class="gantt-row">';
    const displayName = proj._displayName || proj.name;
    html += '<div class="gantt-project-name-col" style="font-size:12px;" title="' + esc(displayName) + '">' + esc(displayName.length > 8 ? displayName.substring(0, 7) + '...' : displayName) + '</div>';

    html += '<div class="gantt-bar-area" style="width:' + totalWidth + 'px;">';

    const planData = proj._plan || safeArr(proj.plan);
    planData.forEach(node => {

      if (!node.start) return;

      const startDate = new Date(node.start);

      const endDate = node.end ? new Date(node.end) : new Date(startDate.getTime() + 86400000);

      const startIdx = (startDate.getFullYear() - startYear) * 12 + (startDate.getMonth() - startMonth);

      const endIdx = (endDate.getFullYear() - startYear) * 12 + (endDate.getMonth() - startMonth);

      const left = Math.max(0, startIdx * MONTH_WIDTH + (startDate.getDate() / new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0).getDate()) * MONTH_WIDTH);

      const barWidth = Math.max(4, Math.max(endIdx - startIdx, 0) * MONTH_WIDTH + ((endDate.getDate()) / new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate() - startDate.getDate() / new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0).getDate()) * MONTH_WIDTH);

      let cls = 'pending';

      if (node.status === '已完成') cls = 'done';

      else if (node.status === '进行中') cls = 'progress';

      else if (endDate < today) cls = 'delayed';

      html += '<div class="gantt-bar ' + cls + '" style="left:' + Math.round(left) + 'px;width:' + Math.round(barWidth) + 'px;" title="' + esc(node.name || '') + '&#10;' + (node.start || '?') + ' → ' + (node.end || '?') + '&#10;状态: ' + (node.status || '待开始') + '">' + esc(node.name || '') + '</div>';

    });



    (proj.milestones || []).forEach(ms => {

      if (!ms.date) return;

      const msDate = new Date(ms.date);

      const msIdx = (msDate.getFullYear() - startYear) * 12 + (msDate.getMonth() - startMonth);

      const msLeft = Math.round(msIdx * MONTH_WIDTH + (msDate.getDate() / new Date(msDate.getFullYear(), msDate.getMonth() + 1, 0).getDate()) * MONTH_WIDTH);

      html += '<div class="gantt-ms-marker" style="left:' + msLeft + 'px;border-bottom-color:' + esc(ms.color||'#6366F1') + ';" title="🏁 ' + esc(ms.name) + '&#10;📅 ' + esc(ms.date) + (ms.description ? '&#10;📝 ' + esc(ms.description) : '') + '"></div>';

    });



    html += '</div></div>';

  });



  html += '</div>';

  return html;

}



function refreshGantt() {

  renderGantt();

}



function toggleMeetingExpand(id) {

  DATA.expandedMeeting = DATA.expandedMeeting === id ? null : id;

  renderMeetings();

}



function openMeetingModal(id) {

  const item = id ? DATA.meetings.find(m => m.id === id) || {} : {};

  const isEdit = !!id;

  const projects = DATA.projects || [];

  const projectOpts = projects.map(p =>

    `<option value="${p.id}" ${item.project_id==p.id?'selected':''}>${esc(p.name)}</option>`

  ).join('');

  const actionItems = typeof item.action_items === 'string' ? JSON.parse(item.action_items || '[]') : (item.action_items || []);

  const aiHtml = actionItems.map((ai, i) => `

    <div class="action-item-row" style="display:flex;gap:4px;margin-top:4px;">

      <input id="ai_task_${i}" value="${esc(ai.task||'')}" placeholder="待办事项" style="flex:2;font-size:12px;">

      <input id="ai_assignee_${i}" value="${esc(ai.assignee||'')}" placeholder="负责人" style="flex:1;font-size:12px;">

      <input id="ai_deadline_${i}" value="${esc(ai.deadline||'')}" type="date" style="flex:1;font-size:12px;">

      <button onclick="this.parentElement.remove()" style="background:none;border:none;color:#DC2626;cursor:pointer;font-size:14px;">✕</button>

    </div>`).join('');



  showModal(isEdit ? '编辑会议' : '新建会议', `

    <div class="modal-field"><label>会议标题 *</label><input id="mf_mtitle" value="${esc(item.title||'')}" placeholder="请输入会议标题"></div>

    <div class="modal-field" style="display:flex;gap:8px;">

      <div style="flex:1;"><label>日期</label><input id="mf_mdate" type="date" value="${esc(item.date||'')}"></div>

      <div style="flex:1;"><label>时间</label><input id="mf_mtime" value="${esc(item.time||'')}" placeholder="14:00-15:30"></div>

    </div>

    <div class="modal-field"><label>地点</label><input id="mf_mlocation" value="${esc(item.location||'')}" placeholder="3F 会议室 A 或 腾讯会议"></div>

    <div class="modal-field"><label>参会人员</label><input id="mf_mattendees" value="${esc(item.attendees||'')}" placeholder="多人用逗号分隔，如：张三,李四,王五"></div>

    <div class="modal-field"><label>关联项目</label><select id="mf_mproject">

      <option value="">不关联项目</option>

      ${projectOpts}

    </select></div>

    <div class="modal-field"><label>状态</label><select id="mf_mstatus">

      <option value="待开始" ${(item.status||'')==='待开始'?'selected':''}>待开始</option>

      <option value="进行中" ${item.status==='进行中'?'selected':''}>进行中</option>

      <option value="已完成" ${item.status==='已完成'?'selected':''}>已完成</option>

      <option value="已取消" ${item.status==='已取消'?'selected':''}>已取消</option>

    </select></div>

    <div class="modal-field"><label>会议议程</label><textarea id="mf_magenda" placeholder="1. 议题一&#10;2. 议题二&#10;3. 议题三" style="min-height:80px;">${esc(item.agenda||'')}</textarea></div>

    <div class="modal-field"><label>会议纪要/决议</label><textarea id="mf_mminutes" placeholder="记录会议讨论要点和决议..." style="min-height:80px;">${esc(item.minutes||'')}</textarea></div>

    <div class="modal-field">

      <label style="display:flex;justify-content:space-between;align-items:center;">

        待办事项

        <button onclick="addActionItem()" style="background:none;border:1px solid #6366F1;color:#6366F1;border-radius:4px;cursor:pointer;font-size:11px;padding:2px 8px;">+ 添加</button>

      </label>

      <div id="actionItemsList">${aiHtml || '<div class="action-item-row" style="display:flex;gap:4px;margin-top:4px;"><input id="ai_task_0" placeholder="待办事项" style="flex:2;font-size:12px;"><input id="ai_assignee_0" placeholder="负责人" style="flex:1;font-size:12px;"><input id="ai_deadline_0" type="date" style="flex:1;font-size:12px;"></div>'}</div>

    </div>`,

    `${isEdit ? `<button class="modal-btn danger" onclick="deleteItem('meetings',${id});closeModal()">删除</button>` : ''}

    <button class="modal-btn cancel" onclick="closeModal()">取消</button>

    <button class="modal-btn confirm" onclick="saveMeeting(${id||0})">${isEdit ? '保存' : '创建'}</button>`);

}



function openMeetingQuickTemplate() {

  const projects = DATA.projects || [];

  const projectOpts = projects.map(p =>

    `<option value="${p.id}">${esc(p.name)}</option>`

  ).join('');



  showModal('快捷模板 · 会议记录', `

    <div style="font-size:12px;color:var(--meta);margin-bottom:8px;">选择模板快速生成会议记录框架</div>

    <div class="modal-field"><label>模板类型</label><select id="mf_template" onchange="applyMeetingTemplate()">

      <option value="review">产品评审会</option>

      <option value="sprint">迭代回顾会</option>

      <option value="tech">技术方案讨论</option>

      <option value="weekly">周例会</option>

      <option value="custom">自定义空白</option>

    </select></div>

    <div class="modal-field"><label>会议标题 *</label><input id="mf_mtitle" value="" placeholder="请输入会议标题"></div>

    <div class="modal-field" style="display:flex;gap:8px;">

      <div style="flex:1;"><label>日期</label><input id="mf_mdate" type="date" value="${new Date().toISOString().slice(0,10)}"></div>

      <div style="flex:1;"><label>时间</label><input id="mf_mtime" value="" placeholder="14:00-15:30"></div>

    </div>

    <div class="modal-field"><label>地点</label><input id="mf_mlocation" value="" placeholder="3F 会议室 A"></div>

    <div class="modal-field"><label>参会人员</label><input id="mf_mattendees" value="" placeholder="多人用逗号分隔"></div>

    <div class="modal-field"><label>关联项目</label><select id="mf_mproject">

      <option value="">不关联项目</option>

      ${projectOpts}

    </select></div>

    <div class="modal-field"><label>会议议程</label><textarea id="mf_magenda" placeholder="1. 议题一&#10;2. 议题二&#10;3. 议题三" style="min-height:80px;"></textarea></div>

    <div class="modal-field"><label>会议纪要/决议</label><textarea id="mf_mminutes" placeholder="记录会议讨论要点和决议..." style="min-height:80px;"></textarea></div>

    <div class="modal-field">

      <label style="display:flex;justify-content:space-between;align-items:center;">

        待办事项

        <button onclick="addActionItem()" style="background:none;border:1px solid #6366F1;color:#6366F1;border-radius:4px;cursor:pointer;font-size:11px;padding:2px 8px;">+ 添加</button>

      </label>

      <div id="actionItemsList">

        <div class="action-item-row" style="display:flex;gap:4px;margin-top:4px;"><input id="ai_task_0" placeholder="待办事项" style="flex:2;font-size:12px;"><input id="ai_assignee_0" placeholder="负责人" style="flex:1;font-size:12px;"><input id="ai_deadline_0" type="date" style="flex:1;font-size:12px;"></div>

      </div>

    </div>`,

    `<button class="modal-btn cancel" onclick="closeModal()">取消</button>

    <button class="modal-btn confirm" onclick="saveMeetingFromTemplate()">生成会议记录</button>`);



  // 自动应用第一个模板

  setTimeout(() => applyMeetingTemplate(), 100);

}



function applyMeetingTemplate() {

  const tpl = document.getElementById('mf_template')?.value || 'review';

  const templates = {

    review: {

      agenda: '1. 产品功能回顾与演示\n2. 用户反馈与数据分析\n3. 竞品对比与市场趋势\n4. 下阶段产品规划讨论',

      minutes: '',

      title: '产品评审会',

    },

    sprint: {

      agenda: '1. 本次迭代完成情况回顾\n2. 遇到的问题和解决方案\n3. 团队协作改进建议\n4. 下个迭代计划确认',

      minutes: '',

      title: '迭代回顾会',

    },

    tech: {

      agenda: '1. 当前技术方案介绍\n2. 方案优缺点分析\n3. 技术选型与风险评估\n4. 实施计划与时间节点',

      minutes: '',

      title: '技术方案讨论',

    },

    weekly: {

      agenda: '1. 上周工作回顾\n2. 本周重点工作\n3. 需要协调的事项\n4. 其他事项',

      minutes: '',

      title: '周例会',

    },

    custom: {

      agenda: '',

      minutes: '',

      title: '',

    },

  };

  const t = templates[tpl];

  if (t) {

    const agendaEl = document.getElementById('mf_magenda');

    if (agendaEl) agendaEl.value = t.agenda;

    const titleEl = document.getElementById('mf_mtitle');

    if (titleEl && t.title) titleEl.value = t.title;

  }

}



let actionItemCounter = 0;

function addActionItem() {

  const list = document.getElementById('actionItemsList');

  if (!list) return;

  actionItemCounter++;

  const idx = actionItemCounter;

  const row = document.createElement('div');

  row.className = 'action-item-row';

  row.style.cssText = 'display:flex;gap:4px;margin-top:4px;';

  row.innerHTML = `

    <input id="ai_task_${idx}" placeholder="待办事项" style="flex:2;font-size:12px;">

    <input id="ai_assignee_${idx}" placeholder="负责人" style="flex:1;font-size:12px;">

    <input id="ai_deadline_${idx}" type="date" style="flex:1;font-size:12px;">

    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:#DC2626;cursor:pointer;font-size:14px;">✕</button>`;

  list.appendChild(row);

}



function collectActionItems() {

  const items = [];

  let idx = 0;

  while (true) {

    const taskEl = document.getElementById('ai_task_' + idx);

    if (!taskEl) break;

    const task = taskEl.value.trim();

    if (task) {

      items.push({

        task,

        assignee: (document.getElementById('ai_assignee_' + idx)?.value || '').trim(),

        deadline: (document.getElementById('ai_deadline_' + idx)?.value || '').trim(),

      });

    }

    idx++;

  }

  return items;

}



async function saveMeeting(id) {

  const projectId = document.getElementById('mf_mproject')?.value || '';

  const body = {

    title: document.getElementById('mf_mtitle').value.trim(),

    date: document.getElementById('mf_mdate').value,

    time: document.getElementById('mf_mtime').value.trim(),

    location: document.getElementById('mf_mlocation').value.trim(),

    attendees: document.getElementById('mf_mattendees').value.trim(),

    agenda: document.getElementById('mf_magenda').value.trim(),

    minutes: document.getElementById('mf_mminutes').value.trim(),

    action_items: collectActionItems(),

    status: document.getElementById('mf_mstatus').value,

    project_id: projectId ? parseInt(projectId) : null,

  };

  if (!body.title) { showToast('请输入会议标题'); return; }

  const res = id ? await PUT(`/api/meetings/${id}`, body) : await POST('/api/meetings', body);

  if (res.code === 200) { await fetchAllData(); renderAll(); closeModal(); showToast(id ? '已更新' : '已创建'); }

  else showToast(res.message || '操作失败');

}



async function saveMeetingFromTemplate() {

  const projectId = document.getElementById('mf_mproject')?.value || '';

  const body = {

    title: document.getElementById('mf_mtitle').value.trim(),

    date: document.getElementById('mf_mdate').value,

    time: document.getElementById('mf_mtime').value.trim(),

    location: document.getElementById('mf_mlocation').value.trim(),

    attendees: document.getElementById('mf_mattendees').value.trim(),

    agenda: document.getElementById('mf_magenda').value.trim(),

    minutes: document.getElementById('mf_mminutes').value.trim(),

    action_items: collectActionItems(),

    status: '待开始',

    project_id: projectId ? parseInt(projectId) : null,

  };

  if (!body.title) { showToast('请输入会议标题'); return; }

  const res = await POST('/api/meetings', body);

  if (res.code === 200) { await fetchAllData(); renderAll(); closeModal(); showToast('会议记录已生成'); }

  else showToast(res.message || '操作失败');

}



// ╔══════════════════════════════════════════════════════════════╗

// ║  语音录入 & 智能纪要生成                                         ║

// ╚══════════════════════════════════════════════════════════════╝



let voiceMediaRecorder = null;  // MediaRecorder 实例（替代 Web Speech API，国内可用）

let voiceAudioChunks = [];      // 录音数据块

let voiceIsRecording = false;

let voiceIsPaused = false;

let voiceTranscript = '';

let voiceInterimTranscript = '';

let voiceWaveTimer = null;



function openVoiceModal(meetingId) {

  voiceIsRecording = false;

  voiceIsPaused = false;

  voiceTranscript = '';

  voiceInterimTranscript = '';



  const projects = DATA.projects || [];

  const projectOpts = projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');



  // 如果传入了 meetingId，则预加载该会议信息

  let prefill = {};

  if (meetingId) {

    const m = DATA.meetings.find(x => x.id === meetingId);

    if (m) prefill = m;

  }



  // 创建自定义模态窗口（不使用 showModal，需要更灵活的布局）

  const overlay = document.getElementById('modalOverlay');

  overlay.innerHTML = `<div class="voice-modal" id="voiceModal">

    <div class="voice-sheet">

      <div class="voice-handle"></div>

      <div class="voice-title">🎤 AI 语音录入</div>

      <div class="voice-status" id="voiceStatus">点击下方按钮开始录制会议</div>



      <div class="voice-wave" id="voiceWave">

        ${Array(7).fill('<div class="voice-wave-bar" style="height:8px;"></div>').join('')}

      </div>



      <div class="voice-controls">

        <button class="voice-btn record" id="voiceRecordBtn" onclick="startVoiceRecording()" title="开始录音">▶</button>

        <button class="voice-btn pause" id="voicePauseBtn" onclick="togglePauseRecording()" disabled title="暂停/继续">⏯</button>

        <button class="voice-btn stop" id="voiceStopBtn" onclick="stopVoiceRecording()" disabled title="停止录音">⏹</button>

      </div>



      <textarea class="voice-transcript-area" id="voiceTranscriptArea" placeholder="点击录音按钮开始，停止后将自动转录为文字..." readonly></textarea>



      <div id="voiceResultArea"></div>



      <div class="modal-field" style="margin-top:8px;"><label>会议标题</label>

        <input id="voiceMeetingTitle" value="${esc(prefill.title||'')}" placeholder="请输入会议标题">

      </div>



      <div class="modal-field" style="margin-top:8px;"><label>关联项目</label>

        <select id="voiceMeetingProject">

          <option value="">不关联项目</option>

          ${projects.map(p => `<option value="${p.id}" ${prefill.project_id==p.id?'selected':''}>${esc(p.name)}</option>`).join('')}

        </select>

      </div>



      <div class="voice-info" id="voiceInfo">

        💡 <b>提示：</b>点击录音按钮开始录制，说完后点击停止按钮，AI 将<b>自动转录语音并生成结构化会议记录</b>（包含讨论要点、决议、待办事项等）。需要 <b>HTTPS 安全连接</b> 和 <b>麦克风权限</b>。

      </div>



      <div class="voice-actions">

        <button class="va-secondary" onclick="closeVoiceModal()">关闭</button>

        <button class="va-primary" id="voiceSummarizeBtn" onclick="generateVoiceSummary()" disabled>🔄 重新生成</button>

        <button class="va-success" id="voiceSaveBtn" onclick="saveVoiceMeeting()" disabled>💾 保存会议</button>

      </div>

    </div>

  </div>`;

  overlay.classList.add('show');



  // 点击遮罩关闭

  document.getElementById('voiceModal').addEventListener('click', function(e) {

    if (e.target === this) { if (!voiceIsRecording) closeVoiceModal(); }

  });

}



function closeVoiceModal() {

  stopVoiceRecording();

  const overlay = document.getElementById('modalOverlay');

  overlay.innerHTML = overlay.getAttribute('data-original') || '';

  overlay.classList.remove('show');

}



// 保存原始 modal 内容

(function() {

  const overlay = document.getElementById('modalOverlay');

  overlay.setAttribute('data-original', overlay.innerHTML);

})();



// 更新语音状态栏的诊断消息

function updateVoiceStatusMessage(type) {

  const statusEl = document.getElementById('voiceStatus');

  if (!statusEl) return;

  statusEl.style.color = '';

  const messages = {

    'recording': '<span class="voice-recording-dot"></span>正在录音... 请说话',

    'transcribing': '🤖 <b>AI 正在转录语音</b>，请稍候...',

    'done': '✅ <b>转录完成</b>，正在自动生成会议记录...',

    'summarizing': '📝 <b>正在分析内容</b>，生成结构化会议记录...',

    'summarized': '✅ <b>会议记录已自动生成</b>，确认后可保存',

    'error': '❌ <b>转录失败</b>，请检查网络后重试',

    'idle': '点击录音按钮开始录制',

  };

  statusEl.innerHTML = messages[type] || messages['recording'];

  if (type === 'error') {

    statusEl.style.color = '#DC2626';

  }

}



async function startVoiceRecording() {

  // ── 检查支持 ──

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {

    showToast('当前浏览器不支持录音，请使用 Chrome 或 Edge');

    return;

  }



  // ── 安全检查：确保在安全上下文（HTTPS 或 localhost） ──

  const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  if (!isSecure) {

    showToast('⚠️ 语音识别需要 HTTPS 安全连接，当前为 HTTP。请使用 HTTPS 访问本页面。', 6000);

    const statusEl = document.getElementById('voiceStatus');

    if (statusEl) {

      statusEl.innerHTML = '❌ <b>当前页面非 HTTPS 安全连接</b>，语音识别 API 被浏览器禁用。<br>请联系管理员配置 HTTPS 访问。';

      statusEl.className = 'voice-status';

      statusEl.style.color = '#DC2626';

    }

    return;

  }



  // ── 检查 MediaRecorder 支持 ──

  if (!window.MediaRecorder) {

    showToast('当前浏览器不支持录音功能，请使用 Chrome 或 Edge');

    return;

  }



  // ── 获取麦克风权限并启动录音 ──

  try {

    // ── 高质量录音设置：16kHz 单声道 + 降噪 + 回声消除 ──

    const stream = await navigator.mediaDevices.getUserMedia({

      audio: {

        sampleRate: { ideal: 16000 },

        channelCount: { ideal: 1 },

        echoCancellation: true,

        noiseSuppression: true,

        autoGainControl: true

      }

    });

    voiceAudioChunks = [];

    

    // 优先使用 webm/opus 格式（兼容性好），回退到默认格式

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')

      ? 'audio/webm;codecs=opus'

      : MediaRecorder.isTypeSupported('audio/webm')

        ? 'audio/webm'

        : '';

    

    voiceMediaRecorder = new MediaRecorder(stream, {

      ...(mimeType ? { mimeType } : {}),

      audioBitsPerSecond: 128000  // 128kbps = 语音转录高保真码率

    });

    

    voiceMediaRecorder.ondataavailable = (e) => {

      if (e.data.size > 0) voiceAudioChunks.push(e.data);

    };

    

    voiceMediaRecorder.onstop = async () => {

      // 释放麦克风

      stream.getTracks().forEach(t => t.stop());

      

      if (voiceAudioChunks.length === 0) {

        setVoiceUIState('stopped');

        updateVoiceStatusMessage('idle');

        return;

      }

      

      // 合并音频块 → base64

      const audioBlob = new Blob(voiceAudioChunks, { type: mimeType || 'audio/webm' });

      const reader = new FileReader();

      reader.onloadend = async () => {

        const base64 = reader.result.split(',')[1];  // 去掉 data:xxx;base64, 前缀

        await transcribeVoice(base64);

      };

      reader.readAsDataURL(audioBlob);

    };



    voiceMediaRecorder.start(1000);  // 每秒收集一个数据块

    voiceIsRecording = true;

    voiceIsPaused = false;

    voiceAudioChunks = [];

    setVoiceUIState('recording');

    updateVoiceStatusMessage('recording');

    startWaveAnimation();

    showToast('🎤 正在录音，请对着麦克风说话...');

    

    // 实时更新录音时长

    const area = document.getElementById('voiceTranscriptArea');

    if (area) area.value = '[🎙️ 正在录音...]\n';

    

  } catch (micErr) {

    console.error('麦克风权限检查失败:', micErr);

    if (micErr.name === 'NotAllowedError' || micErr.name === 'PermissionDeniedError') {

      showToast('麦克风权限被拒绝，请在浏览器地址栏左侧点击锁图标，允许麦克风访问');

      const statusEl = document.getElementById('voiceStatus');

      if (statusEl) {

        statusEl.innerHTML = '🔒 <b>麦克风权限被拒绝</b><br>请点击浏览器地址栏左侧图标，开启麦克风权限后重试。';

        statusEl.className = 'voice-status';

        statusEl.style.color = '#DC2626';

      }

    } else if (micErr.name === 'NotFoundError') {

      showToast('未检测到麦克风设备，请检查麦克风连接');

    } else {

      showToast('启动录音失败：' + (micErr.message || '未知错误'));

    }

  }

}



// ── 服务端语音转录 ──

async function transcribeVoice(base64Audio) {

  setVoiceUIState('transcribing');

  updateVoiceStatusMessage('transcribing');

  const area = document.getElementById('voiceTranscriptArea');

  if (area) area.value = '[🤖 正在转录语音...]\n';

  

  try {

    const res = await POST('/api/meetings/transcribe', { audio: base64Audio });

    if (res.code === 200 && res.text) {

      voiceTranscript = res.text;

      voiceInterimTranscript = '';

      updateVoiceTranscriptDisplay();

      updateVoiceStatusMessage('done');

      showToast('✅ 语音转录完成');



      // ── 自动生成会议记录（无需手动点击） ──

      const autoTitle = document.getElementById('voiceMeetingTitle');

      if (autoTitle && !autoTitle.value.trim()) {

        // 自动填充标题：语音会议 + 日期时间

        const now = new Date();

        autoTitle.value = `语音会议 ${now.toLocaleDateString('zh-CN')} ${now.toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'})}`;

      }

      updateVoiceStatusMessage('summarizing');

      if (area) area.value += '\n[🤖 正在自动生成会议记录...]\n';

      await generateVoiceSummary(true);  // true = 自动模式，不重复弹 toast

    } else {

      voiceTranscript = '';

      updateVoiceTranscriptDisplay();

      updateVoiceStatusMessage('error');

      showToast('转录失败: ' + (res.message || '未知错误'));

    }

  } catch (e) {

    console.error('转录错误:', e);

    voiceTranscript = '';

    updateVoiceTranscriptDisplay();

    updateVoiceStatusMessage('error');

    showToast('转录请求失败，请检查网络连接');

  } finally {

    setVoiceUIState('stopped');

    stopWaveAnimation();

  }

}



function togglePauseRecording() {

  if (!voiceMediaRecorder) return;

  if (voiceIsPaused) {

    // 恢复

    voiceMediaRecorder.resume();

    voiceIsPaused = false;

    setVoiceUIState('recording');

    startWaveAnimation();

    showToast('▶ 已继续录音');

  } else {

    // 暂停

    voiceMediaRecorder.pause();

    voiceIsPaused = true;

    setVoiceUIState('paused');

    stopWaveAnimation();

    showToast('⏸ 已暂停录音');

  }

}



function stopVoiceRecording() {

  if (voiceMediaRecorder && voiceMediaRecorder.state !== 'inactive') {

    voiceMediaRecorder.stop();

  }

  voiceIsRecording = false;

  voiceIsPaused = false;

  stopWaveAnimation();

  // setVoiceUIState 和更新在 mediaRecorder.onstop 中处理

}



function setVoiceUIState(state) {

  const statusEl = document.getElementById('voiceStatus');

  const recordBtn = document.getElementById('voiceRecordBtn');

  const pauseBtn = document.getElementById('voicePauseBtn');

  const stopBtn = document.getElementById('voiceStopBtn');

  const summarizeBtn = document.getElementById('voiceSummarizeBtn');

  const saveBtn = document.getElementById('voiceSaveBtn');

  const transcriptArea = document.getElementById('voiceTranscriptArea');

  const waveBars = document.querySelectorAll('.voice-wave-bar');



  if (!statusEl) return;



  switch (state) {

    case 'recording':

      statusEl.innerHTML = '<span class="voice-recording-dot"></span>正在录音... 请说话';

      statusEl.className = 'voice-status recording';

      if (recordBtn) recordBtn.disabled = true;

      if (pauseBtn) { pauseBtn.disabled = false; pauseBtn.textContent = '⏸'; }

      if (stopBtn) stopBtn.disabled = false;

      if (transcriptArea) transcriptArea.readOnly = true;

      waveBars.forEach(b => b.classList.add('active'));

      break;

    case 'paused':

      statusEl.innerHTML = '⏸ 已暂停';

      statusEl.className = 'voice-status';

      if (recordBtn) recordBtn.disabled = true;

      if (pauseBtn) { pauseBtn.disabled = false; pauseBtn.textContent = '▶'; }

      if (stopBtn) stopBtn.disabled = false;

      waveBars.forEach(b => b.classList.remove('active'));

      break;

    case 'stopped':

      statusEl.innerHTML = voiceTranscript.trim() ? '✅ 录音完成，可编辑转录文本' : '点击录音按钮开始录制';

      statusEl.className = 'voice-status';

      if (recordBtn) recordBtn.disabled = false;

      if (pauseBtn) { pauseBtn.disabled = true; pauseBtn.textContent = '⏯'; }

      if (stopBtn) stopBtn.disabled = true;

      if (transcriptArea) transcriptArea.readOnly = false;

      if (summarizeBtn) summarizeBtn.disabled = !voiceTranscript.trim();

      if (saveBtn) saveBtn.disabled = !voiceTranscript.trim();

      waveBars.forEach(b => { b.classList.remove('active'); b.style.height = '8px'; });

      break;

    case 'transcribing':

      statusEl.innerHTML = '🤖 正在转录语音，请稍候...';

      statusEl.className = 'voice-status';

      if (recordBtn) recordBtn.disabled = true;

      if (pauseBtn) { pauseBtn.disabled = true; pauseBtn.textContent = '⏯'; }

      if (stopBtn) stopBtn.disabled = true;

      if (transcriptArea) transcriptArea.readOnly = true;

      waveBars.forEach(b => { b.classList.remove('active'); b.style.height = '8px'; });

      break;

  }

}



function updateVoiceTranscriptDisplay() {

  const area = document.getElementById('voiceTranscriptArea');

  if (area) {

    let display = voiceTranscript;

    if (voiceInterimTranscript) {

      display += (voiceTranscript ? '\n' : '') + '[识别中...] ' + voiceInterimTranscript;

    }

    area.value = display;

    area.scrollTop = area.scrollHeight;

  }

}



function startWaveAnimation() {

  stopWaveAnimation();

  const bars = document.querySelectorAll('.voice-wave-bar');

  voiceWaveTimer = setInterval(() => {

    bars.forEach(bar => {

      if (voiceIsRecording && !voiceIsPaused) {

        const h = 6 + Math.random() * 36;

        bar.style.height = h + 'px';

      }

    });

  }, 120);

}



function stopWaveAnimation() {

  if (voiceWaveTimer) { clearInterval(voiceWaveTimer); voiceWaveTimer = null; }

}



async function generateVoiceSummary(isAuto = false) {

  const transcript = voiceTranscript.trim();

  if (!transcript) {

    if (!isAuto) showToast('没有录音内容可总结');

    return;

  }



  const summarizeBtn = document.getElementById('voiceSummarizeBtn');

  if (summarizeBtn) { summarizeBtn.disabled = true; summarizeBtn.textContent = '⏳ 正在生成...'; }



  try {

    // 创建临时会议记录来保存转录并获取摘要

    const title = document.getElementById('voiceMeetingTitle')?.value?.trim() || '语音会议记录';

    const projectId = document.getElementById('voiceMeetingProject')?.value || '';

    const createRes = await POST('/api/meetings', {

      title,

      date: new Date().toISOString().slice(0, 10),

      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),

      location: '',

      attendees: '',

      agenda: '',

      minutes: '',

      transcript: transcript,

      status: '进行中',

      project_id: projectId ? parseInt(projectId) : null,

    });



    if (createRes.code !== 200) {

      if (!isAuto) showToast('创建会议失败: ' + (createRes.message || ''));

      if (summarizeBtn) { summarizeBtn.disabled = false; summarizeBtn.textContent = '🔄 重新生成'; }

      return;

    }



    const meetingId = createRes.data.id;



    // 调用 AI 摘要

    const summaryRes = await POST(`/api/meetings/${meetingId}/summarize`, { transcript });

    if (summaryRes.code === 200) {

      const meeting = summaryRes.data;

      const actionItems = meeting.action_items || [];



      // 显示 AI 生成的摘要

      const resultArea = document.getElementById('voiceResultArea');

      if (resultArea) {

        let html = '<div class="voice-result-minutes">';

        html += '<div style="font-weight:700;font-size:14px;margin-bottom:8px;">🤖 AI 自动生成会议记录</div>';

        html += (meeting.minutes || '无内容').replace(/\n/g, '<br>').replace(/###/g, '<b>').replace(/##/g, '<b style="font-size:15px;">');

        html += '</div>';

        resultArea.innerHTML = html;

      }



      // 更新 - 现在可以保存了

      const saveBtn = document.getElementById('voiceSaveBtn');

      if (saveBtn) { saveBtn.disabled = false; saveBtn.setAttribute('data-meeting-id', meetingId); }

      if (summarizeBtn) { summarizeBtn.disabled = false; summarizeBtn.textContent = '🔄 重新生成'; }



      updateVoiceStatusMessage('summarized');

      if (!isAuto) showToast('✅ AI 纪要已生成！');

      await fetchAllData();

    } else {

      if (!isAuto) showToast('AI 摘要生成失败: ' + (summaryRes.message || ''));

      if (summarizeBtn) { summarizeBtn.disabled = !voiceTranscript.trim(); summarizeBtn.textContent = '🔄 重新生成'; }

    }

  } catch(e) {

    console.error('生成摘要错误:', e);

    if (!isAuto) showToast('生成摘要时出错');

  }

}



async function saveVoiceMeeting() {

  const saveBtn = document.getElementById('voiceSaveBtn');

  const meetingId = saveBtn ? parseInt(saveBtn.getAttribute('data-meeting-id')) : 0;



  if (!meetingId) {

    showToast('请先生成会议纪要');

    return;

  }



  const title = document.getElementById('voiceMeetingTitle')?.value?.trim();

  if (!title) { showToast('请输入会议标题'); return; }



  const projectId = document.getElementById('voiceMeetingProject')?.value || '';



  // 更新标题和关联项目

  const updateBody = { title };

  if (projectId) updateBody.project_id = parseInt(projectId);

  await PUT(`/api/meetings/${meetingId}`, updateBody);



  // 清理 DATA 缓存并刷新

  await fetchAllData();

  renderAll();

  closeVoiceModal();

  showToast('✅ 会议记录已保存！');

}



// ╔══════════════════════════════════════════════════════════════╗

// ║  导航 & 缩放                                                  ║

// ╚══════════════════════════════════════════════════════════════╝



function updateScale() {

  const c = document.getElementById('scaleContainer');

  // Desktop (>= 769px): no scaling, CSS handles full-screen

  if (window.innerWidth >= 769) {

    c.style.transform = '';

    c.style.left = '';

    c.style.top = '';

    return;

  }

  const scale = Math.min(window.innerWidth / 390, window.innerHeight / 844);

  c.style.transform = `scale(${scale})`;

  c.style.left = (window.innerWidth - 390 * scale) / 2 + 'px';

  c.style.top  = (window.innerHeight - 844 * scale) / 2 + 'px';

}

window.addEventListener('resize', updateScale);

updateScale();



function switchTab(index) {

  if (currentTab === index) return;

  currentTab = index;

  document.querySelectorAll('#appWrapper .screen').forEach(s => s.classList.remove('active'));

  const screens = document.querySelectorAll('#appWrapper .screen');

  if (screens[index]) screens[index].classList.add('active');

  document.querySelectorAll('.tab-pill').forEach(pill => {

    pill.querySelectorAll('.tab-item').forEach((item, i) => item.classList.toggle('active', i === index));

  });

  const scrollId = ['scroll1','scroll2','scroll3','scroll4','chatMessages','scroll6'][index];

  const el = document.getElementById(scrollId);

  if (el) el.scrollTop = 0;

  // 切换到聊天 tab 时刷新会话列表和角标

  if (index === 4) { renderS5(); dismissBanner(); }

  // 非聊天 tab 时请求通知权限

  if (index !== 4 && !NOTIFY.enabled) { requestNotifyPermission(); }

}

function switchTo(idx) {

  if (currentTab === idx) return;

  const prevIdx = currentTab;

  switchTab(idx);

  // 滑动动画

  const nextScreen = document.getElementById('screen' + (idx + 1));

  if (nextScreen) {

    if (idx > prevIdx) nextScreen.classList.add('slide-in-right');

    else nextScreen.classList.add('slide-in-left');

    setTimeout(() => nextScreen.classList.remove('slide-in-left', 'slide-in-right'), 300);

  }

}



document.addEventListener('keydown', e => {

  if (!document.getElementById('modalOverlay').classList.contains('show') && document.getElementById('loginScreen').classList.contains('hidden')) {

    let idx = currentTab;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') idx = (idx + 1) % 6;

    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') idx = (idx - 1 + 6) % 6;

    else return;

    switchTab(idx);

  }

});



let touchStartX = 0;

document.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; });

document.addEventListener('touchend', e => {

  if (document.getElementById('modalOverlay').classList.contains('show')) return;

  const diff = e.changedTouches[0].clientX - touchStartX;

  if (Math.abs(diff) < 50) return;

  switchTab((diff < 0 ? currentTab + 1 : currentTab - 1 + 6) % 6);

});



// ╔══════════════════════════════════════════════════════════════╗

// ║  启动                                                         ║

// ╚══════════════════════════════════════════════════════════════╝



(async function init() {

  const token = getToken();

  if (token) {

    try {

      const res = await GET('/api/auth/me');

      if (res.code === 200) {

        CURRENT_USER = res.user;

        await afterLogin();

        return;

      }

    } catch(e) {}

    clearToken();

  }

  // 未登录 — 确保登录页可见

  document.getElementById('loginScreen').classList.remove('hidden');

  setTimeout(() => document.getElementById('loginUser').focus(), 100);

})();

