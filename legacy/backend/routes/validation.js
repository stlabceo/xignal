const { check, validationResult } = require('express-validator');
const seon = require('../seon');
const dbcon = require("../dbcon");


// 회원가입 벨리데이션
const validateRegister = [
  check('username')
    .notEmpty().withMessage('이름을 입력해 주세요')
    .bail()
    .isLength({ min: 2 }).withMessage('이름은 2자 이상이어야 합니다.'),
  check('memberid')
    .notEmpty().withMessage('아이디를 입력해 주세요')
    .bail()
    .isLength({ min: 3 }).withMessage('아이디는 3자 이상이어야 합니다.')
    .bail()
    .custom(async (memberid) => {
      const exID = await dbcon.DBOneCall(`CALL SP_U_ID_CHECK(?)`,[memberid]);

      if (exID) {
        throw new Error('이미 등록된 아이디입니다');
      }
    }),
  check('email')
    .isEmail().withMessage('유효하지 않은 이메일 주소입니다')
    .normalizeEmail(),

  check('password')
    .isLength({ min: 8 }).withMessage('비밀번호는 8자 이상이어야 합니다')
    .bail()
    .matches(/[a-zA-Z]/).withMessage('영문, 숫자, 특수문자 조합으로 입력해 주세요')
    .bail()
    .matches(/\d/).withMessage('영문, 숫자, 특수문자 조합으로 입력해 주세요')
    .bail()
    .matches(/[\W_]/).withMessage('영문, 숫자, 특수문자 조합으로 입력해 주세요')
    .bail(),
  check('password2')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('동일한 비밀번호를 입력해 주세요');
      }
      return true;
    }),
  check('mobile')
    .notEmpty().withMessage('휴대전화 번호를 입력해 주세요')
    .bail()
    .matches(/^010-?\d{4}-?\d{4}$/).withMessage('11자리 휴대전화 번호를 입력해 주세요'),

  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];

