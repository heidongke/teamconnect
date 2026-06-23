# TeamConnect 服务器部署指南

## 一、服务器要求

| 项目 | 最低配置 | 推荐配置 |
|------|----------|----------|
| 操作系统 | Ubuntu 20.04 / CentOS 8+ | Ubuntu 22.04 LTS |
| CPU | 1 核 | 2 核 |
| 内存 | 1 GB | 2 GB |
| 磁盘 | 20 GB | 40 GB |
| Node.js | v18+ | v22 LTS |

---

## 二、腾讯云 CVM / 轻量应用服务器购买

1. 打开 [腾讯云轻量应用服务器](https://cloud.tencent.com/product/lighthouse)
2. 选择 **宝塔 Linux 面板 镜像**或 **Ubuntu 22.04** 镜像
3. 最低配置：2核2G，40GB SSD
4. 购买后进入控制台 → 防火墙 → 添加规则：
   - 端口 **3000** (Node.js 服务，可选是否对外暴露)
   - 端口 **80** (HTTP)
   - 端口 **443** (HTTPS)
   - 端口 **22** (SSH)

---

## 三、本地文件传输到服务器

### 方式一：SCP 上传

```bash
# 在本地（你的电脑）执行，将 teamconnect-server-2 目录上传到服务器
scp -r ./teamconnect-server-2 ubuntu@<服务器IP>:/home/ubuntu/teamconnect-server
```

### 方式二：使用宝塔面板上传

1. 浏览器打开 `http://<服务器IP>:8888`
2. 使用宝塔面板的「文件管理」上传压缩包
3. 在服务器上解压

---

## 四、服务器环境配置

SSH 登录到服务器，执行以下步骤：

### 4.1 安装 Node.js

```bash
# 使用 NodeSource 安装 Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证安装
node -v   # 应输出 v22.x.x
npm -v    # 应输出 10.x.x
```

### 4.2 安装 PM2（进程管理器）

```bash
sudo npm install -g pm2

# 设置 PM2 开机自启
pm2 startup systemd
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

### 4.3 安装依赖

```bash
cd /home/ubuntu/teamconnect-server
npm install --production
```

### 4.4 配置 .env

```bash
# 复制模板
cp .env.example .env

# 编辑 .env 文件
nano .env
```

需要填写的关键配置：

```env
# ════════════════════════════════════════════════
# 必填：腾讯云 SMS 短信服务
# ════════════════════════════════════════════════
TENCENT_SECRET_ID=你的SecretId
TENCENT_SECRET_KEY=你的SecretKey
TENCENT_SMS_SDK_APP_ID=你的SDKAppId
TENCENT_SMS_SIGN_NAME=TeamConnect
TENCENT_SMS_VERIFY_TEMPLATE_ID=你的模板ID

# ════════════════════════════════════════════════
# 必填：安全密钥（请随机生成一段长字符串）
# ════════════════════════════════════════════════
JWT_SECRET=请替换为至少32位的随机字符串

# ════════════════════════════════════════════════
# 可选：修改管理员初始密码
# ════════════════════════════════════════════════
ADMIN_INITIAL_USERNAME=admin
ADMIN_INITIAL_PASSWORD=请修改为强密码
```

> **腾讯云凭证获取方式**：
> - 登录 [腾讯云控制台](https://console.cloud.tencent.com) → 访问管理 → API密钥管理
> - 短信控制台 → 应用管理 → 获取 SDKAppId
> - 短信控制台 → 国内短信 → 签名管理 / 正文模板管理 → 获取签名和模板ID

### 4.5 初始化数据库

```bash
node src/db/init.js
```

### 4.6 启动服务

```bash
# 开发模式（控制台看日志）
node src/app.js

# 生产模式（PM2 后台运行）
pm2 start src/app.js --name teamconnect-server

# 保存 PM2 进程列表
pm2 save
```

---

## 五、配置 Nginx 反向代理

### 5.1 安装 Nginx

```bash
sudo apt-get install -y nginx
```

### 5.2 创建配置文件

```bash
sudo nano /etc/nginx/sites-available/teamconnect
```

写入以下内容：

```nginx
server {
    listen 80;
    server_name <你的域名或服务器IP>;

    # 日志
    access_log /var/log/nginx/teamconnect-access.log;
    error_log  /var/log/nginx/teamconnect-error.log;

    # 代理到 Node.js 服务
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 5.3 启用站点

```bash
sudo ln -s /etc/nginx/sites-available/teamconnect /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default   # 删除默认站点（可选）
sudo nginx -t   # 测试配置
sudo systemctl reload nginx
```

---

## 六、配置 HTTPS（SSL 证书）

### 方式一：使用腾讯云免费 SSL 证书

1. [腾讯云 SSL 证书控制台](https://console.cloud.tencent.com/ssl)
2. 申请免费 TrustAsia 单域名证书
3. 下载 Nginx 格式证书
4. 上传到服务器 `/etc/nginx/ssl/`

### 方式二：使用 Let's Encrypt / Certbot

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <你的域名>
```

### Nginx HTTPS 配置

在 `/etc/nginx/sites-available/teamconnect` 中添加：

```nginx
server {
    listen 443 ssl http2;
    server_name <你的域名>;

    ssl_certificate     /etc/nginx/ssl/your_domain.crt;
    ssl_certificate_key /etc/nginx/ssl/your_domain.key;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_cache_bypass $http_upgrade;
    }
}

# HTTP 自动跳转 HTTPS
server {
    listen 80;
    server_name <你的域名>;
    return 301 https://$server_name$request_uri;
}
```

---

## 七、防火墙配置

```bash
# 如果使用的是轻量应用服务器，在腾讯云控制台防火墙页面操作
# 如果使用的是 CVM，还需要配置安全组规则

# 如果是 Ubuntu 系统，还需检查 UFW
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw enable
```

---

## 八、日常维护命令

```bash
# 查看服务状态
pm2 status

# 查看日志（最近50行）
pm2 logs teamconnect-server --lines 50

# 重启服务
pm2 restart teamconnect-server

# 停止服务
pm2 stop teamconnect-server

# 更新代码后重新部署
cd /home/ubuntu/teamconnect-server
git pull                  # 如果用 Git 管理
npm install --production  # 如果有新依赖
pm2 restart teamconnect-server

# 查看系统资源占用
pm2 monit
```

---

## 九、数据备份

```bash
# 数据存储在 data/ 目录（JSON 文件）
# 建议定期备份

# 创建备份脚本
nano /home/ubuntu/backup.sh
```

备份脚本内容：

```bash
#!/bin/bash
BACKUP_DIR="/home/ubuntu/backups"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR
cp -r /home/ubuntu/teamconnect-server/data $BACKUP_DIR/data_$DATE
echo "Backup completed: $DATE"
```

```bash
chmod +x /home/ubuntu/backup.sh

# 添加到 crontab 每天凌晨3点自动备份
crontab -e
# 添加: 0 3 * * * /home/ubuntu/backup.sh
```

---

## 十、完成后验证

1. 浏览器访问 `http://<服务器IP>` 或 `https://<域名>`，应看到 TeamConnect 登录页面
2. 使用默认管理员账号登录：用户名 `admin`，密码见 `.env` 中的 `ADMIN_INITIAL_PASSWORD`
3. 登录后应看到信息广场、工作交接、团队活动等页面，以及「我的」个人中心
4. 测试手机号注册/登录：在腾讯云 SMS 配置正确后，输入手机号应能收到验证码

---

## 常见问题

| 问题 | 解决方案 |
|------|----------|
| 无法访问 3000 端口 | 检查防火墙/安全组是否放行 |
| 短信发送失败 | 检查 `.env` 中的 SecretId/SecretKey/SDKAppId/签名/模板ID 是否正确 |
| PM2 启动后进程崩溃 | `pm2 logs teamconnect-server` 查看错误日志 |
| 数据库被意外清空 | 重新运行 `node src/db/init.js` 重建 |
| Nginx 502 错误 | 确认 Node.js 服务在运行：`pm2 status` |

---

> **部署完成后，建议修改管理员默认密码，并配置好 SSL 证书以保证数据安全。**
