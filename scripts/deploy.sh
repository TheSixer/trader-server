#!/bin/bash

# 设置环境变量
export NODE_ENV=production

# 更新代码
git pull origin main

# 安装依赖
npm install --production

# 创建必要的目录
mkdir -p logs
mkdir -p public/uploads

# 设置权限
chmod 755 public/uploads

# 重启 PM2
pm2 reload ecosystem.config.js --env production

# 输出状态
pm2 status 