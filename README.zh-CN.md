# way2mcp

[English](./README.md)

## 更新日志

### [1.1.0] - 2026-05-03

- **重大变更**: 彻底移除了旧有的 SSE 和 WebSocket 传输支持。
- **重大变更**: 现在全力专注于官方标准的 **Streamable HTTP** 传输，确保最高的协议合规性和性能。
- **内部**: 使用现代 SDK 模式重构了 `HttpBridge`，代码更简洁、更稳健。

<details>
<summary>历史版本</summary>

### [1.0.5] - 2026-05-03

- **修复**: 解决了 Bridge 模式下响应丢失 `result` 包装的问题。

### [1.0.4] - 2026-05-03

- **修复**: 完美透传远程服务器的所有 MCP 能力（工具、提示词、资源）到本地客户端。
- **修复**: 修正了从 SDK Client 中提取服务器能力的逻辑。

### [1.0.3] - 2026-05-03

- **修复**: Bridge 模式现在在本地处理 `initialize` 请求，而不是双重转发，避免了超时和 stdin 关闭的竞态条件。
- **修复**: Bridge 捕获并代理远程服务器的能力信息给本地 MCP 客户端。

### [1.0.2] - 2026-05-03

- **修复**: Streamable HTTP 强制要求 Session ID（修复了无状态模式下由于缺少 Session ID 导致后续请求被拒绝的协议冲突）。
- **修复**: 改进了会话管理逻辑，提高了可靠性。

### [1.0.1] - 2026-05-03

- **修复**: 改进了 `initialize` 请求的处理逻辑，增强了兼容性（修复了 400 Bad Request / Invalid request 错误）。
- **修复**: 增强了 Streamable HTTP 服务器传输层的稳定性。
- **内部**: 重构了服务器端代码，提高了可维护性并降低了代码复杂度。
- **内部**: 为 `/mcp` 请求添加了详细的调试日志。

</details>

