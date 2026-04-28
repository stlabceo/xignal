const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const SECRET_KEY = process.env.JWT_KEY;
const users = {};

module.exports = (server) => {
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  const wsOneSend = async (userId, type, data) => {
    const socketId = users[userId];
    const payload = {
      type,
      data,
    };

    if (socketId) {
      io.to(socketId).emit('user-updated', payload);
    } else {
      console.log(`사용자 ${userId}의 소켓을 찾을 수 없습니다.`);
    }
  };

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication error'));
    }

    jwt.verify(token, SECRET_KEY, (err, decoded) => {
      if (err) {
        return next(new Error('Authentication error'));
      }

      socket.user = decoded;
      users[decoded.userId] = socket.id;
      next();
    });
  });

  io.on('connection', (socket) => {
    socket.on('message', (msg) => {
      socket.emit('response', `서버가 받은 메시지: ${msg}`);
    });

    socket.on('disconnect', () => {
      delete users[socket.user.userId];
    });
  });

  module.exports.io = io;
  module.exports.wsOneSend = wsOneSend;

  return { io, users };
};

module.exports.users = users;
