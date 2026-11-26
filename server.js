
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(server, {
  cors: { origin: "*" }
});

app.get("/", (req, res) => {
  res.send("분신 키우기 서버가 실행 중입니다!");
});

io.on("connection", (socket) => {
  console.log("플레이어 접속:", socket.id);

  socket.on("chat", (message) => {
    if (typeof message !== "string") return;
    const safeMessage = message.trim().slice(0, 200);
    if (!safeMessage) return;

    io.emit("chat", {
      player: "플레이어",
      message: safeMessage
    });
  });

  socket.on("disconnect", () => {
    console.log("플레이어 접속 종료:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`서버 실행 중: 포트 ${PORT}`);
});