[Model Context Protocol (MCP)](https://modelcontextprotocol.io) 的传输层桥接工具。通过一条命令，在不同传输方式（stdio 和 Streamable HTTP）之间连接 MCP 服务器和客户端。

## 什么是 way2mcp？

way2mcp 解决了 MCP 生态系统中的一个常见问题：**你的 MCP 客户端和服务器使用不同的传输方式**。

- 有一个仅支持 stdio 的 MCP 服务器，但需要通过网络暴露它？使用 **`serve`**。
- 有一个远程 HTTP MCP 服务器，但你的客户端只支持 stdio？使用 **`bridge`**。

**serve 模式**

```mermaid
graph LR
    Client[MCP 客户端] -- Streamable HTTP --> way2mcp[way2mcp serve]
    way2mcp -- stdio --> Server[本地 MCP 服务端]
```

**bridge 模式**

```mermaid
graph LR
    Client[本地 MCP 客户端] -- stdio --> way2mcp[way2mcp bridge]
    way2mcp -- Streamable HTTP --> Server[远程 MCP 服务端]
```

## 功能特性

- **两种模式**：`serve`（stdio → 网络）和 `bridge`（网络 → stdio）
- **Streamable HTTP** 作为传输方式（符合 MCP 规范）
- **有状态与无状态**会话管理
- **CORS** 支持，包括来源过滤和正则匹配
- **自定义请求头**和 OAuth2 Bearer 令牌认证
- **健康检查端点**，适用于监控和负载均衡
- **零配置**：合理的默认值，开箱即用

## 安装

```bash
# 全局安装
npm install -g way2mcp

# 或直接使用 npx（无需安装）
npx way2mcp serve --cmd "your-mcp-server"
```

### 系统要求

- Node.js >= 18

## 快速开始

### 将本地 stdio 服务器暴露为 HTTP

```bash
way2mcp serve --cmd "uvx mcp-server-git"
```

这会在端口 8000（默认）上启动一个 HTTP 服务器。MCP 客户端连接到 `http://localhost:8000/mcp`。

### 通过 stdio 连接到远程 MCP 服务器

```bash
way2mcp bridge --url "https://example.com/mcp"
```

这会连接到远程服务器，并通过 stdin/stdout 桥接所有流量，使其兼容仅支持 stdio 的 MCP 客户端。

## 使用方式

### `serve` — 将 stdio MCP 服务器暴露为网络服务

```bash
way2mcp serve --cmd <command> [options]
```

`serve` 命令启动你的 MCP 服务器作为子进程，通过 stdio（stdin/stdout）与之通信，并将其暴露为 Streamable HTTP 端点。

#### 工作原理

1. way2mcp 启动一个 Express HTTP 服务器
2. 当客户端发送 MCP `initialize` 请求时，way2mcp 启动你的 `--cmd` 进程
3. 所有 JSON-RPC 消息在 HTTP 传输和子进程的 stdio 之间代理传输
4. 在有状态模式下，每个客户端会话都有自己的独立子进程
5. 会话结束时，子进程会被清理

#### 选项

| 选项                | 类型                        | 默认值       | 描述                                                                                                                                          |
| ------------------- | --------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `--cmd`             | string                      | **（必填）** | 要启动的 MCP stdio 服务器命令                                                                                                                 |
| `--port`            | number                      | `8000`       | HTTP 监听端口                                                                                                                                 |
| `--stateful`        | boolean                     | `false`      | 启用有状态会话（每个客户端一个子进程）                                                                                                        |
| `--session-timeout` | number                      | —            | 会话超时时间，单位毫秒（仅限有状态模式）                                                                                                      |
| `--cors`            | string[]                    | —            | 允许的 CORS 来源。使用 `--cors "*"` 允许所有来源，或 `--cors "https://example.com"` 指定特定来源。支持正则表达式：`--cors "/example\\.com$/"` |
| `--header`          | string[]                    | —            | 自定义响应头（可重复使用）                                                                                                                    |
| `--oauth2-bearer`   | string                      | —            | OAuth2 Bearer 令牌（设置 `Authorization: Bearer <token>` 请求头）                                                                             |
| `--health`          | string                      | `/healthz`   | 健康检查端点路径                                                                                                                              |
| `--log-level`       | `debug` \| `info` \| `none` | `info`       | 日志详细程度                                                                                                                                  |

#### 示例

```bash
# 基本用法：将 stdio 服务器暴露为 Streamable HTTP
way2mcp serve --cmd "uvx mcp-server-git" --port 8000

# 有状态模式：每个客户端获得独立的会话
way2mcp serve --cmd "uvx mcp-server-git" --stateful

# 允许来自任何域名的跨域请求
way2mcp serve --cmd "node server.js" --cors "*"

# 使用正则匹配特定来源
way2mcp serve --cmd "node server.js" --cors "/\\.example\\.com$/"

# 添加自定义请求头和 OAuth2 认证
way2mcp serve --cmd "uvx mcp-server-git" \
  --header "X-Tenant-Id: abc123" \
  --oauth2-bearer "your-access-token"

# 调试模式，输出详细日志
way2mcp serve --cmd "uvx mcp-server-git" --log-level debug

# 自定义健康检查端点
way2mcp serve --cmd "uvx mcp-server-git" --health "/status"
```

### `bridge` — 通过 stdio 连接到远程 MCP 服务器

```bash
way2mcp bridge --url <url> [options]
```

`bridge` 命令通过网络连接到远程 MCP 服务器，并通过 stdin/stdout 在本地暴露它。这使远程 MCP 服务器兼容仅支持 stdio 传输的客户端。

#### 工作原理

1. way2mcp 启动并连接到远程 MCP 服务器（Streamable HTTP）
2. 从 stdin 读取 JSON-RPC 消息（由本地 MCP 客户端发送）
3. 将消息转发到远程服务器，并将响应写入 stdout

#### 选项

| 选项              | 类型                        | 默认值       | 描述                                                              |
| ----------------- | --------------------------- | ------------ | ----------------------------------------------------------------- |
| `--url`           | string                      | **（必填）** | 远程 MCP 服务器 URL（Streamable HTTP 端点）                       |
| `--header`        | string[]                    | —            | 发送请求时的自定义请求头（可重复使用）                            |
| `--oauth2-bearer` | string                      | —            | OAuth2 Bearer 令牌（设置 `Authorization: Bearer <token>` 请求头） |
| `--log-level`     | `debug` \| `info` \| `none` | `info`       | 日志详细程度                                                      |

#### 示例

```bash
# 连接到 Streamable HTTP 服务器
way2mcp bridge --url "http://localhost:8000/mcp"

# 使用认证连接到远程服务器
way2mcp bridge --url "https://mcp.example.com/mcp" --oauth2-bearer "token123"

# 使用自定义请求头连接
way2mcp bridge --url "https://mcp.example.com/mcp" \
  --header "X-API-Key: secret" \
  --header "X-Tenant: abc"

# 调试模式
way2mcp bridge --url "https://mcp.example.com/mcp" --log-level debug
```

## MCP 客户端配置

### Claude Code

将 way2mcp 添加到 Claude Code 的 MCP 配置（`~/.claude.json`）：

```json
{
  "mcpServers": {
    "my-remote-server": {
      "command": "way2mcp",
      "args": ["bridge", "--url", "https://mcp.example.com/mcp"],
      "env": {}
    }
  }
}
```

或者将本地 stdio 服务器暴露为网络服务：

```json
{
  "mcpServers": {
    "git-tools": {
      "command": "way2mcp",
      "args": ["serve", "--cmd", "uvx mcp-server-git", "--port", "8000"],
      "env": {}
    }
  }
}
```

### Claude Desktop

添加到 Claude Desktop 配置文件（`claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "remote-server": {
      "command": "way2mcp",
      "args": [
        "bridge",
        "--url",
        "https://mcp.example.com/mcp",
        "--oauth2-bearer",
        "your-token"
      ]
    }
  }
}
```

### 任意 MCP 客户端（通过 .mcp.json）

在项目根目录创建 `.mcp.json` 文件：

```json
{
  "mcpServers": {
    "my-server": {
      "type": "http",
      "url": "http://localhost:8000/mcp"
    }
  }
}
```

然后在后台启动 way2mcp serve：

```bash
way2mcp serve --cmd "your-mcp-server" --port 8000
```

## 传输方式支持矩阵

| 传输方式        | serve（输入 → 输出） | bridge（输入 → 输出） |
| --------------- | :------------------: | :-------------------: |
| stdio           |         输入         |         输出          |
| Streamable HTTP |         输出         |         输入          |

## 架构

**serve 模式**
![架构 serve](./assets/docs/architecture-serve-zh.svg)

**bridge 模式**
![架构 bridge](./assets/docs/architecture-bridge-zh.svg)

## 开发

```bash
git clone https://github.com/nicepkg/way2mcp.git
cd way2mcp
npm install
npm run build     # 编译 TypeScript
npm test          # 运行集成测试
```

### 项目结构

```
src/
  index.ts              # CLI 入口（serve / bridge 子命令）
  server.ts             # Express serve 模式
  bridge.ts             # bridge 模式（网络 → stdio）
  types.ts              # 共享类型定义
  gateways/
    stdio-bridge.ts     # StdioBridge：启动子进程，代理 JSON-RPC
    http-bridge.ts      # HttpBridge：连接远程 Streamable HTTP 服务器
  lib/
    logger.ts           # 日志工厂（debug/info/none）
    headers.ts          # 请求头解析（支持 OAuth2）
    cors.ts             # CORS 来源解析（通配符、正则、字符串）
    session.ts          # 带超时的会话访问计数器
    signals.ts          # 优雅关闭（SIGINT/SIGTERM/SIGHUP）
    version.ts          # 从 package.json 读取版本号
tests/
  serve.test.ts         # serve 模式集成测试
  bridge.test.ts        # bridge 模式集成测试
  auto-detect.test.ts   # 传输自动检测测试
```

## 许可证

MIT
