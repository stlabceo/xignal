var createError = require('http-errors');
var express = require('express');
var cors = require('cors')
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const auth = require('./middleware/auth');

require("dotenv").config();

var adminRouter = require('./routes/admin');
var usersRouter = require('./routes/users');
var statsRouter = require('./routes/stats');

var app = express();

const db = require('./database/connect/config');
// db.connect();
db.getConnection();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(cors())
// app.use(cors({origin: process.env.SERVER_HOST }))
// app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const USER_TRADING_ROUTE_ALLOWLIST = new Set([
  'GET /price',
  'GET /candle/data',
  'GET /live/list',
  'GET /live/detail',
  'GET /live/performance-summary',
  'GET /live/track-record/runtime/recent',
  'GET /live/track-record/runtime/item',
  'GET /exchange/symbol-rules',
  'GET /trading/catalog-options',
  'GET /msg/user-facing',
  'POST /live/add',
  'POST /live/edit',
  'POST /live/auto',
  'POST /live/del',
  'GET /grid/live/list',
  'GET /grid/live/detail',
  'POST /grid/live/add',
  'POST /grid/live/edit',
  'POST /grid/live/auto',
  'POST /grid/live/del',
]);

const restrictUserTradingRoute = (req, res, next) => {
  const routeKey = `${String(req.method || '').toUpperCase()} ${req.path}`;
  if (USER_TRADING_ROUTE_ALLOWLIST.has(routeKey)) {
    return next();
  }

  return res.status(404).json({
    ok: false,
    message: 'User trading API route is not available.',
  });
};

app.use('/admin/stats', auth.verifyToken, statsRouter);
app.use('/admin',auth.verifyToken, adminRouter);
app.use('/user/api/stats', statsRouter);
app.use('/user/api/trading', auth.verifyToken, restrictUserTradingRoute, adminRouter);
app.use('/user', usersRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;

