// Register the plugin and define what it adds

import { io } from "socket.io-client";
import { ToolType } from "@shared/types";

// 전역 변수 선언
let mcpPanel: Panel;
let commandListElement: HTMLElement;
const commandHistory: Array<{ timestamp: Date; type: 'sent' | 'received'; command: string; data?: any }> = [];

const options: PluginOptions = {
  title: "MCP Plugin",
  author: "enfpdev",
  description: "A plugin for interacting with MCP using Socket.IO.",
  about:
    "This plugin allows you to connect to the MCP server using Socket.IO and provides various utilities for interacting with it.",
  version: "0.0.3",
  icon: "icon.png",
  tags: ["mcp", "ai", "agent"],
  variant: "desktop",
  await_loading: true,
  new_repository_format: true,
  website: "https://github.com/enfpdev/blockbench-mcp",
  repository: "https://github.com/enfpdev/blockbench-mcp",
  onload: () => {
    const socket = io("http://localhost:9999");

    // 커맨드 기록 HTML 업데이트 함수
    const updateCommandDisplay = () => {
      if (!commandListElement) return;
      
      if (commandHistory.length === 0) {
        commandListElement.innerHTML = '<div class="mcp-empty">아직 커맨드 기록이 없습니다.</div>';
        return;
      }

      const commandsHtml = commandHistory.map(entry => {
        const timeStr = entry.timestamp.toLocaleTimeString();
        const typeIcon = entry.type === 'sent' ? '↗️' : '↙️';
        const typeClass = entry.type === 'sent' ? 'mcp-sent' : 'mcp-received';
        const dataHtml = entry.data ? 
          `<div class="mcp-data">${JSON.stringify(entry.data, null, 2)}</div>` : '';
        
        return `
          <div class="mcp-command-item ${typeClass}">
            <div class="mcp-time">${timeStr}</div>
            <div class="mcp-command">
              <span class="mcp-icon">${typeIcon}</span>
              <span class="mcp-name">${entry.command}</span>
            </div>
            ${dataHtml}
          </div>
        `;
      }).join('');

      commandListElement.innerHTML = commandsHtml;
      commandListElement.scrollTop = commandListElement.scrollHeight;
    };

    mcpPanel = new Panel({
      id: 'mcp_command_history',
      name: 'MCP 커맨드 기록',
      icon: 'history',
      growable: true,
      resizable: true,
      expand_button: true,
      default_side: 'right',
      default_position: {
        slot: 'right_bar',
        float_position: [100, 100],
        float_size: [400, 500],
        height: 400,
        folded: false
      },
      component: {
        name: 'mcp-command-history',
        template: `
          <div class="mcp-command-history">
            <div class="mcp-header">
              <h3>MCP 커맨드 기록</h3>
              <div class="mcp-stats">총 ${commandHistory.length}개 커맨드</div>
            </div>
            <div class="mcp-content" ref="commandList">
              <div class="mcp-empty">아직 커맨드 기록이 없습니다.</div>
            </div>
          </div>
        `,
        mounted() {
          const refs = (this as any).$refs;
          if (refs && refs.commandList) {
            commandListElement = refs.commandList;
            updateCommandDisplay();
          }
        }
      }
    });

    const style = document.createElement('style');
    style.textContent = `
      .mcp-command-history { height: 100%; display: flex; flex-direction: column; }
      .mcp-header { padding: 10px; border-bottom: 1px solid var(--color-border); background: var(--color-ui); }
      .mcp-stats { font-size: 11px; color: var(--color-subtle_text); }
      .mcp-content { flex: 1; overflow-y: auto; padding: 10px; }
      .mcp-empty { text-align: center; color: var(--color-subtle_text); font-style: italic; padding: 20px; }
      .mcp-command-item { margin-bottom: 12px; padding: 8px; border-radius: 4px; border-left: 3px solid transparent; background: var(--color-ui); }
      .mcp-command-item.mcp-sent { border-left-color: #4CAF50; background: rgba(76, 175, 80, 0.1); }
      .mcp-command-item.mcp-received { border-left-color: #2196F3; background: rgba(33, 150, 243, 0.1); }
      .mcp-time { font-size: 10px; color: var(--color-subtle_text); }
      .mcp-command { display: flex; align-items: center; gap: 6px; }
      .mcp-name { font-weight: 600; font-size: 12px; }
      .mcp-data { margin-top: 4px; font-family: monospace; font-size: 10px; background: rgba(0, 0, 0, 0.1); padding: 4px 6px; border-radius: 2px; white-space: pre-wrap; max-height: 100px; overflow-y: auto; }
    `;
    document.head.appendChild(style);

    new Action('mcp_toggle_panel', {
      name: 'MCP 커맨드 패널 토글',
      icon: 'history',
      click: () => {
        const panelElement = document.getElementById('panel_mcp_command_history');
        if (panelElement) {
          const isVisible = panelElement.style.display !== 'none';
          panelElement.style.display = isVisible ? 'none' : 'block';
        }
      }
    });

    const updateCommandHistory = () => {
      updateCommandDisplay();
      const statsElement = document.querySelector('.mcp-stats');
      if (statsElement) {
        statsElement.textContent = `총 ${commandHistory.length}개 커맨드`;
      }
    };

    socket.on("connect", () => {
      console.log("[MCP Plugin] 연결됨");
      commandHistory.push({ timestamp: new Date(), type: 'sent', command: 'client_ready' });
      socket.emit("client_ready");
      updateCommandHistory();
    });

    // --- Execute Script Listener ---
    socket.on("capture_screenshot", (data: { requestId: string, width?: number, height?: number }) => {
      const done = (payload: any) => socket.emit("screenshot_result", { requestId: data.requestId, ...payload });
      try {
        const preview: any = (Preview as any).selected || (Preview as any).all?.[0] || (window as any).main_preview;
        if (!preview) { done({ error: "No preview available" }); return; }

        // Force a render so the framebuffer is current
        try { preview.render(); } catch {}

        // Fallback path: read directly from the WebGL canvas
        const directCapture = () => {
          try {
            const canvas: HTMLCanvasElement = preview.canvas || preview.renderer?.domElement;
            if (!canvas) { done({ error: "Preview has no canvas" }); return; }
            preview.render();
            const dataUrl = canvas.toDataURL("image/png");
            done({ dataUrl });
          } catch (e: any) {
            done({ error: "directCapture failed: " + e.toString() });
          }
        };

        // Try Screencam.screenshotPreview first; if the callback never fires, fall back
        let settled = false;
        const cb = (dataUrl: string) => {
          if (settled) return;
          settled = true;
          if (typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
            done({ dataUrl });
          } else {
            directCapture();
          }
        };
        try {
          const options: any = { silent: true };
          if (data.width) options.width = data.width;
          if (data.height) options.height = data.height;
          (Screencam as any).screenshotPreview(preview, options, cb);
        } catch {
          // ignore; fall through to timeout-based fallback
        }
        setTimeout(() => { if (!settled) { settled = true; directCapture(); } }, 1500);
      } catch (e: any) {
        done({ error: e.toString() });
      }
    });

    socket.on("execute_script", (data: { script: string, requestId: string }) => {
  try {
    const wrappedScript = `(function() { ${data.script} })();`;
    const result = eval(wrappedScript); // Capture the result
    
    // Send the result back to the server with the ID
    socket.emit("script_result", { 
      requestId: data.requestId, 
      result: result 
    });
    
    Blockbench.showStatusMessage("AI Build Command Executed", 2000);
  } catch (e) {
    socket.emit("script_result", { 
      requestId: data.requestId, 
      error: e.toString() 
    });
  }
});

    const originalEmit = socket.emit;
    socket.emit = function(event: string, ...args: any[]) {
      commandHistory.push({ timestamp: new Date(), type: 'sent', command: event, data: args.length > 0 ? args : undefined });
      updateCommandHistory();
      return originalEmit.call(this, event, ...args);
    };

    setInterval(() => {
      if (commandHistory.length > 0) updateCommandHistory();
    }, 10000);
  },
  onunload: () => {
    if (BarItems.mcp_toggle_panel) BarItems.mcp_toggle_panel.delete();
    if (mcpPanel) mcpPanel.delete();
  },
  oninstall: () => {},
  onuninstall: () => {},
};

(function () {
  BBPlugin.register("mcp_socketio_plugin", options);
})();