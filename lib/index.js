/**
 * @dsh-external/dsh-conversation-browser — 对话节点时间线 + 跨会话搜索（Host 侧）。
 *
 * 安全设计：
 * - 只注册一条独立 prefix 路由，不修改任何现有配置/数据。
 * - 只读调用 ctx.sessionQuery（listSessions / readSurface），绝不写会话。
 * - 卸载时通过 ctx.effect 自动释放路由，不留残留。
 */

export const name = "@dsh-external/dsh-conversation-timeline"
export const inject = ["webServer", "sessionQuery"]

const PREFIX = "/conversation-timeline"
const API_PREFIX = `${PREFIX}/api`

function sendJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  })
  res.end(body)
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  })
  res.end(html)
}

/** 极简文本抽取；后续可替换为官方 extractSessionEventText。 */
function joinText(parts) {
  return parts.map((p) => String(p ?? "").trim()).filter(Boolean).join("\n")
}

function contentText(content, includeTools) {
  if (!Array.isArray(content)) return ""
  return joinText(content.flatMap((block) => {
    if (!block || typeof block !== "object") return []
    switch (block.type) {
      case "text": return [block.text]
      case "reasoning": return []
      case "tool-call": return includeTools ? [block.name, block.arguments] : []
      case "tool-result": return includeTools ? contentText(block.content, true) : []
      default: return []
    }
  }))
}

/** 对话文本：只包含真实 user/assistant 的 text 内容，默认视图使用。 */
function dialogueText(event) {
  if (!event || typeof event !== "object") return ""
  const data = event.data ?? {}
  switch (event.type) {
    case "user/message":
      // 只把真正的用户输入当作“对话”；后台任务/插件注入等 user/message 不算。
      if (data.source?.kind !== "user") return ""
      return contentText(data.content, false)
    case "assistant/message": return contentText(data.message?.content, false)
    default: return ""
  }
}

/** 完整文本：包含工具调用、结果等，开启“显示工具/系统节点”后使用。 */
function fullText(event) {
  if (!event || typeof event !== "object") return ""
  const data = event.data ?? {}
  switch (event.type) {
    case "user/message": return contentText(data.content, true)
    case "assistant/message": return contentText(data.message?.content, true)
    case "tool/call": return joinText([data.name, data.arguments])
    case "tool/result": return joinText([
      contentText(data.message?.content, true),
      data.error?.name ?? "",
      data.error?.code ?? "",
    ])
    case "todo/write": return joinText((data.todos ?? []).flatMap((todo) => [todo?.status, todo?.content]))
    case "turn/end": {
      const reason = data.reason ?? {}
      if (reason.kind === "error") return joinText(["error", reason.error?.message])
      if (reason.kind === "completed") return ""
      return reason.kind ?? ""
    }
    default: return ""
  }
}

function roleOfEvent(event) {
  if (!event || typeof event !== "object") return "system"
  switch (event.type) {
    case "user/message": return "user"
    case "assistant/message": return "agent"
    case "tool/call":
    case "tool/result": return "tool"
    default: return "system"
  }
}

function summarizeEvent(event) {
  const dialogue = dialogueText(event)
  const full = fullText(event)
  return {
    seq: event.seq,
    type: event.type,
    time: event.time,
    surface: event.surfaceOp ? "current" : "log-only",
    messageId: event.data?.id ?? null,
    sourceKind: event.data?.source?.kind ?? null,
    role: roleOfEvent(event),
    preview: dialogue.slice(0, 240),
    fullPreview: full.slice(0, 240),
    text: dialogue,
    fullText: full,
    length: dialogue.length,
    fullLength: full.length,
  }
}

function summarizeSessionRecord(record, title, hasDialogue) {
  const header = record?.header ?? {}
  return {
    id: header.id,
    title: title ?? null,
    hasDialogue: Boolean(hasDialogue),
    createdAt: header.createdAt,
    cwd: header.cwd ?? null,
    parentSession: header.parentSession ?? null,
    seedLength: header.seedLength ?? null,
    delegationDepth: header.delegationDepth ?? null,
    live: Boolean(record?.live),
    persisted: Boolean(record?.persisted),
  }
}

async function attachHasDialogue(ctx, sessions) {
  const map = new Map()
  await Promise.all(sessions.map(async (s) => {
    try {
      const surface = await ctx.sessionQuery.readSurface(s.header.id)
      const has = (surface.events ?? []).some((ev) => ev.type === "user/message" || ev.type === "assistant/message")
      map.set(s.header.id, has)
    } catch (err) {
      ctx.logger?.warn?.("[conversation-browser] hasDialogue failed: " + s.header.id + " " + String(err))
      map.set(s.header.id, false)
    }
  }))
  return map
}

