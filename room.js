// room.js
const params = new URLSearchParams(window.location.search);
const myName = params.get("name") || "Người dùng";
document.getElementById("usernameDisplay").innerText = myName;

const serverUrl = "wss://your-worker-name.username.workers.dev";
const socket = new WebSocket(serverUrl);

const videoGrid = document.getElementById("videoGrid");
const peers = {}; 
let localStream;
let localId = null;
let localAudioEnabled = true;
let localVideoEnabled = true;

// Tạo video UI
function createVideoEl(id, displayName, isLocal = false) {
  let wrapper = document.createElement("div");
  wrapper.className = "video-box";
  wrapper.id = "box-" + id;
  wrapper.style.minHeight = "140px";

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  if (isLocal) video.muted = true;
  video.style.width = "100%";
  video.style.height = "100%";
  video.style.objectFit = "cover";

  const label = document.createElement("div");
  label.className = "name-label";
  label.innerText = displayName || "Không tên";

  wrapper.appendChild(video);
  wrapper.appendChild(label);
  videoGrid.appendChild(wrapper);

  return { wrapper, video, label };
}

// Start camera + mic
async function startLocalMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    const ui = createVideoEl("local", myName, true);
    peers["local"] = { pc: null, videoEl: ui.video, wrapper: ui.wrapper, name: myName };
    ui.video.srcObject = localStream;

  } catch (e) {
    alert("Không thể truy cập camera/micro");
    console.error(e);
  }
}

// Send message to signaling server
function send(msg) {
  socket.send(JSON.stringify(msg));
}

// Create RTCPeerConnection
function createPeer(id, remoteName) {
  if (peers[id] && peers[id].pc) return peers[id].pc;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  // Gắn local stream vào pc
  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  const ui = createVideoEl(id, remoteName, false);
  peers[id] = { pc, videoEl: ui.video, wrapper: ui.wrapper, name: remoteName };

  pc.addEventListener("track", (ev) => {
    const stream = ev.streams && ev.streams[0]
      ? ev.streams[0]
      : new MediaStream(ev.track ? [ev.track] : []);
    peers[id].videoEl.srcObject = stream;
  });

  pc.addEventListener("icecandidate", (e) => {
    if (e.candidate) {
      send({
        type: "ice",
        to: id,
        from: localId,
        candidate: e.candidate
      });
    }
  });

  return pc;
}

// Remove a peer
function removePeer(id) {
  const p = peers[id];
  if (!p) return;

  if (p.pc) try { p.pc.close(); } catch (e) {}

  if (p.wrapper && p.wrapper.parentNode)
    p.wrapper.parentNode.removeChild(p.wrapper);

  delete peers[id];
}

// WebSocket events
socket.addEventListener("open", () => {
  send({ type: "join", name: myName });
});

socket.addEventListener("message", async (ev) => {
  const data = JSON.parse(ev.data);

  // ⇨ Nhận ID của chính mình
  if (data.type === "your-id") {
    localId = data.id;
    return;
  }

  // ⇨ Nhận danh sách peer cũ → tạo offer đến họ
  if (data.type === "existing-peers") {
    for (let p of data.peers) {
      const pc = createPeer(p.id, p.name);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      send({
        type: "offer",
        to: p.id,
        from: localId,
        name: myName,
        sdp: pc.localDescription
      });
    }
    return;
  }

  // ⇨ Có peer mới → mình tạo offer cho họ
  if (data.type === "new-peer") {
    const newId = data.id;
    const pc = createPeer(newId, data.name);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    send({
      type: "offer",
      to: newId,
      from: localId,
      name: myName,
      sdp: pc.localDescription
    });
    return;
  }

  // ⇨ Nhận offer → tạo answer
  if (data.type === "offer" && data.from) {
    const from = data.from;

    const pc = createPeer(from, data.name);
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    send({
      type: "answer",
      to: from,
      from: localId,
      name: myName,
      sdp: pc.localDescription
    });
    return;
  }

  // ⇨ Nhận answer → setRemoteDescription
  if (data.type === "answer" && data.from) {
    const from = data.from;
    const p = peers[from];
    if (p && p.pc) {
      await p.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    }
    return;
  }

  // ⇨ Nhận ICE
  if (data.type === "ice" && data.from) {
    const p = peers[data.from];
    if (p && p.pc) {
      try {
        await p.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (e) {
        console.warn("ICE error", e);
      }
    }
    return;
  }

  // ⇨ Peer rời phòng
  if (data.type === "peer-left") {
    removePeer(data.id);
    return;
  }
});

// Rời phòng
document.getElementById("leaveBtn").addEventListener("click", () => {
  for (let id in peers) {
    if (peers[id].pc) try { peers[id].pc.close(); } catch (e) {}

    if (peers[id].wrapper && peers[id].wrapper.parentNode)
      peers[id].wrapper.parentNode.removeChild(peers[id].wrapper);
  }

  if (localStream) localStream.getTracks().forEach(t => t.stop());

  socket.close();
  window.location.href = "index.html";
});

// Toggle mic
document.getElementById("toggleMic").addEventListener("click", () => {
  if (!localStream) return;
  localAudioEnabled = !localAudioEnabled;
  localStream.getAudioTracks().forEach(t => (t.enabled = localAudioEnabled));
});

// Toggle camera
document.getElementById("toggleCam").addEventListener("click", () => {
  if (!localStream) return;
  localVideoEnabled = !localVideoEnabled;
  localStream.getVideoTracks().forEach(t => (t.enabled = localVideoEnabled));
});

// Start local media
(async () => {
  await startLocalMedia();
})();
