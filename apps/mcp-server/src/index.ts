import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Server as SocketServer } from "socket.io";
import { createServer } from "http";

const PORT = 9999;
const httpServer = createServer();
const io = new SocketServer(httpServer, { cors: { origin: "*" } });

let activeSocket: any = null;

io.on("connection", (socket) => {
  console.error(`[Bridge] Blockbench connected: ${socket.id}`);
  activeSocket = socket;
});

httpServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[Socket] Port ${PORT} already in use — another MCP server instance is likely running. ` +
      `This instance will stay alive but will not receive Blockbench connections. ` +
      `Close other MCP clients/instances and restart if tool calls fail.`
    );
  } else {
    console.error(`[Socket] HTTP server error:`, err);
  }
});

httpServer.listen(PORT, () => {
  console.error(`[Socket] Bridge active on port ${PORT}`);
});

const mcpServer = new Server(
  { name: "blockbench-creative-bridge", version: "1.1.0" },
  { capabilities: { tools: {} } }
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "execute_blockbench_script",
      description: "Runs a JavaScript snippet inside Blockbench to create or modify 3D models.",
      inputSchema: {
        type: "object",
        properties: {
          script: {
            type: "string",
            description: "The Blockbench API code to execute (e.g., new Cube({name: 'box'}).init())"
          }
        },
        required: ["script"]
      },
    },
    {
      name: "capture_screenshot",
      description: "Captures a PNG screenshot of the current Blockbench preview and returns it as an image.",
      inputSchema: {
        type: "object",
        properties: {
          width: { type: "number", description: "Optional output width in pixels." },
          height: { type: "number", description: "Optional output height in pixels." }
        }
      },
    },
  ],
}));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "execute_blockbench_script") {
    if (!activeSocket) return { content: [{ type: "text", text: "Not connected" }], isError: true };

    const script = request.params.arguments?.script as string;
    const requestId = Math.random().toString(36).substring(7);

    return new Promise((resolve) => {
      // 1. Set up a one-time listener for the result
      activeSocket.once("script_result", (data: any) => {
        if (data.requestId === requestId) {
          if (data.error) {
            resolve({ content: [{ type: "text", text: `Error: ${data.error}` }], isError: true });
          } else {
            resolve({ content: [{ type: "text", text: `Result: ${JSON.stringify(data.result)}` }] });
          }
        }
      });

      // 2. Send the script to Blockbench
      activeSocket.emit("execute_script", { script, requestId });

      // 3. Optional: Timeout after 5 seconds so Claude doesn't hang forever
      setTimeout(() => {
        resolve({ content: [{ type: "text", text: "Timeout: Blockbench didn't respond." }], isError: true });
      }, 5000);
    });
  }

  if (request.params.name === "capture_screenshot") {
    if (!activeSocket) return { content: [{ type: "text", text: "Not connected" }], isError: true };

    const { width, height } = (request.params.arguments || {}) as { width?: number; height?: number };
    const requestId = Math.random().toString(36).substring(7);

    return new Promise((resolve) => {
      activeSocket.once("screenshot_result", (data: any) => {
        if (data.requestId !== requestId) return;
        if (data.error) {
          resolve({ content: [{ type: "text", text: `Error: ${data.error}` }], isError: true });
          return;
        }
        const dataUrl: string = data.dataUrl || "";
        const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
        if (!match) {
          resolve({ content: [{ type: "text", text: `Invalid screenshot data` }], isError: true });
          return;
        }
        resolve({ content: [{ type: "image", data: match[2], mimeType: match[1] }] });
      });

      activeSocket.emit("capture_screenshot", { requestId, width, height });

      setTimeout(() => {
        resolve({ content: [{ type: "text", text: "Timeout: Blockbench didn't respond." }], isError: true });
      }, 10000);
    });
  }

  throw new Error("Tool not found");
});

const transport = new StdioServerTransport();
mcpServer.connect(transport).catch(e => console.error(e));