async function attachTitles(ctx, records) {
  const ids = records.map((r) => r?.header?.id).filter(Boolean)
  if (ids.length === 0) return new Map()
  try {
    const results = await ctx.sessionQuery.readTitleSnapshots(ids)
    const map = new Map()
    for (const result of results) {
      if (result.status === "fulfilled" && result.value?.title?.title) {
        map.set(result.value.session.id, result.value.title.title)
      }
    }
    return map
  } catch (err) {
    ctx.logger?.warn?.("[conversation-browser] title load failed: " + String(err))
    return new Map()
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function apply(ctx) {
  const route = {
    kind: "prefix",
    path: PREFIX,
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://dsh.local")
        const pathname = url.pathname

        // 根路径：一个极简演示页面
        if (req.method === "GET" && (pathname === PREFIX || pathname === `${PREFIX}/`)) {
          sendHtml(res, 200, `<!doctype html>
<meta charset="utf-8">
<title>DSH 对话节点</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 40px; background: #0f1115; color: #e6e6e6; }
  a { color: #8ab4ff; }
</style>
<h1>DSH 对话节点</h1>
<p>该插件已内嵌到 DSH Web：打开任意会话，右侧会出现 <strong>“对话节点”时间线浮层</strong>。</p>
<p>浮层包含“会话内”和“跨会话”两个页签；会话内默认只显示用户输入节点，悬停可预览，点击可跳转。</p>
<p>API 调试入口：<a href="${API_PREFIX}/sessions">${API_PREFIX}/sessions</a></p>
`)
          return
        }

        // GET /prefix/api/sessions — 会话列表（含标题 + 是否有对话内容）
        if (req.method === "GET" && pathname === `${API_PREFIX}/sessions`) {
          const sessions = await ctx.sessionQuery.listSessions()
          const titles = await attachTitles(ctx, sessions)
          const hasDialogue = await attachHasDialogue(ctx, sessions)
          sendJson(res, 200, sessions.map((s) => summarizeSessionRecord(s, titles.get(s.header.id), hasDialogue.get(s.header.id))))
          return
        }

        // GET /prefix/api/search?q=...&includeTools=0|1 — 跨会话内容搜索
        // 说明：本部署 session-query-sqlite 配置为 openAt: never，FTS searchSessions 不可用；
        // 当前实现退化为对每个会话做字面文本扫描，数据量小时足够用。
        if (req.method === "GET" && pathname === `${API_PREFIX}/search`) {
          const q = (url.searchParams.get("q") || "").trim()
          if (!q) {
            sendJson(res, 400, { error: "q is required" })
            return
          }
          const includeTools = url.searchParams.get("includeTools") === "1"
          const rawLimit = Number(url.searchParams.get("limit") || "20")
          const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, Math.floor(rawLimit)), 50) : 20
          const sessions = await ctx.sessionQuery.listSessions()
          const titles = await attachTitles(ctx, sessions)
          const ql = q.toLowerCase()
          const collected = []
          for (const s of sessions) {
            try {
              const surface = await ctx.sessionQuery.readSurface(s.header.id)
              const matches = (surface.events ?? []).filter((ev) => {
                const text = includeTools ? fullText(ev) : dialogueText(ev)
                return text.toLowerCase().includes(ql)
              })
              if (matches.length === 0) continue
              const matchSummaries = matches.slice(0, 100).map(summarizeEvent)
              const first = matchSummaries[0]
              collected.push({
                session: summarizeSessionRecord(s, titles.get(s.header.id), true),
                matches: matchSummaries,
                bestMatch: first,
              })
            } catch (err) {
              ctx.logger?.warn?.("[conversation-browser] search session failed: " + s.header.id + " " + String(err))
            }
          }
          collected.sort((a, b) => (b.bestMatch?.time ?? 0) - (a.bestMatch?.time ?? 0))
          sendJson(res, 200, {
            items: collected.slice(0, limit),
            nextCursor: null,
          })
          return
        }

        // GET /prefix/api/session/:id/dialogue?limit=5&after=<seq> — 渐进式对话分页（从最早开始分批）
        const dialogueMatch = pathname.match(new RegExp(`^${escapeRegExp(API_PREFIX)}/session/([^/]+)/dialogue$`))
        if (req.method === "GET" && dialogueMatch) {
          const sessionId = decodeURIComponent(dialogueMatch[1])
          const rawLimit = Number(url.searchParams.get("limit") || "5")
          const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, Math.floor(rawLimit)), 50) : 5
          const afterRaw = url.searchParams.get("after")
          const after = afterRaw ? Number(afterRaw) : null
          const surface = await ctx.sessionQuery.readSurface(sessionId)
          const all = (surface.events ?? [])
            .filter((ev) => {
              if (ev.type === "user/message" && ev.data?.source?.kind !== "user") return false
              if (ev.type !== "user/message" && ev.type !== "assistant/message") return false
              return dialogueText(ev).trim() !== ""
            })
            .sort((a, b) => a.seq - b.seq)
          const afterSeq = after !== null && Number.isFinite(after) ? after : -1
          const later = all.filter((ev) => ev.seq > afterSeq)
          const page = later.slice(0, limit)
          const hasMore = later.length > page.length
          const nextAfter = page.length > 0 && hasMore ? page[page.length - 1].seq : null
          sendJson(res, 200, {
            session: surface.session,
            events: page.map(summarizeEvent),
            hasMore,
            nextAfter,
            total: all.length,
          })
          return
        }

        // GET /prefix/api/session/:id/events — 某会话的当前 surface 节点
        const eventsMatch = pathname.match(new RegExp(`^${escapeRegExp(API_PREFIX)}/session/([^/]+)/events$`))
        if (req.method === "GET" && eventsMatch) {
          const sessionId = decodeURIComponent(eventsMatch[1])
          const surface = await ctx.sessionQuery.readSurface(sessionId)
          sendJson(res, 200, {
            session: surface.session,
            capturedThroughSeq: surface.capturedThroughSeq,
            events: surface.events.map(summarizeEvent),
          })
          return
        }

        sendJson(res, 404, { error: "not found" })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        ctx.logger?.warn?.("[conversation-browser] " + message)
        sendJson(res, 500, { error: message })
      }
    },
  }

  ctx.effect(() => ctx.webServer.register(route), "@dsh-external/dsh-conversation-browser: route")
  ctx.logger?.info?.("[" + name + "] available at " + PREFIX)
}
