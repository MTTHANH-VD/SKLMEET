// server.js
// Run: node server.js
const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: 3000 });

let clients = [];

wss.on("connection", (ws) => {
  ws.id = Math.random().toString(36).substr(2, 9);
  clients.push(ws);

  // gửi id của client mới cho những client khác (họ sẽ khởi tạo kết nối tới người mới)
  ws.on("message", (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch (e) { return; }

    if (data.type === "join") {
      // gửi thông báo cho mọi client khác rằng có peer mới
      clients.forEach(c => {
        if (c !== ws) c.send(JSON.stringify({ type: "new-peer", id: ws.id, name: data.name }));
      });
      // cũng trả lại danh sách peers hiện có cho người mới (nếu cần)
      const existing = clients.filter(c => c !== ws).map(c => ({ id: c.id }));
      ws.send(JSON.stringify({ type: "existing-peers", peers: existing }));
    }

    // chuyển tiếp offer/answer/ice tới target
    if (["offer","answer","ice"].includes(data.type)) {
      const target = clients.find(c => c.id === data.to);
      if (target) target.send(JSON.stringify(data));
    }
  });

  ws.on("close", () => {
    // remove client
    clients = clients.filter(c => c !== ws);
    // thông báo cho tất cả client khác rằng peer đã rời
    clients.forEach(c => c.send(JSON.stringify({ type: "peer-left", id: ws.id })));
  });
});

console.log("WebSocket signaling server chạy tại ws://localhost:3000");
