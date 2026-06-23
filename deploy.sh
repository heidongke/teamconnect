#!/bin/bash
# ╔══════════════════════════════════════════════════════════════╗
# ║  TeamConnect 一键部署脚本                                     ║
# ╚══════════════════════════════════════════════════════════════╝

set -e

echo "========================================="
echo "  TeamConnect Server - 部署脚本"
echo "========================================="
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] 未检测到 Node.js，请先安装 Node.js 18+"
    exit 1
fi
echo "[OK] Node.js $(node -v)"

# 检查 .env 文件
if [ ! -f .env ]; then
    echo ""
    echo "[WARN] 未找到 .env 文件，正在从 .env.example 复制..."
    cp .env.example .env
    echo "[WARN] 请编辑 .env 文件，填写腾讯云 SMS 凭证等配置！"
    echo "  必填字段："
    echo "    - TENCENT_SECRET_ID"
    echo "    - TENCENT_SECRET_KEY"
    echo "    - TENCENT_SMS_SDK_APP_ID"
    echo "    - TENCENT_SMS_VERIFY_TEMPLATE_ID"
    echo "    - JWT_SECRET"
    echo ""
    read -p "是否现在编辑？（y/n）: " choice
    if [ "$choice" = "y" ]; then
        nano .env
    fi
fi

# 安装依赖
echo ""
echo "[STEP 1/3] 安装依赖..."
npm install --production
echo "[OK] 依赖安装完成"

# 初始化数据库
echo ""
echo "[STEP 2/3] 初始化数据库..."
node src/db/init.js
echo "[OK] 数据库初始化完成"

# 启动服务
echo ""
echo "[STEP 3/3] 启动服务..."

# 检查 PM2
if command -v pm2 &> /dev/null; then
    # 停掉旧进程（如果存在）
    pm2 delete teamconnect-server 2>/dev/null || true
    pm2 start src/app.js --name teamconnect-server
    pm2 save
    echo "[OK] 服务已通过 PM2 启动"
    echo ""
    echo "常用命令："
    echo "  pm2 status                  - 查看状态"
    echo "  pm2 logs teamconnect-server - 查看日志"
    echo "  pm2 restart teamconnect-server - 重启"
else
    echo "[INFO] 未安装 PM2，正在后台启动..."
    nohup node src/app.js > server.log 2>&1 &
    echo "[OK] 服务已在后台启动 (PID: $!)"
    echo "[INFO] 建议安装 PM2: npm install -g pm2"
fi

echo ""
echo "========================================="
echo "  部署完成！"
echo "  访问地址: http://localhost:3000"
echo "  默认管理员: admin / 见 .env 配置"
echo "========================================="
