# Construction 3D 从零部署文档

本文档用于把当前仓库中的前端 `construction-3d` 和 Kotlin 后端 `local-backend-kotlin` 交给其他人，从零部署到一台 Web 服务器和一台远端 GPU 训练服务器上。

## 1. 架构说明

当前系统分为 3 个部分：

1. 前端：`construction-3d`
   - React + Vite
   - 提供任务提交、任务列表、模型查看、格式转换等页面

2. Web 后端：`local-backend-kotlin`
   - Spring Boot + Kotlin
   - 对外提供 `/api/*` 和 `/models/*`
   - 负责接收上传、记录任务、通过 SSH 调用远端训练机执行 COLMAP + 3DGS

3. 远端训练机
   - 需要能通过 SSH 登录
   - 需要安装 `COLMAP`
   - 需要准备好 `gaussian-splatting` 运行环境
   - 真正执行 `convert.py`、`train.py` 和 `ply2splat_server.py`

推荐部署拓扑：

- `Nginx + 前端 dist + Kotlin 后端` 放在同一台 Web 服务器上
- `gaussian-splatting + GPU + COLMAP` 放在另一台远端训练机上

这是当前代码最稳妥的部署方式，因为前端默认请求相对路径 `/api` 和 `/models`，最适合同域反向代理。

## 2. 代码目录

- 前端：`construction-3d`
- Kotlin 后端：`local-backend-kotlin`
- 后端数据目录：`local-backend-kotlin/data`

后端运行后的本地数据结构大致如下：

- `data/tasks/<taskId>/task.json`
- `data/tasks/<taskId>/annotations.json`
- `data/models/<taskId>/scene.splat`
- `data/models/<taskId>/cameras.json`
- `data/logs/<taskId>.log`

这些目录建议作为持久化目录保留，不要在升级时删除。

## 3. 部署前准备

### 3.1 Web 服务器要求

- Linux 推荐：Ubuntu 20.04 / 22.04
- JDK 21
- Node.js 18+ 和 npm
- Nginx

### 3.2 远端训练机要求

- Linux
- NVIDIA 驱动安装正常
- GPU 可用，建议显存 12 GB 以上，越大越稳
- `nvidia-smi` 可正常执行
- `colmap` 已安装并在 `PATH` 中
- Miniconda 或等价 Python 环境
- 已准备好可运行的 `gaussian-splatting`

至少需要满足下面这些路径或等价替代路径：

- `REMOTE_WORK_DIR`：远端任务工作目录，默认 `/data/gs-tasks`
- `REMOTE_PYTHON_BIN`：Python 路径，默认 `/data/miniconda/envs/gaussian_splatting/bin/python`
- `REMOTE_TRAIN_SCRIPT`：训练脚本，默认 `/data/gaussian-splatting/train.py`
- `REMOTE_PLY2SPLAT_SCRIPT`：PLY 转 SPLAT 脚本，默认 `/data/gaussian-splatting/output/ply2splat_server.py`

此外，Kotlin 后端在 COLMAP 阶段会执行：

```bash
cd /data/gaussian-splatting && <python> convert.py -s <remoteRoot>
```

所以远端默认还要求：

- `/data/gaussian-splatting/convert.py` 存在
- `/data/gaussian-splatting/train.py` 存在
- `/data/gaussian-splatting/scene/` 等依赖存在

如果你的远端路径不同，可以通过环境变量覆盖，见第 5 节。

## 4. 获取代码

把下面两个目录发给部署人员即可：

- `construction-3d`
- `local-backend-kotlin`

也可以整体打包整个 `construction` 根目录，但正式部署时只需要上面两个目录。

建议部署到类似路径：

```bash
/srv/construction/
├── construction-3d
└── local-backend-kotlin
```

## 5. 部署 Kotlin 后端

### 5.1 配置项

`local-backend-kotlin/src/main/resources/application.yml` 现在支持通过环境变量覆盖以下关键配置：