const validateItemAdd = [
  check('enter')
    .custom((value, { req }) => {
      if (req.body.direct1ST == 'N' && (!(0 <= value && value <= 10) || value == null, value == undefined)) {
        throw new Error('진입은 0%~10%까지 입력가능합니다.');
      }
      return true;
    }).bail(),
  check('cancel')
    .custom((value, { req }) => {
      if (req.body.direct1ST == 'N' && (!(0 <= value && value <= 10) || !value)) {
        throw new Error('진입취소는 0%~10%까지 입력가능합니다.');
      }
      return true;
    }).bail(),
  check('profit')
    .custom((value, { req }) => {
      if (!(0.1 <= value && value <= 50) || !value) {
        throw new Error('익절은 0.1%~50%까지 입력가능합니다.');
      }
      return true;
    }).bail(),
  check('stopLoss')
    .custom((value, { req }) => {
      if (!(0.1 <= value && value <= 50) || !value) {
        throw new Error('손절은 0.1%~50%까지 입력가능합니다.');
      }
      return true;
    }).bail(),




  check('t_cancelStopLoss')
    .custom((value, { req }) => {
      if (req.body.trendOrderST == 'Y' && (!(0.3 <= value && value <= 50) || !value)) {
        throw new Error('TS 조건은 0.3%~50% 까지 입력가능합니다.');
      }
      return true;
    }).bail(),

  check('t_chase')
    .custom((value, { req }) => {
      if (req.body.trendOrderST == 'Y' && (req.body.t_cancelStopLoss <= value || !(0.1 <= value && value <= 48.8) || !value)) {
        throw new Error('TS 설정은 1) TS 조건보다 낮아야 하고, 2) 0.1%~48.8% 까지 입력가능합니다.');
      }
      return true;
    }).bail(),

  check('margin')
    .custom((value, { req }) => {
      if (!(10 <= value) || !value) {
        throw new Error('마진은 10$ 이상 보유예탁금 이하 설정 가능합니다.');
      }
      return true;
    }).bail(),

  check('leverage')
    .custom((value, { req }) => {
      if (!(1 <= value && value <= 100) || !value) {
        throw new Error('레버리지는 1이상 100이하 입력 가능합니다.');
      }
      return true;
    }).bail(),

  check('second2')
    .notEmpty().withMessage('지표 설정을 선택해주세요.').bail(),
  check('second3')
    .notEmpty().withMessage('지표 설정을 선택해주세요.').bail(),
  check('second4')
    .notEmpty().withMessage('지표 설정을 선택해주세요.').bail(),

  // check('m_cancelStopLoss')
  //   .custom((value, { req }) => {
  //     if (req.body.minimumOrderST == 'Y' && (value == '' || value == null || value == 0)) {
  //       throw new Error('손절 취소 설정을 입력해주세요.');
  //     }
  //     return true;
  //   }).bail()
  //   .custom((value, { req }) => {
  //     if (req.body.minimumOrderST == 'Y' && (req.body.profit <= value)) {
  //       throw new Error('손절취소 설정은 주문설정 1차 익절보다 동일하게 설정하거나 높게 설정할 수 없습니다.');
  //     }
  //     return true;
  //   }).bail(),
  // check('m_profit')
  //   .custom((value, { req }) => {
  //     if (req.body.minimumOrderST == 'Y' && (value == '' || value == null || value == 0)) {
  //       throw new Error('2차 익절 설정을 입력해주세요.');
  //     }
  //     return true;
  //   }).bail()
  //   .custom((value, { req }) => {
  //     if (req.body.minimumOrderST == 'Y' && (req.body.profit <= value)) {
  //       throw new Error('2차익절 설정은 주문설정 1차 익절보다 동일하게 설정하거나 높게 설정할 수 없습니다.');
  //     }
  //     return true;
  //   }).bail()
  //   .custom((value, { req }) => {
  //     if (req.body.minimumOrderST == 'Y' && (req.body.m_cancelStopLoss < value)) {
  //       throw new Error('손절 취소보다 2차 익절을 높게 설정할 수 없습니다.');
  //     }
  //     return true;
  //   }).bail()
  //   .custom((value, { req }) => {
  //     if (req.body.minimumOrderST == 'Y' && (req.body.m_cancelStopLoss == value || req.body.profit == value)) {
  //       throw new Error('2차 익절은 1차 익절 및 손절취소와 동일하게 설정할 수 없습니다.');
  //     }
  //     return true;
  //   }).bail(),

  // check('t_cancelStopLoss')
  //   .custom((value, { req }) => {
  //     if (req.body.trendOrderST == 'Y' && (value == '' || value == null || value == 0)) {
  //       throw new Error('손절익절취소 설정을 입력해 주세요.');
  //     }
  //     return true;
  //   }).bail()
  //   .custom((value, { req }) => {
  //     if (req.body.trendOrderST == 'Y' && (req.body.profit <= value)) {
  //       throw new Error('손절취소 설정은 주문설정 1차 익절보다 동일하게 설정하거나 높게 설정할 수 없습니다.');
  //     }
  //     return true;
  //   }).bail(),
  // check('t_profit')
  //   .custom((value, { req }) => {
  //     if (req.body.trendOrderST == 'Y' && (value == '' || value == null || value == 0)) {
  //       throw new Error('2차 익절 설정을 입력해주세요.');
  //     }
  //     return true;
  //   }).bail()

  //   .custom((value, { req }) => {
  //     if (req.body.trendOrderST == 'Y' && (req.body.profit <= value)) {
  //       throw new Error('2차익절 설정은 주문설정 1차 익절보다 동일하게 설정하거나 높게 설정할 수 없습니다.');
  //     }
  //     return true;
  //   }).bail()
  //   .custom((value, { req }) => {
  //     if (req.body.trendOrderST == 'Y' && (req.body.t_cancelStopLoss < value)) {
  //       throw new Error('추세주문 2차익절은 손절취소주문 설정보다 높게 설정할 수 없습니다.');
  //     }
  //     return true;
  //   }).bail()
  //   .custom((value, { req }) => {
  //     if (req.body.trendOrderST == 'Y' && (req.body.t_cancelStopLoss == value || req.body.profit == value)) {
  //       throw new Error('2차 익절은 1차 익절 및 손절익절취소와 동일하게 설정할 수 없습니다.');
  //     }
  //     return true;
  //   }).bail(),
  // check('t_chase')
  //   .custom((value, { req }) => {
  //     if (req.body.trendOrderST == 'Y' && (value == '' || value == null || value == 0)) {
  //       throw new Error('추세추격 설정을 입력해주세요.');
  //     }
  //     return true;
  //   }).bail(),

  // check('t_ST')
  //   .custom((value, { req }) => {
  //     if (req.body.trendOrderST == 'Y' && req.body.t_autoST == 'N' && value == 'N') {
  //       throw new Error('추세 추격이나 자동청산 둘 중의 하나를 선택해야 추세주문 설정이 적용됩니다.');
  //     }
  //     return true;
  //   }).bail()
  //   ,
    

  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(500).json({ errors: errors.array() });
    }
    next();
  }
];

