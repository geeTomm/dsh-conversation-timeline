# dsh-conversation-timeline

DSH 对话节点时间线 + 跨会话搜索插件。

在 DSH Web 对话页右侧显示竖向时间线，帮助快速定位历史对话；同时支持跨会话搜索、渐进式加载和复制对话内容。

## 功能

- **会话内时间线**
  - 右侧竖向时间线，节点为用户输入消息
  - 悬停节点显示完整用户输入
  - 点击节点跳转到对话对应位置
  - 首次打开自动滚动到最新，之后记忆滚动位置
  - 默认折叠，不打扰正常对话
  - 在 Trajectory（轨迹）视图下自动隐藏

- **跨会话搜索**
  - 按用户 / Agent 对话内容搜索
  - 可开启“包含工具 / 系统节点”
  - 搜索结果按会话分组，默认显示 5 条匹配，可继续加载更多
  - 每条消息带角色标记（用户 / Agent / 工具 / 系统）

- **跨会话浏览**
  - 默认隐藏空会话，可勾选显示
  - 展开后从最早的 5 条对话开始，分批加载更多
  - 支持复制当前已加载的对话

- **渐进式加载**
  - 对话内容按批次加载，避免长会话一次读取过多数据
  - 当前使用 `after` 游标分批次返回

## 安装

### 方式一：本地插件目录

将本仓库目录链接到 DSH profile：

```json
{
  "dependencies": {
    "@dsh-external/dsh-conversation-timeline": "link:/path/to/dsh-conversation-timeline"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@dsh-external/dsh-conversation-timeline"
      ]
    }
  }
}
```

### 方式二：DSH super-injector

在 DSH 会话中让 super-injector 执行：

```
dev_inject_plugin { "dir": "/path/to/dsh-conversation-timeline" }
```

或持久安装：

```
dev_install_package { "dir": "/path/to/dsh-conversation-timeline" }
```

## 使用

1. 打开任意 DSH 会话。
2. 右侧出现“对话节点”时间线（默认收起）。
3. 点击展开后：
   - “会话内”页签查看当前会话的用户输入时间线
   - “跨会话”页签搜索/浏览所有历史会话
4. 在轨迹视图下时间线自动隐藏。

## API

插件只读访问 `ctx.sessionQuery`，不修改任何会话数据。

- `GET /conversation-timeline/api/sessions`
- `GET /conversation-timeline/api/search?q=...&includeTools=0|1`
- `GET /conversation-timeline/api/session/:id/events`
- `GET /conversation-timeline/api/session/:id/dialogue?limit=5&after=<seq>`

## 说明

- 搜索采用双模式：优先尝试 `session-query-sqlite` 的 FTS 全文索引；如果部署关闭了 FTS（`openAt: never`），自动回退到逐会话文本扫描。
- 兼容 meow-memory：时间线只显示真实用户输入（`source.kind === "user"`），meow-memory 注入的上下文/记忆节点不会出现在时间线；跳转按 messageId 精确匹配，文本兜底时也跳过非用户节点。

## License

BSD-3-Clause
