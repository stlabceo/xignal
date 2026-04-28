const { check, validationResult } = require("express-validator");
const dbcon = require("../dbcon");
const splitTakeProfit = require("../split-take-profit");
const adminManagement = require("../admin-management");

const MIN_MARGIN_USDT = 5;

const isBlank = (value) =>
  value === "" || value === null || value === undefined;

const toNumber = (value) => Number(value);

const toEnabledFlag = (value) =>
  value === true || value === "true" || value === "Y" || value === 1 || value === "1";

const hasPositiveNumber = (value) => {
  if (isBlank(value)) {
    return false;
  }

  const numericValue = toNumber(value);
  return Number.isFinite(numericValue) && numericValue > 0;
};

const validateMinimumTradeRequirements = async ({ symbol, margin, leverage }) => {
  const numericMargin = toNumber(margin);
  const numericLeverage = toNumber(leverage);
  if (!Number.isFinite(numericMargin) || !Number.isFinite(numericLeverage)) {
    return null;
  }

  const tradeValue = numericMargin * numericLeverage;
  const symbolRules = await adminManagement.getExchangeSymbolRuleSummary(symbol).catch(() => null);
  const minTradeValue = Number(symbolRules?.minTradeValue || 0);

  if (minTradeValue > 0 && tradeValue + 0.0000001 < minTradeValue) {
    throw new Error(
      `Trade value must be at least ${minTradeValue} USDT for ${String(symbolRules?.symbol || symbol || "").toUpperCase()}.`
    );
  }

  return {
    tradeValue,
    minTradeValue,
    symbolRules,
  };
};

const getSplitTakeProfitConfig = (req) => {
  if (req._splitTakeProfitConfig) {
    return req._splitTakeProfitConfig;
  }

  req._splitTakeProfitConfig = splitTakeProfit.normalizeSplitTakeProfitPayload({
    ...req.body,
  });
  return req._splitTakeProfitConfig;
};

const validateSplitTakeProfitConfig = (req) => {
  const config = getSplitTakeProfitConfig(req);
  if (!config.enabled) {
    return null;
  }

  if (!hasPositiveNumber(req.body.stopLoss)) {
    throw new Error("Split take profit requires a percent stop loss.");
  }

  if (!Array.isArray(config.stages) || config.stages.length === 0) {
    throw new Error("Configure at least one split take profit stage.");
  }

  if (config.splitTakeProfitCount !== config.stages.length) {
    throw new Error("Split take profit stage count does not match configured rows.");
  }

  if (config.stages.length > splitTakeProfit.MAX_SPLIT_TAKE_PROFIT_STAGES) {
    throw new Error("Split take profit stage count exceeds the admin maximum.");
  }

  let previousTp = 0;
  let ratioTotal = 0;
  for (const stage of config.stages) {
    if (!(stage.tpPercent > previousTp)) {
      throw new Error("Split take profit stages must be sorted by ascending TP.");
    }

    if (!(stage.closeRatio > 0)) {
      throw new Error("Each split take profit stage requires a positive close ratio.");
    }

    previousTp = stage.tpPercent;
    ratioTotal += stage.closeRatio;
  }

  if (Math.abs(ratioTotal - 100) > 0.001) {
    throw new Error("Split take profit ratios must add up to 100%.");
  }

  return config;
};

const respondValidation = (status = 400) => (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(status).json({ errors: errors.array() });
  }
  next();
};