const validateStart = [
  check('enter')
    .notEmpty().withMessage('진입 설정을 입력해주세요.').bail()
    .isInt({ min: 4, max:70 }).withMessage('진입은 최소 4틱 이상 70틱이하 값으로 설정하실 수 있습니다.').bail(),
  check('cancel')
    .notEmpty().withMessage('진입취소 설정을 입력해주세요.').bail()
    .isInt({ min: 4, max:70 }).withMessage('진입취소는 최소 4틱 이상 70틱이하 값으로 설정하실 수 있습니다.').bail(),
  check('profit')
    .notEmpty().withMessage('1차 익절 설정을 입력해주세요.').bail()
    .isInt({ min: 20 }).withMessage('1차 익절은 최소 20틱부터 설정이 가능합니다.').bail(),
  check('stopLoss')
    .notEmpty().withMessage('손절 설정을 입력해주세요.').bail()
    .isInt({ min: 20 }).withMessage('손절은 최소 20틱부터 설정이 가능합니다.').bail(),

  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(500).json({ errors: errors.array() });
    }
    next();
  }
];

// 로그인 벨리데이션
const validateLogin = [
  check('userId')
    .notEmpty().withMessage('이름과 이메일을 입력해주세요'),
  check('password')
    .notEmpty().withMessage('이름과 이메일을 입력해주세요'),

  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ status: 400, errors: errors.array() });
    }
    next();
  }
];

const validateRegister1 = [
  check('username')
    .notEmpty().withMessage('이름을 입력해 주세요')
    .bail()
    .isLength({ min: 2 }).withMessage('이름은 2자 이상이어야 합니다.'),
  check('email')
    .isEmail().withMessage('유효하지 않은 이메일 주소입니다')
    .normalizeEmail(),
  // check('agree')
  //   .custom((value, { req }) => {
  //     if (value !== true) {
  //       throw new Error('이용약관 및 개인정보보호정책 동의를 하셔야 가입이가능합니다.');
  //     }
  //     return true;
  //   }),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];


const validateRegister2 = [
  check('memberid')
    .notEmpty().withMessage('아이디를 입력해 주세요')
      .bail()
    .isLength({ min: 4 }).withMessage("아이디는 4자 이상이어야 합니다.")
      .bail()
    .custom(async (memberid) => {
      const exID = await dbcon.DBOneCall(`CALL SP_U_ID_CHECK(?)`,[memberid]);

      if (exID) {
        throw new Error('이미 등록된 아이디입니다');
      }
    }),
  check('password')
    .notEmpty().withMessage('비밀번호를 입력해 주세요')
      .bail()
    .isLength({ min: 6 }).withMessage("영문/숫자 조합 6자리 이상 입력해주세요.")
      .bail()
    .matches(/[a-zA-Z]/).withMessage('영문/숫자 조합 6자리 이상 입력해주세요.')
      .bail()
    .matches(/\d/).withMessage('영문/숫자 조합 6자리 이상 입력해주세요.'),
  check('password2')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('동일한 비밀번호를 입력해 주세요');
      }
      return true;
    }),

  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];


module.exports = { 
  validateRegister,
  validateRegister1,
  validateRegister2,
  validateLogin,
  validateItemAdd,
  validateStart
};