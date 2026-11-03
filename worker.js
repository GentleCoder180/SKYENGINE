import { DurableObject } from "cloudflare:workers";

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  sockets() {
    return this.ctx.getWebSockets();
  }

  send(ws, data) {
    try { ws.send(JSON.stringify(data)); } catch {}
  }

  broadcast(data, except) {
    const message = JSON.stringify(data);
    for (const ws of this.sockets()) {
      if (ws !== except) {
        try { ws.send(message); } catch {}
      }
    }
  }

  async webSocketMessage(ws, raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    if (data.type === "join") {
      const name = String(data.name || "Player").replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 20) || "Player";
      const id = crypto.randomUUID();
      ws.serializeAttachment({ id, name, x: 0, y: 4, z: 0, yaw: 0 });
      const players = this.sockets().filter(s => s !== ws).map(s => s.deserializeAttachment()).filter(Boolean);
      const editsObject = await this.ctx.storage.get("edits") || {};
      const edits = Object.entries(editsObject).slice(-1200).map(([key, block]) => ({ key, block }));
      this.send(ws, { type: "welcome", id, players, edits });
      this.broadcast({ type: "player", player: { id, name, x: 0, y: 4, z: 0, yaw: 0 } }, ws);
      return;
    }

    const current = ws.deserializeAttachment();
    if (!current) return;

    if (data.type === "player") {
      const updated = {
        ...current,
        name: String(data.name || current.name).replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 20) || "Player",
        x: Number(data.x), y: Number(data.y), z: Number(data.z), yaw: Number(data.yaw)
      };
      if (![updated.x, updated.y, updated.z, updated.yaw].every(Number.isFinite)) return;
      if (Math.abs(updated.x) > 100000 || Math.abs(updated.y) > 256 || Math.abs(updated.z) > 100000) return;
      ws.serializeAttachment(updated);
      this.broadcast({ type: "player", player: updated }, ws);
      return;
    }

    if (data.type === "block") {
      const key = String(data.key || "");
      const parts = key.split(",").map(Number);
      const allowed = new Set(["grass","dirt","stone","wood","leaves","brick","sand","glass","coal","iron","gold_block","diamond","glider","crafting_table"]);
      if (parts.length !== 3 || parts.some(n => !Number.isInteger(n) || Math.abs(n) > 100000) || parts[1] < -6 || parts[1] > 48) return;
      if (data.block !== null && !allowed.has(data.block)) return;
      const edits = await this.ctx.storage.get("edits") || {};
      edits[key] = data.block;
      const entries = Object.entries(edits);
      if (entries.length > 1200) {
        for (const [oldKey] of entries.slice(0, entries.length - 1200)) delete edits[oldKey];
      }
      await this.ctx.storage.put("edits", edits);
      this.broadcast({ type: "block", key, block: data.block }, ws);
    }
  }

  async webSocketClose(ws) {
    const player = ws.deserializeAttachment();
    if (player?.id) this.broadcast({ type: "leave", id: player.id }, ws);
  }

  async webSocketError(ws) {
    const player = ws.deserializeAttachment();
    if (player?.id) this.broadcast({ type: "leave", id: player.id }, ws);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/room\/([A-Za-z0-9_-]{3,16})$/);
    if (!match) return new Response("SKYENGINE multiplayer server is running.", { status: 200 });
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket connection required.", { status: 426 });
    }
    const roomId = env.GAME_ROOMS.idFromName(match[1].toUpperCase());
    return env.GAME_ROOMS.get(roomId).fetch(request);
  }
};

export class RoomSocket extends DurableObject {
  async fetch(request) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }
}
