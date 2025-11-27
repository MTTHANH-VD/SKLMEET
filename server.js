// server.js
const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: 3000 });

let clients = [];

wss.on("connection", (ws) => {
  ws.id = Math.random().toString(36).substr(2, 9);
  clients.push(ws);

  ws.on("message", (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch (e) { return; }

    if (data.type === "join") {
      // gửi id riêng cho client mới
      ws.send(JSON.stringify({ type: "your-id", id: ws.id }));

      // báo cho các client khác biết có người mới
      clients.forEach(c => {
        if (c !== ws)
          c.send(JSON.stringify({ type: "new-peer", id: ws.id, name: data.name }));
      });

      // gửi danh sách peer cũ cho người mới
      const existing = clients
        .filter(c => c !== ws)
        .map(c => ({ id: c.id, name: c.name }));
      ws.send(JSON.stringify({ type: "existing-peers", peers: existing }));
    }

    if (["offer", "answer", "ice"].includes(data.type)) {
      const target = clients.find(c => c.id === data.to);
      if (target) target.send(JSON.stringify(data));
    }
  });

  ws.on("close", () => {
    clients = clients.filter(c => c !== ws);
    clients.forEach(c =>
      c.send(JSON.stringify({ type: "peer-left", id: ws.id }))
    );
  });
});

console.log("Server chạy tại ws://localhost:3000");
