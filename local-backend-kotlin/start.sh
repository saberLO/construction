#!/bin/bash
# 启动前必须设置 SSH_PASSWORD 环境变量
if [ -z "$SSH_PASSWORD" ]; then
    echo "[错误] 请先设置环境变量 SSH_PASSWORD"
    echo "示例: export SSH_PASSWORD=your_password"
    exit 1
fi
./gradlew bootRun