- `SERVER_PORT`
- `APP_DATA_DIR`
- `APP_CORS_ORIGINS`
- `SSH_HOST`
- `SSH_PORT`
- `SSH_USERNAME`
- `SSH_PASSWORD`
- `REMOTE_WORK_DIR`
- `REMOTE_PYTHON_BIN`
- `REMOTE_TRAIN_SCRIPT`
- `REMOTE_PLY2SPLAT_SCRIPT`
- `VISION_MODEL_DIR`
- `VISION_PYTHON_BIN`
- `VISION_SCRIPT_PATH`
- `VISION_CONFIDENCE`
- `VISION_IOU`
- `VISION_IMAGE_SIZE`
- `VISION_TIMEOUT_SECONDS`
- `ITERATIONS_LOW`
- `ITERATIONS_MEDIUM`
- `ITERATIONS_HIGH`

最少必须正确设置的是：

- `SSH_HOST`
- `SSH_PORT`
- `SSH_USERNAME`
- `SSH_PASSWORD`

如果远端训练环境路径不是当前默认值，还要额外设置：

- `REMOTE_WORK_DIR`
- `REMOTE_PYTHON_BIN`
- `REMOTE_TRAIN_SCRIPT`
- `REMOTE_PLY2SPLAT_SCRIPT`

### 5.2 构建

进入后端目录：

```bash
cd /srv/construction/local-backend-kotlin
./gradlew bootJar
```

Windows 下可使用：

```bat
gradlew.bat bootJar
```

构建成功后，Jar 一般位于：

```bash
build/libs/local-backend-kotlin-1.0.0.jar
```

### 5.3 运行

最简单的手工运行方式：

```bash
cd /srv/construction/local-backend-kotlin
export SSH_HOST=your-remote-host
export SSH_PORT=22
export SSH_USERNAME=root
export SSH_PASSWORD='your-password'
export APP_DATA_DIR=/srv/construction/local-backend-kotlin/data
export VISION_MODEL_DIR=/srv/construction/model
export VISION_PYTHON_BIN=/usr/bin/python3
java -jar build/libs/local-backend-kotlin-1.0.0.jar
```

也可以直接用仓库自带脚本：

```bash
cd /srv/construction/local-backend-kotlin
export SSH_PASSWORD='your-password'
./start.sh
```

如果需要启用前端的 `YOLO识别` 页面，Web 服务器本机还需要准备：

- 可执行的 Python 3 环境
- `pip install ultralytics pillow`
- `VISION_MODEL_DIR` 指向部署目录中的 YOLO `.pt` 权重目录

注意：

- `start.sh` / `start.bat` 只强制检查了 `SSH_PASSWORD`
- 其他配置仍建议通过环境变量显式指定
- 正式部署建议使用 `systemd` 守护，而不是前台运行

### 5.4 systemd 部署

仓库已提供示例文件：

- `deploy/local-backend-kotlin.service.example`

建议：

1. 复制为 `/etc/systemd/system/local-backend-kotlin.service`
2. 修改 `WorkingDirectory`、`ExecStart`、`EnvironmentFile`
3. 把环境变量写入 `/etc/construction/local-backend-kotlin.env`

示例命令：

```bash
sudo mkdir -p /etc/construction
sudo cp /srv/construction/deploy/local-backend-kotlin.service.example /etc/systemd/system/local-backend-kotlin.service
sudo nano /etc/construction/local-backend-kotlin.env
sudo systemctl daemon-reload
sudo systemctl enable --now local-backend-kotlin
sudo systemctl status local-backend-kotlin
```

## 6. 部署前端

### 6.1 安装依赖并构建

```bash
cd /srv/construction/construction-3d
npm ci
npm run build
```

构建产物输出在：

```bash
construction-3d/dist
```

### 6.2 注意事项

前端当前默认使用：

- API：`/api`
- 模型文件：`/models`

因此生产环境建议：

- 前端静态资源、`/api`、`/models` 全部走同一个域名
- 用 Nginx 把 `/api` 反向代理到 Kotlin 后端
- 用 Nginx 把 `/models` 反向代理到 Kotlin 后端

## 7. Nginx 部署

仓库已提供示例文件：

- `deploy/nginx.construction.conf.example`

核心思路：

- `/` 提供前端 `dist`
- `/api/` 代理到 `http://127.0.0.1:3000/`
- `/models/` 代理到 `http://127.0.0.1:3000/models/`

示例命令：

```bash
sudo cp /srv/construction/deploy/nginx.construction.conf.example /etc/nginx/conf.d/construction.conf
sudo nginx -t
sudo systemctl reload nginx
```

## 8. 远端训练机准备清单

