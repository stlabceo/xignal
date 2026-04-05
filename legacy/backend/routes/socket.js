// var express = require('express');
// var router = express.Router();
// const axios = require('axios');
// const redisClient = require('../util/redis.util');
// const jwt = require('../util/jwt.util');
// const db = require('../database/connect/config');
// const seon = require('../seon');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.JWT_KEY;
const users = {}; // { userId: socketId } 저장

module.exports = (server) => {
  const io = new Server(server, {
      cors: {
          origin: "*", // 클라이언트 도메인에 맞게 수정 가능
          methods: ["GET", "POST"]
      }
  });

  const wsOneSend = async (userId, type, data) => {
    const socketId = users[userId];
    const payload = {
        type: type,
        data: data,
    }

    // console.log('/////////// ', socketId);
    if (socketId) {
        io.to(socketId).emit('user-updated', payload);
        // console.log(`Sent data to user ${userId}:`, payload);
    } else {
        console.log(`❗ 유저 ${userId}의 소켓을 찾을 수 없습니다.`);
    }
  }


  io.use((socket, next) => {
    // 클라이언트에서 보낸 JWT 토큰 확인
    const token = socket.handshake.auth?.token;
    if (!token) {
        // console.log("⛔ JWT 토큰 없음 - 연결 거부");
        return next(new Error("Authentication error"));
    }

    // 토큰 검증
    jwt.verify(token, SECRET_KEY, (err, decoded) => {
      if (err) {
          // console.log("❌ JWT 검증 실패 - 연결 거부");
          return next(new Error("Authentication error"));
      }
      // console.log("✅ JWT 인증 성공 - 사용자:", decoded);
      socket.user = decoded; // 이후 소켓 이벤트에서 활용 가능
      users[decoded.userId] = socket.id; // userId -> socketId 매핑
      next();
    });
  });

  io.on('connection', (socket) => {
    // console.log('✅ 클라이언트 연결됨:', socket.id);
    // console.log(users);
    // 1초마다 클라이언트에게 데이터 전송
    
    // setInterval(() => {
    //   // const data = { time: new Date().toISOString(), value: Math.random() };

    //   console.log('------------------');
    //   for (let key in users) {
    //       const userId = key;
    //       const socketId = users[key];
    //       // console.log(key, users[key], socketId);
          
    //       // io.to(socketId).emit('user-updated', { msg: '123132132' });

    //       wsOneSend(userId, 'test', { msg: '123132132' })
    //   }
    // //   console.log('------------------ EE');



    // //   // socket.emit('data', data);
    // }, 3000);

    // 클라이언트 메시지 수신
    socket.on('message', (msg) => {
      // console.log('📩 클라이언트 메시지:', msg);
      socket.emit('response', `서버가 받은 메시지: ${msg}`);
    });

    // 연결 해제 이벤트
    socket.on('disconnect', () => {
      // console.log('❌ 클라이언트 연결 해제:', socket.id);
      delete users[socket.user.userId]; // 연결 종료 시 제거
    });
  });

  module.exports.io = io;
  module.exports.wsOneSend = wsOneSend;

  // module.exports.users = users;

  return { io, users };
};

module.exports.users = users;

