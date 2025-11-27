// room.js
const params = new URLSearchParams(window.location.search);
const myName = params.get("name") || "Người dùng";
document.getElementById("usernameDisplay").innerText = myName;

const serverUrl = "ws://localhost:3000"; // nếu test LAN -> ws://<your-ip>:3000
const socket = new WebSocket(serverUrl);

const videoGrid = document.getElementById("videoGrid");
const peers = {}; // id -> { pc, videoEl, name }
let localStream;
let localAudioEnabled = true;
let localVideoEnabled = true;
let localId = null;

// helper: tạo video element cho peer (local or remote)
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

// start local media
async function startLocalMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const { wrapper, video, label } = createVideoEl("local", myName, true);
    peers["local"] = { pc: null, videoEl: video, wrapper, name: myName };
    video.srcObject = localStream;
  } catch (e) {
    alert("Không thể truy cập camera/micro. Vui lòng kiểm tra quyền.");
    console.error(e);
  }
}

// signaling helpers
function send(msg) {
  socket.send(JSON.stringify(msg));
}

// create RTCPeerConnection and hook events
function createPeer(id, remoteName) {
  if (peers[id] && peers[id].pc) return peers[id].pc;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  // attach local tracks
  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  // create or reuse video element
  const { wrapper, video, label } = createVideoEl(id, remoteName || id, false);
  peers[id] = { pc, videoEl: video, wrapper, name: remoteName || id };

  // when remote track arrives
  pc.addEventListener("track", (ev) => {
    // ev.streams[0] may be undefined on some browsers; prefer ev.streams[0]
    const stream = ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream(ev.track ? [ev.track] : []);
    peers[id].videoEl.srcObject = stream;
  });

  // ICE -> send to remote
  pc.addEventListener("icecandidate", (e) => {
    if (e.candidate) {
      send({ type: "ice", to: id, candidate: e.candidate });
    }
  });

  return pc;
}

// remove peer UI and close pc
function removePeer(id) {
  const p = peers[id];
  if (!p) return;
  if (p.pc) try { p.pc.close(); } catch (e) {}
  if (p.wrapper && p.wrapper.parentNode) p.wrapper.parentNode.removeChild(p.wrapper);
  delete peers[id];
}

// active speaker detection (basic) — highlight wrapper when speaking
function monitorSpeaking(stream, wrapper) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    let last = 0;
    function tick() {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length;
      if (avg > 20) {
        wrapper.classList.add("speaking");
        last = Date.now();
      } else if (Date.now() - last > 700) {
        wrapper.classList.remove("speaking");
      }
      requestAnimationFrame(tick);
    }
    tick();
  } catch (e) {
    // nếu không thể, bỏ qua
  }
}

// WebSocket events
socket.addEventListener("open", () => {
  send({ type: "join", name: myName });
});

// receive messages
socket.addEventListener("message", async (ev) => {
  const data = JSON.parse(ev.data);

  if (data.type === "existing-peers") {
    // server trả về danh sách peer hiện có - ta sẽ chờ server nói new-peer hoặc tự khởi tạo
    // nothing to do here (we'll wait for new-peer events) or optionally create offers to them
    return;
  }

  if (data.type === "new-peer") {
    // existing clients sẽ tạo kết nối tới peer mới (initiator)
    const newId = data.id;
    const pc = createPeer(newId, data.name);
    // tạo offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: "offer", to: newId, from: localId, sdp: pc.localDescription });
    return;
  }

  if (data.type === "offer" && data.from) {
    // nhận offer: tạo peer (non-initiator), setRemote, tạo answer
    const from = data.from;
    const pc = createPeer(from, data.name);
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send({ type: "answer", to: from, from: localId, sdp: pc.localDescription });
    return;
  }

  if (data.type === "answer" && data.from) {
    const from = data.from;
    const p = peers[from];
    if (p && p.pc) {
      await p.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    }
    return;
  }

  if (data.type === "ice" && data.from) {
    const p = peers[data.from];
    if (p && p.pc) {
      try {
        await p.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (e) {
        console.warn("ICE candidate error", e);
      }
    }
    return;
  }

  if (data.type === "peer-left") {
    removePeer(data.id);
    return;
  }

  // optionally handle id assignment from server if you choose to implement; for now localId stay null
});

// Clean up when window closed
window.addEventListener("beforeunload", () => {
  socket.close();
});

// controls
document.getElementById("toggleMic").addEventListener("click", () => {
  if (!localStream) return;
  localAudioEnabled = !localAudioEnabled;
  localStream.getAudioTracks().forEach(t => t.enabled = localAudioEnabled);
});

document.getElementById("toggleCam").addEventListener("click", () => {
  if (!localStream) return;
  localVideoEnabled = !localVideoEnabled;
  localStream.getVideoTracks().forEach(t => t.enabled = localVideoEnabled);
});

document.getElementById("leaveBtn").addEventListener("click", () => {
  // close all peers, stop local tracks and go back
  Object.keys(peers).forEach(id => {
    if (peers[id].pc) try { peers[id].pc.close(); } catch(e){}
    if (peers[id].wrapper && peers[id].wrapper.parentNode) peers[id].wrapper.parentNode.removeChild(peers[id].wrapper);
  });
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }
  socket.close();
  window.location.href = "index.html";
});

// init
(async () => {
  await startLocalMedia();
})();
