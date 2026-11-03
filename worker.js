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
    const submissions = await this.ctx.storage.get("submissions") || {};
    const published = await this.ctx.storage.get("published") || {};
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
    if (url.pathname === "/api/ai/improve" && request.method === "POST") {
      if(!this.env.AI)return json({error:"Cloudflare Workers AI is not enabled for this Worker yet."},503);
      let body;try{body=await request.json()}catch{return json({error:"Invalid request"},400)}
      const title=String(body.title||"").slice(0,80),idea=String(body.idea||"").slice(0,1200),category=String(body.category||"other").slice(0,30);
      if(idea.trim().length<8)return json({error:"Describe your game idea first."},400);
      try{
        const result=await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct",{messages:[
          {role:"system",content:"You are SKYENGINE Creator Coach. Help young game creators improve safe, original voxel game ideas. Give practical suggestions for gameplay loop, level design, accessibility, fair multiplayer, and a short build checklist. Do not provide harmful, hateful, sexual, or dangerous content. Do not claim to publish or execute code."},
          {role:"user",content:"Project: "+title+"\nCategory: "+category+"\nIdea: "+idea+"\nGive 5 specific improvements and a 3-step build plan."}
        ]});
        return json({suggestions:String(result.response||"No suggestions returned.")});
      }catch(e){return json({error:"AI request failed. Check the Workers AI binding and account access."},502)}
    }
    if (url.pathname === "/api/catalog" && request.method === "GET") {
      return json({ games: Object.values(published).sort((a,b)=>(b.approvedAt||0)-(a.approvedAt||0)) });
    }
    if (url.pathname === "/api/submit" && request.method === "POST") {
      let body; try { body = await request.json(); } catch { return json({error:"Invalid request"},400); }
      const title=String(body.title||"").trim().replace(/[<>]/g,"").slice(0,40);
      const description=String(body.description||"").trim().replace(/[<>]/g,"").slice(0,500);
      const category=String(body.category||"").toLowerCase();
      const kind=String(body.kind||"world");
      const owner=String(body.owner||"Player").replace(/[^a-zA-Z0-9 _-]/g,"").slice(0,24)||"Player";
      const payload=String(body.payload||"");
      const categories=new Set(["adventure","survival","creative","parkour","minigames","roleplay","puzzle","racing","other"]);
      if(title.length<3||description.length<10||!categories.has(category)||!["world","game"].includes(kind)||payload.length<2||payload.length>50000)
        return json({error:"Check the title, description, category and project data (maximum 50 KB)."},400);
      if(Object.keys(submissions).length>=500)return json({error:"The review queue is full. Try again later."},429);
      const id=crypto.randomUUID().slice(0,8).toUpperCase();
      submissions[id]={id,title,description,category,kind,owner,payload,status:"pending",submittedAt:Date.now()};
      await this.ctx.storage.put("submissions",submissions);
      return json({ok:true,id,status:"pending"},201);
    }
    if (url.pathname === "/api/like" && request.method === "POST") {
      let body; try { body = await request.json(); } catch { return json({error:"Invalid request"},400); }
      const id=String(body.id||"").toUpperCase(), player=String(body.player||"").trim().slice(0,24);
      if(!published[id])return json({error:"Published game not found."},404);
      if(!player)return json({error:"Log in first."},400);
      const liked=published[id].likedBy||[];
      if(liked.includes(player.toLowerCase()))return json({game:published[id],alreadyLiked:true});
      liked.push(player.toLowerCase());published[id].likedBy=liked;published[id].likes=liked.length;
      await this.ctx.storage.put("published",published);
      return json({game:published[id],alreadyLiked:false});
    }
    if (url.pathname === "/api/admin/submissions" && request.method === "GET") {
      if(request.headers.get("X-Admin-Name")!=="Theadmin"||!this.env.ADMIN_PASSWORD||request.headers.get("X-Admin-Password")!==this.env.ADMIN_PASSWORD)return json({error:"Admin authorization failed."},401);
      return json({submissions:Object.values(submissions).sort((a,b)=>a.submittedAt-b.submittedAt)});
    }
    if (url.pathname === "/api/admin/review" && request.method === "POST") {
      if(request.headers.get("X-Admin-Name")!=="Theadmin"||!this.env.ADMIN_PASSWORD||request.headers.get("X-Admin-Password")!==this.env.ADMIN_PASSWORD)return json({error:"Admin authorization failed."},401);
      let body;try{body=await request.json()}catch{return json({error:"Invalid request"},400)}
      const id=String(body.id||"").toUpperCase(),action=String(body.action||"");
      if(!submissions[id])return json({error:"Submission not found."},404);
      if(!["approve","reject"].includes(action))return json({error:"Choose approve or reject."},400);
      const item=submissions[id];
      if(action==="approve"){
        published[id]={id,title:item.title,description:item.description,category:item.category,kind:item.kind,owner:item.owner,payload:item.payload,likes:0,likedBy:[],approvedAt:Date.now()};
      }
      item.status=action==="approve"?"approved":"rejected";item.reviewedAt=Date.now();
      await this.ctx.storage.put("submissions",submissions);await this.ctx.storage.put("published",published);
      return json({ok:true,status:item.status});
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
