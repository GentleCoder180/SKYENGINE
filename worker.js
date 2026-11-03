import { DurableObject } from "cloudflare:workers";

const MODES = new Set(["survival", "creative", "parkour"]);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Admin-Name,X-Admin-Password",
  "Content-Type": "application/json"
};
function json(data, status=200) { return new Response(JSON.stringify(data), { status, headers: cors }); }

export class Lobby extends DurableObject {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const games = await this.ctx.storage.get("games") || {};
    if (url.pathname === "/api/games" && request.method === "GET") {
      return json({ games: Object.values(games).sort((a,b) => b.createdAt-a.createdAt) });
    }
    if (url.pathname === "/api/games" && request.method === "POST") {
      let body; try { body = await request.json(); } catch { return json({error:"Invalid request"},400); }
      const name = String(body.name || "").trim().replace(/[<>]/g,"").slice(0,28);
      const mode = String(body.mode || "survival");
      if (name.length < 3) return json({error:"Game name must be at least 3 characters."},400);
      if (!MODES.has(mode)) return json({error:"Choose a supported game type."},400);
      if (Object.keys(games).length >= 100) return json({error:"The public room list is full. Try again later."},429);
      let id;
      do { id = crypto.randomUUID().replace(/-/g,"").slice(0,6).toUpperCase(); } while (games[id]);
      const game = { id, name, mode, owner: String(body.owner || "Player").slice(0,20), createdAt: Date.now() };
      games[id] = game;
      await this.ctx.storage.put("games", games);
      const roomId = this.env.GAME_ROOMS.idFromName(id);
      await this.env.GAME_ROOMS.get(roomId).fetch("https://room.internal/configure", {
        method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({name,mode})
      });
      return json({game},201);
    }
    if (url.pathname === "/api/admin/login" && request.method === "POST") {
      let body; try { body = await request.json(); } catch { return json({error:"Invalid request"},400); }
      const expected = this.env.ADMIN_PASSWORD;
      if (!expected) return json({error:"Admin password is not configured in Cloudflare yet."},503);
      if (String(body.username) !== "Theadmin" || String(body.password) !== expected) return json({error:"Admin username or password is incorrect."},401);
      return json({ok:true});
    }
    if (url.pathname === "/api/admin/remove" && request.method === "POST") {
      if (!this.env.ADMIN_PASSWORD ||
          request.headers.get("X-Admin-Name") !== "Theadmin" ||
          request.headers.get("X-Admin-Password") !== this.env.ADMIN_PASSWORD) return json({error:"Admin authorization failed."},401);
      let body; try { body = await request.json(); } catch { return json({error:"Invalid request"},400); }
      const id = String(body.id || "").toUpperCase();
      if (!games[id]) return json({error:"Room not found."},404);
      delete games[id]; await this.ctx.storage.put("games",games);
      return json({ok:true});
    }
    return json({error:"Not found"},404);
  }
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) { super(ctx, env); }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/configure" && request.method === "POST") {
      const body = await request.json();
      const mode = MODES.has(body.mode) ? body.mode : "survival";
      await this.ctx.storage.put("gameInfo", { name:String(body.name||"Game").slice(0,28), mode });
      if (mode === "parkour") {
        const edits = {};
        const pads = [
          {x:0,y:8,z:0,size:3},
          {x:4,y:9,z:0,size:2},
          {x:8,y:10,z:2,size:2},
          {x:12,y:11,z:0,size:2},
          {x:16,y:12,z:-2,size:2},
          {x:20,y:13,z:0,size:2},
          {x:24,y:14,z:0,size:3,finish:true}
        ];
        for (const pad of pads) {
          for (let dx=0; dx<pad.size; dx++) for (let dz=0; dz<pad.size; dz++) {
            edits[`${pad.x+dx},${pad.y},${pad.z+dz}`] = pad.finish ? "gold_block" : "brick";
          }
        }
        await this.ctx.storage.put("edits", edits);
      }
      return new Response("ok");
    }
    if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket connection required.", {status:426});
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null,{status:101,webSocket:pair[0]});
  }
  sockets() { return this.ctx.getWebSockets(); }
  send(ws,data) { try { ws.send(JSON.stringify(data)); } catch {} }
  broadcast(data,except) {
    const message=JSON.stringify(data);
    for(const ws of this.sockets()) if(ws!==except) { try{ws.send(message)}catch{} }
  }
  async webSocketMessage(ws,raw) {
    let data; try{data=JSON.parse(raw)}catch{return}
    if(data.type==="join") {
      const name=String(data.name||"Player").replace(/[^a-zA-Z0-9 _-]/g,"").slice(0,20)||"Player";
      const id=crypto.randomUUID();
      ws.serializeAttachment({id,name,x:0,y:4,z:0,yaw:0});
      const players=this.sockets().filter(s=>s!==ws).map(s=>s.deserializeAttachment()).filter(Boolean);
      const editsObject=await this.ctx.storage.get("edits")||{};
      const edits=Object.entries(editsObject).slice(-1200).map(([key,block])=>({key,block}));
      const game=await this.ctx.storage.get("gameInfo")||{name:"Room",mode:"survival"};
      this.send(ws,{type:"welcome",id,players,edits,game});
      this.broadcast({type:"player",player:{id,name,x:0,y:4,z:0,yaw:0}},ws); return;
    }
    const current=ws.deserializeAttachment(); if(!current)return;
    if(data.type==="player") {
      const updated={...current,name:String(data.name||current.name).replace(/[^a-zA-Z0-9 _-]/g,"").slice(0,20)||"Player",x:Number(data.x),y:Number(data.y),z:Number(data.z),yaw:Number(data.yaw)};
      if(![updated.x,updated.y,updated.z,updated.yaw].every(Number.isFinite)||Math.abs(updated.x)>100000||Math.abs(updated.y)>256||Math.abs(updated.z)>100000)return;
      ws.serializeAttachment(updated);this.broadcast({type:"player",player:updated},ws);return;
    }
    if(data.type==="block") {
      const key=String(data.key||"");const parts=key.split(",").map(Number);
      const allowed=new Set(["grass","dirt","stone","wood","leaves","brick","sand","glass","coal","iron","gold_block","diamond","glider","crafting_table"]);
      if(parts.length!==3||parts.some(n=>!Number.isInteger(n)||Math.abs(n)>100000)||parts[1]<-6||parts[1]>48||(data.block!==null&&!allowed.has(data.block)))return;
      const edits=await this.ctx.storage.get("edits")||{};edits[key]=data.block;
      const entries=Object.entries(edits);if(entries.length>1200)for(const [oldKey] of entries.slice(0,entries.length-1200))delete edits[oldKey];
      await this.ctx.storage.put("edits",edits);this.broadcast({type:"block",key,block:data.block},ws);
    }
  }
  async webSocketClose(ws) { const p=ws.deserializeAttachment();if(p?.id)this.broadcast({type:"leave",id:p.id},ws); }
  async webSocketError(ws) { const p=ws.deserializeAttachment();if(p?.id)this.broadcast({type:"leave",id:p.id},ws); }
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname.startsWith("/api/")) return env.LOBBY.get(env.LOBBY.idFromName("global-lobby")).fetch(request);
    const match=url.pathname.match(/^\/room\/([A-Za-z0-9_-]{3,16})$/);
    if(!match)return new Response("SKYENGINE multiplayer server is running.",{status:200});
    if(request.headers.get("Upgrade")!=="websocket")return new Response("WebSocket connection required.",{status:426});
    const roomId=env.GAME_ROOMS.idFromName(match[1].toUpperCase());
    return env.GAME_ROOMS.get(roomId).fetch(request);
  }
};