const validateRegister = [
  check("username")
    .notEmpty()
    .withMessage("??已????낆젾??雅뚯눘苑??")
    .bail()
    .isLength({ min: 2 })
    .withMessage("??已?? 2????곴맒 ??낆젾??雅뚯눘苑??"),
  check("memberid")
    .notEmpty()
    .withMessage("?袁⑹뵠?遺? ??낆젾??雅뚯눘苑??")
    .bail()
    .isLength({ min: 3 })
    .withMessage("?袁⑹뵠?遺얜뮉 3????곴맒 ??낆젾??雅뚯눘苑??")
    .bail()
    .custom(async (memberid) => {
      const existingId = await dbcon.DBOneCall(`CALL SP_U_ID_CHECK(?)`, [memberid]);
      if (existingId) {
        throw new Error("??? ?源낆쨯???袁⑹뵠?遺우뿯??덈뼄.");
      }
      return true;
    }),
  check("email")
    .isEmail()
    .withMessage("?醫륁뒞????李??雅뚯눘?쇘몴???낆젾??雅뚯눘苑??")
    .normalizeEmail(),
  check("password")
    .isLength({ min: 8 })
    .withMessage("??쑬?甕곕뜇???8????곴맒 ??낆젾??雅뚯눘苑??")
    .bail()
    .matches(/[a-zA-Z]/)
    .withMessage("??쑬?甕곕뜇????怨론? ??ъ쁽, ?諭?붻눧紐꾩쁽??筌뤴뫀紐???釉??곷튊 ??몃빍??")
    .bail()
    .matches(/\d/)
    .withMessage("??쑬?甕곕뜇????怨론? ??ъ쁽, ?諭?붻눧紐꾩쁽??筌뤴뫀紐???釉??곷튊 ??몃빍??")
    .bail()
    .matches(/[\W_]/)
    .withMessage("??쑬?甕곕뜇????怨론? ??ъ쁽, ?諭?붻눧紐꾩쁽??筌뤴뫀紐???釉??곷튊 ??몃빍??"),
  check("password2").custom((value, { req }) => {
    if (value !== req.body.password) {
      throw new Error("??쑬?甕곕뜇???類ㅼ뵥????깊뒄??? ??녿뮸??덈뼄.");
    }
    return true;
  }),
  check("mobile")
    .notEmpty()
    .withMessage("????袁れ넅 甕곕뜇?뉒몴???낆젾??雅뚯눘苑??")
    .bail()
    .matches(/^010-?\d{4}-?\d{4}$/)
    .withMessage("????袁れ넅 甕곕뜇???010-0000-0000 ?類ㅻ뻼??곗쨮 ??낆젾??雅뚯눘苑??"),
  respondValidation(400),
];

const validateItemAdd = [
  check("type").custom((value) => {
    const normalizedType = adminManagement.normalizeSignalStrategyCode(value);
    if (!normalizedType) {
      throw new Error("전략을 선택해 주세요.");
    }

    if (normalizedType.length > adminManagement.SIGNAL_RUNTIME_TYPE_MAX_LENGTH) {
      throw new Error(
        `Signal PID create is blocked because strategy type length ${normalizedType.length} exceeds runtime max length ${adminManagement.SIGNAL_RUNTIME_TYPE_MAX_LENGTH}.`
      );
    }

    return true;
  }),
  check("profit").custom((value, { req }) => {
    if (validateSplitTakeProfitConfig(req)) {
      return true;
    }

    if (isBlank(value) || !(0.1 <= toNumber(value) && toNumber(value) <= 50)) {
      throw new Error("???쟿 揶쏅?? 0.1%~50% 甕곕뗄??癒?퐣 ??낆젾??雅뚯눘苑??");
    }
    return true;
  }),
  check("stopLoss").custom((value, { req }) => {
    const percentEnabled = hasPositiveNumber(value);
    const reverseEnabled = toEnabledFlag(req.body.stopLossReverseEnabled);
    const timeEnabled = toEnabledFlag(req.body.stopLossTimeEnabled);

    if (!percentEnabled && !reverseEnabled && !timeEnabled) {
      throw new Error("?癒?쟿 ????? ?癒?쟿(%), 獄쏆꼶? ?醫륁깈, ??볦퍢 野껋럡??餓???롪돌 ??곴맒 ?醫뤾문??곷튊 ??몃빍??");
    }

    if (percentEnabled && !(0.1 <= toNumber(value) && toNumber(value) <= 50)) {
      throw new Error("?癒?쟿 揶쏅?? 0.1%~50% 甕곕뗄??癒?퐣 ??낆젾??雅뚯눘苑??");
    }

    return true;
  }),
  check("stopLossTimeValue").custom((value, { req }) => {
    validateSplitTakeProfitConfig(req);

    if (!toEnabledFlag(req.body.stopLossTimeEnabled)) {
      return true;
    }

    const numericValue = toNumber(value);
    if (
      isBlank(value) ||
      !Number.isFinite(numericValue) ||
      !Number.isInteger(numericValue) ||
      numericValue <= 0
    ) {
      throw new Error("??볦퍢 野껋럡??筌?沅?? 1????곴맒???類ㅻ땾嚥???낆젾??雅뚯눘苑??");
    }

    return true;
  }),
  check("margin").custom(async (value, { req }) => {
    if (isBlank(value) || !(MIN_MARGIN_USDT <= toNumber(value))) {
      throw new Error(`Margin must be at least ${MIN_MARGIN_USDT} USDT.`);
    }

    if (hasPositiveNumber(req.body.leverage)) {
      await validateMinimumTradeRequirements({
        symbol: req.body.symbol,
        margin: value,
        leverage: req.body.leverage,
      });
    }

    return true;
  }),
  check("leverage").custom((value) => {
    if (isBlank(value) || !(1 <= toNumber(value) && toNumber(value) <= 100)) {
      throw new Error("??덉쒔?귐???1獄???곴맒 100獄???꾨릭嚥???낆젾??雅뚯눘苑??");
    }
    return true;
  }),
  respondValidation(400),
];

