@echo off
REM 启动前必须设置 SSH_PASSWORD 环境变量
REM 示例：set SSH_PASSWORD=your_password_here

if "%SSH_PASSWORD%"=="" (
    echo [错误] 请先设置环境变量 SSH_PASSWORD
    echo 示例: set SSH_PASSWORD=your_password
    exit /b 1
)

gradlew.bat bootRun