远端训练机至少要满足：

1. SSH 能登录

```bash
ssh root@your-remote-host -p 22
```

2. GPU 正常

```bash
nvidia-smi
```

3. COLMAP 在 PATH 中

```bash
which colmap
colmap -h
```

4. Python 环境可用

```bash
/data/miniconda/envs/gaussian_splatting/bin/python -V
```

5. `gaussian-splatting` 脚本存在

```bash
ls /data/gaussian-splatting/train.py
ls /data/gaussian-splatting/convert.py
ls /data/gaussian-splatting/output/ply2splat_server.py
```

6. 任务目录可写

```bash
mkdir -p /data/gs-tasks
touch /data/gs-tasks/.write_test && rm -f /data/gs-tasks/.write_test
```

## 9. 首次联调验证

部署完成后按下面顺序验证：

1. 验证后端健康检查

```bash
curl http://127.0.0.1:3000/health
```

预期返回：

```json
{"status":"ok","tasks":0}
```

2. 打开前端首页

```text
http://your-domain/
```

3. 提交一个最小任务

- 上传少量图片
- 确认左侧任务列表能刷新
- 确认状态会从 `pending -> running -> completed/failed`

4. 验证模型访问

- 查看器能加载 `scene.splat`
- 下载按钮可用
- 若成功导出 `cameras.json`，相机预设面板可用

## 10. 升级与迁移

### 10.1 保留数据

升级时请保留：

- `local-backend-kotlin/data/tasks`
- `local-backend-kotlin/data/models`
- `local-backend-kotlin/data/logs`

### 10.2 旧模型迁移

如果要从旧版 `local-backend` 迁移到 `local-backend-kotlin`，至少需要复制：

- `data/models/<taskId>`
- `data/tasks/<taskId>/task.json`
- 可选：`data/logs/<taskId>.log`

只复制 `scene.splat` 不够，因为任务列表依赖 `task.json`。

## 11. 常见问题

### 11.1 SSH 连接失败

检查：

- `SSH_HOST`
- `SSH_PORT`
- `SSH_USERNAME`
- `SSH_PASSWORD`
- Web 服务器到远端训练机的防火墙是否放通

### 11.2 断电后续跑时出现 `database is locked`

这是 COLMAP 阶段的 SQLite 数据库锁残留问题。当前后端已在续跑前尝试：

- 清理该任务残留进程
- 清理未完成的 COLMAP 中间文件和 SQLite 数据库

如果仍失败，可手工清理该任务远端目录下的：

- `database.db`
- `database.db-*`
- `sparse`
- `stereo`
- `images`
- `distorted`

然后再续跑。

### 11.3 训练阶段出现 `CUDA out of memory`

说明远端 GPU 显存不足。常见解决办法：

- 换更大显存的 GPU
- 减少输入图片数量
- 降低图片分辨率
- 调低训练压力参数

### 11.4 任务看起来卡在 99%

常见原因不是 `scene.splat` 还没下载完，而是后处理还在做：

- 导出 COLMAP 文本模型
- 下载 `cameras.txt`
- 下载 `images.txt`
- 生成 `cameras.json`

如果 `scene.splat` 已经存在，但任务还未完成，优先检查 `data/models/<taskId>/` 下是否仍在生成：

- `_cameras_txt.tmp`
- `_images_txt.tmp`
- `cameras.json`

### 11.5 前端能打开，但接口 404

通常是 Nginx 没有正确代理：

- `/api/*`
- `/models/*`

前端默认不是直连 `http://host:3000`，而是请求当前域名下的相对路径。

## 12. 当前版本的部署约束

当前代码更适合下面这种部署方式：

- 前端和 Kotlin 后端在同一个域名下
- Nginx 做反代
- Kotlin 后端通过 SSH 调用远端 GPU 训练机

如果要做下面这些场景，需要额外改代码或改部署方式：

- 前后端跨域、跨域名直接访问
- 无 SSH 的本地直接训练
- Docker 一键部署
- 多训练机负载均衡

---

如果部署人员只想先跑通最小版本，建议优先完成：

1. 远端训练机环境准备
2. Kotlin 后端启动并能通过 `/health`
3. Nginx 正确代理 `/api` 和 `/models`
4. 前端 `npm run build` 后能正常打开首页

然后再做真实任务验证。
