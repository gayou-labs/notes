// 反向連結側欄（像 Obsidian）與關聯圖
import { useEffect, useMemo, useRef, useState } from "react";
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY } from "d3-force";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import { drag as d3drag } from "d3-drag";
import { store } from "./store.js";
import { titleOf, iconOf } from "./registry.js";
import { linesOf } from "./lines.js";

function Snip({ parts, selfId, term }) {
  return (
    <div className="bl-snip">
      {parts.map((p, i) => {
        if (p.link) return <mark key={i} className={p.link === selfId ? "hit" : ""}>[[{p.text}]]</mark>;
        if (!term) return <span key={i}>{p.text}</span>;
        const seg = p.text.split(term);
        return (
          <span key={i}>
            {seg.map((s, j) => (
              <span key={j}>
                {s}
                {j < seg.length - 1 && <mark className="hit">{term}</mark>}
              </span>
            ))}
          </span>
        );
      })}
    </div>
  );
}

/* ---------- 右側面板 ---------- */
export function BacklinksPanel({ page, ctx, onClose }) {
  const { pages, byId, isGone } = ctx;
  const [all, setAll] = useState(null);
  const [open, setOpen] = useState({});
  const linking = pages.filter((p) => p.id !== page.id && (p.links || []).includes(page.id) && !isGone(p));

  useEffect(() => {
    let alive = true;
    store.getAllContent().then((c) => alive && setAll(c));
    return () => {
      alive = false;
    };
  }, [page.id, pages.length]);

  const title = (page.title || "").trim();
  const linked = useMemo(() => {
    if (!all) return [];
    return linking.map((p) => ({
      p,
      lines: linesOf(p, all[p.id], byId).filter((parts) => parts.some((x) => x.link === page.id)),
    }));
  }, [all, linking.map((p) => p.id).join(), byId, page.id]);
  const mentions = useMemo(() => {
    if (!all || title.length < 2) return [];
    const ids = new Set(linking.map((p) => p.id));
    const out = [];
    for (const p of pages) {
      if (p.id === page.id || ids.has(p.id) || isGone(p)) continue;
      const lines = linesOf(p, all[p.id], byId).filter((parts) => parts.some((x) => !x.link && x.text.includes(title)));
      if (lines.length) out.push({ p, lines });
    }
    return out;
  }, [all, title, pages, byId, page.id]);

  const group = (list, kind) =>
    list.map(({ p, lines }) => {
      const k = kind + p.id;
      const shut = open[k] === false;
      return (
        <div key={k} className="bl-group">
          <div className="bl-head">
            <button className={"tog" + (shut ? "" : " open")} onClick={() => setOpen((o) => ({ ...o, [k]: shut }))} aria-label="展開">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
            <a href={"#/p/" + p.id} className="bl-title">
              {iconOf(p)} {titleOf(p)}
            </a>
            <span className="bl-n">{lines.length || ""}</span>
          </div>
          {!shut &&
            lines.slice(0, 8).map((parts, i) => (
              <a key={i} href={"#/p/" + p.id} className="bl-card">
                <Snip parts={parts} selfId={page.id} term={kind === "m" ? title : ""} />
              </a>
            ))}
        </div>
      );
    });

  return (
    <aside className="rpanel">
      <div className="rp-head">
        <b>反向連結</b>
        <span className="grow" />
        <button className="ibtn xs" onClick={onClose} title="關閉">
          ✕
        </button>
      </div>
      <div className="rp-body">
        <div className="rp-sec">
          已連結本頁的頁面 <span className="bl-n">{linking.length}</span>
        </div>
        {!all && <p className="muted sm pad">讀取中…</p>}
        {all && linking.length === 0 && <p className="muted sm pad">還沒有頁面連到這一頁。在其他頁面輸入 [[ 就能連過來。</p>}
        {group(linked, "l")}
        <div className="rp-sec">
          未連結但提及本頁的頁面 <span className="bl-n">{mentions.length}</span>
        </div>
        {all && title.length < 2 && <p className="muted sm pad">標題太短，不找提及。</p>}
        {all && title.length >= 2 && mentions.length === 0 && <p className="muted sm pad">沒有其他頁面提到「{title}」。</p>}
        {group(mentions, "m")}
      </div>
    </aside>
  );
}

/* ---------- 關聯圖 ---------- */
export function GraphView({ ctx }) {
  const { pages, isGone } = ctx;
  const svgRef = useRef(null);
  const [showTree, setShowTree] = useState(() => localStorage.getItem("notes-graph-tree") !== "0");
  const [showOrphans, setShowOrphans] = useState(() => localStorage.getItem("notes-graph-orphans") !== "0");
  const [q, setQ] = useState("");

  const data = useMemo(() => {
    const live = pages.filter((p) => !isGone(p));
    const ids = new Set(live.map((p) => p.id));
    const links = [];
    for (const p of live) {
      for (const t of p.links || []) if (ids.has(t) && t !== p.id) links.push({ source: p.id, target: t, kind: "link" });
      if (showTree && p.parentId && ids.has(p.parentId)) links.push({ source: p.parentId, target: p.id, kind: "tree" });
    }
    const deg = {};
    links.forEach((l) => {
      deg[l.source] = (deg[l.source] || 0) + 1;
      deg[l.target] = (deg[l.target] || 0) + 1;
    });
    const nodes = live.filter((p) => showOrphans || deg[p.id]).map((p) => ({ id: p.id, p, deg: deg[p.id] || 0 }));
    return { nodes, links };
  }, [pages, showTree, showOrphans]);

  useEffect(() => {
    const svg = select(svgRef.current);
    svg.selectAll("*").remove();
    const { width, height } = svgRef.current.getBoundingClientRect();
    const nodes = data.nodes.map((n) => ({ ...n }));
    const links = data.links.map((l) => ({ ...l }));
    const root = svg.append("g");
    const zb = d3zoom()
      .scaleExtent([0.2, 4])
      .on("zoom", (e) => root.attr("transform", e.transform));
    svg.call(zb).on("dblclick.zoom", null);
    svg.call(zb.transform, zoomIdentity.translate(width / 2, height / 2));

    const link = root
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("class", (d) => "g-link " + d.kind);
    const node = root
      .append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("class", (d) => "g-node" + (d.p.type === "board" ? " board" : ""))
      .style("cursor", "pointer");
    const r = (d) => 5 + Math.min(10, Math.sqrt(d.deg) * 2.5);
    node.append("circle").attr("r", r);
    node
      .append("text")
      .attr("dy", (d) => r(d) + 13)
      .attr("text-anchor", "middle")
      .text((d) => titleOf(d.p));

    const neighbors = new Map(nodes.map((n) => [n.id, new Set([n.id])]));
    links.forEach((l) => {
      const s = l.source.id || l.source, t = l.target.id || l.target;
      neighbors.get(s)?.add(t);
      neighbors.get(t)?.add(s);
    });
    node
      .on("mouseenter", (e, d) => {
        const nb = neighbors.get(d.id);
        node.classed("dim", (n) => !nb.has(n.id));
        link.classed("dim", (l) => l.source.id !== d.id && l.target.id !== d.id).classed("hot", (l) => l.source.id === d.id || l.target.id === d.id);
      })
      .on("mouseleave", () => {
        node.classed("dim", false);
        link.classed("dim", false).classed("hot", false);
      })
      .on("click", (e, d) => {
        if (e.defaultPrevented) return;
        location.hash = "#/p/" + d.id;
      });

    const sim = forceSimulation(nodes)
      .force("link", forceLink(links).id((d) => d.id).distance((l) => (l.kind === "tree" ? 60 : 90)).strength(0.6))
      .force("charge", forceManyBody().strength(-220))
      .force("center", forceCenter(0, 0))
      .force("x", forceX(0).strength(0.04))
      .force("y", forceY(0).strength(0.04))
      .force("collide", forceCollide().radius((d) => r(d) + 14))
      .on("tick", () => {
        link.attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y).attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
        node.attr("transform", (d) => `translate(${d.x},${d.y})`);
      });
    node.call(
      d3drag()
        .on("start", (e, d) => {
          if (!e.active) sim.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (e, d) => {
          d.fx = e.x;
          d.fy = e.y;
        })
        .on("end", (e, d) => {
          if (!e.active) sim.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    );
    svgRef.current.__nodes = node;
    return () => sim.stop();
  }, [data]);

  useEffect(() => {
    const node = svgRef.current.__nodes;
    if (!node) return;
    const t = q.trim().toLowerCase();
    node.classed("match", (d) => !!t && titleOf(d.p).toLowerCase().includes(t));
    node.classed("faded", (d) => !!t && !titleOf(d.p).toLowerCase().includes(t));
  }, [q, data]);

  const setPref = (k, v, set) => {
    set(v);
    try {
      localStorage.setItem(k, v ? "1" : "0");
    } catch {}
  };

  return (
    <div className="graph-wrap">
      <div className="graph-bar">
        <input className="field sm" placeholder="找頁面…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="ck">
          <input type="checkbox" checked={showTree} onChange={(e) => setPref("notes-graph-tree", e.target.checked, setShowTree)} />
          顯示上下層頁面關係
        </label>
        <label className="ck">
          <input type="checkbox" checked={showOrphans} onChange={(e) => setPref("notes-graph-orphans", e.target.checked, setShowOrphans)} />
          顯示沒有連結的頁面
        </label>
        <span className="muted sm">
          {data.nodes.length} 頁 · {data.links.filter((l) => l.kind === "link").length} 條連結
        </span>
      </div>
      <svg ref={svgRef} className="graph" />
      <div className="graph-legend muted sm">
        <span>
          <i className="lg-line link" />
          頁面連結
        </span>
        {showTree && (
          <span>
            <i className="lg-line tree" />
            上下層
          </span>
        )}
        <span>拖曳移動 · 滾輪縮放 · 點一下開啟</span>
      </div>
    </div>
  );
}
