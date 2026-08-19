window.__ModuleLoader__.load({
  id: "@dsh-external/dsh-conversation-timeline",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const _reactModule = require("react");
    const React = _reactModule && _reactModule.__esModule && _reactModule.default ? _reactModule.default : _reactModule;
    const { useEffect, useState, useMemo, useCallback, useRef } = React;
    const API_BASE = "/conversation-timeline/api";

    function h(type, props, ...children) {
      return React.createElement(type, props, ...children);
    }

    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error) {
        console.error("[conversation-browser]", error);
      }
      render() {
        if (this.state.error) {
          return h(
            "div",
            { style: { color: "#f66", padding: "12px", fontFamily: "monospace", fontSize: "12px" } },
            "面板出错: " + String((this.state.error && this.state.error.message) || this.state.error)
          );
        }
        return this.props.children;
      }
    }

    const overlayBaseStyle = {
      position: "fixed",
      zIndex: 1000,
      pointerEvents: "auto",
      width: "270px",
      background: "rgba(15,17,21,0.96)",
      borderLeft: "1px solid #333",
      boxShadow: "-8px 0 24px rgba(0,0,0,0.35)",
      display: "flex",
      flexDirection: "column",
      fontFamily: "system-ui, sans-serif",
      fontSize: "13px",
      color: "#e6e6e6",
      overflow: "hidden",
    };

    const tabStyle = (active) => ({
      flex: 1,
      padding: "6px 4px",
      textAlign: "center",
      cursor: "pointer",
      borderBottom: active ? "2px solid #4c8dff" : "2px solid transparent",
      color: active ? "#fff" : "#999",
      fontWeight: active ? "600" : "400",
      background: "transparent",
      borderTop: "none",
      borderLeft: "none",
      borderRight: "none",
    });

    const dotStyle = {
      width: "12px",
      height: "12px",
      borderRadius: "50%",
      background: "#4c8dff",
      border: "2px solid #0f1115",
      boxShadow: "0 0 0 2px #4c8dff",
      cursor: "pointer",
      position: "relative",
      flex: "none",
      marginTop: "2px",
    };

    const tooltipStyle = {
      position: "fixed",
      zIndex: 1100,
      maxWidth: "320px",
      background: "#1f2430",
      border: "1px solid #444",
      borderRadius: "8px",
      padding: "8px 10px",
      fontSize: "12px",
      color: "#eee",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      pointerEvents: "none",
    };

    async function fetchJson(path) {
      const res = await fetch(API_BASE + path);
      if (!res.ok) throw new Error("HTTP " + res.status + ": " + (await res.text()).slice(0, 200));
      return res.json();
    }

    /**
     * ═══ better-sidebar 侧边栏嵌入契约（优化时勿破坏）═══
     * props：useSessions / loadOlder 由挂载方注入；embedded=true 时以
     * "填满容器"方式渲染（无浮动定位/无折叠/跳过轨迹页抑制）。
     * 优化组件内部逻辑可自由改，但请保留：props 签名、embedded 分支、
     * embedded 布局（flex 容器）三处。
     */
    function TimelineOverlay({ useSessions, loadOlder, embedded }) {
      const currentId = useSessions((s) => s.current);
      const [tab, setTab] = useState("session");
      const [collapsed, setCollapsed] = useState(!embedded);
      const [chatRect, setChatRect] = useState(null);
      const [scrollbarWidth, setScrollbarWidth] = useState(0);
      const [isTrajectory, setIsTrajectory] = useState(false);
      const [sessionState, setSessionState] = useState({ loading: false, data: null, error: null });
      const [hovered, setHovered] = useState(null);
      const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
      const [jumpLoading, setJumpLoading] = useState(false);

      // 跨会话
      const [globalState, setGlobalState] = useState({ loading: true, sessions: [], error: null });
      const [expandedSession, setExpandedSession] = useState(null);
      const [dialogueBySession, setDialogueBySession] = useState({});
      const [globalQuery, setGlobalQuery] = useState("");
      const [globalIncludeTools, setGlobalIncludeTools] = useState(false);
      const [showEmptySessions, setShowEmptySessions] = useState(false);
      const [expandedSearch, setExpandedSearch] = useState(null);
      const [searchVisibleCounts, setSearchVisibleCounts] = useState({});
      const [searchState, setSearchState] = useState({ loading: false, results: null, error: null });
      const scrollRef = useRef(null);
      const savedScrollTops = useRef({ global: 0, sessions: {} });
      const sessionScrollInitialized = useRef({});

      // 把浮层限制在“对话/轨迹”滚动块内部，避免穿过 header/composer 横线
      useEffect(() => {
        if (embedded) return;
        let cancelled = false;
        const update = () => {
          if (cancelled) return;
          const el = document.querySelector("[data-conversation-scroll]");
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const composer = el.querySelector("[data-composer-seat]");
          const bottom = composer ? composer.getBoundingClientRect().top : rect.bottom;
          const height = Math.max(0, bottom - rect.top);
          const hasVScroll = el.scrollHeight > el.clientHeight + 1;
          const measuredScrollbar = Math.max(0, el.offsetWidth - el.clientWidth);
          const scrollbar = hasVScroll ? (measuredScrollbar > 0 ? measuredScrollbar : 16) : 0;
          setIsTrajectory(!!document.querySelector("[data-trajectory-scroll]"));
          if (rect.width > 0 && height > 0) {
            setChatRect({ top: rect.top, left: rect.left, right: rect.right, height, scrollbar });
          }
        };
        update();
        const timer = setInterval(update, 400);
        window.addEventListener("resize", update);
        window.addEventListener("scroll", update, true);
        return () => {
          cancelled = true;
          clearInterval(timer);
          window.removeEventListener("resize", update);
          window.removeEventListener("scroll", update, true);
        };
      }, [currentId]);

      // 计算浏览器滚动条宽度，避免浮层盖住滚动条
      useEffect(() => {
        const update = () => {
          const hasPageScroll = document.documentElement.scrollHeight > document.documentElement.clientHeight + 1;
          const measured = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
          setScrollbarWidth(hasPageScroll ? (measured > 0 ? measured : 16) : 0);
        };
        update();
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
      }, []);

      // 当前会话的用户输入节点
      useEffect(() => {
        if (!currentId) {
          setSessionState({ loading: false, data: null, error: null });
          return;
        }
        let cancelled = false;
        setSessionState({ loading: true, data: null, error: null });
        fetchJson("/session/" + encodeURIComponent(currentId) + "/events")
          .then((data) => {
            if (!cancelled) setSessionState({ loading: false, data, error: null });
          })
          .catch((err) => {
            if (!cancelled) setSessionState({ loading: false, data: null, error: String(err && err.message ? err.message : err) });
          });
        return () => {
          cancelled = true;
        };
      }, [currentId]);

      // 跨会话列表（含标题）
      useEffect(() => {
        let cancelled = false;
        fetchJson("/sessions")
          .then((sessions) => {
            if (!cancelled) setGlobalState({ loading: false, sessions, error: null });
          })
          .catch((err) => {
            if (!cancelled) setGlobalState({ loading: false, sessions: [], error: String(err && err.message ? err.message : err) });
          });
        return () => {
          cancelled = true;
        };
      }, []);

      // 跨会话内容搜索（防抖）
      useEffect(() => {
        const q = globalQuery.trim();
        if (!q) {
          setSearchState({ loading: false, results: null, error: null });
          return;
        }
        let cancelled = false;
        setSearchState({ loading: true, results: null, error: null });
        const timer = setTimeout(() => {
          fetchJson("/search?q=" + encodeURIComponent(q) + "&includeTools=" + (globalIncludeTools ? "1" : "0") + "&limit=20")
            .then((data) => {
              if (!cancelled) setSearchState({ loading: false, results: data.items || [], error: null });
            })
            .catch((err) => {
              if (!cancelled) setSearchState({ loading: false, results: null, error: String(err && err.message ? err.message : err) });
            });
        }, 300);
        return () => {
          cancelled = true;
          clearTimeout(timer);
        };
      }, [globalQuery, globalIncludeTools]);

      const userEvents = useMemo(() => {
        const events = sessionState.data?.events ?? [];
        return events.filter((ev) => ev.type === "user/message" && ev.sourceKind === "user" && (ev.preview || "").trim() !== "");
      }, [sessionState.data]);

      const jumpToUserMessage = useCallback(
        async (ev) => {
          const scrollEl = document.querySelector("[data-conversation-scroll]");
          const root = scrollEl || document;
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

          // 优先用 messageId 精确匹配聊天节点锚点（key = "13:input-message" + messageId）
          const key = ev.messageId ? "13:input-message" + String(ev.messageId) : null;
          const findTarget = () => {
            if (!key) return null;
            const rows = Array.from(root.querySelectorAll("[data-chat-anchor-key]"));
            return rows.find((row) => row.dataset.chatAnchorKey === key) || null;
          };
          let target = findTarget();
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
          }

          // 目标节点还没加载：持续调用 loadOlder() 并轮询检测，直到目标出现或没有更多内容。
          // 用「已渲染节点行数是否增长」判断加载是否有进展，避免依赖按钮的瞬时存在/禁用状态。
          const chatButtonRoot = scrollEl || document.querySelector("[data-chat-flow]") || document;
          const findLoadOlderButton = () => {
            const buttons = Array.from(chatButtonRoot.querySelectorAll("button"));
            return buttons.find((b) => /加载更早|加载更多|Load earlier|Load more/.test((b.textContent || "").trim())) || null;
          };
          const countRows = () => root.querySelectorAll("[data-chat-anchor-key]").length;

          setJumpLoading(true);
          try {
            let lastCount = countRows();
            let idleRounds = 0;
            const startedAt = Date.now();
            while (Date.now() - startedAt < 15000) {
              if (typeof loadOlder === "function" && currentId) {
                try { await loadOlder(currentId); } catch (err) { /* 忽略，继续轮询 */ }
              }
              await wait(250);
              target = findTarget();
              if (target) {
                target.scrollIntoView({ behavior: "smooth", block: "start" });
                return;
              }
              const now = countRows();
              if (now > lastCount) {
                lastCount = now;
                idleRounds = 0;
              } else {
                idleRounds += 1;
                if (idleRounds >= 3 && !findLoadOlderButton()) {
                  break; // 连续无进展且没有加载按钮：认为已全部加载
                }
              }
            }
          } finally {
            setJumpLoading(false);
          }

          // 兜底：按文本查找
          const preview = (ev.preview || "").trim();
          if (!preview) return;
          const candidates = Array.from(root.querySelectorAll("*")).filter((el) => {
            if (el.children.length > 0) return false;
            const text = (el.textContent || "").trim();
            return text.length >= 4 && (text === preview || text.startsWith(preview.slice(0, 40)) || preview.startsWith(text.slice(0, 40)));
          });
          target = candidates[candidates.length - 1];
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
          } else if (scrollEl) {
            scrollEl.scrollTop = 0;
          }
        },
        [currentId, loadOlder]
      );

      const onDotHover = useCallback((ev, e) => {
        setHovered(ev);
        setTooltipPos({ x: e.clientX + 14, y: e.clientY + 14 });
      }, []);

      // 从轨迹页切回对话页 / 重新展开时，恢复该页签之前的滚动位置；
      // 会话内时间线第一次打开时滑到底部（最新），之后记住位置。
      useEffect(() => {
        if (isTrajectory || collapsed) return;
        const el = scrollRef.current;
        if (!el) return;
        if (tab === "session" && currentId) {
          const hasContent = !!sessionState.data && userEvents.length > 0;
          if (hasContent && !sessionScrollInitialized.current[currentId]) {
            el.scrollTop = el.scrollHeight;
            sessionScrollInitialized.current[currentId] = true;
            savedScrollTops.current.sessions[currentId] = el.scrollTop;
          } else if (sessionScrollInitialized.current[currentId]) {
            el.scrollTop = savedScrollTops.current.sessions[currentId] || 0;
          }
        } else {
          el.scrollTop = savedScrollTops.current.global || 0;
        }
      }, [isTrajectory, collapsed, tab, currentId, sessionState.data, userEvents.length]);

      if (!currentId) return null;
      if (isTrajectory && !embedded) return null;
      if (collapsed && !embedded) {
        return h(
          "div",
          {
            style: {
              ...overlayBaseStyle,
              width: "36px",
              alignItems: "center",
              paddingTop: "8px",
              cursor: "pointer",
              ...(chatRect
                ? { top: chatRect.top, left: Math.max(0, chatRect.right - 36 - (chatRect.scrollbar || 0)), bottom: 0 }
                : { top: "48px", right: scrollbarWidth || 0, bottom: 0 }),
            },
            onClick: () => setCollapsed(false),
            title: "展开节点时间线",
          },
          h("div", { style: { writingMode: "vertical-rl", color: "#888", fontSize: "12px" } }, "节点时间线")
        );
      }

      const overlayStyle = embedded
        ? {
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
            width: "100%",
            boxSizing: "border-box",
          }
        : {
            ...overlayBaseStyle,
            ...(chatRect
              ? { top: chatRect.top, left: Math.max(0, chatRect.right - 270 - (chatRect.scrollbar || 0)), bottom: 0 }
              : { top: "48px", right: scrollbarWidth || 0, bottom: 0 }),
          };

      const sessionContent =
        tab === "session"
          ? renderSessionTimeline({
              sessionState,
              userEvents,
              hovered,
              tooltipPos,
              onDotHover: (ev, e) => onDotHover(ev, e),
              onDotLeave: () => setHovered(null),
              onDotClick: jumpToUserMessage,
            })
          : renderGlobalPanel({
              globalState,
              globalQuery,
              setGlobalQuery,
              globalIncludeTools,
              setGlobalIncludeTools,
              showEmptySessions,
              setShowEmptySessions,
              searchState,
              expandedSession,
              setExpandedSession,
              expandedSearch,
              setExpandedSearch,
              searchVisibleCounts,
              setSearchVisibleCounts,
              dialogueBySession,
              setDialogueBySession,
            });

      return h(
        "div",
        { style: overlayStyle },
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              padding: "8px 10px",
              borderBottom: "1px solid #333",
              flex: "none",
            },
          },
          h("div", { style: { fontWeight: "bold", flex: 1 } }, "对话节点"),
          !embedded &&
            h(
              "button",
              {
                onClick: () => setCollapsed(true),
                style: {
                  background: "transparent",
                  border: "none",
                  color: "#999",
                  cursor: "pointer",
                  fontSize: "16px",
                  lineHeight: "1",
                },
                title: "收起",
              },
              "»"
            )
        ),
        h(
          "div",
          { style: { display: "flex", borderBottom: "1px solid #333", flex: "none" } },
          h("button", { style: tabStyle(tab === "session"), onClick: () => setTab("session") }, "会话内"),
          h("button", { style: tabStyle(tab === "global"), onClick: () => setTab("global") }, "跨会话")
        ),
        jumpLoading &&
          h(
            "div",
            {
              style: {
                padding: "6px 10px",
                color: "#4c8dff",
                fontSize: "12px",
                borderBottom: "1px solid #333",
                flex: "none",
              },
            },
            "正在加载历史消息..."
          ),
        h(
          "div",
          {
            ref: scrollRef,
            onScroll: (e) => {
              if (tab === "session" && currentId) {
                savedScrollTops.current.sessions[currentId] = e.target.scrollTop;
              } else {
                savedScrollTops.current.global = e.target.scrollTop;
              }
            },
            style: { flex: 1, overflow: "auto", padding: "10px" },
          },
          sessionContent
        )
      );
    }

    function renderSessionTimeline({ sessionState, userEvents, hovered, tooltipPos, onDotHover, onDotLeave, onDotClick }) {
      if (sessionState.loading) {
        return h("div", { style: { color: "#888" } }, "加载当前会话节点...");
      }
      if (sessionState.error) {
        return h("div", { style: { color: "#f66" } }, "加载失败: " + sessionState.error);
      }
      if (userEvents.length === 0) {
        return h("div", { style: { color: "#888" } }, "当前会话暂无用户输入节点");
      }
      return h(
        "div",
        { style: { position: "relative", paddingLeft: "10px" } },
        h("div", {
          style: {
            position: "absolute",
            left: "15px",
            top: "6px",
            bottom: "6px",
            width: "2px",
            background: "#333",
          },
        }),
        userEvents.map((ev, idx) =>
          h(
            "div",
            {
              key: ev.seq,
              style: {
                display: "flex",
                gap: "10px",
                alignItems: "flex-start",
                marginBottom: "14px",
                position: "relative",
              },
            },
            h("div", {
              style: dotStyle,
              onMouseEnter: (e) => onDotHover(ev, e),
              onMouseLeave: onDotLeave,
              onClick: () => onDotClick(ev),
              title: "",
            }),
            h(
              "div",
              { style: { flex: 1, minWidth: 0, cursor: "pointer" } },
              h("div", { style: { color: "#888", fontSize: "11px" } }, `#${ev.seq} · ${new Date(ev.time).toLocaleTimeString()}`),
              h(
                "div",
                {
                  style: {
                    color: "#ccc",
                    fontSize: "12px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  },
                  onClick: () => onDotClick(ev),
                },
                ev.preview || "(空)"
              )
            )
          )
        ),
        hovered &&
          h(
            "div",
            {
              style: {
                ...tooltipStyle,
                left: tooltipPos.x,
                top: tooltipPos.y,
              },
            },
            hovered.text || hovered.preview || "(空)"
          )
      );
    }

    function renderGlobalPanel({ globalState, globalQuery, setGlobalQuery, globalIncludeTools, setGlobalIncludeTools, showEmptySessions, setShowEmptySessions, searchState, expandedSession, setExpandedSession, expandedSearch, setExpandedSearch, searchVisibleCounts, setSearchVisibleCounts, dialogueBySession, setDialogueBySession }) {
      async function toggleSession(s) {
        if (expandedSession === s.id) {
          setExpandedSession(null);
          return;
        }
        setExpandedSession(s.id);
        if (dialogueBySession[s.id] && !dialogueBySession[s.id].error) return;
        setDialogueBySession((prev) => ({ ...prev, [s.id]: { events: [], hasMore: false, nextAfter: null, loading: true, error: null } }));
        try {
          const data = await fetchJson("/session/" + encodeURIComponent(s.id) + "/dialogue?limit=5");
          setDialogueBySession((prev) => ({ ...prev, [s.id]: { events: data.events || [], hasMore: data.hasMore, nextAfter: data.nextAfter, loading: false, error: null } }));
        } catch (err) {
          setDialogueBySession((prev) => ({ ...prev, [s.id]: { events: [], hasMore: false, nextAfter: null, loading: false, error: String(err && err.message ? err.message : err) } }));
        }
      }

      async function loadMoreDialogue(s) {
        const cur = dialogueBySession[s.id];
        if (!cur || cur.loading || !cur.hasMore || !cur.nextAfter) return;
        setDialogueBySession((prev) => ({ ...prev, [s.id]: { ...prev[s.id], loading: true } }));
        try {
          const data = await fetchJson("/session/" + encodeURIComponent(s.id) + "/dialogue?limit=5&after=" + encodeURIComponent(cur.nextAfter));
          setDialogueBySession((prev) => {
            const old = prev[s.id] || { events: [] };
            return { ...prev, [s.id]: { events: [...old.events, ...(data.events || [])], hasMore: data.hasMore, nextAfter: data.nextAfter, loading: false, error: null } };
          });
        } catch (err) {
          setDialogueBySession((prev) => ({ ...prev, [s.id]: { ...prev[s.id], loading: false, error: String(err && err.message ? err.message : err) } }));
        }
      }

      function roleBadge(role) {
        const map = {
          user: { text: "用户", color: "#4c8dff" },
          agent: { text: "Agent", color: "#36b37e" },
          tool: { text: "工具", color: "#b7791f" },
          system: { text: "系统", color: "#999" },
        };
        const cfg = map[role] || map.system;
        return h(
          "span",
          {
            style: {
              display: "inline-block",
              padding: "0 6px",
              borderRadius: "10px",
              fontSize: "10px",
              lineHeight: "16px",
              background: cfg.color + "22",
              color: cfg.color,
              border: "1px solid " + cfg.color,
              marginRight: "6px",
              verticalAlign: "middle",
            },
          },
          cfg.text
        );
      }

      function formatCopy(events) {
        return events
          .map((ev) => {
            const who = ev.role === "user" ? "用户" : ev.role === "agent" ? "Agent" : ev.role || "消息";
            return `${who}：${ev.text || ev.preview || ""}`;
          })
          .join("\n\n");
      }

      async function copyEvents(events) {
        const text = formatCopy(events);
        try {
          await navigator.clipboard.writeText(text);
        } catch (err) {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
      }

      const header = h(
        "div",
        {},
        h("input", {
          placeholder: "搜索用户 / Agent 对话内容，例如：dsh 安装",
          value: globalQuery,
          onChange: (e) => setGlobalQuery(e.target.value),
          style: {
            width: "100%",
            boxSizing: "border-box",
            padding: "6px 8px",
            borderRadius: "6px",
            border: "1px solid #444",
            background: "#1a1d23",
            color: "#eee",
            marginBottom: "6px",
          },
        }),
        h(
          "div",
          { style: { display: "flex", gap: "10px", marginBottom: "8px", flexWrap: "wrap" } },
          h(
            "label",
            { style: { display: "flex", alignItems: "center", gap: "4px", color: "#bbb", fontSize: "12px", cursor: "pointer" } },
            h("input", {
              type: "checkbox",
              checked: globalIncludeTools,
              onChange: (e) => setGlobalIncludeTools(e.target.checked),
            }),
            "包含工具 / 系统节点"
          ),
          h(
            "label",
            { style: { display: "flex", alignItems: "center", gap: "4px", color: "#bbb", fontSize: "12px", cursor: "pointer" } },
            h("input", {
              type: "checkbox",
              checked: showEmptySessions,
              onChange: (e) => setShowEmptySessions(e.target.checked),
            }),
            "显示空会话（仅 id）"
          )
        )
      );

      const q = globalQuery.trim();

      // 搜索模式：默认展开后显示 5 条匹配，可继续加载更多
      if (q) {
        if (searchState.loading) {
          return h("div", {}, header, h("div", { style: { color: "#888" } }, "搜索中..."));
        }
        if (searchState.error) {
          return h("div", {}, header, h("div", { style: { color: "#f66" } }, "搜索失败: " + searchState.error));
        }
        const results = searchState.results || [];
        if (results.length === 0) {
          return h("div", {}, header, h("div", { style: { color: "#888" } }, "没有匹配的对话内容"));
        }
        return h(
          "div",
          {},
          header,
          h("div", { style: { color: "#888", fontSize: "11px", marginBottom: "6px" } }, `找到 ${results.length} 个会话`),
          results.map((item) => {
            const s = item.session;
            const title = s.title || s.id;
            const matches = item.matches || (item.bestMatch ? [item.bestMatch] : []);
            const first = matches[0];
            const isOpen = expandedSearch === s.id;
            const visibleCount = isOpen ? (searchVisibleCounts[s.id] || 5) : 1;
            const visibleMatches = matches.slice(0, visibleCount);
            return h(
              "div",
              {
                key: s.id,
                style: {
                  border: "1px solid #333",
                  borderRadius: "8px",
                  padding: "8px",
                  marginBottom: "6px",
                },
              },
              h("div", { style: { fontWeight: "600" } }, title),
              h("div", { style: { color: "#999", fontSize: "11px", margin: "2px 0" } }, s.id),
              !isOpen &&
                first &&
                h(
                  "div",
                  { style: { color: "#ccc", fontSize: "12px", whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: "4px" } },
                  roleBadge(first.role),
                  first.preview || "(无文本)"
                ),
              !isOpen &&
                h(
                  "div",
                  {
                    style: {
                      textAlign: "left",
                      color: "#4c8dff",
                      fontSize: "11px",
                      marginTop: "6px",
                      cursor: "pointer",
                    },
                    onClick: () => {
                      setExpandedSearch(s.id);
                      setSearchVisibleCounts((prev) => ({ ...prev, [s.id]: 5 }));
                    },
                  },
                  matches.length > 1 ? `展开 ${matches.length} 条匹配` : "展开"
                ),
              isOpen &&
                h(
                  "div",
                  { style: { marginTop: "6px" } },
                  h(
                    "div",
                    { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" } },
                    h("span", { style: { color: "#888", fontSize: "11px" } }, `匹配 ${Math.min(visibleCount, matches.length)} / ${matches.length}`),
                    h(
                      "button",
                      {
                        onClick: () => copyEvents(visibleMatches),
                        style: {
                          background: "transparent",
                          border: "1px solid #444",
                          borderRadius: "6px",
                          color: "#ccc",
                          fontSize: "11px",
                          padding: "2px 8px",
                          cursor: "pointer",
                        },
                      },
                      "复制对话"
                    )
                  ),
                  h(
                    "div",
                    { style: { borderLeft: "2px solid #555", paddingLeft: "8px" } },
                    visibleMatches.map((ev) =>
                      h(
                        "div",
                        { key: ev.seq, style: { marginBottom: "8px" } },
                        h("div", { style: { color: "#888", fontSize: "11px" } }, `#${ev.seq} · ${new Date(ev.time).toLocaleTimeString()}`),
                        h(
                          "div",
                          { style: { color: "#ccc", fontSize: "12px", whiteSpace: "pre-wrap", wordBreak: "break-word" } },
                          roleBadge(ev.role),
                          (globalIncludeTools ? ev.fullText || ev.fullPreview : ev.text || ev.preview) || "(无文本)"
                        )
                      )
                    )
                  ),
                  h(
                    "div",
                    { style: { display: "flex", gap: "12px", marginTop: "6px", alignItems: "center" } },
                    visibleCount < matches.length &&
                      h(
                        "span",
                        {
                          style: { color: "#4c8dff", fontSize: "11px", cursor: "pointer" },
                          onClick: () => setSearchVisibleCounts((prev) => ({ ...prev, [s.id]: (prev[s.id] || 5) + 5 })),
                        },
                        "加载更多匹配"
                      ),
                    h(
                      "span",
                      {
                        style: { color: "#4c8dff", fontSize: "11px", cursor: "pointer" },
                        onClick: () => {
                          setExpandedSearch(null);
                          setSearchVisibleCounts((prev) => ({ ...prev, [s.id]: 5 }));
                        },
                      },
                      "收起"
                    )
                  )
                )
            );
          })
        );
      }

      // 浏览模式：默认隐藏空会话，展开后从最早的 5 条开始，可继续加载更多
      if (globalState.loading) {
        return h("div", {}, header, h("div", { style: { color: "#888" } }, "加载跨会话列表..."));
      }
      if (globalState.error) {
        return h("div", {}, header, h("div", { style: { color: "#f66" } }, "加载失败: " + globalState.error));
      }

      const sessions = globalState.sessions.filter((s) => showEmptySessions || s.hasDialogue);
      return h(
        "div",
        {},
        header,
        sessions.length === 0
          ? h("div", { style: { color: "#888" } }, showEmptySessions ? "无会话" : "没有有内容的会话")
          : sessions.slice(0, 30).map((s) => {
              const isOpen = expandedSession === s.id;
              const data = dialogueBySession[s.id];
              const contentEvents = data && !data.error ? data.events : [];
              const title = s.title || s.id;
              return h(
                "div",
                {
                  key: s.id,
                  style: {
                    border: "1px solid #333",
                    borderRadius: "8px",
                    padding: "8px",
                    marginBottom: "6px",
                  },
                },
                h(
                  "div",
                  { style: { fontWeight: "600" } },
                  title,
                  !s.hasDialogue && h("span", { style: { color: "#888", fontSize: "11px", marginLeft: "6px" } }, "(空会话)")
                ),
                h(
                  "div",
                  { style: { color: "#999", fontSize: "11px", margin: "4px 0" } },
                  `${s.id} · ${new Date(s.createdAt).toLocaleString()}`
                ),
                !isOpen &&
                  h(
                    "div",
                    {
                      style: {
                        textAlign: "left",
                        color: "#4c8dff",
                        fontSize: "11px",
                        marginTop: "6px",
                        cursor: "pointer",
                      },
                      onClick: () => toggleSession(s),
                    },
                    "展开"
                  ),
                isOpen &&
                  h(
                    "div",
                    { style: { marginTop: "6px" } },
                    h(
                      "div",
                      { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" } },
                      h("span", { style: { color: "#888", fontSize: "11px" } }, data && data.total ? `共 ${data.total} 条对话` : ""),
                      h(
                        "button",
                        {
                          onClick: () => copyEvents(contentEvents),
                          style: {
                            background: "transparent",
                            border: "1px solid #444",
                            borderRadius: "6px",
                            color: "#ccc",
                            fontSize: "11px",
                            padding: "2px 8px",
                            cursor: "pointer",
                          },
                        },
                        "复制对话"
                      )
                    ),
                    data == null || data.loading
                      ? h("div", { style: { color: "#888" } }, "加载中...")
                      : data.error
                      ? h("div", { style: { color: "#f66" } }, "加载失败: " + data.error)
                      : contentEvents.length === 0
                      ? h("div", { style: { color: "#888" } }, "空会话 / 无对话内容")
                      : h(
                          "div",
                          { style: { borderLeft: "2px solid #555", paddingLeft: "8px" } },
                          contentEvents.map((ev) =>
                            h(
                              "div",
                              { key: ev.seq, style: { marginBottom: "8px" } },
                              h("div", { style: { color: "#888", fontSize: "11px" } }, `#${ev.seq} · ${new Date(ev.time).toLocaleTimeString()}`),
                              h(
                                "div",
                                {
                                  style: {
                                    color: "#ccc",
                                    fontSize: "12px",
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word",
                                  },
                                },
                                roleBadge(ev.role),
                                ev.text || ev.preview || "(空)"
                              )
                            )
                          )
                        ),
                    h(
                      "div",
                      { style: { display: "flex", gap: "12px", marginTop: "6px", alignItems: "center" } },
                      data &&
                        data.hasMore &&
                        h(
                          "span",
                          {
                            style: { color: "#4c8dff", fontSize: "11px", cursor: "pointer" },
                            onClick: () => loadMoreDialogue(s),
                          },
                          data.loading ? "加载中..." : "加载更多 5 条"
                        ),
                      h(
                        "span",
                        {
                          style: { color: "#4c8dff", fontSize: "11px", cursor: "pointer" },
                          onClick: () => setExpandedSession(null),
                        },
                        "收起"
                      )
                    )
                  )
              );
            })
      );
    }

    function TimelineOverlayBoundary(props) {
      return h(ErrorBoundary, null, h(TimelineOverlay, props));
    }

    // —— 浮动时间线开关偏好（localStorage 持久化，设置页「插件」卡片可开关）——
    const FLOAT_PREF_KEY = "dsh.conversationTimeline.floatEnabled";
    function readFloatPref() {
      try { return localStorage.getItem(FLOAT_PREF_KEY) !== "0"; } catch (e) { return true; }
    }
    function writeFloatPref(v) {
      try { localStorage.setItem(FLOAT_PREF_KEY, v ? "1" : "0"); } catch (e) { /* noop */ }
      try { window.dispatchEvent(new Event("dsh-timeline-float-pref")); } catch (e) { /* noop */ }
    }
    function FloatOverlayGate(props) {
      const [, force] = React.useState(0);
      React.useEffect(() => {
        const fn = () => force((n) => n + 1);
        window.addEventListener("dsh-timeline-float-pref", fn);
        return () => window.removeEventListener("dsh-timeline-float-pref", fn);
      }, []);
      return readFloatPref() ? h(TimelineOverlayBoundary, props) : null;
    }
    function TimelineSettingsCard() {
      const [enabled, setEnabled] = React.useState(readFloatPref());
      return h(
        "div",
        { style: { padding: "14px 16px" } },
        h("div", { style: { fontWeight: "600", marginBottom: "10px", fontSize: "13px" } }, "节点时间线"),
        h(
          "label",
          { style: { display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "13px" } },
          h("input", {
            type: "checkbox",
            checked: enabled,
            onChange: (e) => {
              setEnabled(e.target.checked);
              writeFloatPref(e.target.checked);
            },
          }),
          h("span", null, "浮动节点时间线（overlay）"),
          h("span", { style: { color: "#999", fontSize: "11px", marginLeft: "4px" } }, "关闭后仅保留侧边栏时间线")
        )
      );
    }

    exports.inject = ["slots"];

    exports.apply = function (ctx) {
      ctx.effect(
        () =>
          ctx.slots.register({
            name: "shell.overlay",
            id: "@dsh-external/dsh-conversation-timeline-overlay",
            order: 100,
            inject: () => ({
              loadOlder: (sessionId) => {
                const binding = ctx.sessions?.binding?.(sessionId);
                const session = binding?.session;
                return session?.loadOlder ? session.loadOlder() : undefined;
              },
            }),
          }, FloatOverlayGate),
        "@dsh-external/dsh-conversation-timeline: overlay"
      );

      // 设置页「节点时间线」分区：浮动时间线开关（settings.section 非 keyed，无需 host namespace）
      ctx.effect(
        () =>
          ctx.slots.inject("settings.section", () =>
            ctx.slots.register({
              name: "settings.section",
              id: "conversation-timeline-section",
              order: 50,
              label: () => "节点时间线",
            }, TimelineSettingsCard)
          ),
        "@dsh-external/dsh-conversation-timeline: settings section"
      );

      // ═══ better-sidebar 侧边栏嵌入（契约区：优化时保留，勿删）═══
      // betterSidebar 是可选服务：不能用 exports.inject 硬声明（否则服务缺失时整个
      // 入口 pending），也不能在 apply 时用 ctx.get() 直接取（注册顺序可能晚于本插件）。
      // 用 ctx.inject 等待服务注册：服务存在时注册侧边栏 Tab；不存在时子 fiber 保持
      // pending，主入口不受影响，插件退化为纯浮动 overlay（两态兼容）。
      ctx.inject(["betterSidebar"], (bsCtx) => {
        const bs = bsCtx.betterSidebar;
        if (bs && typeof bs.registerTab === "function") {
          bsCtx.effect(
            () =>
              bs.registerTab({
                id: "conversation-timeline",
                title: "节点时间线",
                order: 40,
                component: (props) => {
                  const scope = (props && props.scope) || {};
                  const sessionId = scope.sessionId;
                  const useSessions = (sel) => sel({ current: sessionId });
                  const loadOlder = (sid) => {
                    try {
                      const binding = props && props.ctx && props.ctx.sessions && props.ctx.sessions.binding
                        ? props.ctx.sessions.binding(sid || sessionId)
                        : void 0;
                      const session = binding && binding.session;
                      return session && session.loadOlder ? session.loadOlder() : undefined;
                    } catch (e) {
                      return undefined;
                    }
                  };
                  return h(TimelineOverlay, { useSessions, loadOlder, embedded: true });
                },
              }),
            "@dsh-external/dsh-conversation-timeline: better-sidebar tab"
          );
        }
      });
    };

    return module.exports;
  },
});