const validateGridItemAdd = [
  check("a_name")
    .notEmpty()
    .withMessage("전략 이름을 입력해 주세요."),
  check("symbol")
    .notEmpty()
    .withMessage("종목을 선택해 주세요."),
  check("bunbong")
    .notEmpty()
    .withMessage("캔들을 선택해 주세요."),
  check("profit").custom((value) => {
    if (isBlank(value) || !(0.1 <= toNumber(value) && toNumber(value) <= 50)) {
      throw new Error("익절 설정은 0.1%~50% 범위로 입력해 주세요.");
    }
    return true;
  }),
  check("margin").custom(async (value, { req }) => {
    if (isBlank(value) || !(MIN_MARGIN_USDT <= toNumber(value))) {
      throw new Error(`Margin must be at least ${MIN_MARGIN_USDT} USDT.`);
    }

    if (hasPositiveNumber(req.body.leverage)) {
      await validateMinimumTradeRequirements({
        symbol: req.body.symbol,
        margin: value,
        leverage: req.body.leverage,
      });
    }

    return true;
  }),
  check("leverage").custom((value) => {
    if (isBlank(value) || !(1 <= toNumber(value) && toNumber(value) <= 100)) {
      throw new Error("레버리지는 1배 이상 100배 이하로 입력해 주세요.");
    }
    return true;
  }),
  respondValidation(400),
];

const validateLogin = [
  check("userId").notEmpty().withMessage("?袁⑹뵠?遺? ??낆젾??雅뚯눘苑??"),
  check("password").notEmpty().withMessage("??쑬?甕곕뜇?뉒몴???낆젾??雅뚯눘苑??"),
  respondValidation(400),
];

const validateRegister1 = [
  check("username")
    .notEmpty()
    .withMessage("??已????낆젾??雅뚯눘苑??")
    .bail()
    .isLength({ min: 2 })
    .withMessage("??已?? 2????곴맒 ??낆젾??雅뚯눘苑??"),
  check("email")
    .isEmail()
    .withMessage("?醫륁뒞????李??雅뚯눘?쇘몴???낆젾??雅뚯눘苑??")
    .normalizeEmail(),
  respondValidation(400),
];

const validateRegister2 = [
  check("memberid")
    .notEmpty()
    .withMessage("?袁⑹뵠?遺? ??낆젾??雅뚯눘苑??")
    .bail()
    .isLength({ min: 4 })
    .withMessage("?袁⑹뵠?遺얜뮉 4????곴맒 ??낆젾??雅뚯눘苑??")
    .bail()
    .custom(async (memberid) => {
      const existingId = await dbcon.DBOneCall(`CALL SP_U_ID_CHECK(?)`, [memberid]);
      if (existingId) {
        throw new Error("??? ?源낆쨯???袁⑹뵠?遺우뿯??덈뼄.");
      }
      return true;
    }),
  check("password")
    .notEmpty()
    .withMessage("??쑬?甕곕뜇?뉒몴???낆젾??雅뚯눘苑??")
    .bail()
    .isLength({ min: 6 })
    .withMessage("??쑬?甕곕뜇????怨론???ъ쁽 鈺곌퀬鍮 6????곴맒 ??낆젾??雅뚯눘苑??")
    .bail()
    .matches(/[a-zA-Z]/)
    .withMessage("??쑬?甕곕뜇????怨론???ъ쁽 鈺곌퀬鍮 6????곴맒 ??낆젾??雅뚯눘苑??")
    .bail()
    .matches(/\d/)
    .withMessage("??쑬?甕곕뜇????怨론???ъ쁽 鈺곌퀬鍮 6????곴맒 ??낆젾??雅뚯눘苑??"),
  check("password2").custom((value, { req }) => {
    if (value !== req.body.password) {
      throw new Error("??쑬?甕곕뜇???類ㅼ뵥????깊뒄??? ??녿뮸??덈뼄.");
    }
    return true;
  }),
  respondValidation(400),
];

module.exports = {
  validateRegister,
  validateRegister1,
  validateRegister2,
  validateLogin,
  validateItemAdd,
  validateGridItemAdd,
};
