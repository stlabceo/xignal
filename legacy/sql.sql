/*
 Navicat Premium Data Transfer

 Source Server         : coin_xignal
 Source Server Type    : MariaDB
 Source Server Version : 110702 (11.7.2-MariaDB)
 Source Host           : 1.234.63.146:3306
 Source Schema         : xignal

 Target Server Type    : MariaDB
 Target Server Version : 110702 (11.7.2-MariaDB)
 File Encoding         : 65001

 Date: 18/03/2026 10:40:22
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for admin_member
-- ----------------------------
DROP TABLE IF EXISTS `admin_member`;
CREATE TABLE `admin_member`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `mem_id` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL DEFAULT '',
  `mem_name` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL DEFAULT '',
  `mem_mobile` char(11) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  `password` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  `alarmST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL DEFAULT 'Y',
  `grade` int(11) NOT NULL DEFAULT 0,
  `email` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `price` double(15, 3) NULL DEFAULT 1000.000,
  `live_price` double(15, 3) NULL DEFAULT 0.000,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `allExactST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `allStopST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `allExact` int(11) NULL DEFAULT NULL,
  `allStop` int(11) NULL DEFAULT NULL,
  `allStartST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `recom` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `metaId` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `appKey` char(64) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `appSecret` char(64) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `mem_id`(`mem_id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 149 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of admin_member
-- ----------------------------
INSERT INTO `admin_member` VALUES (1, 'test1', '이명해', '000', '*E8ED88FEC596451B51588AF4F02FA33C2CF95079', 'N', 0, NULL, 1000.000, 0.000, '2025-05-19 15:43:25', 'N', 'N', NULL, NULL, 'N', '', NULL, NULL, NULL);
INSERT INTO `admin_member` VALUES (139, 'test1sdfasadfasdf', '', '01000000000', '*E8ED88FEC596451B51588AF4F02FA33C2CF95079', 'Y', 0, '', 1000.000, 0.000, '2026-01-08 13:43:38', 'N', 'N', NULL, NULL, 'N', '', NULL, NULL, NULL);
INSERT INTO `admin_member` VALUES (145, 'zxasdc08', 'test1', '01000000000', '*E8ED88FEC596451B51588AF4F02FA33C2CF95079', 'Y', 0, 'zxasdc08@naver.com', 1000.000, 0.000, '2026-01-09 13:12:51', 'N', 'N', NULL, NULL, 'N', 'C1491', NULL, NULL, NULL);
INSERT INTO `admin_member` VALUES (146, 'huey0605', '김희석', '01000000000', '*61BD1B7F15101841903925E7C5961A982512A117', 'Y', 0, 'huey0605@gmail.com', 966.738, 499.900, '2026-01-13 15:33:15', 'N', 'N', NULL, NULL, 'N', 'A8889', NULL, '6ua6KBZ4FCOpRMUhi2WObt29ddJI7t6qwLLWbPKiV5KIbCzy5KDiy8WAONhW2JJ7', 'TsR0fwKzePaNaoFDnSZ7IVkCmtxxyQPW9GxbKYMLP0cipmDv2uBY8JiGQ7LPGrsV');
INSERT INTO `admin_member` VALUES (147, 'tmdtka1', '한승상', '01000000000', '*6921FDF5DF5E49516191420087649C84B08A15FC', 'Y', 0, 'ceo@trams.co.kr', 1025.461, 0.000, '2026-01-16 12:10:15', 'N', 'N', NULL, NULL, 'N', 'A8889', NULL, NULL, NULL);
INSERT INTO `admin_member` VALUES (148, 'linebacker33', '황수민', '01000000000', '*320294AD61BB5887149886F5015A5B3F5E9BD248', 'Y', 0, 'leader@anotherlab.net', 1000.000, 0.000, '2026-02-08 19:21:55', 'N', 'N', NULL, NULL, 'N', 'A8889', NULL, NULL, NULL);

-- ----------------------------
-- Table structure for alert_log
-- ----------------------------
DROP TABLE IF EXISTS `alert_log`;
CREATE TABLE `alert_log`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid` char(15) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `db_type` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `type` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `symbol` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `close` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `signal_time` datetime NULL DEFAULT NULL,
  `created_at` datetime NULL DEFAULT current_timestamp() ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of alert_log
-- ----------------------------

-- ----------------------------
-- Table structure for alert_log2
-- ----------------------------
DROP TABLE IF EXISTS `alert_log2`;
CREATE TABLE `alert_log2`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `uid` int(11) NULL DEFAULT NULL,
  `pid` int(11) NULL DEFAULT NULL,
  `log_id` int(11) NULL DEFAULT NULL,
  `uuid` char(15) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `db_type` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `type` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `st` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `signal_price` double(15, 3) NULL DEFAULT NULL,
  `result_price` double(15, 3) NULL DEFAULT NULL,
  `bunbong` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `second1` int(11) NULL DEFAULT NULL,
  `second2` int(11) NULL DEFAULT NULL,
  `second3` int(11) NULL DEFAULT NULL,
  `second4` int(11) NULL DEFAULT NULL,
  `signal_time` datetime NULL DEFAULT NULL,
  `created_at` datetime NULL DEFAULT current_timestamp() ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of alert_log2
-- ----------------------------

-- ----------------------------
-- Table structure for alert_log3
-- ----------------------------
DROP TABLE IF EXISTS `alert_log3`;
CREATE TABLE `alert_log3`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `symbol` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `db_type` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `type` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bunbong` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `signal_time` datetime NULL DEFAULT NULL,
  `created_at` datetime NULL DEFAULT current_timestamp() ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of alert_log3
-- ----------------------------

-- ----------------------------
-- Table structure for candle_cool
-- ----------------------------
DROP TABLE IF EXISTS `candle_cool`;
CREATE TABLE `candle_cool`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid` char(15) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  `side` char(5) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `cooltime` datetime NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uuid`(`uuid`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of candle_cool
-- ----------------------------

-- ----------------------------
-- Table structure for candle_list
-- ----------------------------
DROP TABLE IF EXISTS `candle_list`;
CREATE TABLE `candle_list`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `symbol` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bunbong` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `CLOSE_NOW` double(15, 3) NULL DEFAULT NULL,
  `CLOSE_PREV` double(15, 3) NULL DEFAULT NULL COMMENT '이전종가',
  `BBW_NOW` double(15, 3) NULL DEFAULT NULL COMMENT '선택된 심벌과 선택된 캔들의 볼린저밴드의 폭을 계산 , 볼린저밴드의 표준편차 멀티플은 2배수로 하고, 캔들의 가짓수는 20개로 한다. BB(20)의 높이 ',
  `BBW_PREV` double(15, 3) NULL DEFAULT NULL,
  `Vol_Z_score` double(15, 3) NULL DEFAULT NULL COMMENT '거래량의 z –score 계산 , 캔들의 기준은 20개로 한다. Z score = (마지막 캔들의 거래량 – 20개 구간 거래량 평균)/20개 구간 거래량의 표준편차',
  `RSI` double(15, 3) NULL DEFAULT NULL COMMENT '직전 캔들 종가 기준 , RSI(20)의 값을 표시',
  `RSI_Slope` double(15, 3) NULL DEFAULT NULL COMMENT '캔들은 20개를 사용한다. RSI Slope = 1번째 캔들의 RSI(20)-마지막 캔들의 RSI(20)/20 ',
  `ATR` double(15, 3) NULL DEFAULT NULL COMMENT '직전 20개 캔들의 ATR 표시 ',
  `STD_DEV` double(15, 3) NULL DEFAULT NULL COMMENT '직전 20개 캔들의 표준편차 표시 ',
  `F_UP_LV1` double(15, 3) NULL DEFAULT NULL COMMENT '직전 20개 캔들 기준 피보나치 되돌림의 첫번째 상단의 가격 계산  ',
  `F_UP_LV2` double(15, 3) NULL DEFAULT NULL COMMENT '직전 20개 캔들 기준 피보나치 되돌림의 두번째 상단의 가격 계산',
  `F_DN_LV1` double(15, 3) NULL DEFAULT NULL COMMENT '직전 20개 캔들 기준 피보나치 되돌림의 첫번째 하단의 가격 계산  ',
  `F_DN_LV2` double(15, 3) NULL DEFAULT NULL COMMENT '직전 20개 캔들 기준 피보나치 되돌림의 두번째 하단의 가격 계산',
  `CC_BTC` double(15, 3) NULL DEFAULT NULL,
  `CC_ETH` double(15, 3) NULL DEFAULT NULL,
  `updated_at` datetime NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `created_at` datetime NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of candle_list
-- ----------------------------

-- ----------------------------
-- Table structure for event_log
-- ----------------------------
DROP TABLE IF EXISTS `event_log`;
CREATE TABLE `event_log`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `uid` int(11) UNSIGNED NULL DEFAULT NULL,
  `pid` int(11) UNSIGNED NULL DEFAULT NULL,
  `tid` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `oid` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `event_type` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `old_st` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `new_st` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `old_status` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `new_status` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `signalType` char(5) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `signalPrice` double(15, 2) NULL DEFAULT NULL,
  `signalTime` datetime NULL DEFAULT NULL,
  `localTime` datetime NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `item_uid`(`uid`) USING BTREE,
  INDEX `play_list_id`(`pid`) USING BTREE,
  CONSTRAINT `event_log_ibfk_1` FOREIGN KEY (`uid`) REFERENCES `admin_member` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of event_log
-- ----------------------------

-- ----------------------------
-- Table structure for line_list
-- ----------------------------
DROP TABLE IF EXISTS `line_list`;
CREATE TABLE `line_list`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `uid` int(11) NOT NULL,
  `symbol` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  `subLine` double(15, 3) NULL DEFAULT NULL COMMENT '지지선',
  `resLine` double(15, 3) NULL DEFAULT NULL COMMENT '저항선',
  `updated_at` datetime NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uuid`(`symbol`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 13 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of line_list
-- ----------------------------
INSERT INTO `line_list` VALUES (1, 1, 'BTCUSDT', 119450.000, 123740.000, '2025-10-10 12:14:55');
INSERT INTO `line_list` VALUES (5, 1, 'BTCUSDT123', NULL, NULL, NULL);
INSERT INTO `line_list` VALUES (6, 1, 'BTCUSDT1', NULL, NULL, NULL);
INSERT INTO `line_list` VALUES (7, 1, 'BTCUSDT12', 123.256, 222.000, '2025-09-28 07:12:11');
INSERT INTO `line_list` VALUES (8, 1, 'XRPUSDT', 2.750, 2.840, '2025-10-10 13:05:27');
INSERT INTO `line_list` VALUES (9, 1, 'ETHUSDT', 4250.000, 4430.000, '2025-10-10 13:09:03');
INSERT INTO `line_list` VALUES (10, 1, 'SOLUSDT', 210.000, 230.000, '2025-10-08 11:44:13');
INSERT INTO `line_list` VALUES (11, 1, 'DOGEUSDT', 0.240, 0.260, '2025-10-06 21:58:22');
INSERT INTO `line_list` VALUES (12, 1, '', NULL, NULL, NULL);

-- ----------------------------
-- Table structure for live_play_list
-- ----------------------------
DROP TABLE IF EXISTS `live_play_list`;
CREATE TABLE `live_play_list`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `uid` int(11) UNSIGNED NOT NULL,
  `live_ST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL DEFAULT 'Y',
  `a_name` varchar(30) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  `symbol` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bunbong` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL COMMENT '1~ 990',
  `type` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL COMMENT 'stoch, RSI, UT, mid, abs',
  `second1` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `second2` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT '1',
  `second3` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT '1',
  `second4` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT '1',
  `marginType` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `AI_ST` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `repeatConfig` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'repeat' COMMENT 'repeat: 자동반복, stopLoss: 손절 시 반복 멈춤, once: 1회만 진입',
  `profitTradeType` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'per' COMMENT 'per, abs, fix',
  `profitFixValue` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL COMMENT '지지선 : sub, 저항선: res',
  `profitAbsValue` double(15, 2) NULL DEFAULT 0.00 COMMENT '절대값',
  `lossTradeType` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'per',
  `lossFixValue` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `lossAbsValue` double(15, 2) NULL DEFAULT 0.00,
  `absValue` double(15, 2) NULL DEFAULT NULL COMMENT '진입시 절대값',
  `limitST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `enter` double(15, 2) NULL DEFAULT 1.00 COMMENT '진입',
  `cancel` double(15, 2) NULL DEFAULT 1.00 COMMENT '진입취소',
  `profit` double(15, 2) NULL DEFAULT 1.00 COMMENT '1차익절',
  `stopLoss` double(15, 2) NULL DEFAULT 1.00 COMMENT '손절',
  `leverage` double(15, 2) NULL DEFAULT 0.00,
  `margin` double(15, 2) NULL DEFAULT 0.00,
  `minimumOrderST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `m_cancelStopLoss` double(15, 2) NULL DEFAULT NULL COMMENT '손절취소',
  `m_profit` double(15, 2) NULL DEFAULT NULL COMMENT '2차익절',
  `trendOrderST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `t_cancelStopLoss` double(15, 2) NULL DEFAULT NULL COMMENT '추세:손절취소',
  `t_profit` double(15, 2) NULL DEFAULT NULL COMMENT '추세:2차익절',
  `t_chase` double(15, 2) NULL DEFAULT NULL COMMENT '추세:추세추격',
  `t_ST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `t_autoST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N' COMMENT '자동청산 on off',
  `t_direct` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `signalType` char(5) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `alarmSignalST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `alarmResultST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `orderSize` int(11) NULL DEFAULT NULL,
  `st` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'STOP' COMMENT 'STOP, START',
  `status` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'READY',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `autoST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `stoch_id` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `direct1ST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `direct2ST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `detailTap` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'B',
  `selectST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'Y',
  `r_tid` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `r_oid` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `r_m_st` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `r_t_st` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `r_t_tick` double(15, 2) NULL DEFAULT 0.00,
  `r_t_cnt` int(11) NULL DEFAULT 0,
  `r_tempPrice` double(10, 2) NULL DEFAULT NULL,
  `r_signalType` char(5) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `r_signalPrice` double(15, 2) NULL DEFAULT NULL,
  `r_signalTime` datetime NULL DEFAULT NULL,
  `r_exactPrice` double(15, 2) NULL DEFAULT NULL,
  `r_exactTime` datetime NULL DEFAULT NULL,
  `r_profitPrice` double(15, 2) NULL DEFAULT 0.00,
  `r_profitTime` datetime NULL DEFAULT NULL,
  `r_stopPrice` double(15, 2) NULL DEFAULT 0.00,
  `r_stopTime` datetime NULL DEFAULT NULL,
  `r_endPrice` double(15, 2) NULL DEFAULT 0.00,
  `r_endTime` datetime NULL DEFAULT NULL,
  `r_exact_cnt` int(11) NULL DEFAULT 0,
  `r_profit_cnt` int(11) NULL DEFAULT 0,
  `r_profit_tick` double(15, 2) NULL DEFAULT 0.00,
  `r_stop_cnt` int(11) NULL DEFAULT 0,
  `r_stop_tick` double(15, 2) NULL DEFAULT 0.00,
  `r_forcing_cnt` int(11) NULL DEFAULT 0,
  `r_forcing_tick` int(11) NULL DEFAULT 0,
  `r_real_tick` double(15, 2) NULL DEFAULT NULL,
  `r_pol_tick` double(15, 2) NULL DEFAULT 0.00,
  `r_charge` double(15, 2) NULL DEFAULT 0.00,
  `r_t_charge` double(15, 2) NULL DEFAULT NULL,
  `r_pol_sum` double(15, 3) NULL DEFAULT 0.000,
  `r_minQty` double(15, 3) NULL DEFAULT NULL,
  `r_qty` double(15, 3) NULL DEFAULT NULL,
  `r_margin` double(15, 3) NULL DEFAULT NULL,
  `r_win` int(11) NULL DEFAULT 0,
  `r_loss` int(11) NULL DEFAULT 0,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `item_uid`(`uid`) USING BTREE,
  CONSTRAINT `live_play_list_ibfk_1` FOREIGN KEY (`uid`) REFERENCES `admin_member` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB AUTO_INCREMENT = 3 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of live_play_list
-- ----------------------------
INSERT INTO `live_play_list` VALUES (1, 1, 'Y', '123', 'BTCUSDT', '1', 'scalping', '1', '5', '3', '3', 'isolated', 'attack', 'repeat', 'per', 'res', NULL, 'per', 'res', NULL, 0.00, 'N', NULL, 0.00, 1.00, 1.00, 1.00, 1.00, 'N', 0.00, 0.00, 'N', 0.00, 0.00, 0.00, 'N', 'N', 'N', 'BUY', 'Y', 'Y', 1, 'START', 'READY', '2026-01-16 13:49:54', 'N', 'S_A_BTCUSDT_1', 'N', 'N', 'B', 'Y', NULL, NULL, 'N', 'N', 0.00, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, NULL, 0.00, NULL, 0.00, NULL, 0, 0, 0.00, 0, 0.00, 0, 0, NULL, 0.00, 0.00, 0.00, 0.000, 0.000, 0.000, 0.000, 0, 0);
INSERT INTO `live_play_list` VALUES (2, 147, 'Y', '123', 'BTCUSDT', '1', 'scalping', '1', '5', '3', '3', 'isolated', 'attack', 'repeat', 'per', 'res', NULL, 'per', 'res', NULL, 0.00, 'N', NULL, 0.00, 123.00, 123.00, 123.00, 123.00, 'N', 0.00, 0.00, 'N', 0.00, 0.00, 0.00, 'N', 'N', 'N', 'BUY', 'Y', 'Y', 1, 'START', 'READY', '2026-01-16 14:32:45', 'N', 'S_A_BTCUSDT_1', 'N', 'N', 'B', 'Y', NULL, NULL, 'N', 'N', 0.00, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, NULL, 0.00, NULL, 0.00, NULL, 0, 0, 0.00, 0, 0.00, 0, 0, NULL, 0.00, 0.00, 0.00, 0.000, 0.000, 0.000, 0.000, 0, 0);

-- ----------------------------
-- Table structure for live_play_log
-- ----------------------------
DROP TABLE IF EXISTS `live_play_log`;
CREATE TABLE `live_play_log`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `uid` int(11) UNSIGNED NOT NULL,
  `pid` int(11) UNSIGNED NOT NULL,
  `tid` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `oid` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `st` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  `symbol` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `type` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bunbong` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `win_loss` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `leverage` double(15, 2) NULL DEFAULT NULL,
  `margin` double(15, 2) NULL DEFAULT NULL,
  `positionSize` double(15, 2) NULL DEFAULT NULL,
  `signalType` char(5) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  `signalPrice` double(15, 10) NULL DEFAULT NULL,
  `signalTime` datetime NULL DEFAULT NULL,
  `openPrice` double(15, 10) NULL DEFAULT NULL COMMENT '체결된가격 진입가격',
  `closePrice` double(15, 10) NULL DEFAULT NULL COMMENT '익절 가격',
  `closeTick` double(15, 10) NULL DEFAULT NULL,
  `pol_tick` double(15, 10) NULL DEFAULT NULL COMMENT '손익 틱',
  `pol_sum` double(15, 10) NULL DEFAULT NULL COMMENT '손익 돈',
  `charge` double(15, 10) NULL DEFAULT 0.0000000000 COMMENT 'ls증권 수수료',
  `openTime` datetime NULL DEFAULT NULL,
  `closeTime` datetime NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `item_uid`(`uid`) USING BTREE,
  INDEX `play_list_id`(`pid`) USING BTREE,
  CONSTRAINT `live_play_log_ibfk_1` FOREIGN KEY (`uid`) REFERENCES `admin_member` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of live_play_log
-- ----------------------------

-- ----------------------------
-- Table structure for ls_log_bunbong
-- ----------------------------
DROP TABLE IF EXISTS `ls_log_bunbong`;
CREATE TABLE `ls_log_bunbong`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `symbol` char(8) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL COMMENT '종목코드',
  `open` double(15, 2) NULL DEFAULT NULL COMMENT '시가',
  `high` double(15, 2) NULL DEFAULT NULL COMMENT '고가',
  `low` double(15, 2) NULL DEFAULT NULL COMMENT '저가',
  `close` double(15, 2) NULL DEFAULT NULL COMMENT '종가',
  `ovsdate` datetime NULL DEFAULT NULL COMMENT '체결일자(현지)',
  `kordate` datetime NULL DEFAULT NULL COMMENT '체결일자(한국)	',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of ls_log_bunbong
-- ----------------------------

-- ----------------------------
-- Table structure for ls_log_ovc
-- ----------------------------
DROP TABLE IF EXISTS `ls_log_ovc`;
CREATE TABLE `ls_log_ovc`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `symbol` char(8) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL COMMENT '종목코드',
  `ovsdate` datetime NULL DEFAULT NULL COMMENT '체결일자(현지)',
  `kordate` datetime NULL DEFAULT NULL COMMENT '체결일자(한국)	',
  `curpr` double(15, 3) NULL DEFAULT NULL COMMENT '체결가격',
  `ydiffpr` double(15, 3) NULL DEFAULT NULL COMMENT '전일대비',
  `ydiffSign` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL COMMENT '전일대비기호',
  `open` double(15, 3) NULL DEFAULT NULL COMMENT '시가',
  `high` double(15, 3) NULL DEFAULT NULL COMMENT '고가',
  `low` double(15, 3) NULL DEFAULT NULL COMMENT '저가',
  `chgrate` double(15, 3) NULL DEFAULT NULL COMMENT '등락율',
  `trdq` int(11) NULL DEFAULT NULL COMMENT '건별체결수량',
  `totq` int(11) NULL DEFAULT NULL COMMENT '누적체결수량',
  `cgubun` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL COMMENT '체결구분',
  `mdvolume` int(11) NULL DEFAULT NULL COMMENT '매도누적체결수량',
  `msvolume` int(11) NULL DEFAULT NULL COMMENT '매수누적체결수량',
  `ovsmkend` date NULL DEFAULT NULL COMMENT '장마감일',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of ls_log_ovc
-- ----------------------------

-- ----------------------------
-- Table structure for ls_log_ovh
-- ----------------------------
DROP TABLE IF EXISTS `ls_log_ovh`;
CREATE TABLE `ls_log_ovh`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `symbol` char(8) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `hotime` char(6) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `offerho1` char(16) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bidho1` char(16) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `offerrem1` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `offerno1` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bidno1` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `offerho2` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bidho2` char(16) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `offerrem2` char(16) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bidrem2` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `offerno2` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bidno2` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `offerho3` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bidho3` char(16) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `offerrem3` char(16) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bidrem3` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `offerno3` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bidno3` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `offerho4` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bidho4` char(16) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `offerrem4` char(16) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bidrem4` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `offerno4` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bidno4` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `offerho5` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bidho5` char(16) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bidrem1` char(16) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `offerrem5` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bidrem5` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `offerno5` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bidno5` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `totoffercnt` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `totbidcnt` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `totofferrem` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `totbidrem` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of ls_log_ovh
-- ----------------------------

-- ----------------------------
-- Table structure for ls_tick
-- ----------------------------
DROP TABLE IF EXISTS `ls_tick`;
CREATE TABLE `ls_tick`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `symbol` char(8) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL COMMENT '종목코드',
  `curpr` double(15, 2) NULL DEFAULT NULL COMMENT '시가',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of ls_tick
-- ----------------------------

-- ----------------------------
-- Table structure for msg_list
-- ----------------------------
DROP TABLE IF EXISTS `msg_list`;
CREATE TABLE `msg_list`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `fun` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `code` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `msg` longtext CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `uid` int(11) NULL DEFAULT NULL,
  `pid` int(11) NULL DEFAULT NULL,
  `tid` char(12) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `symbol` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `side` char(5) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `st` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL DEFAULT 'N',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 47 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of msg_list
-- ----------------------------
INSERT INTO `msg_list` VALUES (1, 'sendEnter', '404', 'userQty is not defined', 1, 1, NULL, 'BTCUSDT', 'BUY', 'Y', '2025-07-18 12:43:19', '2025-07-25 15:04:18');
INSERT INTO `msg_list` VALUES (2, 'sendEnter', '404', 'positionSize is not defined', 1, 1, '732828392001', 'BTCUSDT', 'BUY', 'Y', '2025-07-18 12:56:56', '2025-07-22 18:13:06');
INSERT INTO `msg_list` VALUES (3, 'sendEnter', '404', 'positionSize is not defined', 1, 1, '732839911538', 'BTCUSDT', 'BUY', 'Y', '2025-07-18 13:14:53', '2025-07-22 18:13:06');
INSERT INTO `msg_list` VALUES (4, 'sendEnter', '404', 'positionSize is not defined', 1, 1, '732841239392', 'BTCUSDT', 'BUY', 'Y', '2025-07-18 13:18:08', '2025-07-22 18:13:06');
INSERT INTO `msg_list` VALUES (5, 'sendEnter', '-4061', 'Order\'s position side does not match user\'s setting.', 1, 1, NULL, 'BTCUSDT', 'BUY', 'Y', '2025-10-01 09:29:36', '2025-10-01 09:31:38');
INSERT INTO `msg_list` VALUES (6, 'sendEnter', '-4061', 'Order\'s position side does not match user\'s setting.', 1, 1, NULL, 'BTCUSDT', 'BUY', 'Y', '2025-10-01 09:31:33', '2025-10-01 09:31:38');
INSERT INTO `msg_list` VALUES (7, 'sendEnter', '-4061', 'Order\'s position side does not match user\'s setting.', 1, 1, NULL, 'BTCUSDT', 'BUY', 'Y', '2025-10-01 09:33:34', '2025-10-01 09:34:37');
INSERT INTO `msg_list` VALUES (8, 'sendEnter', '-4061', 'Order\'s position side does not match user\'s setting.', 1, 1, NULL, 'BTCUSDT', 'buy', 'Y', '2025-10-01 09:34:09', '2025-10-01 09:34:37');
INSERT INTO `msg_list` VALUES (9, 'sendForcing', '-2022', 'ReduceOnly Order is rejected.', 1, 1, '781681611086', 'BTCUSDT', 'BUY', 'Y', '2025-10-01 09:50:36', '2025-10-01 09:57:06');
INSERT INTO `msg_list` VALUES (10, 'sendEnter', '-2019', 'Margin is insufficient.', 1, 1, NULL, 'BTCUSDT', 'BUY', 'Y', '2025-10-01 10:07:51', '2025-10-01 10:10:06');
INSERT INTO `msg_list` VALUES (11, 'sendEnter', '-2019', 'Margin is insufficient.', 1, 2, NULL, 'SOLUSDT', 'SELL', 'Y', '2025-10-01 18:53:24', '2025-10-05 13:15:57');
INSERT INTO `msg_list` VALUES (12, 'sendEnter', '-2019', 'Margin is insufficient.', 1, 7, NULL, 'BTCUSDT', 'BUY', 'N', '2025-10-03 13:57:33', NULL);
INSERT INTO `msg_list` VALUES (13, 'sendEnter', '-2019', 'Margin is insufficient.', 1, 7, NULL, 'BTCUSDT', 'BUY', 'N', '2025-10-03 13:57:36', NULL);
INSERT INTO `msg_list` VALUES (14, 'sendEnter', '-2019', 'Margin is insufficient.', 1, 7, NULL, 'BTCUSDT', 'BUY', 'N', '2025-10-03 13:57:58', NULL);
INSERT INTO `msg_list` VALUES (15, 'sendEnter', '-2019', 'Margin is insufficient.', 1, 7, NULL, 'BTCUSDT', 'BUY', 'N', '2025-10-03 13:58:01', NULL);
INSERT INTO `msg_list` VALUES (16, 'sendEnter', '-2019', 'Margin is insufficient.', 1, 7, NULL, 'BTCUSDT', 'BUY', 'N', '2025-10-03 13:58:20', NULL);
INSERT INTO `msg_list` VALUES (17, 'sendEnter', '-2019', 'Margin is insufficient.', 1, 10, NULL, 'BTCUSDT', 'SELL', 'N', '2025-10-03 14:12:10', NULL);
INSERT INTO `msg_list` VALUES (18, 'sendEnter', '-2019', 'Margin is insufficient.', 1, 4, NULL, 'BTCUSDT', 'SELL', 'N', '2025-10-03 16:10:12', NULL);
INSERT INTO `msg_list` VALUES (19, 'sendEnter', '-2019', 'Margin is insufficient.', 1, 1, NULL, 'BTCUSDT', 'BUY', 'Y', '2025-10-03 17:59:03', '2025-10-03 17:59:24');
INSERT INTO `msg_list` VALUES (20, 'sendEnter', '-2019', 'Margin is insufficient.', 1, 9, NULL, 'BTCUSDT', 'BUY', 'N', '2025-10-03 18:23:42', NULL);
INSERT INTO `msg_list` VALUES (21, 'sendEnter', '-2019', 'Margin is insufficient.', 1, 3, NULL, 'BTCUSDT', 'BUY', 'Y', '2025-10-03 18:28:42', '2025-10-06 15:37:44');
INSERT INTO `msg_list` VALUES (22, 'sendEnter', '-2019', 'Margin is insufficient.', 1, 2, NULL, 'BTCUSDT', 'SELL', 'Y', '2025-10-04 00:19:00', '2025-10-05 13:15:57');
INSERT INTO `msg_list` VALUES (23, 'sendEnter', '-2019', 'Margin is insufficient.', 1, 8, NULL, 'BTCUSDT', 'SELL', 'N', '2025-10-04 00:19:00', NULL);
INSERT INTO `msg_list` VALUES (24, 'sendForcing', '-2022', 'ReduceOnly Order is rejected.', 1, 3, '124102055442', 'XRPUSDT', 'BUY', 'N', '2025-10-09 09:45:31', NULL);
INSERT INTO `msg_list` VALUES (25, 'sendForcing', '-2022', 'ReduceOnly Order is rejected.', 1, 4, '124309575135', 'XRPUSDT', 'SELL', 'N', '2025-10-09 09:45:32', NULL);
INSERT INTO `msg_list` VALUES (26, 'sendEnter', '-2019', 'Margin is insufficient.', 1, 1, NULL, 'BTCUSDT', 'BUY', 'N', '2025-10-17 17:35:54', NULL);
INSERT INTO `msg_list` VALUES (27, 'sendEnter', '-2019', 'Margin is insufficient.', 1, 1, NULL, 'BTCUSDT', 'BUY', 'N', '2025-10-17 17:36:32', NULL);
INSERT INTO `msg_list` VALUES (28, 'sendEnter', '-2019', 'Margin is insufficient.', 1, 17, NULL, 'BTCUSDT', 'BUY', 'N', '2025-11-14 12:41:09', NULL);
INSERT INTO `msg_list` VALUES (29, 'sendEnter', '-2019', 'Margin is insufficient.', 1, 17, NULL, 'BTCUSDT', 'BUY', 'N', '2025-11-14 16:37:55', NULL);
INSERT INTO `msg_list` VALUES (30, 'sendEnter', '-2019', 'Margin is insufficient.', 1, 18, NULL, 'ETHUSDT', 'BUY', 'N', '2025-11-14 16:37:56', NULL);
INSERT INTO `msg_list` VALUES (31, 'sendEnter', '-1106', 'Parameter \'stopprice\' sent when not required.', 1, 17, NULL, 'BTCUSDT', 'BUY', 'N', '2025-11-20 13:03:59', NULL);
INSERT INTO `msg_list` VALUES (32, 'sendEnter', '-1116', 'Invalid orderType.', 1, 17, NULL, 'BTCUSDT', 'BUY', 'N', '2025-11-20 13:09:41', NULL);
INSERT INTO `msg_list` VALUES (33, 'sendEnter', '-1116', 'Invalid orderType.', 1, 17, NULL, 'BTCUSDT', 'BUY', 'N', '2025-11-20 13:20:12', NULL);
INSERT INTO `msg_list` VALUES (34, 'sendEnter', '-1116', 'Invalid orderType.', 1, 17, NULL, 'BTCUSDT', 'BUY', 'N', '2025-11-20 13:37:00', NULL);
INSERT INTO `msg_list` VALUES (35, 'sendEnter', '-1116', 'Invalid orderType.', 1, 17, NULL, 'BTCUSDT', 'BUY', 'N', '2025-11-20 13:43:02', NULL);
INSERT INTO `msg_list` VALUES (36, 'sendEnter', '-1116', 'Invalid orderType.', 1, 17, NULL, 'BTCUSDT', 'BUY', 'N', '2025-11-20 13:52:18', NULL);
INSERT INTO `msg_list` VALUES (37, 'sendEnter', '-1111', 'Precision is over the maximum defined for this asset.', 1, 17, NULL, 'BTCUSDT', 'BUY', 'N', '2025-11-20 15:18:26', NULL);
INSERT INTO `msg_list` VALUES (38, 'sendEnter', '-1102', 'Mandatory parameter \'price\' was not sent, was empty/null, or malformed.', 1, 17, NULL, 'BTCUSDT', 'BUY', 'N', '2025-11-20 15:20:59', NULL);
INSERT INTO `msg_list` VALUES (39, 'sendEnter', '-1115', 'Invalid timeInForce.', 1, 17, NULL, 'BTCUSDT', 'BUY', 'N', '2025-11-20 15:25:10', NULL);
INSERT INTO `msg_list` VALUES (40, 'sendEnter', '-2021', 'Order would immediately trigger.', 1, 17, NULL, 'BTCUSDT', 'BUY', 'N', '2025-11-20 15:36:53', NULL);
INSERT INTO `msg_list` VALUES (41, 'sendForcing', '-1102', 'Mandatory parameter \'quantity\' was not sent, was empty/null, or malformed.', 1, 17, '829365958524', 'BTCUSDT', 'BUY', 'N', '2025-11-20 16:07:58', NULL);
INSERT INTO `msg_list` VALUES (42, 'sendEnter', '-4116', 'ClientOrderId is duplicated.', 1, 17, NULL, 'BTCUSDT', 'BUY', 'N', '2025-11-20 16:35:34', NULL);
INSERT INTO `msg_list` VALUES (43, 'sendForcing', '-1102', 'Mandatory parameter \'quantity\' was not sent, was empty/null, or malformed.', 1, 19, '829424012345', 'BTCUSDT', 'BUY', 'N', '2025-11-20 16:41:39', NULL);
INSERT INTO `msg_list` VALUES (44, 'sendEnter', '-2021', 'Order would immediately trigger.', 1, 19, NULL, 'BTCUSDT', 'SELL', 'N', '2025-11-20 16:49:41', NULL);
INSERT INTO `msg_list` VALUES (45, 'sendEnter', '-2021', 'Order would immediately trigger.', 1, 19, NULL, 'BTCUSDT', 'SELL', 'N', '2025-11-20 16:51:17', NULL);
INSERT INTO `msg_list` VALUES (46, 'sendEnter', '-2021', 'Order would immediately trigger.', 1, 19, NULL, 'BTCUSDT', 'SELL', 'N', '2025-11-20 16:53:54', NULL);

-- ----------------------------
-- Table structure for play_list
-- ----------------------------
DROP TABLE IF EXISTS `play_list`;
CREATE TABLE `play_list`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `uid` int(11) UNSIGNED NOT NULL,
  `symbol` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `bunbong` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL COMMENT '1~ 990',
  `type` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL COMMENT 'bunbong, tick',
  `second1` int(11) NULL DEFAULT NULL,
  `second2` int(11) NULL DEFAULT 1,
  `second3` int(11) NULL DEFAULT 1,
  `second4` int(11) NULL DEFAULT 1,
  `enter` double(15, 2) NULL DEFAULT 1.00 COMMENT '진입',
  `cancel` double(15, 2) NULL DEFAULT 1.00 COMMENT '진입취소',
  `profit` double(15, 2) NULL DEFAULT 1.00 COMMENT '1차익절',
  `stopLoss` double(15, 2) NULL DEFAULT 1.00 COMMENT '손절',
  `leverage` double(15, 2) NULL DEFAULT 0.00,
  `margin` double(15, 2) NULL DEFAULT 0.00,
  `minimumOrderST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `m_cancelStopLoss` double(15, 2) NULL DEFAULT NULL COMMENT '손절취소',
  `m_profit` double(15, 2) NULL DEFAULT NULL COMMENT '2차익절',
  `trendOrderST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `t_cancelStopLoss` double(15, 2) NULL DEFAULT NULL COMMENT '추세:손절취소',
  `t_profit` double(15, 2) NULL DEFAULT NULL COMMENT '추세:2차익절',
  `t_chase` double(15, 2) NULL DEFAULT NULL COMMENT '추세:추세추격',
  `t_ST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `t_autoST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N' COMMENT '자동청산 on off',
  `t_direct` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `signalType` char(5) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `alarmSignalST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `alarmResultST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `orderSize` int(11) NULL DEFAULT NULL,
  `st` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'STOP' COMMENT 'STOP, START',
  `status` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'READY',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `autoST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `stoch_id` char(15) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `direct1ST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `direct2ST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `detailTap` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'B',
  `selectST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'Y',
  `r_tid` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `r_oid` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `r_m_st` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `r_t_st` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `r_t_tick` double(15, 2) NULL DEFAULT 0.00,
  `r_t_cnt` int(11) NULL DEFAULT 0,
  `r_tempPrice` double(10, 2) NULL DEFAULT NULL,
  `r_signalType` char(5) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `r_signalPrice` double(15, 2) NULL DEFAULT NULL,
  `r_signalTime` datetime NULL DEFAULT NULL,
  `r_exactPrice` double(15, 2) NULL DEFAULT NULL,
  `r_exactTime` datetime NULL DEFAULT NULL,
  `r_profitPrice` double(15, 2) NULL DEFAULT 0.00,
  `r_profitTime` datetime NULL DEFAULT NULL,
  `r_stopPrice` double(15, 2) NULL DEFAULT 0.00,
  `r_stopTime` datetime NULL DEFAULT NULL,
  `r_endPrice` double(15, 2) NULL DEFAULT 0.00,
  `r_endTime` datetime NULL DEFAULT NULL,
  `r_exact_cnt` int(11) NULL DEFAULT 0,
  `r_profit_cnt` int(11) NULL DEFAULT 0,
  `r_profit_tick` int(11) NULL DEFAULT 0,
  `r_stop_cnt` int(11) NULL DEFAULT 0,
  `r_stop_tick` int(11) NULL DEFAULT 0,
  `r_forcing_cnt` int(11) NULL DEFAULT 0,
  `r_forcing_tick` int(11) NULL DEFAULT 0,
  `r_real_tick` double(15, 2) NULL DEFAULT NULL,
  `r_pol_tick` double(15, 2) NULL DEFAULT 0.00,
  `r_charge` double(15, 2) NULL DEFAULT 0.00,
  `r_pol_sum` double(15, 3) NULL DEFAULT 0.000,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `item_uid`(`uid`) USING BTREE,
  CONSTRAINT `play_list_ibfk_1` FOREIGN KEY (`uid`) REFERENCES `admin_member` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB AUTO_INCREMENT = 181 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of play_list
-- ----------------------------
INSERT INTO `play_list` VALUES (1, 1, 'ETHUSDT', 'A_1', 'A', 1, 14, 3, 3, 0.10, 10.00, 40.00, 100.00, 21.00, 11.00, 'N', 0.00, 0.00, 'Y', 1222.00, 0.00, 122.00, 'N', 'N', 'N', 'SELL', 'Y', 'Y', 1, 'START', 'EXACT', '2025-05-19 15:50:34', 'Y', '9C57418E85F346D', 'N', 'N', 'B', 'Y', NULL, NULL, 'N', 'N', 0.00, 0, NULL, 'SELL', 2555.96, '2025-06-20 17:34:43', 2558.97, '2025-06-20 17:35:25', 0.00, NULL, 0.00, NULL, 0.00, NULL, 2, 1, 177, 0, 0, 0, 0, 120.23, 176.54, 0.00, 176.540);
INSERT INTO `play_list` VALUES (2, 1, 'BTCUSDT', 'A_3', 'A', 1, 5, 3, 3, 0.10, 40.00, 50.00, 240.00, 0.00, 0.00, 'N', 0.00, 0.00, 'N', 0.00, 0.00, 0.00, 'N', 'N', 'N', 'SELL', 'Y', 'Y', 1, 'START', 'EXACT', '2025-05-19 15:50:34', 'Y', 'H3Y8V0XHJGIZGV2', 'N', 'N', 'B', 'Y', NULL, NULL, 'N', 'N', 0.00, 0, NULL, 'SELL', 105926.70, '2025-06-20 17:59:25', 106041.60, '2025-06-20 18:03:56', 0.00, NULL, 0.00, NULL, 0.00, NULL, 77, 52, 3558, 23, -5017, 1, 12, 231.00, -1445.80, 0.00, -1445.800);
INSERT INTO `play_list` VALUES (3, 1, 'BTCUSDT', 'A_3', 'A', 1, 5, 3, 3, 44.00, 40.00, 50.00, 240.00, 0.00, 0.00, 'N', 0.00, 0.00, 'N', 0.00, 0.00, 0.00, 'N', 'N', 'N', 'BUY', 'Y', 'Y', 1, 'START', 'READY', '2025-05-19 15:50:34', 'Y', NULL, 'N', 'N', 'B', 'Y', NULL, NULL, 'N', 'N', 0.00, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, NULL, 0.00, NULL, 0.00, NULL, 0, 0, 0, 0, 0, 0, 0, NULL, 0.00, 0.00, 0.000);
INSERT INTO `play_list` VALUES (4, 1, 'BTCUSDT', 'A_5', 'A', 1, 5, 3, 3, 44.00, 40.00, 50.00, 240.00, NULL, NULL, 'N', 0.00, 0.00, 'N', 0.00, 0.00, 0.00, 'N', 'N', 'N', 'TWO', 'Y', 'Y', 1, 'START', 'EXACT_WAIT', '2025-05-19 15:50:34', 'Y', '19H5KKXLACORTG0', 'N', 'N', 'A', 'Y', NULL, NULL, 'N', 'N', 0.00, 0, NULL, 'SELL', 102676.10, '2025-06-24 04:45:51', NULL, NULL, 0.00, NULL, 0.00, NULL, 0.00, NULL, 1, 1, 57, 0, 0, 0, 0, 0.00, 57.00, 0.00, 57.000);
INSERT INTO `play_list` VALUES (5, 1, 'BTCUSDT', 'A_5', 'A', 1, 5, 3, 3, 44.00, 40.00, 50.00, 240.00, 0.00, 0.00, 'N', 0.00, 0.00, 'N', 0.00, 0.00, 0.00, 'N', 'N', 'N', 'BUY', 'Y', 'Y', 1, 'START', 'READY', '2025-05-19 15:50:34', 'Y', NULL, 'N', 'N', 'B', 'Y', NULL, NULL, 'N', 'N', 0.00, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, NULL, 0.00, NULL, 0.00, NULL, 0, 0, 0, 0, 0, 0, 0, NULL, 0.00, 0.00, 0.000);
INSERT INTO `play_list` VALUES (6, 1, 'BTCUSDT', 'A_5', 'A', 1, 5, 3, 3, 44.00, 40.00, 50.00, 240.00, 0.00, 0.00, 'N', 0.00, 0.00, 'N', 0.00, 0.00, 0.00, 'N', 'N', 'N', 'SELL', 'Y', 'Y', 1, 'START', 'READY', '2025-05-19 15:50:34', 'Y', NULL, 'N', 'N', 'B', 'Y', NULL, NULL, 'N', 'N', 0.00, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, NULL, 0.00, NULL, 0.00, NULL, 0, 0, 0, 0, 0, 0, 0, NULL, 0.00, 0.00, 0.000);

-- ----------------------------
-- Table structure for play_log
-- ----------------------------
DROP TABLE IF EXISTS `play_log`;
CREATE TABLE `play_log`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `uid` int(11) UNSIGNED NOT NULL,
  `pid` int(11) UNSIGNED NOT NULL,
  `tid` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `oid` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `st` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  `signalType` char(5) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  `signalPrice` double(15, 2) NULL DEFAULT NULL,
  `signalTime` datetime NULL DEFAULT NULL,
  `openPrice` double(15, 2) NULL DEFAULT NULL COMMENT '체결된가격 진입가격',
  `closePrice` double(15, 2) NULL DEFAULT NULL COMMENT '익절 가격',
  `closeTick` double(15, 2) NULL DEFAULT NULL,
  `pol_tick` double(15, 2) NULL DEFAULT NULL COMMENT '손익 틱',
  `pol_sum` double(15, 2) NULL DEFAULT NULL COMMENT '손익 돈',
  `charge` double(15, 2) NULL DEFAULT 0.00 COMMENT 'ls증권 수수료',
  `openTime` datetime NULL DEFAULT NULL,
  `closeTime` datetime NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `item_uid`(`uid`) USING BTREE,
  INDEX `play_list_id`(`pid`) USING BTREE,
  CONSTRAINT `play_log_ibfk_1` FOREIGN KEY (`uid`) REFERENCES `admin_member` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of play_log
-- ----------------------------

-- ----------------------------
-- Table structure for real_price
-- ----------------------------
DROP TABLE IF EXISTS `real_price`;
CREATE TABLE `real_price`  (
  `cur_price` double(15, 2) NOT NULL DEFAULT 0.00
) ENGINE = InnoDB CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of real_price
-- ----------------------------
INSERT INTO `real_price` VALUES (21719.75);

-- ----------------------------
-- Table structure for stoch_list
-- ----------------------------
DROP TABLE IF EXISTS `stoch_list`;
CREATE TABLE `stoch_list`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `symbol` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `uuid` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  `type` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL COMMENT 'stoch, rsi, sma',
  `bunbong` int(11) NULL DEFAULT NULL,
  `second1` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL COMMENT 'rsi 분봉?',
  `second2` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT '1',
  `second3` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT '1',
  `second4` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT '1',
  `rsi_period` int(11) NULL DEFAULT NULL,
  `rsi_up` double(15, 3) NULL DEFAULT NULL,
  `rsi_down` double(15, 3) NULL DEFAULT NULL,
  `st1` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'INIT' COMMENT 'INIT: 추가해야함, READY:준비, DEL: 삭제해야함',
  `st2` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'INIT',
  `created_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`, `uuid`) USING BTREE,
  INDEX `item_uid`(`uuid`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1011 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of stoch_list
-- ----------------------------
INSERT INTO `stoch_list` VALUES (1, 'BTCUSDT', 'S_A_BTCUSDT_1', 'scalping', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (2, 'BTCUSDT', 'S_A_BTCUSDT_2', 'scalping', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (3, 'BTCUSDT', 'S_A_BTCUSDT_3', 'scalping', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (4, 'BTCUSDT', 'S_A_BTCUSDT_5', 'scalping', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (5, 'BTCUSDT', 'S_A_BTCUSDT_10', 'scalping', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (6, 'BTCUSDT', 'S_A_BTCUSDT_15', 'scalping', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (7, 'ETHUSDT', 'S_A_ETHUSDT_1', 'scalping', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (8, 'ETHUSDT', 'S_A_ETHUSDT_2', 'scalping', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (9, 'ETHUSDT', 'S_A_ETHUSDT_3', 'scalping', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (10, 'ETHUSDT', 'S_A_ETHUSDT_5', 'scalping', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (11, 'ETHUSDT', 'S_A_ETHUSDT_10', 'scalping', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (12, 'ETHUSDT', 'S_A_ETHUSDT_15', 'scalping', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (13, 'XRPUSDT', 'S_A_XRPUSDT_1', 'scalping', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (14, 'XRPUSDT', 'S_A_XRPUSDT_2', 'scalping', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (15, 'XRPUSDT', 'S_A_XRPUSDT_3', 'scalping', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (16, 'XRPUSDT', 'S_A_XRPUSDT_5', 'scalping', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (17, 'XRPUSDT', 'S_A_XRPUSDT_10', 'scalping', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (18, 'XRPUSDT', 'S_A_XRPUSDT_15', 'scalping', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (19, 'SOLUSDT', 'S_A_SOLUSDT_1', 'scalping', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (20, 'SOLUSDT', 'S_A_SOLUSDT_2', 'scalping', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (21, 'SOLUSDT', 'S_A_SOLUSDT_3', 'scalping', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (22, 'SOLUSDT', 'S_A_SOLUSDT_5', 'scalping', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (23, 'SOLUSDT', 'S_A_SOLUSDT_10', 'scalping', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (24, 'SOLUSDT', 'S_A_SOLUSDT_15', 'scalping', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (25, 'DOGEUSDT', 'S_A_DOGEUSDT_1', 'scalping', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (26, 'DOGEUSDT', 'S_A_DOGEUSDT_2', 'scalping', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (27, 'DOGEUSDT', 'S_A_DOGEUSDT_3', 'scalping', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (28, 'DOGEUSDT', 'S_A_DOGEUSDT_5', 'scalping', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (29, 'DOGEUSDT', 'S_A_DOGEUSDT_10', 'scalping', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (30, 'DOGEUSDT', 'S_A_DOGEUSDT_15', 'scalping', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (31, 'BTCUSDT', 'S_B_BTCUSDT_1', 'scalping', 1, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (32, 'BTCUSDT', 'S_B_BTCUSDT_2', 'scalping', 2, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (33, 'BTCUSDT', 'S_B_BTCUSDT_3', 'scalping', 3, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (34, 'BTCUSDT', 'S_B_BTCUSDT_5', 'scalping', 5, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (35, 'BTCUSDT', 'S_B_BTCUSDT_10', 'scalping', 10, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (36, 'BTCUSDT', 'S_B_BTCUSDT_15', 'scalping', 15, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (37, 'ETHUSDT', 'S_B_ETHUSDT_1', 'scalping', 1, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (38, 'ETHUSDT', 'S_B_ETHUSDT_2', 'scalping', 2, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (39, 'ETHUSDT', 'S_B_ETHUSDT_3', 'scalping', 3, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (40, 'ETHUSDT', 'S_B_ETHUSDT_5', 'scalping', 5, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (41, 'ETHUSDT', 'S_B_ETHUSDT_10', 'scalping', 10, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (42, 'ETHUSDT', 'S_B_ETHUSDT_15', 'scalping', 15, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (43, 'XRPUSDT', 'S_B_XRPUSDT_1', 'scalping', 1, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (44, 'XRPUSDT', 'S_B_XRPUSDT_2', 'scalping', 2, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (45, 'XRPUSDT', 'S_B_XRPUSDT_3', 'scalping', 3, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (46, 'XRPUSDT', 'S_B_XRPUSDT_5', 'scalping', 5, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (47, 'XRPUSDT', 'S_B_XRPUSDT_10', 'scalping', 10, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (48, 'XRPUSDT', 'S_B_XRPUSDT_15', 'scalping', 15, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (49, 'SOLUSDT', 'S_B_SOLUSDT_1', 'scalping', 1, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (50, 'SOLUSDT', 'S_B_SOLUSDT_2', 'scalping', 2, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (51, 'SOLUSDT', 'S_B_SOLUSDT_3', 'scalping', 3, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (52, 'SOLUSDT', 'S_B_SOLUSDT_5', 'scalping', 5, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (53, 'SOLUSDT', 'S_B_SOLUSDT_10', 'scalping', 10, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (54, 'SOLUSDT', 'S_B_SOLUSDT_15', 'scalping', 15, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (55, 'DOGEUSDT', 'S_B_DOGEUSDT_1', 'scalping', 1, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (56, 'DOGEUSDT', 'S_B_DOGEUSDT_2', 'scalping', 2, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (57, 'DOGEUSDT', 'S_B_DOGEUSDT_3', 'scalping', 3, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (58, 'DOGEUSDT', 'S_B_DOGEUSDT_5', 'scalping', 5, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (59, 'DOGEUSDT', 'S_B_DOGEUSDT_10', 'scalping', 10, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (60, 'DOGEUSDT', 'S_B_DOGEUSDT_15', 'scalping', 15, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (61, 'BTCUSDT', 'S_C_BTCUSDT_1', 'scalping', 1, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (62, 'BTCUSDT', 'S_C_BTCUSDT_2', 'scalping', 2, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (63, 'BTCUSDT', 'S_C_BTCUSDT_3', 'scalping', 3, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (64, 'BTCUSDT', 'S_C_BTCUSDT_5', 'scalping', 5, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (65, 'BTCUSDT', 'S_C_BTCUSDT_10', 'scalping', 10, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (66, 'BTCUSDT', 'S_C_BTCUSDT_15', 'scalping', 15, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (67, 'ETHUSDT', 'S_C_ETHUSDT_1', 'scalping', 1, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (68, 'ETHUSDT', 'S_C_ETHUSDT_2', 'scalping', 2, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (69, 'ETHUSDT', 'S_C_ETHUSDT_3', 'scalping', 3, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (70, 'ETHUSDT', 'S_C_ETHUSDT_5', 'scalping', 5, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (71, 'ETHUSDT', 'S_C_ETHUSDT_10', 'scalping', 10, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (72, 'ETHUSDT', 'S_C_ETHUSDT_15', 'scalping', 15, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (73, 'XRPUSDT', 'S_C_XRPUSDT_1', 'scalping', 1, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (74, 'XRPUSDT', 'S_C_XRPUSDT_2', 'scalping', 2, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (75, 'XRPUSDT', 'S_C_XRPUSDT_3', 'scalping', 3, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (76, 'XRPUSDT', 'S_C_XRPUSDT_5', 'scalping', 5, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (77, 'XRPUSDT', 'S_C_XRPUSDT_10', 'scalping', 10, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (78, 'XRPUSDT', 'S_C_XRPUSDT_15', 'scalping', 15, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (79, 'SOLUSDT', 'S_C_SOLUSDT_1', 'scalping', 1, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (80, 'SOLUSDT', 'S_C_SOLUSDT_2', 'scalping', 2, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (81, 'SOLUSDT', 'S_C_SOLUSDT_3', 'scalping', 3, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (82, 'SOLUSDT', 'S_C_SOLUSDT_5', 'scalping', 5, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (83, 'SOLUSDT', 'S_C_SOLUSDT_10', 'scalping', 10, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (84, 'SOLUSDT', 'S_C_SOLUSDT_15', 'scalping', 15, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (85, 'DOGEUSDT', 'S_C_DOGEUSDT_1', 'scalping', 1, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (86, 'DOGEUSDT', 'S_C_DOGEUSDT_2', 'scalping', 2, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (87, 'DOGEUSDT', 'S_C_DOGEUSDT_3', 'scalping', 3, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (88, 'DOGEUSDT', 'S_C_DOGEUSDT_5', 'scalping', 5, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (89, 'DOGEUSDT', 'S_C_DOGEUSDT_10', 'scalping', 10, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (90, 'DOGEUSDT', 'S_C_DOGEUSDT_15', 'scalping', 15, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (91, 'BTCUSDT', 'T_A_BTCUSDT_1', 'trend', 1, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (92, 'BTCUSDT', 'T_A_BTCUSDT_2', 'trend', 2, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (93, 'BTCUSDT', 'T_A_BTCUSDT_3', 'trend', 3, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (94, 'BTCUSDT', 'T_A_BTCUSDT_5', 'trend', 5, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (95, 'BTCUSDT', 'T_A_BTCUSDT_10', 'trend', 10, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (96, 'BTCUSDT', 'T_A_BTCUSDT_15', 'trend', 15, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (97, 'ETHUSDT', 'T_A_ETHUSDT_1', 'trend', 1, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (98, 'ETHUSDT', 'T_A_ETHUSDT_2', 'trend', 2, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (99, 'ETHUSDT', 'T_A_ETHUSDT_3', 'trend', 3, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (100, 'ETHUSDT', 'T_A_ETHUSDT_5', 'trend', 5, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (101, 'ETHUSDT', 'T_A_ETHUSDT_10', 'trend', 10, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (102, 'ETHUSDT', 'T_A_ETHUSDT_15', 'trend', 15, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (103, 'XRPUSDT', 'T_A_XRPUSDT_1', 'trend', 1, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (104, 'XRPUSDT', 'T_A_XRPUSDT_2', 'trend', 2, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (105, 'XRPUSDT', 'T_A_XRPUSDT_3', 'trend', 3, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (106, 'XRPUSDT', 'T_A_XRPUSDT_5', 'trend', 5, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (107, 'XRPUSDT', 'T_A_XRPUSDT_10', 'trend', 10, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (108, 'XRPUSDT', 'T_A_XRPUSDT_15', 'trend', 15, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (109, 'SOLUSDT', 'T_A_SOLUSDT_1', 'trend', 1, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (110, 'SOLUSDT', 'T_A_SOLUSDT_2', 'trend', 2, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (111, 'SOLUSDT', 'T_A_SOLUSDT_3', 'trend', 3, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (112, 'SOLUSDT', 'T_A_SOLUSDT_5', 'trend', 5, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (113, 'SOLUSDT', 'T_A_SOLUSDT_10', 'trend', 10, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (114, 'SOLUSDT', 'T_A_SOLUSDT_15', 'trend', 15, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (115, 'DOGEUSDT', 'T_A_DOGEUSDT_1', 'trend', 1, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (116, 'DOGEUSDT', 'T_A_DOGEUSDT_2', 'trend', 2, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (117, 'DOGEUSDT', 'T_A_DOGEUSDT_3', 'trend', 3, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (118, 'DOGEUSDT', 'T_A_DOGEUSDT_5', 'trend', 5, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (119, 'DOGEUSDT', 'T_A_DOGEUSDT_10', 'trend', 10, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (120, 'DOGEUSDT', 'T_A_DOGEUSDT_15', 'trend', 15, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (121, 'BTCUSDT', 'T_B_BTCUSDT_1', 'trend', 1, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (122, 'BTCUSDT', 'T_B_BTCUSDT_2', 'trend', 2, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (123, 'BTCUSDT', 'T_B_BTCUSDT_3', 'trend', 3, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (124, 'BTCUSDT', 'T_B_BTCUSDT_5', 'trend', 5, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (125, 'BTCUSDT', 'T_B_BTCUSDT_10', 'trend', 10, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (126, 'BTCUSDT', 'T_B_BTCUSDT_15', 'trend', 15, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (127, 'ETHUSDT', 'T_B_ETHUSDT_1', 'trend', 1, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (128, 'ETHUSDT', 'T_B_ETHUSDT_2', 'trend', 2, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (129, 'ETHUSDT', 'T_B_ETHUSDT_3', 'trend', 3, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (130, 'ETHUSDT', 'T_B_ETHUSDT_5', 'trend', 5, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (131, 'ETHUSDT', 'T_B_ETHUSDT_10', 'trend', 10, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (132, 'ETHUSDT', 'T_B_ETHUSDT_15', 'trend', 15, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (133, 'XRPUSDT', 'T_B_XRPUSDT_1', 'trend', 1, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (134, 'XRPUSDT', 'T_B_XRPUSDT_2', 'trend', 2, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (135, 'XRPUSDT', 'T_B_XRPUSDT_3', 'trend', 3, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (136, 'XRPUSDT', 'T_B_XRPUSDT_5', 'trend', 5, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (137, 'XRPUSDT', 'T_B_XRPUSDT_10', 'trend', 10, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (138, 'XRPUSDT', 'T_B_XRPUSDT_15', 'trend', 15, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (139, 'SOLUSDT', 'T_B_SOLUSDT_1', 'trend', 1, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (140, 'SOLUSDT', 'T_B_SOLUSDT_2', 'trend', 2, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (141, 'SOLUSDT', 'T_B_SOLUSDT_3', 'trend', 3, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (142, 'SOLUSDT', 'T_B_SOLUSDT_5', 'trend', 5, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (143, 'SOLUSDT', 'T_B_SOLUSDT_10', 'trend', 10, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (144, 'SOLUSDT', 'T_B_SOLUSDT_15', 'trend', 15, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (145, 'DOGEUSDT', 'T_B_DOGEUSDT_1', 'trend', 1, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (146, 'DOGEUSDT', 'T_B_DOGEUSDT_2', 'trend', 2, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (147, 'DOGEUSDT', 'T_B_DOGEUSDT_3', 'trend', 3, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (148, 'DOGEUSDT', 'T_B_DOGEUSDT_5', 'trend', 5, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (149, 'DOGEUSDT', 'T_B_DOGEUSDT_10', 'trend', 10, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (150, 'DOGEUSDT', 'T_B_DOGEUSDT_15', 'trend', 15, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (151, 'BTCUSDT', 'T_C_BTCUSDT_1', 'trend', 1, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (152, 'BTCUSDT', 'T_C_BTCUSDT_2', 'trend', 2, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (153, 'BTCUSDT', 'T_C_BTCUSDT_3', 'trend', 3, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (154, 'BTCUSDT', 'T_C_BTCUSDT_5', 'trend', 5, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (155, 'BTCUSDT', 'T_C_BTCUSDT_10', 'trend', 10, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (156, 'BTCUSDT', 'T_C_BTCUSDT_15', 'trend', 15, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (157, 'ETHUSDT', 'T_C_ETHUSDT_1', 'trend', 1, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (158, 'ETHUSDT', 'T_C_ETHUSDT_2', 'trend', 2, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (159, 'ETHUSDT', 'T_C_ETHUSDT_3', 'trend', 3, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (160, 'ETHUSDT', 'T_C_ETHUSDT_5', 'trend', 5, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (161, 'ETHUSDT', 'T_C_ETHUSDT_10', 'trend', 10, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (162, 'ETHUSDT', 'T_C_ETHUSDT_15', 'trend', 15, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (163, 'XRPUSDT', 'T_C_XRPUSDT_1', 'trend', 1, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (164, 'XRPUSDT', 'T_C_XRPUSDT_2', 'trend', 2, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (165, 'XRPUSDT', 'T_C_XRPUSDT_3', 'trend', 3, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (166, 'XRPUSDT', 'T_C_XRPUSDT_5', 'trend', 5, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (167, 'XRPUSDT', 'T_C_XRPUSDT_10', 'trend', 10, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (168, 'XRPUSDT', 'T_C_XRPUSDT_15', 'trend', 15, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (169, 'SOLUSDT', 'T_C_SOLUSDT_1', 'trend', 1, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (170, 'SOLUSDT', 'T_C_SOLUSDT_2', 'trend', 2, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (171, 'SOLUSDT', 'T_C_SOLUSDT_3', 'trend', 3, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (172, 'SOLUSDT', 'T_C_SOLUSDT_5', 'trend', 5, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (173, 'SOLUSDT', 'T_C_SOLUSDT_10', 'trend', 10, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (174, 'SOLUSDT', 'T_C_SOLUSDT_15', 'trend', 15, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (175, 'DOGEUSDT', 'T_C_DOGEUSDT_1', 'trend', 1, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (176, 'DOGEUSDT', 'T_C_DOGEUSDT_2', 'trend', 2, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (177, 'DOGEUSDT', 'T_C_DOGEUSDT_3', 'trend', 3, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (178, 'DOGEUSDT', 'T_C_DOGEUSDT_5', 'trend', 5, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (179, 'DOGEUSDT', 'T_C_DOGEUSDT_10', 'trend', 10, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (180, 'DOGEUSDT', 'T_C_DOGEUSDT_15', 'trend', 15, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (181, 'BTCUSDT', 'G_A_BTCUSDT_1', 'greenLight', 1, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (182, 'BTCUSDT', 'G_A_BTCUSDT_2', 'greenLight', 2, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (183, 'BTCUSDT', 'G_A_BTCUSDT_3', 'greenLight', 3, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (184, 'BTCUSDT', 'G_A_BTCUSDT_5', 'greenLight', 5, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (185, 'BTCUSDT', 'G_A_BTCUSDT_10', 'greenLight', 10, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (186, 'BTCUSDT', 'G_A_BTCUSDT_15', 'greenLight', 15, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (187, 'ETHUSDT', 'G_A_ETHUSDT_1', 'greenLight', 1, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (188, 'ETHUSDT', 'G_A_ETHUSDT_2', 'greenLight', 2, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (189, 'ETHUSDT', 'G_A_ETHUSDT_3', 'greenLight', 3, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (190, 'ETHUSDT', 'G_A_ETHUSDT_5', 'greenLight', 5, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (191, 'ETHUSDT', 'G_A_ETHUSDT_10', 'greenLight', 10, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (192, 'ETHUSDT', 'G_A_ETHUSDT_15', 'greenLight', 15, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (193, 'XRPUSDT', 'G_A_XRPUSDT_1', 'greenLight', 1, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (194, 'XRPUSDT', 'G_A_XRPUSDT_2', 'greenLight', 2, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (195, 'XRPUSDT', 'G_A_XRPUSDT_3', 'greenLight', 3, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (196, 'XRPUSDT', 'G_A_XRPUSDT_5', 'greenLight', 5, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (197, 'XRPUSDT', 'G_A_XRPUSDT_10', 'greenLight', 10, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (198, 'XRPUSDT', 'G_A_XRPUSDT_15', 'greenLight', 15, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (199, 'SOLUSDT', 'G_A_SOLUSDT_1', 'greenLight', 1, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (200, 'SOLUSDT', 'G_A_SOLUSDT_2', 'greenLight', 2, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (201, 'SOLUSDT', 'G_A_SOLUSDT_3', 'greenLight', 3, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (202, 'SOLUSDT', 'G_A_SOLUSDT_5', 'greenLight', 5, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (203, 'SOLUSDT', 'G_A_SOLUSDT_10', 'greenLight', 10, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (204, 'SOLUSDT', 'G_A_SOLUSDT_15', 'greenLight', 15, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (205, 'DOGEUSDT', 'G_A_DOGEUSDT_1', 'greenLight', 1, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (206, 'DOGEUSDT', 'G_A_DOGEUSDT_2', 'greenLight', 2, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (207, 'DOGEUSDT', 'G_A_DOGEUSDT_3', 'greenLight', 3, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (208, 'DOGEUSDT', 'G_A_DOGEUSDT_5', 'greenLight', 5, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (209, 'DOGEUSDT', 'G_A_DOGEUSDT_10', 'greenLight', 10, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (210, 'DOGEUSDT', 'G_A_DOGEUSDT_15', 'greenLight', 15, NULL, '-1', '1', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (211, 'BTCUSDT', 'G_B_BTCUSDT_1', 'greenLight', 1, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (212, 'BTCUSDT', 'G_B_BTCUSDT_2', 'greenLight', 2, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (213, 'BTCUSDT', 'G_B_BTCUSDT_3', 'greenLight', 3, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (214, 'BTCUSDT', 'G_B_BTCUSDT_5', 'greenLight', 5, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (215, 'BTCUSDT', 'G_B_BTCUSDT_10', 'greenLight', 10, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (216, 'BTCUSDT', 'G_B_BTCUSDT_15', 'greenLight', 15, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (217, 'ETHUSDT', 'G_B_ETHUSDT_1', 'greenLight', 1, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (218, 'ETHUSDT', 'G_B_ETHUSDT_2', 'greenLight', 2, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (219, 'ETHUSDT', 'G_B_ETHUSDT_3', 'greenLight', 3, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (220, 'ETHUSDT', 'G_B_ETHUSDT_5', 'greenLight', 5, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (221, 'ETHUSDT', 'G_B_ETHUSDT_10', 'greenLight', 10, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (222, 'ETHUSDT', 'G_B_ETHUSDT_15', 'greenLight', 15, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (223, 'XRPUSDT', 'G_B_XRPUSDT_1', 'greenLight', 1, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (224, 'XRPUSDT', 'G_B_XRPUSDT_2', 'greenLight', 2, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (225, 'XRPUSDT', 'G_B_XRPUSDT_3', 'greenLight', 3, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (226, 'XRPUSDT', 'G_B_XRPUSDT_5', 'greenLight', 5, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (227, 'XRPUSDT', 'G_B_XRPUSDT_10', 'greenLight', 10, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (228, 'XRPUSDT', 'G_B_XRPUSDT_15', 'greenLight', 15, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (229, 'SOLUSDT', 'G_B_SOLUSDT_1', 'greenLight', 1, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (230, 'SOLUSDT', 'G_B_SOLUSDT_2', 'greenLight', 2, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (231, 'SOLUSDT', 'G_B_SOLUSDT_3', 'greenLight', 3, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (232, 'SOLUSDT', 'G_B_SOLUSDT_5', 'greenLight', 5, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (233, 'SOLUSDT', 'G_B_SOLUSDT_10', 'greenLight', 10, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (234, 'SOLUSDT', 'G_B_SOLUSDT_15', 'greenLight', 15, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (235, 'DOGEUSDT', 'G_B_DOGEUSDT_1', 'greenLight', 1, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (236, 'DOGEUSDT', 'G_B_DOGEUSDT_2', 'greenLight', 2, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (237, 'DOGEUSDT', 'G_B_DOGEUSDT_3', 'greenLight', 3, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (238, 'DOGEUSDT', 'G_B_DOGEUSDT_5', 'greenLight', 5, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (239, 'DOGEUSDT', 'G_B_DOGEUSDT_10', 'greenLight', 10, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (240, 'DOGEUSDT', 'G_B_DOGEUSDT_15', 'greenLight', 15, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (241, 'BTCUSDT', 'G_B_BTCUSDT_1', 'greenLight', 1, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (242, 'BTCUSDT', 'G_B_BTCUSDT_2', 'greenLight', 2, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (243, 'BTCUSDT', 'G_B_BTCUSDT_3', 'greenLight', 3, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (244, 'BTCUSDT', 'G_B_BTCUSDT_5', 'greenLight', 5, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (245, 'BTCUSDT', 'G_B_BTCUSDT_10', 'greenLight', 10, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (246, 'BTCUSDT', 'G_B_BTCUSDT_15', 'greenLight', 15, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (247, 'ETHUSDT', 'G_B_ETHUSDT_1', 'greenLight', 1, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (248, 'ETHUSDT', 'G_B_ETHUSDT_2', 'greenLight', 2, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (249, 'ETHUSDT', 'G_B_ETHUSDT_3', 'greenLight', 3, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (250, 'ETHUSDT', 'G_B_ETHUSDT_5', 'greenLight', 5, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (251, 'ETHUSDT', 'G_B_ETHUSDT_10', 'greenLight', 10, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (252, 'ETHUSDT', 'G_B_ETHUSDT_15', 'greenLight', 15, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (253, 'XRPUSDT', 'G_B_XRPUSDT_1', 'greenLight', 1, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (254, 'XRPUSDT', 'G_B_XRPUSDT_2', 'greenLight', 2, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (255, 'XRPUSDT', 'G_B_XRPUSDT_3', 'greenLight', 3, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (256, 'XRPUSDT', 'G_B_XRPUSDT_5', 'greenLight', 5, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (257, 'XRPUSDT', 'G_B_XRPUSDT_10', 'greenLight', 10, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (258, 'XRPUSDT', 'G_B_XRPUSDT_15', 'greenLight', 15, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (259, 'SOLUSDT', 'G_B_SOLUSDT_1', 'greenLight', 1, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (260, 'SOLUSDT', 'G_B_SOLUSDT_2', 'greenLight', 2, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (261, 'SOLUSDT', 'G_B_SOLUSDT_3', 'greenLight', 3, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (262, 'SOLUSDT', 'G_B_SOLUSDT_5', 'greenLight', 5, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (263, 'SOLUSDT', 'G_B_SOLUSDT_10', 'greenLight', 10, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (264, 'SOLUSDT', 'G_B_SOLUSDT_15', 'greenLight', 15, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (265, 'DOGEUSDT', 'G_B_DOGEUSDT_1', 'greenLight', 1, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (266, 'DOGEUSDT', 'G_B_DOGEUSDT_2', 'greenLight', 2, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (267, 'DOGEUSDT', 'G_B_DOGEUSDT_3', 'greenLight', 3, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (268, 'DOGEUSDT', 'G_B_DOGEUSDT_5', 'greenLight', 5, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (269, 'DOGEUSDT', 'G_B_DOGEUSDT_10', 'greenLight', 10, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (270, 'DOGEUSDT', 'G_B_DOGEUSDT_15', 'greenLight', 15, NULL, '-3', '3', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (271, 'BTCUSDT', 'G_C_BTCUSDT_1', 'greenLight', 1, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (272, 'BTCUSDT', 'G_C_BTCUSDT_2', 'greenLight', 2, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (273, 'BTCUSDT', 'G_C_BTCUSDT_3', 'greenLight', 3, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (274, 'BTCUSDT', 'G_C_BTCUSDT_5', 'greenLight', 5, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (275, 'BTCUSDT', 'G_C_BTCUSDT_10', 'greenLight', 10, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (276, 'BTCUSDT', 'G_C_BTCUSDT_15', 'greenLight', 15, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (277, 'ETHUSDT', 'G_C_ETHUSDT_1', 'greenLight', 1, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (278, 'ETHUSDT', 'G_C_ETHUSDT_2', 'greenLight', 2, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (279, 'ETHUSDT', 'G_C_ETHUSDT_3', 'greenLight', 3, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (280, 'ETHUSDT', 'G_C_ETHUSDT_5', 'greenLight', 5, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (281, 'ETHUSDT', 'G_C_ETHUSDT_10', 'greenLight', 10, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (282, 'ETHUSDT', 'G_C_ETHUSDT_15', 'greenLight', 15, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (283, 'XRPUSDT', 'G_C_XRPUSDT_1', 'greenLight', 1, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (284, 'XRPUSDT', 'G_C_XRPUSDT_2', 'greenLight', 2, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (285, 'XRPUSDT', 'G_C_XRPUSDT_3', 'greenLight', 3, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (286, 'XRPUSDT', 'G_C_XRPUSDT_5', 'greenLight', 5, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (287, 'XRPUSDT', 'G_C_XRPUSDT_10', 'greenLight', 10, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (288, 'XRPUSDT', 'G_C_XRPUSDT_15', 'greenLight', 15, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (289, 'SOLUSDT', 'G_C_SOLUSDT_1', 'greenLight', 1, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (290, 'SOLUSDT', 'G_C_SOLUSDT_2', 'greenLight', 2, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (291, 'SOLUSDT', 'G_C_SOLUSDT_3', 'greenLight', 3, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (292, 'SOLUSDT', 'G_C_SOLUSDT_5', 'greenLight', 5, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (293, 'SOLUSDT', 'G_C_SOLUSDT_10', 'greenLight', 10, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (294, 'SOLUSDT', 'G_C_SOLUSDT_15', 'greenLight', 15, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (295, 'DOGEUSDT', 'G_C_DOGEUSDT_1', 'greenLight', 1, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (296, 'DOGEUSDT', 'G_C_DOGEUSDT_2', 'greenLight', 2, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (297, 'DOGEUSDT', 'G_C_DOGEUSDT_3', 'greenLight', 3, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (298, 'DOGEUSDT', 'G_C_DOGEUSDT_5', 'greenLight', 5, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (299, 'DOGEUSDT', 'G_C_DOGEUSDT_10', 'greenLight', 10, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (300, 'DOGEUSDT', 'G_C_DOGEUSDT_15', 'greenLight', 15, NULL, '-2', '2', NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:23:24');
INSERT INTO `stoch_list` VALUES (301, 'BTCUSDT', 'H_BTCUSDT_1', 'stoch', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (302, 'BTCUSDT', 'H_BTCUSDT_2', 'stoch', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (303, 'BTCUSDT', 'H_BTCUSDT_3', 'stoch', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (304, 'BTCUSDT', 'H_BTCUSDT_5', 'stoch', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (305, 'BTCUSDT', 'H_BTCUSDT_10', 'stoch', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (306, 'BTCUSDT', 'H_BTCUSDT_15', 'stoch', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (307, 'BTCUSDT', 'H_BTCUSDT_30', 'stoch', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (308, 'ETHUSDT', 'H_ETHUSDT_1', 'stoch', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (309, 'ETHUSDT', 'H_ETHUSDT_2', 'stoch', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (310, 'ETHUSDT', 'H_ETHUSDT_3', 'stoch', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (311, 'ETHUSDT', 'H_ETHUSDT_5', 'stoch', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (312, 'ETHUSDT', 'H_ETHUSDT_10', 'stoch', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (313, 'ETHUSDT', 'H_ETHUSDT_15', 'stoch', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (314, 'ETHUSDT', 'H_ETHUSDT_30', 'stoch', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (315, 'XRPUSDT', 'H_XRPUSDT_1', 'stoch', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (316, 'XRPUSDT', 'H_XRPUSDT_2', 'stoch', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (317, 'XRPUSDT', 'H_XRPUSDT_3', 'stoch', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (318, 'XRPUSDT', 'H_XRPUSDT_5', 'stoch', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (319, 'XRPUSDT', 'H_XRPUSDT_10', 'stoch', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (320, 'XRPUSDT', 'H_XRPUSDT_15', 'stoch', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (321, 'XRPUSDT', 'H_XRPUSDT_30', 'stoch', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (322, 'SOLUSDT', 'H_SOLUSDT_1', 'stoch', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (323, 'SOLUSDT', 'H_SOLUSDT_2', 'stoch', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (324, 'SOLUSDT', 'H_SOLUSDT_3', 'stoch', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (325, 'SOLUSDT', 'H_SOLUSDT_5', 'stoch', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (326, 'SOLUSDT', 'H_SOLUSDT_10', 'stoch', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (327, 'SOLUSDT', 'H_SOLUSDT_15', 'stoch', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (328, 'SOLUSDT', 'H_SOLUSDT_30', 'stoch', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (329, 'DOGEUSDT', 'H_DOGEUSDT_1', 'stoch', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (330, 'DOGEUSDT', 'H_DOGEUSDT_2', 'stoch', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (331, 'DOGEUSDT', 'H_DOGEUSDT_3', 'stoch', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (332, 'DOGEUSDT', 'H_DOGEUSDT_5', 'stoch', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (333, 'DOGEUSDT', 'H_DOGEUSDT_10', 'stoch', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (334, 'DOGEUSDT', 'H_DOGEUSDT_15', 'stoch', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (335, 'DOGEUSDT', 'H_DOGEUSDT_30', 'stoch', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (336, 'PUMPUSDT', 'H_PUMPUSDT_1', 'stoch', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (337, 'PUMPUSDT', 'H_PUMPUSDT_2', 'stoch', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (338, 'PUMPUSDT', 'H_PUMPUSDT_3', 'stoch', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (339, 'PUMPUSDT', 'H_PUMPUSDT_5', 'stoch', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (340, 'PUMPUSDT', 'H_PUMPUSDT_10', 'stoch', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (341, 'PUMPUSDT', 'H_PUMPUSDT_15', 'stoch', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (342, 'PUMPUSDT', 'H_PUMPUSDT_30', 'stoch', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (343, 'AVAXUSDT', 'H_AVAXUSDT_1', 'stoch', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (344, 'AVAXUSDT', 'H_AVAXUSDT_2', 'stoch', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (345, 'AVAXUSDT', 'H_AVAXUSDT_3', 'stoch', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (346, 'AVAXUSDT', 'H_AVAXUSDT_5', 'stoch', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (347, 'AVAXUSDT', 'H_AVAXUSDT_10', 'stoch', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (348, 'AVAXUSDT', 'H_AVAXUSDT_15', 'stoch', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (349, 'AVAXUSDT', 'H_AVAXUSDT_30', 'stoch', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (350, 'UNIUSDT', 'H_UNIUSDT_1', 'stoch', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (351, 'UNIUSDT', 'H_UNIUSDT_2', 'stoch', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (352, 'UNIUSDT', 'H_UNIUSDT_3', 'stoch', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (353, 'UNIUSDT', 'H_UNIUSDT_5', 'stoch', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (354, 'UNIUSDT', 'H_UNIUSDT_10', 'stoch', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (355, 'UNIUSDT', 'H_UNIUSDT_15', 'stoch', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (356, 'UNIUSDT', 'H_UNIUSDT_30', 'stoch', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (357, 'SUIUSDT', 'H_SUIUSDT_1', 'stoch', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (358, 'SUIUSDT', 'H_SUIUSDT_2', 'stoch', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (359, 'SUIUSDT', 'H_SUIUSDT_3', 'stoch', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (360, 'SUIUSDT', 'H_SUIUSDT_5', 'stoch', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (361, 'SUIUSDT', 'H_SUIUSDT_10', 'stoch', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (362, 'SUIUSDT', 'H_SUIUSDT_15', 'stoch', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (363, 'SUIUSDT', 'H_SUIUSDT_30', 'stoch', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (364, 'WLFIUSDT', 'H_WLFIUSDT_1', 'stoch', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (365, 'WLFIUSDT', 'H_WLFIUSDT_2', 'stoch', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (366, 'WLFIUSDT', 'H_WLFIUSDT_3', 'stoch', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (367, 'WLFIUSDT', 'H_WLFIUSDT_5', 'stoch', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (368, 'WLFIUSDT', 'H_WLFIUSDT_10', 'stoch', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (369, 'WLFIUSDT', 'H_WLFIUSDT_15', 'stoch', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (370, 'WLFIUSDT', 'H_WLFIUSDT_30', 'stoch', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (371, 'TONUSDT', 'H_TONUSDT_1', 'stoch', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (372, 'TONUSDT', 'H_TONUSDT_2', 'stoch', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (373, 'TONUSDT', 'H_TONUSDT_3', 'stoch', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (374, 'TONUSDT', 'H_TONUSDT_5', 'stoch', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (375, 'TONUSDT', 'H_TONUSDT_10', 'stoch', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (376, 'TONUSDT', 'H_TONUSDT_15', 'stoch', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (377, 'TONUSDT', 'H_TONUSDT_30', 'stoch', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (378, 'ENAUSDT', 'H_ENAUSDT_1', 'stoch', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (379, 'ENAUSDT', 'H_ENAUSDT_2', 'stoch', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (380, 'ENAUSDT', 'H_ENAUSDT_3', 'stoch', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (381, 'ENAUSDT', 'H_ENAUSDT_5', 'stoch', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (382, 'ENAUSDT', 'H_ENAUSDT_10', 'stoch', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (383, 'ENAUSDT', 'H_ENAUSDT_15', 'stoch', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (384, 'ENAUSDT', 'H_ENAUSDT_30', 'stoch', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (385, 'QNTUSDT', 'H_QNTUSDT_1', 'stoch', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (386, 'QNTUSDT', 'H_QNTUSDT_2', 'stoch', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (387, 'QNTUSDT', 'H_QNTUSDT_3', 'stoch', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (388, 'QNTUSDT', 'H_QNTUSDT_5', 'stoch', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (389, 'QNTUSDT', 'H_QNTUSDT_10', 'stoch', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (390, 'QNTUSDT', 'H_QNTUSDT_15', 'stoch', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (391, 'QNTUSDT', 'H_QNTUSDT_30', 'stoch', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (392, 'ALGOUSDT', 'H_ALGOUSDT_1', 'stoch', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (393, 'ALGOUSDT', 'H_ALGOUSDT_2', 'stoch', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (394, 'ALGOUSDT', 'H_ALGOUSDT_3', 'stoch', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (395, 'ALGOUSDT', 'H_ALGOUSDT_5', 'stoch', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (396, 'ALGOUSDT', 'H_ALGOUSDT_10', 'stoch', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (397, 'ALGOUSDT', 'H_ALGOUSDT_15', 'stoch', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (398, 'ALGOUSDT', 'H_ALGOUSDT_30', 'stoch', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (399, 'VETUSDT', 'H_VETUSDT_1', 'stoch', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (400, 'VETUSDT', 'H_VETUSDT_2', 'stoch', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (401, 'VETUSDT', 'H_VETUSDT_3', 'stoch', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (402, 'VETUSDT', 'H_VETUSDT_5', 'stoch', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (403, 'VETUSDT', 'H_VETUSDT_10', 'stoch', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (404, 'VETUSDT', 'H_VETUSDT_15', 'stoch', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (405, 'VETUSDT', 'H_VETUSDT_30', 'stoch', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (406, 'SEIUSDT', 'H_SEIUSDT_1', 'stoch', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (407, 'SEIUSDT', 'H_SEIUSDT_2', 'stoch', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (408, 'SEIUSDT', 'H_SEIUSDT_3', 'stoch', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (409, 'SEIUSDT', 'H_SEIUSDT_5', 'stoch', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (410, 'SEIUSDT', 'H_SEIUSDT_10', 'stoch', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (411, 'SEIUSDT', 'H_SEIUSDT_15', 'stoch', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (412, 'SEIUSDT', 'H_SEIUSDT_30', 'stoch', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (413, 'RENDERUSDT', 'H_RENDERUSDT_1', 'stoch', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (414, 'RENDERUSDT', 'H_RENDERUSDT_2', 'stoch', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (415, 'RENDERUSDT', 'H_RENDERUSDT_3', 'stoch', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (416, 'RENDERUSDT', 'H_RENDERUSDT_5', 'stoch', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (417, 'RENDERUSDT', 'H_RENDERUSDT_10', 'stoch', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (418, 'RENDERUSDT', 'H_RENDERUSDT_15', 'stoch', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (419, 'RENDERUSDT', 'H_RENDERUSDT_30', 'stoch', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:49:26');
INSERT INTO `stoch_list` VALUES (420, 'BTCUSDT', 'S_A_BTCUSDT_30', 'scalping', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:59:00');
INSERT INTO `stoch_list` VALUES (421, 'ETHUSDT', 'S_A_ETHUSDT_30', 'scalping', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:59:05');
INSERT INTO `stoch_list` VALUES (422, 'XRPUSDT', 'S_A_XRPUSDT_30', 'scalping', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:59:10');
INSERT INTO `stoch_list` VALUES (423, 'SOLUSDT', 'S_A_SOLUSDT_30', 'scalping', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:59:15');
INSERT INTO `stoch_list` VALUES (424, 'DOGEUSDT', 'S_A_DOGEUSDT_30', 'scalping', 30, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:59:19');
INSERT INTO `stoch_list` VALUES (425, 'PUMPUSDT', 'S_A_PUMPUSDT_1', 'scalping', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:59:34');
INSERT INTO `stoch_list` VALUES (426, 'PUMPUSDT', 'S_A_PUMPUSDT_2', 'scalping', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:59:40');
INSERT INTO `stoch_list` VALUES (427, 'PUMPUSDT', 'S_A_PUMPUSDT_3', 'scalping', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:59:44');
INSERT INTO `stoch_list` VALUES (428, 'PUMPUSDT', 'S_A_PUMPUSDT_5', 'scalping', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:59:50');
INSERT INTO `stoch_list` VALUES (429, 'PUMPUSDT', 'S_A_PUMPUSDT_10', 'scalping', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:59:54');
INSERT INTO `stoch_list` VALUES (430, 'PUMPUSDT', 'S_A_PUMPUSDT_15', 'scalping', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 16:59:57');
INSERT INTO `stoch_list` VALUES (431, 'AVAXUSDT', 'S_A_AVAXUSDT_1', 'scalping', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:00:02');
INSERT INTO `stoch_list` VALUES (432, 'AVAXUSDT', 'S_A_AVAXUSDT_2', 'scalping', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:00:05');
INSERT INTO `stoch_list` VALUES (433, 'AVAXUSDT', 'S_A_AVAXUSDT_3', 'scalping', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:00:08');
INSERT INTO `stoch_list` VALUES (434, 'AVAXUSDT', 'S_A_AVAXUSDT_5', 'scalping', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:00:11');
INSERT INTO `stoch_list` VALUES (435, 'AVAXUSDT', 'S_A_AVAXUSDT_10', 'scalping', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:00:14');
INSERT INTO `stoch_list` VALUES (436, 'AVAXUSDT', 'S_A_AVAXUSDT_15', 'scalping', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:00:17');
INSERT INTO `stoch_list` VALUES (437, 'UNIUSDT', 'S_A_UNIUSDT_1', 'scalping', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:00:22');
INSERT INTO `stoch_list` VALUES (438, 'UNIUSDT', 'S_A_UNIUSDT_2', 'scalping', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:00:25');
INSERT INTO `stoch_list` VALUES (439, 'UNIUSDT', 'S_A_UNIUSDT_3', 'scalping', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:00:28');
INSERT INTO `stoch_list` VALUES (440, 'UNIUSDT', 'S_A_UNIUSDT_5', 'scalping', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:00:31');
INSERT INTO `stoch_list` VALUES (441, 'UNIUSDT', 'S_A_UNIUSDT_10', 'scalping', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:00:34');
INSERT INTO `stoch_list` VALUES (442, 'UNIUSDT', 'S_A_UNIUSDT_15', 'scalping', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:00:37');
INSERT INTO `stoch_list` VALUES (443, 'SUIUSDT', 'S_A_SUIUSDT_1', 'scalping', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:00:46');
INSERT INTO `stoch_list` VALUES (444, 'SUIUSDT', 'S_A_SUIUSDT_2', 'scalping', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:00:52');
INSERT INTO `stoch_list` VALUES (445, 'SUIUSDT', 'S_A_SUIUSDT_3', 'scalping', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:00:55');
INSERT INTO `stoch_list` VALUES (446, 'SUIUSDT', 'S_A_SUIUSDT_5', 'scalping', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:01:00');
INSERT INTO `stoch_list` VALUES (447, 'SUIUSDT', 'S_A_SUIUSDT_10', 'scalping', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:01:03');
INSERT INTO `stoch_list` VALUES (448, 'SUIUSDT', 'S_A_SUIUSDT_15', 'scalping', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:01:06');
INSERT INTO `stoch_list` VALUES (449, 'WLFIUSDT', 'S_A_WLFIUSDT_1', 'scalping', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:01:13');
INSERT INTO `stoch_list` VALUES (450, 'WLFIUSDT', 'S_A_WLFIUSDT_2', 'scalping', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:01:16');
INSERT INTO `stoch_list` VALUES (451, 'WLFIUSDT', 'S_A_WLFIUSDT_3', 'scalping', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:01:19');
INSERT INTO `stoch_list` VALUES (452, 'WLFIUSDT', 'S_A_WLFIUSDT_5', 'scalping', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:01:22');
INSERT INTO `stoch_list` VALUES (453, 'WLFIUSDT', 'S_A_WLFIUSDT_10', 'scalping', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:01:25');
INSERT INTO `stoch_list` VALUES (454, 'WLFIUSDT', 'S_A_WLFIUSDT_15', 'scalping', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:01:37');
INSERT INTO `stoch_list` VALUES (455, 'TONUSDT', 'S_A_TONUSDT_1', 'scalping', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:01:45');
INSERT INTO `stoch_list` VALUES (456, 'TONUSDT', 'S_A_TONUSDT_2', 'scalping', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:01:48');
INSERT INTO `stoch_list` VALUES (457, 'TONUSDT', 'S_A_TONUSDT_3', 'scalping', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:01:51');
INSERT INTO `stoch_list` VALUES (458, 'TONUSDT', 'S_A_TONUSDT_5', 'scalping', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:01:54');
INSERT INTO `stoch_list` VALUES (459, 'TONUSDT', 'S_A_TONUSDT_10', 'scalping', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:01:57');
INSERT INTO `stoch_list` VALUES (460, 'TONUSDT', 'S_A_TONUSDT_15', 'scalping', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:02:00');
INSERT INTO `stoch_list` VALUES (461, 'ENAUSDT', 'S_A_ENAUSDT_1', 'scalping', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:02:05');
INSERT INTO `stoch_list` VALUES (462, 'ENAUSDT', 'S_A_ENAUSDT_2', 'scalping', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:02:13');
INSERT INTO `stoch_list` VALUES (463, 'ENAUSDT', 'S_A_ENAUSDT_3', 'scalping', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:02:22');
INSERT INTO `stoch_list` VALUES (464, 'ENAUSDT', 'S_A_ENAUSDT_5', 'scalping', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:02:27');
INSERT INTO `stoch_list` VALUES (465, 'ENAUSDT', 'S_A_ENAUSDT_10', 'scalping', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:02:31');
INSERT INTO `stoch_list` VALUES (466, 'ENAUSDT', 'S_A_ENAUSDT_15', 'scalping', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:02:34');
INSERT INTO `stoch_list` VALUES (467, 'QNTUSDT', 'S_A_QNTUSDT_1', 'scalping', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:02:39');
INSERT INTO `stoch_list` VALUES (468, 'QNTUSDT', 'S_A_QNTUSDT_2', 'scalping', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:02:42');
INSERT INTO `stoch_list` VALUES (469, 'QNTUSDT', 'S_A_QNTUSDT_3', 'scalping', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:02:45');
INSERT INTO `stoch_list` VALUES (470, 'QNTUSDT', 'S_A_QNTUSDT_5', 'scalping', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:02:48');
INSERT INTO `stoch_list` VALUES (471, 'QNTUSDT', 'S_A_QNTUSDT_10', 'scalping', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:02:51');
INSERT INTO `stoch_list` VALUES (472, 'QNTUSDT', 'S_A_QNTUSDT_15', 'scalping', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:02:54');
INSERT INTO `stoch_list` VALUES (473, 'ALGOUSDT', 'S_A_ALGOUSDT_1', 'scalping', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:02:59');
INSERT INTO `stoch_list` VALUES (474, 'ALGOUSDT', 'S_A_ALGOUSDT_2', 'scalping', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:03:02');
INSERT INTO `stoch_list` VALUES (475, 'ALGOUSDT', 'S_A_ALGOUSDT_3', 'scalping', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:03:05');
INSERT INTO `stoch_list` VALUES (476, 'ALGOUSDT', 'S_A_ALGOUSDT_5', 'scalping', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:03:31');
INSERT INTO `stoch_list` VALUES (477, 'ALGOUSDT', 'S_A_ALGOUSDT_10', 'scalping', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:03:34');
INSERT INTO `stoch_list` VALUES (478, 'ALGOUSDT', 'S_A_ALGOUSDT_15', 'scalping', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:03:37');
INSERT INTO `stoch_list` VALUES (479, 'VETUSDT', 'S_A_VETUSDT_1', 'scalping', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:03:46');
INSERT INTO `stoch_list` VALUES (480, 'VETUSDT', 'S_A_VETUSDT_2', 'scalping', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:03:51');
INSERT INTO `stoch_list` VALUES (481, 'VETUSDT', 'S_A_VETUSDT_3', 'scalping', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:03:55');
INSERT INTO `stoch_list` VALUES (482, 'VETUSDT', 'S_A_VETUSDT_5', 'scalping', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:04:00');
INSERT INTO `stoch_list` VALUES (483, 'VETUSDT', 'S_A_VETUSDT_10', 'scalping', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:04:06');
INSERT INTO `stoch_list` VALUES (484, 'VETUSDT', 'S_A_VETUSDT_15', 'scalping', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:04:10');
INSERT INTO `stoch_list` VALUES (485, 'SEIUSDT', 'S_A_SEIUSDT_1', 'scalping', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:04:15');
INSERT INTO `stoch_list` VALUES (486, 'SEIUSDT', 'S_A_SEIUSDT_2', 'scalping', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:04:18');
INSERT INTO `stoch_list` VALUES (487, 'SEIUSDT', 'S_A_SEIUSDT_3', 'scalping', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:04:21');
INSERT INTO `stoch_list` VALUES (488, 'SEIUSDT', 'S_A_SEIUSDT_5', 'scalping', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:04:24');
INSERT INTO `stoch_list` VALUES (489, 'SEIUSDT', 'S_A_SEIUSDT_10', 'scalping', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:04:27');
INSERT INTO `stoch_list` VALUES (490, 'SEIUSDT', 'S_A_SEIUSDT_15', 'scalping', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:04:30');
INSERT INTO `stoch_list` VALUES (491, 'RENDERUSDT', 'S_A_RENDERUSDT_1', 'scalping', 1, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:04:35');
INSERT INTO `stoch_list` VALUES (492, 'RENDERUSDT', 'S_A_RENDERUSDT_2', 'scalping', 2, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:04:37');
INSERT INTO `stoch_list` VALUES (493, 'RENDERUSDT', 'S_A_RENDERUSDT_3', 'scalping', 3, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:04:40');
INSERT INTO `stoch_list` VALUES (494, 'RENDERUSDT', 'S_A_RENDERUSDT_5', 'scalping', 5, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:04:43');
INSERT INTO `stoch_list` VALUES (495, 'RENDERUSDT', 'S_A_RENDERUSDT_10', 'scalping', 10, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:04:46');
INSERT INTO `stoch_list` VALUES (496, 'RENDERUSDT', 'S_A_RENDERUSDT_15', 'scalping', 15, NULL, '5', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:04:49');
INSERT INTO `stoch_list` VALUES (497, 'BTCUSDT', 'S_B_BTCUSDT_30', 'scalping', 30, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:04:54');
INSERT INTO `stoch_list` VALUES (498, 'ETHUSDT', 'S_B_ETHUSDT_30', 'scalping', 30, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:04:59');
INSERT INTO `stoch_list` VALUES (499, 'XRPUSDT', 'S_B_XRPUSDT_30', 'scalping', 30, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:05:04');
INSERT INTO `stoch_list` VALUES (500, 'SOLUSDT', 'S_B_SOLUSDT_30', 'scalping', 30, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:05:09');
INSERT INTO `stoch_list` VALUES (501, 'DOGEUSDT', 'S_B_DOGEUSDT_30', 'scalping', 30, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:05:13');
INSERT INTO `stoch_list` VALUES (502, 'PUMPUSDT', 'S_B_PUMPUSDT_1', 'scalping', 1, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:05:18');
INSERT INTO `stoch_list` VALUES (503, 'PUMPUSDT', 'S_B_PUMPUSDT_2', 'scalping', 2, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:05:28');
INSERT INTO `stoch_list` VALUES (504, 'PUMPUSDT', 'S_B_PUMPUSDT_3', 'scalping', 3, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:05:35');
INSERT INTO `stoch_list` VALUES (505, 'PUMPUSDT', 'S_B_PUMPUSDT_5', 'scalping', 5, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:05:38');
INSERT INTO `stoch_list` VALUES (506, 'PUMPUSDT', 'S_B_PUMPUSDT_10', 'scalping', 10, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:05:42');
INSERT INTO `stoch_list` VALUES (507, 'PUMPUSDT', 'S_B_PUMPUSDT_15', 'scalping', 15, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:05:45');
INSERT INTO `stoch_list` VALUES (508, 'AVAXUSDT', 'S_B_AVAXUSDT_1', 'scalping', 1, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:05:49');
INSERT INTO `stoch_list` VALUES (509, 'AVAXUSDT', 'S_B_AVAXUSDT_2', 'scalping', 2, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:05:52');
INSERT INTO `stoch_list` VALUES (510, 'AVAXUSDT', 'S_B_AVAXUSDT_3', 'scalping', 3, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:05:55');
INSERT INTO `stoch_list` VALUES (511, 'AVAXUSDT', 'S_B_AVAXUSDT_5', 'scalping', 5, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:05:58');
INSERT INTO `stoch_list` VALUES (512, 'AVAXUSDT', 'S_B_AVAXUSDT_10', 'scalping', 10, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:06:01');
INSERT INTO `stoch_list` VALUES (513, 'AVAXUSDT', 'S_B_AVAXUSDT_15', 'scalping', 15, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:06:04');
INSERT INTO `stoch_list` VALUES (514, 'UNIUSDT', 'S_B_UNIUSDT_1', 'scalping', 1, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:06:09');
INSERT INTO `stoch_list` VALUES (515, 'UNIUSDT', 'S_B_UNIUSDT_2', 'scalping', 2, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:06:12');
INSERT INTO `stoch_list` VALUES (516, 'UNIUSDT', 'S_B_UNIUSDT_3', 'scalping', 3, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:06:16');
INSERT INTO `stoch_list` VALUES (517, 'UNIUSDT', 'S_B_UNIUSDT_5', 'scalping', 5, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:06:19');
INSERT INTO `stoch_list` VALUES (518, 'UNIUSDT', 'S_B_UNIUSDT_10', 'scalping', 10, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:06:22');
INSERT INTO `stoch_list` VALUES (519, 'UNIUSDT', 'S_B_UNIUSDT_15', 'scalping', 15, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:06:25');
INSERT INTO `stoch_list` VALUES (520, 'SUIUSDT', 'S_B_SUIUSDT_1', 'scalping', 1, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:06:29');
INSERT INTO `stoch_list` VALUES (521, 'SUIUSDT', 'S_B_SUIUSDT_2', 'scalping', 2, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:06:32');
INSERT INTO `stoch_list` VALUES (522, 'SUIUSDT', 'S_B_SUIUSDT_3', 'scalping', 3, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:06:35');
INSERT INTO `stoch_list` VALUES (523, 'SUIUSDT', 'S_B_SUIUSDT_5', 'scalping', 5, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:06:38');
INSERT INTO `stoch_list` VALUES (524, 'SUIUSDT', 'S_B_SUIUSDT_10', 'scalping', 10, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:06:41');
INSERT INTO `stoch_list` VALUES (525, 'SUIUSDT', 'S_B_SUIUSDT_15', 'scalping', 15, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:06:44');
INSERT INTO `stoch_list` VALUES (526, 'WLFIUSDT', 'S_B_WLFIUSDT_1', 'scalping', 1, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:06:49');
INSERT INTO `stoch_list` VALUES (527, 'WLFIUSDT', 'S_B_WLFIUSDT_2', 'scalping', 2, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:06:52');
INSERT INTO `stoch_list` VALUES (528, 'WLFIUSDT', 'S_B_WLFIUSDT_3', 'scalping', 3, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:06:55');
INSERT INTO `stoch_list` VALUES (529, 'WLFIUSDT', 'S_B_WLFIUSDT_5', 'scalping', 5, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:06:58');
INSERT INTO `stoch_list` VALUES (530, 'WLFIUSDT', 'S_B_WLFIUSDT_10', 'scalping', 10, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:07:01');
INSERT INTO `stoch_list` VALUES (531, 'WLFIUSDT', 'S_B_WLFIUSDT_15', 'scalping', 15, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:07:04');
INSERT INTO `stoch_list` VALUES (532, 'TONUSDT', 'S_B_TONUSDT_1', 'scalping', 1, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:07:09');
INSERT INTO `stoch_list` VALUES (533, 'TONUSDT', 'S_B_TONUSDT_2', 'scalping', 2, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:07:12');
INSERT INTO `stoch_list` VALUES (534, 'TONUSDT', 'S_B_TONUSDT_3', 'scalping', 3, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:07:15');
INSERT INTO `stoch_list` VALUES (535, 'TONUSDT', 'S_B_TONUSDT_5', 'scalping', 5, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:07:18');
INSERT INTO `stoch_list` VALUES (536, 'TONUSDT', 'S_B_TONUSDT_10', 'scalping', 10, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:07:21');
INSERT INTO `stoch_list` VALUES (537, 'TONUSDT', 'S_B_TONUSDT_15', 'scalping', 15, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:07:24');
INSERT INTO `stoch_list` VALUES (538, 'ENAUSDT', 'S_B_ENAUSDT_1', 'scalping', 1, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:07:29');
INSERT INTO `stoch_list` VALUES (539, 'ENAUSDT', 'S_B_ENAUSDT_2', 'scalping', 2, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:07:32');
INSERT INTO `stoch_list` VALUES (540, 'ENAUSDT', 'S_B_ENAUSDT_3', 'scalping', 3, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:07:35');
INSERT INTO `stoch_list` VALUES (541, 'ENAUSDT', 'S_B_ENAUSDT_5', 'scalping', 5, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:07:38');
INSERT INTO `stoch_list` VALUES (542, 'ENAUSDT', 'S_B_ENAUSDT_10', 'scalping', 10, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:07:41');
INSERT INTO `stoch_list` VALUES (543, 'ENAUSDT', 'S_B_ENAUSDT_15', 'scalping', 15, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:07:44');
INSERT INTO `stoch_list` VALUES (544, 'QNTUSDT', 'S_B_QNTUSDT_1', 'scalping', 1, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:07:50');
INSERT INTO `stoch_list` VALUES (545, 'QNTUSDT', 'S_B_QNTUSDT_2', 'scalping', 2, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:07:52');
INSERT INTO `stoch_list` VALUES (546, 'QNTUSDT', 'S_B_QNTUSDT_3', 'scalping', 3, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:07:56');
INSERT INTO `stoch_list` VALUES (547, 'QNTUSDT', 'S_B_QNTUSDT_5', 'scalping', 5, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:07:59');
INSERT INTO `stoch_list` VALUES (548, 'QNTUSDT', 'S_B_QNTUSDT_10', 'scalping', 10, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:08:02');
INSERT INTO `stoch_list` VALUES (549, 'QNTUSDT', 'S_B_QNTUSDT_15', 'scalping', 15, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:08:05');
INSERT INTO `stoch_list` VALUES (550, 'ALGOUSDT', 'S_B_ALGOUSDT_1', 'scalping', 1, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:08:10');
INSERT INTO `stoch_list` VALUES (551, 'ALGOUSDT', 'S_B_ALGOUSDT_2', 'scalping', 2, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:08:13');
INSERT INTO `stoch_list` VALUES (552, 'ALGOUSDT', 'S_B_ALGOUSDT_3', 'scalping', 3, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:08:16');
INSERT INTO `stoch_list` VALUES (553, 'ALGOUSDT', 'S_B_ALGOUSDT_5', 'scalping', 5, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:08:19');
INSERT INTO `stoch_list` VALUES (554, 'ALGOUSDT', 'S_B_ALGOUSDT_10', 'scalping', 10, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:08:22');
INSERT INTO `stoch_list` VALUES (555, 'ALGOUSDT', 'S_B_ALGOUSDT_15', 'scalping', 15, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:08:25');
INSERT INTO `stoch_list` VALUES (556, 'VETUSDT', 'S_B_VETUSDT_1', 'scalping', 1, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:08:30');
INSERT INTO `stoch_list` VALUES (557, 'VETUSDT', 'S_B_VETUSDT_2', 'scalping', 2, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:08:33');
INSERT INTO `stoch_list` VALUES (558, 'VETUSDT', 'S_B_VETUSDT_3', 'scalping', 3, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:08:36');
INSERT INTO `stoch_list` VALUES (559, 'VETUSDT', 'S_B_VETUSDT_5', 'scalping', 5, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:08:39');
INSERT INTO `stoch_list` VALUES (560, 'VETUSDT', 'S_B_VETUSDT_10', 'scalping', 10, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:08:42');
INSERT INTO `stoch_list` VALUES (561, 'VETUSDT', 'S_B_VETUSDT_15', 'scalping', 15, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:08:45');
INSERT INTO `stoch_list` VALUES (562, 'SEIUSDT', 'S_B_SEIUSDT_1', 'scalping', 1, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:08:50');
INSERT INTO `stoch_list` VALUES (563, 'SEIUSDT', 'S_B_SEIUSDT_2', 'scalping', 2, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:08:53');
INSERT INTO `stoch_list` VALUES (564, 'SEIUSDT', 'S_B_SEIUSDT_3', 'scalping', 3, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:08:56');
INSERT INTO `stoch_list` VALUES (565, 'SEIUSDT', 'S_B_SEIUSDT_5', 'scalping', 5, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:08:59');
INSERT INTO `stoch_list` VALUES (566, 'SEIUSDT', 'S_B_SEIUSDT_10', 'scalping', 10, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:09:02');
INSERT INTO `stoch_list` VALUES (567, 'SEIUSDT', 'S_B_SEIUSDT_15', 'scalping', 15, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:09:05');
INSERT INTO `stoch_list` VALUES (568, 'RENDERUSDT', 'S_B_RENDERUSDT_1', 'scalping', 1, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:09:10');
INSERT INTO `stoch_list` VALUES (569, 'RENDERUSDT', 'S_B_RENDERUSDT_2', 'scalping', 2, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:09:13');
INSERT INTO `stoch_list` VALUES (570, 'RENDERUSDT', 'S_B_RENDERUSDT_3', 'scalping', 3, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:09:16');
INSERT INTO `stoch_list` VALUES (571, 'RENDERUSDT', 'S_B_RENDERUSDT_5', 'scalping', 5, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:09:20');
INSERT INTO `stoch_list` VALUES (572, 'RENDERUSDT', 'S_B_RENDERUSDT_10', 'scalping', 10, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:09:23');
INSERT INTO `stoch_list` VALUES (573, 'RENDERUSDT', 'S_B_RENDERUSDT_15', 'scalping', 15, NULL, '14', '3', '3', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:09:26');
INSERT INTO `stoch_list` VALUES (574, 'BTCUSDT', 'S_C_BTCUSDT_30', 'scalping', 30, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:09:31');
INSERT INTO `stoch_list` VALUES (575, 'ETHUSDT', 'S_C_ETHUSDT_30', 'scalping', 30, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:09:36');
INSERT INTO `stoch_list` VALUES (576, 'XRPUSDT', 'S_C_XRPUSDT_30', 'scalping', 30, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:09:40');
INSERT INTO `stoch_list` VALUES (577, 'SOLUSDT', 'S_C_SOLUSDT_30', 'scalping', 30, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:09:45');
INSERT INTO `stoch_list` VALUES (578, 'DOGEUSDT', 'S_C_DOGEUSDT_30', 'scalping', 30, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:09:50');
INSERT INTO `stoch_list` VALUES (579, 'PUMPUSDT', 'S_C_PUMPUSDT_1', 'scalping', 1, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:09:55');
INSERT INTO `stoch_list` VALUES (580, 'PUMPUSDT', 'S_C_PUMPUSDT_2', 'scalping', 2, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:09:58');
INSERT INTO `stoch_list` VALUES (581, 'PUMPUSDT', 'S_C_PUMPUSDT_3', 'scalping', 3, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:10:02');
INSERT INTO `stoch_list` VALUES (582, 'PUMPUSDT', 'S_C_PUMPUSDT_5', 'scalping', 5, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:10:05');
INSERT INTO `stoch_list` VALUES (583, 'PUMPUSDT', 'S_C_PUMPUSDT_10', 'scalping', 10, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:10:08');
INSERT INTO `stoch_list` VALUES (584, 'PUMPUSDT', 'S_C_PUMPUSDT_15', 'scalping', 15, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:10:11');
INSERT INTO `stoch_list` VALUES (585, 'AVAXUSDT', 'S_C_AVAXUSDT_1', 'scalping', 1, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:10:16');
INSERT INTO `stoch_list` VALUES (586, 'AVAXUSDT', 'S_C_AVAXUSDT_2', 'scalping', 2, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:10:19');
INSERT INTO `stoch_list` VALUES (587, 'AVAXUSDT', 'S_C_AVAXUSDT_3', 'scalping', 3, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:10:22');
INSERT INTO `stoch_list` VALUES (588, 'AVAXUSDT', 'S_C_AVAXUSDT_5', 'scalping', 5, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:10:26');
INSERT INTO `stoch_list` VALUES (589, 'AVAXUSDT', 'S_C_AVAXUSDT_10', 'scalping', 10, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:10:29');
INSERT INTO `stoch_list` VALUES (590, 'AVAXUSDT', 'S_C_AVAXUSDT_15', 'scalping', 15, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:10:32');
INSERT INTO `stoch_list` VALUES (591, 'UNIUSDT', 'S_C_UNIUSDT_1', 'scalping', 1, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:10:37');
INSERT INTO `stoch_list` VALUES (592, 'UNIUSDT', 'S_C_UNIUSDT_2', 'scalping', 2, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:10:40');
INSERT INTO `stoch_list` VALUES (593, 'UNIUSDT', 'S_C_UNIUSDT_3', 'scalping', 3, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:10:43');
INSERT INTO `stoch_list` VALUES (594, 'UNIUSDT', 'S_C_UNIUSDT_5', 'scalping', 5, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:10:46');
INSERT INTO `stoch_list` VALUES (595, 'UNIUSDT', 'S_C_UNIUSDT_10', 'scalping', 10, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:10:49');
INSERT INTO `stoch_list` VALUES (596, 'UNIUSDT', 'S_C_UNIUSDT_15', 'scalping', 15, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:10:52');
INSERT INTO `stoch_list` VALUES (597, 'SUIUSDT', 'S_C_SUIUSDT_1', 'scalping', 1, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:10:57');
INSERT INTO `stoch_list` VALUES (598, 'SUIUSDT', 'S_C_SUIUSDT_2', 'scalping', 2, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:11:00');
INSERT INTO `stoch_list` VALUES (599, 'SUIUSDT', 'S_C_SUIUSDT_3', 'scalping', 3, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:11:03');
INSERT INTO `stoch_list` VALUES (600, 'SUIUSDT', 'S_C_SUIUSDT_5', 'scalping', 5, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:11:06');
INSERT INTO `stoch_list` VALUES (601, 'SUIUSDT', 'S_C_SUIUSDT_10', 'scalping', 10, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:11:09');
INSERT INTO `stoch_list` VALUES (602, 'SUIUSDT', 'S_C_SUIUSDT_15', 'scalping', 15, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:11:12');
INSERT INTO `stoch_list` VALUES (603, 'WLFIUSDT', 'S_C_WLFIUSDT_1', 'scalping', 1, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:11:18');
INSERT INTO `stoch_list` VALUES (604, 'WLFIUSDT', 'S_C_WLFIUSDT_2', 'scalping', 2, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:11:21');
INSERT INTO `stoch_list` VALUES (605, 'WLFIUSDT', 'S_C_WLFIUSDT_3', 'scalping', 3, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:11:24');
INSERT INTO `stoch_list` VALUES (606, 'WLFIUSDT', 'S_C_WLFIUSDT_5', 'scalping', 5, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:11:27');
INSERT INTO `stoch_list` VALUES (607, 'WLFIUSDT', 'S_C_WLFIUSDT_10', 'scalping', 10, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:11:30');
INSERT INTO `stoch_list` VALUES (608, 'WLFIUSDT', 'S_C_WLFIUSDT_15', 'scalping', 15, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:11:33');
INSERT INTO `stoch_list` VALUES (609, 'TONUSDT', 'S_C_TONUSDT_1', 'scalping', 1, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:11:38');
INSERT INTO `stoch_list` VALUES (610, 'TONUSDT', 'S_C_TONUSDT_2', 'scalping', 2, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:11:41');
INSERT INTO `stoch_list` VALUES (611, 'TONUSDT', 'S_C_TONUSDT_3', 'scalping', 3, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:11:45');
INSERT INTO `stoch_list` VALUES (612, 'TONUSDT', 'S_C_TONUSDT_5', 'scalping', 5, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:11:48');
INSERT INTO `stoch_list` VALUES (613, 'TONUSDT', 'S_C_TONUSDT_10', 'scalping', 10, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:11:51');
INSERT INTO `stoch_list` VALUES (614, 'TONUSDT', 'S_C_TONUSDT_15', 'scalping', 15, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:11:54');
INSERT INTO `stoch_list` VALUES (615, 'ENAUSDT', 'S_C_ENAUSDT_1', 'scalping', 1, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:11:59');
INSERT INTO `stoch_list` VALUES (616, 'ENAUSDT', 'S_C_ENAUSDT_2', 'scalping', 2, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:12:02');
INSERT INTO `stoch_list` VALUES (617, 'ENAUSDT', 'S_C_ENAUSDT_3', 'scalping', 3, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:12:05');
INSERT INTO `stoch_list` VALUES (618, 'ENAUSDT', 'S_C_ENAUSDT_5', 'scalping', 5, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:12:08');
INSERT INTO `stoch_list` VALUES (619, 'ENAUSDT', 'S_C_ENAUSDT_10', 'scalping', 10, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:12:11');
INSERT INTO `stoch_list` VALUES (620, 'ENAUSDT', 'S_C_ENAUSDT_15', 'scalping', 15, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:12:14');
INSERT INTO `stoch_list` VALUES (621, 'QNTUSDT', 'S_C_QNTUSDT_1', 'scalping', 1, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:12:19');
INSERT INTO `stoch_list` VALUES (622, 'QNTUSDT', 'S_C_QNTUSDT_2', 'scalping', 2, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:12:22');
INSERT INTO `stoch_list` VALUES (623, 'QNTUSDT', 'S_C_QNTUSDT_3', 'scalping', 3, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:12:25');
INSERT INTO `stoch_list` VALUES (624, 'QNTUSDT', 'S_C_QNTUSDT_5', 'scalping', 5, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:12:28');
INSERT INTO `stoch_list` VALUES (625, 'QNTUSDT', 'S_C_QNTUSDT_10', 'scalping', 10, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:12:31');
INSERT INTO `stoch_list` VALUES (626, 'QNTUSDT', 'S_C_QNTUSDT_15', 'scalping', 15, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:12:34');
INSERT INTO `stoch_list` VALUES (627, 'ALGOUSDT', 'S_C_ALGOUSDT_1', 'scalping', 1, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:12:39');
INSERT INTO `stoch_list` VALUES (628, 'ALGOUSDT', 'S_C_ALGOUSDT_2', 'scalping', 2, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:12:42');
INSERT INTO `stoch_list` VALUES (629, 'ALGOUSDT', 'S_C_ALGOUSDT_3', 'scalping', 3, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:12:45');
INSERT INTO `stoch_list` VALUES (630, 'ALGOUSDT', 'S_C_ALGOUSDT_5', 'scalping', 5, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:12:48');
INSERT INTO `stoch_list` VALUES (631, 'ALGOUSDT', 'S_C_ALGOUSDT_10', 'scalping', 10, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:12:51');
INSERT INTO `stoch_list` VALUES (632, 'ALGOUSDT', 'S_C_ALGOUSDT_15', 'scalping', 15, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:12:54');
INSERT INTO `stoch_list` VALUES (633, 'VETUSDT', 'S_C_VETUSDT_1', 'scalping', 1, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:12:59');
INSERT INTO `stoch_list` VALUES (634, 'VETUSDT', 'S_C_VETUSDT_2', 'scalping', 2, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:13:02');
INSERT INTO `stoch_list` VALUES (635, 'VETUSDT', 'S_C_VETUSDT_3', 'scalping', 3, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:13:06');
INSERT INTO `stoch_list` VALUES (636, 'VETUSDT', 'S_C_VETUSDT_5', 'scalping', 5, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:13:09');
INSERT INTO `stoch_list` VALUES (637, 'VETUSDT', 'S_C_VETUSDT_10', 'scalping', 10, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:13:12');
INSERT INTO `stoch_list` VALUES (638, 'VETUSDT', 'S_C_VETUSDT_15', 'scalping', 15, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:13:15');
INSERT INTO `stoch_list` VALUES (639, 'SEIUSDT', 'S_C_SEIUSDT_1', 'scalping', 1, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:13:20');
INSERT INTO `stoch_list` VALUES (640, 'SEIUSDT', 'S_C_SEIUSDT_2', 'scalping', 2, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:13:23');
INSERT INTO `stoch_list` VALUES (641, 'SEIUSDT', 'S_C_SEIUSDT_3', 'scalping', 3, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:13:26');
INSERT INTO `stoch_list` VALUES (642, 'SEIUSDT', 'S_C_SEIUSDT_5', 'scalping', 5, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:13:29');
INSERT INTO `stoch_list` VALUES (643, 'SEIUSDT', 'S_C_SEIUSDT_10', 'scalping', 10, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:13:32');
INSERT INTO `stoch_list` VALUES (644, 'SEIUSDT', 'S_C_SEIUSDT_15', 'scalping', 15, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:13:35');
INSERT INTO `stoch_list` VALUES (645, 'RENDERUSDT', 'S_C_RENDERUSDT_1', 'scalping', 1, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:13:40');
INSERT INTO `stoch_list` VALUES (646, 'RENDERUSDT', 'S_C_RENDERUSDT_2', 'scalping', 2, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:13:43');
INSERT INTO `stoch_list` VALUES (647, 'RENDERUSDT', 'S_C_RENDERUSDT_3', 'scalping', 3, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:13:46');
INSERT INTO `stoch_list` VALUES (648, 'RENDERUSDT', 'S_C_RENDERUSDT_5', 'scalping', 5, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:13:49');
INSERT INTO `stoch_list` VALUES (649, 'RENDERUSDT', 'S_C_RENDERUSDT_10', 'scalping', 10, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:13:52');
INSERT INTO `stoch_list` VALUES (650, 'RENDERUSDT', 'S_C_RENDERUSDT_15', 'scalping', 15, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:13:55');
INSERT INTO `stoch_list` VALUES (651, 'PUMPUSDT', 'S_C_PUMPUSDT_30', 'scalping', 30, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:14:00');
INSERT INTO `stoch_list` VALUES (653, 'AVAXUSDT', 'S_C_AVAXUSDT_30', 'scalping', 30, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:14:05');
INSERT INTO `stoch_list` VALUES (654, 'UNIUSDT', 'S_C_UNIUSDT_30', 'scalping', 30, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:14:10');
INSERT INTO `stoch_list` VALUES (655, 'SUIUSDT', 'S_C_SUIUSDT_30', 'scalping', 30, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:14:15');
INSERT INTO `stoch_list` VALUES (656, 'WLFIUSDT', 'S_C_WLFIUSDT_30', 'scalping', 30, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:14:20');
INSERT INTO `stoch_list` VALUES (657, 'TONUSDT', 'S_C_TONUSDT_30', 'scalping', 30, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:14:24');
INSERT INTO `stoch_list` VALUES (658, 'ENAUSDT', 'S_C_ENAUSDT_30', 'scalping', 30, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:14:29');
INSERT INTO `stoch_list` VALUES (659, 'QNTUSDT', 'S_C_QNTUSDT_30', 'scalping', 30, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:14:34');
INSERT INTO `stoch_list` VALUES (660, 'ALGOUSDT', 'S_C_ALGOUSDT_30', 'scalping', 30, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:14:39');
INSERT INTO `stoch_list` VALUES (661, 'VETUSDT', 'S_C_VETUSDT_30', 'scalping', 30, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:14:44');
INSERT INTO `stoch_list` VALUES (662, 'SEIUSDT', 'S_C_SEIUSDT_30', 'scalping', 30, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:14:49');
INSERT INTO `stoch_list` VALUES (663, 'RENDERUSDT', 'S_C_RENDERUSDT_30', 'scalping', 30, NULL, '10', '6', '6', NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:14:54');
INSERT INTO `stoch_list` VALUES (664, 'BTCUSDT', 'K1_BTCUSDT_1', 'K1', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:34:44');
INSERT INTO `stoch_list` VALUES (665, 'BTCUSDT', 'K1_BTCUSDT_2', 'K1', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:34:47');
INSERT INTO `stoch_list` VALUES (666, 'BTCUSDT', 'K1_BTCUSDT_3', 'K1', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:34:50');
INSERT INTO `stoch_list` VALUES (667, 'BTCUSDT', 'K1_BTCUSDT_5', 'K1', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:34:53');
INSERT INTO `stoch_list` VALUES (668, 'BTCUSDT', 'K1_BTCUSDT_10', 'K1', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:34:56');
INSERT INTO `stoch_list` VALUES (669, 'BTCUSDT', 'K1_BTCUSDT_15', 'K1', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:34:59');
INSERT INTO `stoch_list` VALUES (670, 'BTCUSDT', 'K1_BTCUSDT_30', 'K1', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:35:02');
INSERT INTO `stoch_list` VALUES (671, 'ETHUSDT', 'K1_ETHUSDT_1', 'K1', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:35:07');
INSERT INTO `stoch_list` VALUES (672, 'ETHUSDT', 'K1_ETHUSDT_2', 'K1', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:35:10');
INSERT INTO `stoch_list` VALUES (673, 'ETHUSDT', 'K1_ETHUSDT_3', 'K1', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:35:13');
INSERT INTO `stoch_list` VALUES (674, 'ETHUSDT', 'K1_ETHUSDT_5', 'K1', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:35:16');
INSERT INTO `stoch_list` VALUES (675, 'ETHUSDT', 'K1_ETHUSDT_10', 'K1', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:35:19');
INSERT INTO `stoch_list` VALUES (676, 'ETHUSDT', 'K1_ETHUSDT_15', 'K1', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:35:22');
INSERT INTO `stoch_list` VALUES (677, 'ETHUSDT', 'K1_ETHUSDT_30', 'K1', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:35:25');
INSERT INTO `stoch_list` VALUES (678, 'XRPUSDT', 'K1_XRPUSDT_1', 'K1', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:35:35');
INSERT INTO `stoch_list` VALUES (679, 'XRPUSDT', 'K1_XRPUSDT_2', 'K1', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:35:38');
INSERT INTO `stoch_list` VALUES (680, 'XRPUSDT', 'K1_XRPUSDT_3', 'K1', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:35:41');
INSERT INTO `stoch_list` VALUES (681, 'XRPUSDT', 'K1_XRPUSDT_5', 'K1', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:35:44');
INSERT INTO `stoch_list` VALUES (682, 'XRPUSDT', 'K1_XRPUSDT_10', 'K1', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:35:47');
INSERT INTO `stoch_list` VALUES (683, 'XRPUSDT', 'K1_XRPUSDT_15', 'K1', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:35:50');
INSERT INTO `stoch_list` VALUES (684, 'XRPUSDT', 'K1_XRPUSDT_30', 'K1', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:35:53');
INSERT INTO `stoch_list` VALUES (685, 'SOLUSDT', 'K1_SOLUSDT_1', 'K1', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:35:58');
INSERT INTO `stoch_list` VALUES (686, 'SOLUSDT', 'K1_SOLUSDT_2', 'K1', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:36:01');
INSERT INTO `stoch_list` VALUES (687, 'SOLUSDT', 'K1_SOLUSDT_3', 'K1', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:36:04');
INSERT INTO `stoch_list` VALUES (688, 'SOLUSDT', 'K1_SOLUSDT_5', 'K1', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:36:07');
INSERT INTO `stoch_list` VALUES (689, 'SOLUSDT', 'K1_SOLUSDT_10', 'K1', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:36:10');
INSERT INTO `stoch_list` VALUES (690, 'SOLUSDT', 'K1_SOLUSDT_15', 'K1', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:36:13');
INSERT INTO `stoch_list` VALUES (691, 'SOLUSDT', 'K1_SOLUSDT_30', 'K1', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:36:16');
INSERT INTO `stoch_list` VALUES (692, 'DOGEUSDT', 'K1_DOGEUSDT_1', 'K1', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:36:20');
INSERT INTO `stoch_list` VALUES (693, 'DOGEUSDT', 'K1_DOGEUSDT_2', 'K1', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:36:23');
INSERT INTO `stoch_list` VALUES (694, 'DOGEUSDT', 'K1_DOGEUSDT_3', 'K1', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:36:26');
INSERT INTO `stoch_list` VALUES (695, 'DOGEUSDT', 'K1_DOGEUSDT_5', 'K1', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:36:29');
INSERT INTO `stoch_list` VALUES (696, 'DOGEUSDT', 'K1_DOGEUSDT_10', 'K1', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:36:32');
INSERT INTO `stoch_list` VALUES (697, 'DOGEUSDT', 'K1_DOGEUSDT_15', 'K1', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:36:35');
INSERT INTO `stoch_list` VALUES (698, 'DOGEUSDT', 'K1_DOGEUSDT_30', 'K1', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:36:38');
INSERT INTO `stoch_list` VALUES (699, 'PUMPUSDT', 'K1_PUMPUSDT_1', 'K1', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:36:43');
INSERT INTO `stoch_list` VALUES (700, 'PUMPUSDT', 'K1_PUMPUSDT_2', 'K1', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:36:46');
INSERT INTO `stoch_list` VALUES (701, 'PUMPUSDT', 'K1_PUMPUSDT_3', 'K1', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:36:49');
INSERT INTO `stoch_list` VALUES (702, 'PUMPUSDT', 'K1_PUMPUSDT_5', 'K1', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:36:52');
INSERT INTO `stoch_list` VALUES (703, 'PUMPUSDT', 'K1_PUMPUSDT_10', 'K1', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:36:55');
INSERT INTO `stoch_list` VALUES (704, 'PUMPUSDT', 'K1_PUMPUSDT_15', 'K1', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:36:58');
INSERT INTO `stoch_list` VALUES (705, 'PUMPUSDT', 'K1_PUMPUSDT_30', 'K1', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:37:01');
INSERT INTO `stoch_list` VALUES (706, 'AVAXUSDT', 'K1_AVAXUSDT_1', 'K1', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:37:06');
INSERT INTO `stoch_list` VALUES (707, 'AVAXUSDT', 'K1_AVAXUSDT_2', 'K1', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:37:08');
INSERT INTO `stoch_list` VALUES (708, 'AVAXUSDT', 'K1_AVAXUSDT_3', 'K1', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:37:11');
INSERT INTO `stoch_list` VALUES (709, 'AVAXUSDT', 'K1_AVAXUSDT_5', 'K1', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:37:14');
INSERT INTO `stoch_list` VALUES (710, 'AVAXUSDT', 'K1_AVAXUSDT_10', 'K1', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:37:17');
INSERT INTO `stoch_list` VALUES (711, 'AVAXUSDT', 'K1_AVAXUSDT_15', 'K1', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:37:20');
INSERT INTO `stoch_list` VALUES (712, 'AVAXUSDT', 'K1_AVAXUSDT_30', 'K1', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:37:23');
INSERT INTO `stoch_list` VALUES (713, 'UNIUSDT', 'K1_UNIUSDT_1', 'K1', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:37:28');
INSERT INTO `stoch_list` VALUES (714, 'UNIUSDT', 'K1_UNIUSDT_2', 'K1', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:37:31');
INSERT INTO `stoch_list` VALUES (715, 'UNIUSDT', 'K1_UNIUSDT_3', 'K1', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:37:34');
INSERT INTO `stoch_list` VALUES (716, 'UNIUSDT', 'K1_UNIUSDT_5', 'K1', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:37:37');
INSERT INTO `stoch_list` VALUES (717, 'UNIUSDT', 'K1_UNIUSDT_10', 'K1', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:37:40');
INSERT INTO `stoch_list` VALUES (718, 'UNIUSDT', 'K1_UNIUSDT_15', 'K1', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:37:43');
INSERT INTO `stoch_list` VALUES (719, 'UNIUSDT', 'K1_UNIUSDT_30', 'K1', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:37:46');
INSERT INTO `stoch_list` VALUES (720, 'SUIUSDT', 'K1_SUIUSDT_1', 'K1', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:37:51');
INSERT INTO `stoch_list` VALUES (721, 'SUIUSDT', 'K1_SUIUSDT_2', 'K1', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:37:54');
INSERT INTO `stoch_list` VALUES (722, 'SUIUSDT', 'K1_SUIUSDT_3', 'K1', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:37:57');
INSERT INTO `stoch_list` VALUES (723, 'SUIUSDT', 'K1_SUIUSDT_5', 'K1', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:37:59');
INSERT INTO `stoch_list` VALUES (724, 'SUIUSDT', 'K1_SUIUSDT_10', 'K1', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:38:02');
INSERT INTO `stoch_list` VALUES (725, 'SUIUSDT', 'K1_SUIUSDT_15', 'K1', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:38:05');
INSERT INTO `stoch_list` VALUES (726, 'SUIUSDT', 'K1_SUIUSDT_30', 'K1', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:38:08');
INSERT INTO `stoch_list` VALUES (727, 'WLFIUSDT', 'K1_WLFIUSDT_1', 'K1', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:38:13');
INSERT INTO `stoch_list` VALUES (728, 'WLFIUSDT', 'K1_WLFIUSDT_2', 'K1', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:38:16');
INSERT INTO `stoch_list` VALUES (729, 'WLFIUSDT', 'K1_WLFIUSDT_3', 'K1', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:38:19');
INSERT INTO `stoch_list` VALUES (730, 'WLFIUSDT', 'K1_WLFIUSDT_5', 'K1', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:38:22');
INSERT INTO `stoch_list` VALUES (731, 'WLFIUSDT', 'K1_WLFIUSDT_10', 'K1', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:38:25');
INSERT INTO `stoch_list` VALUES (732, 'WLFIUSDT', 'K1_WLFIUSDT_15', 'K1', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:38:28');
INSERT INTO `stoch_list` VALUES (733, 'WLFIUSDT', 'K1_WLFIUSDT_30', 'K1', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:38:31');
INSERT INTO `stoch_list` VALUES (734, 'TONUSDT', 'K1_TONUSDT_1', 'K1', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:38:36');
INSERT INTO `stoch_list` VALUES (735, 'TONUSDT', 'K1_TONUSDT_2', 'K1', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:38:38');
INSERT INTO `stoch_list` VALUES (736, 'TONUSDT', 'K1_TONUSDT_3', 'K1', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:38:41');
INSERT INTO `stoch_list` VALUES (737, 'TONUSDT', 'K1_TONUSDT_5', 'K1', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:38:44');
INSERT INTO `stoch_list` VALUES (738, 'TONUSDT', 'K1_TONUSDT_10', 'K1', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:38:47');
INSERT INTO `stoch_list` VALUES (739, 'TONUSDT', 'K1_TONUSDT_15', 'K1', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:38:50');
INSERT INTO `stoch_list` VALUES (740, 'TONUSDT', 'K1_TONUSDT_30', 'K1', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:38:53');
INSERT INTO `stoch_list` VALUES (741, 'ENAUSDT', 'K1_ENAUSDT_1', 'K1', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:38:59');
INSERT INTO `stoch_list` VALUES (742, 'ENAUSDT', 'K1_ENAUSDT_2', 'K1', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:39:02');
INSERT INTO `stoch_list` VALUES (743, 'ENAUSDT', 'K1_ENAUSDT_3', 'K1', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:39:05');
INSERT INTO `stoch_list` VALUES (744, 'ENAUSDT', 'K1_ENAUSDT_5', 'K1', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:39:07');
INSERT INTO `stoch_list` VALUES (745, 'ENAUSDT', 'K1_ENAUSDT_10', 'K1', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:39:27');
INSERT INTO `stoch_list` VALUES (746, 'ENAUSDT', 'K1_ENAUSDT_15', 'K1', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:39:30');
INSERT INTO `stoch_list` VALUES (747, 'ENAUSDT', 'K1_ENAUSDT_30', 'K1', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:39:33');
INSERT INTO `stoch_list` VALUES (748, 'QNTUSDT', 'K1_QNTUSDT_1', 'K1', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:39:37');
INSERT INTO `stoch_list` VALUES (749, 'QNTUSDT', 'K1_QNTUSDT_2', 'K1', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:39:40');
INSERT INTO `stoch_list` VALUES (750, 'QNTUSDT', 'K1_QNTUSDT_3', 'K1', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:39:43');
INSERT INTO `stoch_list` VALUES (751, 'QNTUSDT', 'K1_QNTUSDT_5', 'K1', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:39:46');
INSERT INTO `stoch_list` VALUES (752, 'QNTUSDT', 'K1_QNTUSDT_10', 'K1', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:39:49');
INSERT INTO `stoch_list` VALUES (753, 'QNTUSDT', 'K1_QNTUSDT_15', 'K1', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:39:52');
INSERT INTO `stoch_list` VALUES (754, 'QNTUSDT', 'K1_QNTUSDT_30', 'K1', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:39:55');
INSERT INTO `stoch_list` VALUES (755, 'ALGOUSDT', 'K1_ALGOUSDT_1', 'K1', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:00');
INSERT INTO `stoch_list` VALUES (756, 'ALGOUSDT', 'K1_ALGOUSDT_2', 'K1', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:03');
INSERT INTO `stoch_list` VALUES (757, 'ALGOUSDT', 'K1_ALGOUSDT_3', 'K1', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:06');
INSERT INTO `stoch_list` VALUES (758, 'ALGOUSDT', 'K1_ALGOUSDT_5', 'K1', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:09');
INSERT INTO `stoch_list` VALUES (759, 'ALGOUSDT', 'K1_ALGOUSDT_10', 'K1', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:12');
INSERT INTO `stoch_list` VALUES (760, 'ALGOUSDT', 'K1_ALGOUSDT_15', 'K1', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:15');
INSERT INTO `stoch_list` VALUES (761, 'ALGOUSDT', 'K1_ALGOUSDT_30', 'K1', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:18');
INSERT INTO `stoch_list` VALUES (762, 'VETUSDT', 'K1_VETUSDT_1', 'K1', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:22');
INSERT INTO `stoch_list` VALUES (763, 'VETUSDT', 'K1_VETUSDT_2', 'K1', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:25');
INSERT INTO `stoch_list` VALUES (764, 'VETUSDT', 'K1_VETUSDT_3', 'K1', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:28');
INSERT INTO `stoch_list` VALUES (765, 'VETUSDT', 'K1_VETUSDT_5', 'K1', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:31');
INSERT INTO `stoch_list` VALUES (766, 'VETUSDT', 'K1_VETUSDT_10', 'K1', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:34');
INSERT INTO `stoch_list` VALUES (767, 'VETUSDT', 'K1_VETUSDT_15', 'K1', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:37');
INSERT INTO `stoch_list` VALUES (768, 'VETUSDT', 'K1_VETUSDT_30', 'K1', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:40');
INSERT INTO `stoch_list` VALUES (769, 'SEIUSDT', 'K1_SEIUSDT_1', 'K1', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:45');
INSERT INTO `stoch_list` VALUES (770, 'SEIUSDT', 'K1_SEIUSDT_2', 'K1', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:48');
INSERT INTO `stoch_list` VALUES (771, 'SEIUSDT', 'K1_SEIUSDT_3', 'K1', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:50');
INSERT INTO `stoch_list` VALUES (772, 'SEIUSDT', 'K1_SEIUSDT_5', 'K1', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:53');
INSERT INTO `stoch_list` VALUES (773, 'SEIUSDT', 'K1_SEIUSDT_10', 'K1', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:56');
INSERT INTO `stoch_list` VALUES (774, 'SEIUSDT', 'K1_SEIUSDT_15', 'K1', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:40:59');
INSERT INTO `stoch_list` VALUES (775, 'SEIUSDT', 'K1_SEIUSDT_30', 'K1', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:41:02');
INSERT INTO `stoch_list` VALUES (776, 'RENDERUSDT', 'K1_RENDERUSDT_1', 'K1', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:41:07');
INSERT INTO `stoch_list` VALUES (777, 'RENDERUSDT', 'K1_RENDERUSDT_2', 'K1', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:41:10');
INSERT INTO `stoch_list` VALUES (778, 'RENDERUSDT', 'K1_RENDERUSDT_3', 'K1', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:41:13');
INSERT INTO `stoch_list` VALUES (779, 'RENDERUSDT', 'K1_RENDERUSDT_5', 'K1', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:41:16');
INSERT INTO `stoch_list` VALUES (780, 'RENDERUSDT', 'K1_RENDERUSDT_10', 'K1', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:41:19');
INSERT INTO `stoch_list` VALUES (781, 'RENDERUSDT', 'K1_RENDERUSDT_15', 'K1', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:41:21');
INSERT INTO `stoch_list` VALUES (782, 'RENDERUSDT', 'K1_RENDERUSDT_30', 'K1', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:41:24');
INSERT INTO `stoch_list` VALUES (783, 'BTCUSDT', 'K2_BTCUSDT_1', 'K2', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:42:05');
INSERT INTO `stoch_list` VALUES (784, 'BTCUSDT', 'K2_BTCUSDT_2', 'K2', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:42:08');
INSERT INTO `stoch_list` VALUES (785, 'BTCUSDT', 'K2_BTCUSDT_3', 'K2', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:42:11');
INSERT INTO `stoch_list` VALUES (786, 'BTCUSDT', 'K2_BTCUSDT_5', 'K2', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:42:14');
INSERT INTO `stoch_list` VALUES (787, 'BTCUSDT', 'K2_BTCUSDT_10', 'K2', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:42:17');
INSERT INTO `stoch_list` VALUES (788, 'BTCUSDT', 'K2_BTCUSDT_15', 'K2', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:42:19');
INSERT INTO `stoch_list` VALUES (789, 'BTCUSDT', 'K2_BTCUSDT_30', 'K2', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:42:22');
INSERT INTO `stoch_list` VALUES (790, 'ETHUSDT', 'K2_ETHUSDT_1', 'K2', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:42:27');
INSERT INTO `stoch_list` VALUES (791, 'ETHUSDT', 'K2_ETHUSDT_2', 'K2', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:42:30');
INSERT INTO `stoch_list` VALUES (792, 'ETHUSDT', 'K2_ETHUSDT_3', 'K2', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:42:33');
INSERT INTO `stoch_list` VALUES (793, 'ETHUSDT', 'K2_ETHUSDT_5', 'K2', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:42:36');
INSERT INTO `stoch_list` VALUES (794, 'ETHUSDT', 'K2_ETHUSDT_10', 'K2', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:42:39');
INSERT INTO `stoch_list` VALUES (795, 'ETHUSDT', 'K2_ETHUSDT_15', 'K2', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:42:42');
INSERT INTO `stoch_list` VALUES (796, 'ETHUSDT', 'K2_ETHUSDT_30', 'K2', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:42:45');
INSERT INTO `stoch_list` VALUES (797, 'XRPUSDT', 'K2_XRPUSDT_1', 'K2', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:42:50');
INSERT INTO `stoch_list` VALUES (798, 'XRPUSDT', 'K2_XRPUSDT_2', 'K2', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:42:53');
INSERT INTO `stoch_list` VALUES (799, 'XRPUSDT', 'K2_XRPUSDT_3', 'K2', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:42:56');
INSERT INTO `stoch_list` VALUES (800, 'XRPUSDT', 'K2_XRPUSDT_5', 'K2', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:42:59');
INSERT INTO `stoch_list` VALUES (801, 'XRPUSDT', 'K2_XRPUSDT_10', 'K2', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:43:02');
INSERT INTO `stoch_list` VALUES (802, 'XRPUSDT', 'K2_XRPUSDT_15', 'K2', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:43:05');
INSERT INTO `stoch_list` VALUES (803, 'XRPUSDT', 'K2_XRPUSDT_30', 'K2', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:43:08');
INSERT INTO `stoch_list` VALUES (804, 'SOLUSDT', 'K2_SOLUSDT_1', 'K2', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:43:12');
INSERT INTO `stoch_list` VALUES (805, 'SOLUSDT', 'K2_SOLUSDT_2', 'K2', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:43:15');
INSERT INTO `stoch_list` VALUES (806, 'SOLUSDT', 'K2_SOLUSDT_3', 'K2', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:43:18');
INSERT INTO `stoch_list` VALUES (807, 'SOLUSDT', 'K2_SOLUSDT_5', 'K2', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:43:21');
INSERT INTO `stoch_list` VALUES (808, 'SOLUSDT', 'K2_SOLUSDT_10', 'K2', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:43:24');
INSERT INTO `stoch_list` VALUES (809, 'SOLUSDT', 'K2_SOLUSDT_15', 'K2', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:43:27');
INSERT INTO `stoch_list` VALUES (810, 'SOLUSDT', 'K2_SOLUSDT_30', 'K2', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:43:30');
INSERT INTO `stoch_list` VALUES (811, 'DOGEUSDT', 'K2_DOGEUSDT_1', 'K2', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:43:35');
INSERT INTO `stoch_list` VALUES (812, 'DOGEUSDT', 'K2_DOGEUSDT_2', 'K2', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:43:38');
INSERT INTO `stoch_list` VALUES (813, 'DOGEUSDT', 'K2_DOGEUSDT_3', 'K2', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:43:41');
INSERT INTO `stoch_list` VALUES (814, 'DOGEUSDT', 'K2_DOGEUSDT_5', 'K2', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:43:44');
INSERT INTO `stoch_list` VALUES (815, 'DOGEUSDT', 'K2_DOGEUSDT_10', 'K2', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:43:47');
INSERT INTO `stoch_list` VALUES (816, 'DOGEUSDT', 'K2_DOGEUSDT_15', 'K2', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:43:50');
INSERT INTO `stoch_list` VALUES (817, 'DOGEUSDT', 'K2_DOGEUSDT_30', 'K2', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:43:53');
INSERT INTO `stoch_list` VALUES (818, 'PUMPUSDT', 'K2_PUMPUSDT_1', 'K2', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:43:58');
INSERT INTO `stoch_list` VALUES (819, 'PUMPUSDT', 'K2_PUMPUSDT_2', 'K2', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:44:01');
INSERT INTO `stoch_list` VALUES (820, 'PUMPUSDT', 'K2_PUMPUSDT_3', 'K2', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:44:04');
INSERT INTO `stoch_list` VALUES (821, 'PUMPUSDT', 'K2_PUMPUSDT_5', 'K2', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:44:07');
INSERT INTO `stoch_list` VALUES (822, 'PUMPUSDT', 'K2_PUMPUSDT_10', 'K2', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:44:10');
INSERT INTO `stoch_list` VALUES (823, 'PUMPUSDT', 'K2_PUMPUSDT_15', 'K2', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:44:13');
INSERT INTO `stoch_list` VALUES (824, 'PUMPUSDT', 'K2_PUMPUSDT_30', 'K2', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:44:16');
INSERT INTO `stoch_list` VALUES (825, 'AVAXUSDT', 'K2_AVAXUSDT_1', 'K2', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:44:20');
INSERT INTO `stoch_list` VALUES (826, 'AVAXUSDT', 'K2_AVAXUSDT_2', 'K2', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:44:23');
INSERT INTO `stoch_list` VALUES (827, 'AVAXUSDT', 'K2_AVAXUSDT_3', 'K2', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:44:26');
INSERT INTO `stoch_list` VALUES (828, 'AVAXUSDT', 'K2_AVAXUSDT_5', 'K2', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:44:29');
INSERT INTO `stoch_list` VALUES (829, 'AVAXUSDT', 'K2_AVAXUSDT_10', 'K2', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:44:32');
INSERT INTO `stoch_list` VALUES (830, 'AVAXUSDT', 'K2_AVAXUSDT_15', 'K2', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:44:35');
INSERT INTO `stoch_list` VALUES (831, 'AVAXUSDT', 'K2_AVAXUSDT_30', 'K2', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:44:38');
INSERT INTO `stoch_list` VALUES (832, 'UNIUSDT', 'K2_UNIUSDT_1', 'K2', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:44:43');
INSERT INTO `stoch_list` VALUES (833, 'UNIUSDT', 'K2_UNIUSDT_2', 'K2', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:44:46');
INSERT INTO `stoch_list` VALUES (834, 'UNIUSDT', 'K2_UNIUSDT_3', 'K2', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:44:49');
INSERT INTO `stoch_list` VALUES (835, 'UNIUSDT', 'K2_UNIUSDT_5', 'K2', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:44:52');
INSERT INTO `stoch_list` VALUES (836, 'UNIUSDT', 'K2_UNIUSDT_10', 'K2', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:44:55');
INSERT INTO `stoch_list` VALUES (837, 'UNIUSDT', 'K2_UNIUSDT_15', 'K2', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:44:58');
INSERT INTO `stoch_list` VALUES (838, 'UNIUSDT', 'K2_UNIUSDT_30', 'K2', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:45:01');
INSERT INTO `stoch_list` VALUES (839, 'SUIUSDT', 'K2_SUIUSDT_1', 'K2', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:45:06');
INSERT INTO `stoch_list` VALUES (840, 'SUIUSDT', 'K2_SUIUSDT_2', 'K2', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:45:08');
INSERT INTO `stoch_list` VALUES (841, 'SUIUSDT', 'K2_SUIUSDT_3', 'K2', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:45:12');
INSERT INTO `stoch_list` VALUES (842, 'SUIUSDT', 'K2_SUIUSDT_5', 'K2', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:45:15');
INSERT INTO `stoch_list` VALUES (843, 'SUIUSDT', 'K2_SUIUSDT_10', 'K2', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:45:18');
INSERT INTO `stoch_list` VALUES (844, 'SUIUSDT', 'K2_SUIUSDT_15', 'K2', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:45:21');
INSERT INTO `stoch_list` VALUES (845, 'SUIUSDT', 'K2_SUIUSDT_30', 'K2', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:45:24');
INSERT INTO `stoch_list` VALUES (846, 'WLFIUSDT', 'K2_WLFIUSDT_1', 'K2', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:45:28');
INSERT INTO `stoch_list` VALUES (847, 'WLFIUSDT', 'K2_WLFIUSDT_2', 'K2', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:45:31');
INSERT INTO `stoch_list` VALUES (848, 'WLFIUSDT', 'K2_WLFIUSDT_3', 'K2', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:45:34');
INSERT INTO `stoch_list` VALUES (849, 'WLFIUSDT', 'K2_WLFIUSDT_5', 'K2', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:45:37');
INSERT INTO `stoch_list` VALUES (850, 'WLFIUSDT', 'K2_WLFIUSDT_10', 'K2', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:45:40');
INSERT INTO `stoch_list` VALUES (851, 'WLFIUSDT', 'K2_WLFIUSDT_15', 'K2', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:45:43');
INSERT INTO `stoch_list` VALUES (852, 'WLFIUSDT', 'K2_WLFIUSDT_30', 'K2', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:45:46');
INSERT INTO `stoch_list` VALUES (853, 'TONUSDT', 'K2_TONUSDT_1', 'K2', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:45:51');
INSERT INTO `stoch_list` VALUES (854, 'TONUSDT', 'K2_TONUSDT_2', 'K2', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:45:54');
INSERT INTO `stoch_list` VALUES (855, 'TONUSDT', 'K2_TONUSDT_3', 'K2', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:45:57');
INSERT INTO `stoch_list` VALUES (856, 'TONUSDT', 'K2_TONUSDT_5', 'K2', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:46:00');
INSERT INTO `stoch_list` VALUES (857, 'TONUSDT', 'K2_TONUSDT_10', 'K2', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:46:03');
INSERT INTO `stoch_list` VALUES (858, 'TONUSDT', 'K2_TONUSDT_15', 'K2', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:46:06');
INSERT INTO `stoch_list` VALUES (859, 'TONUSDT', 'K2_TONUSDT_30', 'K2', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:46:09');
INSERT INTO `stoch_list` VALUES (860, 'ENAUSDT', 'K2_ENAUSDT_1', 'K2', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:46:14');
INSERT INTO `stoch_list` VALUES (861, 'ENAUSDT', 'K2_ENAUSDT_2', 'K2', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:46:17');
INSERT INTO `stoch_list` VALUES (862, 'ENAUSDT', 'K2_ENAUSDT_3', 'K2', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:46:20');
INSERT INTO `stoch_list` VALUES (863, 'ENAUSDT', 'K2_ENAUSDT_5', 'K2', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:46:23');
INSERT INTO `stoch_list` VALUES (864, 'ENAUSDT', 'K2_ENAUSDT_10', 'K2', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:46:26');
INSERT INTO `stoch_list` VALUES (865, 'ENAUSDT', 'K2_ENAUSDT_15', 'K2', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:46:29');
INSERT INTO `stoch_list` VALUES (866, 'ENAUSDT', 'K2_ENAUSDT_30', 'K2', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:46:33');
INSERT INTO `stoch_list` VALUES (867, 'QNTUSDT', 'K2_QNTUSDT_1', 'K2', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:46:37');
INSERT INTO `stoch_list` VALUES (868, 'QNTUSDT', 'K2_QNTUSDT_2', 'K2', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:46:40');
INSERT INTO `stoch_list` VALUES (869, 'QNTUSDT', 'K2_QNTUSDT_3', 'K2', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:46:43');
INSERT INTO `stoch_list` VALUES (870, 'QNTUSDT', 'K2_QNTUSDT_5', 'K2', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:46:46');
INSERT INTO `stoch_list` VALUES (871, 'QNTUSDT', 'K2_QNTUSDT_10', 'K2', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:46:50');
INSERT INTO `stoch_list` VALUES (872, 'QNTUSDT', 'K2_QNTUSDT_15', 'K2', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:46:53');
INSERT INTO `stoch_list` VALUES (873, 'QNTUSDT', 'K2_QNTUSDT_30', 'K2', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:46:55');
INSERT INTO `stoch_list` VALUES (874, 'ALGOUSDT', 'K2_ALGOUSDT_1', 'K2', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:47:00');
INSERT INTO `stoch_list` VALUES (875, 'ALGOUSDT', 'K2_ALGOUSDT_2', 'K2', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:47:04');
INSERT INTO `stoch_list` VALUES (876, 'ALGOUSDT', 'K2_ALGOUSDT_3', 'K2', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:47:07');
INSERT INTO `stoch_list` VALUES (877, 'ALGOUSDT', 'K2_ALGOUSDT_5', 'K2', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:47:10');
INSERT INTO `stoch_list` VALUES (878, 'ALGOUSDT', 'K2_ALGOUSDT_10', 'K2', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:47:13');
INSERT INTO `stoch_list` VALUES (879, 'ALGOUSDT', 'K2_ALGOUSDT_15', 'K2', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:47:16');
INSERT INTO `stoch_list` VALUES (880, 'ALGOUSDT', 'K2_ALGOUSDT_30', 'K2', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:47:19');
INSERT INTO `stoch_list` VALUES (881, 'VETUSDT', 'K2_VETUSDT_1', 'K2', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:47:24');
INSERT INTO `stoch_list` VALUES (882, 'VETUSDT', 'K2_VETUSDT_2', 'K2', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:47:27');
INSERT INTO `stoch_list` VALUES (883, 'VETUSDT', 'K2_VETUSDT_3', 'K2', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:47:30');
INSERT INTO `stoch_list` VALUES (884, 'VETUSDT', 'K2_VETUSDT_5', 'K2', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:47:33');
INSERT INTO `stoch_list` VALUES (885, 'VETUSDT', 'K2_VETUSDT_10', 'K2', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:47:36');
INSERT INTO `stoch_list` VALUES (886, 'VETUSDT', 'K2_VETUSDT_15', 'K2', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:47:39');
INSERT INTO `stoch_list` VALUES (887, 'VETUSDT', 'K2_VETUSDT_30', 'K2', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:47:42');
INSERT INTO `stoch_list` VALUES (888, 'SEIUSDT', 'K2_SEIUSDT_1', 'K2', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:47:47');
INSERT INTO `stoch_list` VALUES (889, 'SEIUSDT', 'K2_SEIUSDT_2', 'K2', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:47:50');
INSERT INTO `stoch_list` VALUES (890, 'SEIUSDT', 'K2_SEIUSDT_3', 'K2', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:47:53');
INSERT INTO `stoch_list` VALUES (891, 'SEIUSDT', 'K2_SEIUSDT_5', 'K2', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:47:56');
INSERT INTO `stoch_list` VALUES (892, 'SEIUSDT', 'K2_SEIUSDT_10', 'K2', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:47:59');
INSERT INTO `stoch_list` VALUES (893, 'SEIUSDT', 'K2_SEIUSDT_15', 'K2', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:48:02');
INSERT INTO `stoch_list` VALUES (894, 'SEIUSDT', 'K2_SEIUSDT_30', 'K2', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:48:05');
INSERT INTO `stoch_list` VALUES (895, 'RENDERUSDT', 'K2_RENDERUSDT_1', 'K2', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:48:10');
INSERT INTO `stoch_list` VALUES (896, 'RENDERUSDT', 'K2_RENDERUSDT_2', 'K2', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:48:13');
INSERT INTO `stoch_list` VALUES (897, 'RENDERUSDT', 'K2_RENDERUSDT_3', 'K2', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:48:16');
INSERT INTO `stoch_list` VALUES (898, 'RENDERUSDT', 'K2_RENDERUSDT_5', 'K2', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:48:19');
INSERT INTO `stoch_list` VALUES (899, 'RENDERUSDT', 'K2_RENDERUSDT_10', 'K2', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:48:22');
INSERT INTO `stoch_list` VALUES (900, 'RENDERUSDT', 'K2_RENDERUSDT_15', 'K2', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:48:25');
INSERT INTO `stoch_list` VALUES (901, 'RENDERUSDT', 'K2_RENDERUSDT_30', 'K2', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:48:28');
INSERT INTO `stoch_list` VALUES (902, 'BTCUSDT', 'T_A_BTCUSDT_30', 'trend', 30, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:19:59');
INSERT INTO `stoch_list` VALUES (903, 'ETHUSDT', 'T_A_ETHUSDT_30', 'trend', 30, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:20:04');
INSERT INTO `stoch_list` VALUES (904, 'XRPUSDT', 'T_A_XRPUSDT_30', 'trend', 30, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:20:09');
INSERT INTO `stoch_list` VALUES (905, 'SOLUSDT', 'T_A_SOLUSDT_30', 'trend', 30, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:20:14');
INSERT INTO `stoch_list` VALUES (906, 'DOGEUSDT', 'T_A_DOGEUSDT_30', 'trend', 30, NULL, '1.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:20:19');
INSERT INTO `stoch_list` VALUES (907, 'BTCUSDT', 'T_B_BTCUSDT_30', 'trend', 30, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:20:24');
INSERT INTO `stoch_list` VALUES (908, 'ETHUSDT', 'T_B_ETHUSDT_30', 'trend', 30, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:20:28');
INSERT INTO `stoch_list` VALUES (909, 'XRPUSDT', 'T_B_XRPUSDT_30', 'trend', 30, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:20:33');
INSERT INTO `stoch_list` VALUES (910, 'SOLUSDT', 'T_B_SOLUSDT_30', 'trend', 30, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:20:38');
INSERT INTO `stoch_list` VALUES (911, 'DOGEUSDT', 'T_B_DOGEUSDT_30', 'trend', 30, NULL, '2.5', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:20:43');
INSERT INTO `stoch_list` VALUES (912, 'BTCUSDT', 'T_C_BTCUSDT_30', 'trend', 30, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:20:48');
INSERT INTO `stoch_list` VALUES (913, 'ETHUSDT', 'T_C_ETHUSDT_30', 'trend', 30, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:20:52');
INSERT INTO `stoch_list` VALUES (914, 'XRPUSDT', 'T_C_XRPUSDT_30', 'trend', 30, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:20:57');
INSERT INTO `stoch_list` VALUES (915, 'SOLUSDT', 'T_C_SOLUSDT_30', 'trend', 30, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:21:02');
INSERT INTO `stoch_list` VALUES (916, 'DOGEUSDT', 'T_C_DOGEUSDT_30', 'trend', 30, NULL, '2', NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:21:07');
INSERT INTO `stoch_list` VALUES (917, 'BTCUSDT', 'R_P_BTCUSDT_1', 'RSI+UT', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:24:22');
INSERT INTO `stoch_list` VALUES (918, 'BTCUSDT', 'R_P_BTCUSDT_2', 'RSI+UT', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:24:25');
INSERT INTO `stoch_list` VALUES (919, 'BTCUSDT', 'R_P_BTCUSDT_3', 'RSI+UT', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:24:28');
INSERT INTO `stoch_list` VALUES (920, 'BTCUSDT', 'R_P_BTCUSDT_5', 'RSI+UT', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:24:31');
INSERT INTO `stoch_list` VALUES (921, 'BTCUSDT', 'R_P_BTCUSDT_10', 'RSI+UT', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:24:34');
INSERT INTO `stoch_list` VALUES (922, 'BTCUSDT', 'R_P_BTCUSDT_15', 'RSI+UT', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:24:37');
INSERT INTO `stoch_list` VALUES (923, 'BTCUSDT', 'R_P_BTCUSDT_30', 'RSI+UT', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:24:40');
INSERT INTO `stoch_list` VALUES (924, 'ETHUSDT', 'R_P_ETHUSDT_1', 'RSI+UT', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:24:45');
INSERT INTO `stoch_list` VALUES (925, 'ETHUSDT', 'R_P_ETHUSDT_2', 'RSI+UT', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:24:48');
INSERT INTO `stoch_list` VALUES (926, 'ETHUSDT', 'R_P_ETHUSDT_3', 'RSI+UT', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:24:51');
INSERT INTO `stoch_list` VALUES (927, 'ETHUSDT', 'R_P_ETHUSDT_5', 'RSI+UT', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:24:54');
INSERT INTO `stoch_list` VALUES (928, 'ETHUSDT', 'R_P_ETHUSDT_10', 'RSI+UT', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:24:56');
INSERT INTO `stoch_list` VALUES (929, 'ETHUSDT', 'R_P_ETHUSDT_15', 'RSI+UT', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:24:59');
INSERT INTO `stoch_list` VALUES (930, 'ETHUSDT', 'R_P_ETHUSDT_30', 'RSI+UT', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:25:02');
INSERT INTO `stoch_list` VALUES (931, 'XRPUSDT', 'R_P_XRPUSDT_1', 'RSI+UT', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:25:07');
INSERT INTO `stoch_list` VALUES (932, 'XRPUSDT', 'R_P_XRPUSDT_2', 'RSI+UT', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:25:16');
INSERT INTO `stoch_list` VALUES (933, 'XRPUSDT', 'R_P_XRPUSDT_3', 'RSI+UT', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:25:28');
INSERT INTO `stoch_list` VALUES (934, 'XRPUSDT', 'R_P_XRPUSDT_5', 'RSI+UT', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:25:34');
INSERT INTO `stoch_list` VALUES (935, 'XRPUSDT', 'R_P_XRPUSDT_10', 'RSI+UT', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:25:40');
INSERT INTO `stoch_list` VALUES (936, 'XRPUSDT', 'R_P_XRPUSDT_15', 'RSI+UT', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:25:43');
INSERT INTO `stoch_list` VALUES (937, 'XRPUSDT', 'R_P_XRPUSDT_30', 'RSI+UT', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:25:50');
INSERT INTO `stoch_list` VALUES (938, 'SOLUSDT', 'R_P_SOLUSDT_1', 'RSI+UT', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:25:55');
INSERT INTO `stoch_list` VALUES (939, 'SOLUSDT', 'R_P_SOLUSDT_2', 'RSI+UT', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:25:58');
INSERT INTO `stoch_list` VALUES (940, 'SOLUSDT', 'R_P_SOLUSDT_3', 'RSI+UT', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:26:01');
INSERT INTO `stoch_list` VALUES (941, 'SOLUSDT', 'R_P_SOLUSDT_5', 'RSI+UT', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:26:04');
INSERT INTO `stoch_list` VALUES (942, 'SOLUSDT', 'R_P_SOLUSDT_10', 'RSI+UT', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:26:07');
INSERT INTO `stoch_list` VALUES (943, 'SOLUSDT', 'R_P_SOLUSDT_15', 'RSI+UT', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:26:10');
INSERT INTO `stoch_list` VALUES (944, 'SOLUSDT', 'R_P_SOLUSDT_30', 'RSI+UT', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:26:13');
INSERT INTO `stoch_list` VALUES (945, 'DOGEUSDT', 'R_P_DOGEUSDT_1', 'RSI+UT', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:26:18');
INSERT INTO `stoch_list` VALUES (946, 'DOGEUSDT', 'R_P_DOGEUSDT_2', 'RSI+UT', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:26:21');
INSERT INTO `stoch_list` VALUES (947, 'DOGEUSDT', 'R_P_DOGEUSDT_3', 'RSI+UT', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:26:23');
INSERT INTO `stoch_list` VALUES (948, 'DOGEUSDT', 'R_P_DOGEUSDT_5', 'RSI+UT', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:26:26');
INSERT INTO `stoch_list` VALUES (949, 'DOGEUSDT', 'R_P_DOGEUSDT_10', 'RSI+UT', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:26:29');
INSERT INTO `stoch_list` VALUES (950, 'DOGEUSDT', 'R_P_DOGEUSDT_15', 'RSI+UT', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:26:32');
INSERT INTO `stoch_list` VALUES (951, 'DOGEUSDT', 'R_P_DOGEUSDT_30', 'RSI+UT', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:26:35');
INSERT INTO `stoch_list` VALUES (952, 'BTCUSDT', 'R_M_BTCUSDT_1', 'RSI-UT', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:27:48');
INSERT INTO `stoch_list` VALUES (953, 'BTCUSDT', 'R_M_BTCUSDT_2', 'RSI-UT', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:29:02');
INSERT INTO `stoch_list` VALUES (954, 'BTCUSDT', 'R_M_BTCUSDT_3', 'RSI-UT', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:29:05');
INSERT INTO `stoch_list` VALUES (955, 'BTCUSDT', 'R_M_BTCUSDT_5', 'RSI-UT', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:29:08');
INSERT INTO `stoch_list` VALUES (956, 'BTCUSDT', 'R_M_BTCUSDT_10', 'RSI-UT', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:29:11');
INSERT INTO `stoch_list` VALUES (957, 'BTCUSDT', 'R_M_BTCUSDT_15', 'RSI-UT', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:29:14');
INSERT INTO `stoch_list` VALUES (958, 'BTCUSDT', 'R_M_BTCUSDT_30', 'RSI-UT', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:29:17');
INSERT INTO `stoch_list` VALUES (959, 'ETHUSDT', 'R_M_ETHUSDT_1', 'RSI-UT', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:29:21');
INSERT INTO `stoch_list` VALUES (960, 'ETHUSDT', 'R_M_ETHUSDT_2', 'RSI-UT', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:29:24');
INSERT INTO `stoch_list` VALUES (961, 'ETHUSDT', 'R_M_ETHUSDT_3', 'RSI-UT', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:29:27');
INSERT INTO `stoch_list` VALUES (962, 'ETHUSDT', 'R_M_ETHUSDT_5', 'RSI-UT', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:29:30');
INSERT INTO `stoch_list` VALUES (963, 'ETHUSDT', 'R_M_ETHUSDT_10', 'RSI-UT', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:29:33');
INSERT INTO `stoch_list` VALUES (964, 'ETHUSDT', 'R_M_ETHUSDT_15', 'RSI-UT', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:29:36');
INSERT INTO `stoch_list` VALUES (965, 'ETHUSDT', 'R_M_ETHUSDT_30', 'RSI-UT', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:29:39');
INSERT INTO `stoch_list` VALUES (966, 'XRPUSDT', 'R_M_XRPUSDT_1', 'RSI-UT', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:29:44');
INSERT INTO `stoch_list` VALUES (967, 'XRPUSDT', 'R_M_XRPUSDT_2', 'RSI-UT', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:29:47');
INSERT INTO `stoch_list` VALUES (968, 'XRPUSDT', 'R_M_XRPUSDT_3', 'RSI-UT', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:29:49');
INSERT INTO `stoch_list` VALUES (969, 'XRPUSDT', 'R_M_XRPUSDT_5', 'RSI-UT', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:29:52');
INSERT INTO `stoch_list` VALUES (970, 'XRPUSDT', 'R_M_XRPUSDT_10', 'RSI-UT', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:29:55');
INSERT INTO `stoch_list` VALUES (971, 'XRPUSDT', 'R_M_XRPUSDT_15', 'RSI-UT', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:29:58');
INSERT INTO `stoch_list` VALUES (972, 'XRPUSDT', 'R_M_XRPUSDT_30', 'RSI-UT', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:30:01');
INSERT INTO `stoch_list` VALUES (973, 'SOLUSDT', 'R_M_SOLUSDT_1', 'RSI-UT', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:30:06');
INSERT INTO `stoch_list` VALUES (974, 'SOLUSDT', 'R_M_SOLUSDT_2', 'RSI-UT', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:30:09');
INSERT INTO `stoch_list` VALUES (975, 'SOLUSDT', 'R_M_SOLUSDT_3', 'RSI-UT', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:30:12');
INSERT INTO `stoch_list` VALUES (976, 'SOLUSDT', 'R_M_SOLUSDT_5', 'RSI-UT', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:30:15');
INSERT INTO `stoch_list` VALUES (977, 'SOLUSDT', 'R_M_SOLUSDT_10', 'RSI-UT', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:30:18');
INSERT INTO `stoch_list` VALUES (978, 'SOLUSDT', 'R_M_SOLUSDT_15', 'RSI-UT', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:30:21');
INSERT INTO `stoch_list` VALUES (979, 'SOLUSDT', 'R_M_SOLUSDT_30', 'RSI-UT', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:30:24');
INSERT INTO `stoch_list` VALUES (980, 'DOGEUSDT', 'R_M_DOGEUSDT_1', 'RSI-UT', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:30:28');
INSERT INTO `stoch_list` VALUES (981, 'DOGEUSDT', 'R_M_DOGEUSDT_2', 'RSI-UT', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:30:31');
INSERT INTO `stoch_list` VALUES (982, 'DOGEUSDT', 'R_M_DOGEUSDT_3', 'RSI-UT', 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:30:34');
INSERT INTO `stoch_list` VALUES (983, 'DOGEUSDT', 'R_M_DOGEUSDT_5', 'RSI-UT', 5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:30:37');
INSERT INTO `stoch_list` VALUES (984, 'DOGEUSDT', 'R_M_DOGEUSDT_10', 'RSI-UT', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:30:40');
INSERT INTO `stoch_list` VALUES (985, 'DOGEUSDT', 'R_M_DOGEUSDT_15', 'RSI-UT', 15, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:30:43');
INSERT INTO `stoch_list` VALUES (986, 'DOGEUSDT', 'R_M_DOGEUSDT_30', 'RSI-UT', 30, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'READY', 'READY', '2026-01-14 17:30:46');

-- ----------------------------
-- Table structure for test_play_list
-- ----------------------------
DROP TABLE IF EXISTS `test_play_list`;
CREATE TABLE `test_play_list`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `uid` int(11) UNSIGNED NOT NULL,
  `live_ST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL DEFAULT 'N',
  `a_name` varchar(30) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `symbol` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'BTCUSDT',
  `bunbong` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL COMMENT '1~ 990',
  `type` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL COMMENT 'stoch, RSI, UT, mid, abs',
  `second1` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `second2` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT '1',
  `second3` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT '1',
  `second4` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT '1',
  `marginType` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `AI_ST` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `repeatConfig` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'repeat' COMMENT 'repeat: 자동반복, stopLoss: 손절 시 반복 멈춤, once: 1회만 진입',
  `profitTradeType` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'per' COMMENT 'per, abs, fix',
  `profitFixValue` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL COMMENT '지지선 : res, 저항선: sub',
  `profitAbsValue` double(15, 2) NULL DEFAULT 0.00 COMMENT '절대값',
  `lossTradeType` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'per',
  `lossFixValue` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `lossAbsValue` double(15, 2) NULL DEFAULT 0.00,
  `absValue` double(15, 2) NULL DEFAULT NULL COMMENT '진입시 절대값',
  `limitST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `enter` double(15, 2) NULL DEFAULT 1.00 COMMENT '진입',
  `cancel` double(15, 2) NULL DEFAULT 1.00 COMMENT '진입취소',
  `profit` double(15, 2) NULL DEFAULT 1.00 COMMENT '1차익절',
  `stopLoss` double(15, 2) NULL DEFAULT 1.00 COMMENT '손절',
  `leverage` double(15, 2) NULL DEFAULT 0.00,
  `margin` double(15, 2) NULL DEFAULT 0.00,
  `minimumOrderST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `m_cancelStopLoss` double(15, 2) NULL DEFAULT NULL COMMENT '손절취소',
  `m_profit` double(15, 2) NULL DEFAULT NULL COMMENT '2차익절',
  `trendOrderST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `t_cancelStopLoss` double(15, 2) NULL DEFAULT NULL COMMENT '추세:손절취소',
  `t_profit` double(15, 2) NULL DEFAULT NULL COMMENT '추세:2차익절',
  `t_chase` double(15, 2) NULL DEFAULT NULL COMMENT '추세:추세추격',
  `t_ST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `t_autoST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N' COMMENT '자동청산 on off',
  `t_direct` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `signalType` char(5) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `alarmSignalST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `alarmResultST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `orderSize` int(11) NULL DEFAULT NULL,
  `st` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'STOP' COMMENT 'STOP, START',
  `status` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'READY',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `autoST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `stoch_id` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `direct1ST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `direct2ST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `detailTap` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'B',
  `selectST` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'Y',
  `r_tid` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `r_oid` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `r_m_st` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `r_t_st` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT 'N',
  `r_t_tick` double(15, 2) NULL DEFAULT 0.00,
  `r_t_cnt` int(11) NULL DEFAULT 0,
  `r_tempPrice` double(10, 2) NULL DEFAULT NULL,
  `r_signalType` char(5) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `r_signalPrice` double(15, 2) NULL DEFAULT NULL,
  `r_signalTime` datetime NULL DEFAULT NULL,
  `r_exactPrice` double(15, 2) NULL DEFAULT NULL,
  `r_exactTime` datetime NULL DEFAULT NULL,
  `r_profitPrice` double(15, 2) NULL DEFAULT 0.00,
  `r_profitTime` datetime NULL DEFAULT NULL,
  `r_stopPrice` double(15, 2) NULL DEFAULT 0.00,
  `r_stopTime` datetime NULL DEFAULT NULL,
  `r_endPrice` double(15, 2) NULL DEFAULT 0.00,
  `r_endTime` datetime NULL DEFAULT NULL,
  `r_exact_cnt` int(11) NULL DEFAULT 0,
  `r_profit_cnt` int(11) NULL DEFAULT 0,
  `r_profit_tick` double(15, 2) NULL DEFAULT 0.00,
  `r_stop_cnt` int(11) NULL DEFAULT 0,
  `r_stop_tick` double(15, 2) NULL DEFAULT 0.00,
  `r_forcing_cnt` int(11) NULL DEFAULT 0,
  `r_forcing_tick` int(11) NULL DEFAULT 0,
  `r_real_tick` double(15, 2) NULL DEFAULT NULL,
  `r_pol_tick` double(15, 2) NULL DEFAULT 0.00,
  `r_charge` double(15, 2) NULL DEFAULT 0.00,
  `r_t_charge` double(15, 2) NULL DEFAULT NULL,
  `r_pol_sum` double(15, 3) NULL DEFAULT 0.000,
  `r_minQty` double(15, 3) NULL DEFAULT NULL,
  `r_qty` double(15, 3) NULL DEFAULT NULL,
  `r_margin` double(15, 3) NULL DEFAULT NULL,
  `r_win` int(11) NULL DEFAULT 0,
  `r_loss` int(11) NULL DEFAULT 0,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `item_uid`(`uid`) USING BTREE,
  CONSTRAINT `test_play_list_ibfk_1` FOREIGN KEY (`uid`) REFERENCES `admin_member` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB AUTO_INCREMENT = 12 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of test_play_list
-- ----------------------------
INSERT INTO `test_play_list` VALUES (1, 147, 'N', 'SCALPING_ETH_LONG', 'ETHUSDT', '5', 'scalping', '1', '5', '3', '3', 'isolated', 'attack', 'repeat', 'per', 'res', NULL, 'per', 'res', NULL, NULL, 'N', NULL, 0.00, 0.27, 1.00, 20.00, 50.00, 'N', 0.00, 0.00, 'N', 0.00, 0.00, 0.00, 'N', 'N', 'N', 'BUY', 'Y', 'Y', 1, 'START', 'EXACT', '2026-01-16 12:14:33', 'Y', 'S_A_ETHUSDT_5', 'N', 'N', 'B', 'Y', NULL, NULL, 'N', 'N', 0.00, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, NULL, 0.00, NULL, 0.00, NULL, 0, 0, 0.00, 0, 0.00, 0, 0, NULL, 0.00, 0.00, 0.00, 0.000, 0.000, 0.344, 0.000, 3, 1);
INSERT INTO `test_play_list` VALUES (2, 147, 'N', 'SCALPING_ETH_LONG', 'ETHUSDT', '5', 'scalping', '1', '5', '3', '3', 'isolated', 'attack', 'repeat', 'per', 'res', NULL, 'per', 'res', NULL, 0.00, 'N', NULL, 0.00, 0.20, 1.00, 20.00, 50.00, 'N', 0.00, 0.00, 'N', 0.00, 0.00, 0.00, 'N', 'N', 'N', 'SELL', 'Y', 'Y', 1, 'START', 'EXACT', '2026-01-16 12:15:01', 'Y', 'S_A_ETHUSDT_5', 'N', 'N', 'B', 'Y', NULL, NULL, 'N', 'N', 0.00, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, NULL, 0.00, NULL, 0.00, NULL, 0, 0, 0.00, 0, 0.00, 0, 0, NULL, 0.00, 0.00, 0.00, 0.000, 0.000, 0.410, 0.000, 52, 8);
INSERT INTO `test_play_list` VALUES (3, 147, 'N', 'BTCUSDT.P_TEST_SCALPING', 'BTCUSDT', '1', 'scalping', '1', '5', '3', '3', 'isolated', 'attack', 'repeat', 'per', 'res', NULL, 'per', 'res', NULL, 0.00, 'N', NULL, 0.00, 0.20, 1.20, 20.00, 10.00, 'N', 0.00, 0.00, 'N', 0.00, 0.00, 0.00, 'N', 'N', 'N', 'BUY', 'Y', 'Y', 1, 'START', 'EXACT', '2026-01-16 12:44:35', 'Y', 'S_A_BTCUSDT_1', 'N', 'N', 'B', 'Y', NULL, NULL, 'N', 'N', 0.00, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, NULL, 0.00, NULL, 0.00, NULL, 0, 0, 0.00, 0, 0.00, 0, 0, NULL, 0.00, 0.00, 0.00, 0.000, 0.000, 0.002, 0.000, 7, 3);
INSERT INTO `test_play_list` VALUES (4, 147, 'N', 'BTCUSDT.P_TEST_SCALPING', 'BTCUSDT', '1', 'scalping', '1', '5', '3', '3', 'isolated', 'attack', 'repeat', 'per', 'res', NULL, 'per', 'res', NULL, 0.00, 'N', NULL, 0.00, 0.20, 1.20, 20.00, 10.00, 'N', 0.00, 0.00, 'N', 0.00, 0.00, 0.00, 'N', 'N', 'N', 'SELL', 'Y', 'Y', 1, 'START', 'EXACT', '2026-01-16 12:44:40', 'Y', 'S_A_BTCUSDT_1', 'N', 'N', 'B', 'Y', NULL, NULL, 'N', 'N', 0.00, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, NULL, 0.00, NULL, 0.00, NULL, 0, 0, 0.00, 0, 0.00, 0, 0, NULL, 0.00, 0.00, 0.00, 0.000, 0.000, 0.002, 0.000, 11, 1);
INSERT INTO `test_play_list` VALUES (5, 1, 'N', '123', 'BTCUSDT', '1', 'scalping', '1', '5', '3', '3', 'isolated', 'attack', 'repeat', 'per', 'res', NULL, 'per', 'res', NULL, 0.00, 'N', NULL, 0.00, 123.00, 123.00, 123.00, 123.00, 'N', 0.00, 0.00, 'N', 0.00, 0.00, 0.00, 'N', 'N', 'N', 'BUY', 'Y', 'Y', 1, 'START', 'EXACT', '2026-01-16 14:04:04', 'Y', 'S_A_BTCUSDT_1', 'N', 'N', 'B', 'Y', NULL, NULL, 'N', 'N', 0.00, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, NULL, 0.00, NULL, 0.00, NULL, 0, 0, 0.00, 0, 0.00, 0, 0, NULL, 0.00, 0.00, NULL, 0.000, NULL, 0.159, NULL, 0, 0);
INSERT INTO `test_play_list` VALUES (6, 146, 'N', '전략1', 'BTCUSDT', '5', 'scalping', '1', '5', '3', '3', 'isolated', 'attack', 'repeat', 'per', 'res', NULL, 'per', 'res', NULL, NULL, 'N', NULL, 0.00, 0.25, 0.50, 20.00, 50.00, 'N', 0.00, 0.00, 'N', 0.00, 0.00, 0.00, 'N', 'N', 'N', 'BUY', 'Y', 'Y', 1, 'START', 'READY', '2026-01-21 16:54:39', 'N', 'S_A_BTCUSDT_5', 'N', 'N', 'B', 'Y', NULL, NULL, 'N', 'N', 0.00, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, NULL, 0.00, NULL, 0.00, NULL, 0, 0, 0.00, 0, 0.00, 0, 0, NULL, 0.00, 0.00, 0.00, 0.000, 0.000, 0.000, 0.000, 29, 14);
INSERT INTO `test_play_list` VALUES (7, 146, 'N', '전략2', 'ETHUSDT', '5', 'scalping', '1', '5', '3', '3', 'isolated', 'attack', 'repeat', 'per', 'res', NULL, 'per', 'res', NULL, NULL, 'N', NULL, 0.00, 0.35, 0.15, 20.00, 50.00, 'N', 0.00, 0.00, 'N', 0.00, 0.00, 0.00, 'N', 'N', 'N', 'BUY', 'Y', 'Y', 1, 'START', 'READY', '2026-01-21 16:59:33', 'N', 'S_A_ETHUSDT_5', 'N', 'N', 'B', 'Y', NULL, NULL, 'N', 'N', 0.00, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, NULL, 0.00, NULL, 0.00, NULL, 0, 0, 0.00, 0, 0.00, 0, 0, NULL, 0.00, 0.00, 0.00, 0.000, 0.000, 0.000, 0.000, 8, 21);
INSERT INTO `test_play_list` VALUES (8, 146, 'N', '전략3', 'XRPUSDT', '5', 'scalping', '1', '5', '3', '3', 'isolated', 'attack', 'repeat', 'per', 'res', NULL, 'per', 'res', NULL, NULL, 'N', NULL, 0.00, 0.40, 0.65, 20.00, 50.00, 'N', 0.00, 0.00, 'N', 0.00, 0.00, 0.00, 'N', 'N', 'N', 'BUY', 'Y', 'Y', 1, 'START', 'READY', '2026-01-21 17:01:16', 'N', 'S_A_XRPUSDT_5', 'N', 'N', 'B', 'Y', NULL, NULL, 'N', 'N', 0.00, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, NULL, 0.00, NULL, 0.00, NULL, 0, 0, 0.00, 0, 0.00, 0, 0, NULL, 0.00, 0.00, 0.00, 0.000, 0.000, 0.000, 0.000, 13, 14);
INSERT INTO `test_play_list` VALUES (9, 1, 'N', '1-1', 'BTCUSDT', '1', 'greenlight', '1', '-3', '3', NULL, 'isolated', 'conser', 'repeat', 'per', 'res', NULL, 'per', 'res', NULL, 0.00, 'N', NULL, 0.00, 0.50, 0.50, 20.00, 100.00, 'N', 0.00, 0.00, 'N', 0.00, 0.00, 0.00, 'N', 'N', 'N', 'SELL', 'Y', 'Y', 1, 'STOP', 'READY', '2026-02-13 17:02:12', 'Y', 'G_B_BTCUSDT_1', 'N', 'N', 'B', 'Y', NULL, NULL, 'N', 'N', 0.00, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, NULL, 0.00, NULL, 0.00, NULL, 0, 0, 0.00, 0, 0.00, 0, 0, NULL, 0.00, 0.00, NULL, 0.000, NULL, NULL, NULL, 0, 0);
INSERT INTO `test_play_list` VALUES (10, 1, 'N', '1-1', 'BTCUSDT', '1', 'greenlight', '1', '-3', '3', NULL, 'isolated', 'conser', 'repeat', 'per', 'res', NULL, 'per', 'res', NULL, 0.00, 'N', NULL, 0.00, 0.50, 0.50, 20.00, 100.00, 'N', 0.00, 0.00, 'N', 0.00, 0.00, 0.00, 'N', 'N', 'N', 'BUY', 'Y', 'Y', 1, 'STOP', 'READY', '2026-02-13 17:02:22', 'Y', 'G_B_BTCUSDT_1', 'N', 'N', 'B', 'Y', NULL, NULL, 'N', 'N', 0.00, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, NULL, 0.00, NULL, 0.00, NULL, 0, 0, 0.00, 0, 0.00, 0, 0, NULL, 0.00, 0.00, NULL, 0.000, NULL, NULL, NULL, 0, 0);
INSERT INTO `test_play_list` VALUES (11, 1, 'N', '1-1', 'BTCUSDT', '1', 'scalping', '1', '14', '3', '3', 'isolated', 'conser', 'repeat', 'per', 'res', NULL, 'per', 'res', NULL, 0.00, 'N', NULL, 0.00, 0.50, 0.50, 20.00, 100.00, 'N', 0.00, 0.00, 'N', 0.00, 0.00, 0.00, 'N', 'N', 'N', 'SELL', 'Y', 'Y', 1, 'STOP', 'READY', '2026-02-13 17:04:14', 'Y', 'S_B_BTCUSDT_1', 'N', 'N', 'B', 'Y', NULL, NULL, 'N', 'N', 0.00, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, NULL, 0.00, NULL, 0.00, NULL, 0, 0, 0.00, 0, 0.00, 0, 0, NULL, 0.00, 0.00, NULL, 0.000, NULL, NULL, NULL, 0, 0);

-- ----------------------------
-- Table structure for test_play_log
-- ----------------------------
DROP TABLE IF EXISTS `test_play_log`;
CREATE TABLE `test_play_log`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `uid` int(11) UNSIGNED NOT NULL,
  `pid` int(11) UNSIGNED NOT NULL,
  `tid` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `oid` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `st` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  `symbol` char(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `type` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL COMMENT '전략',
  `bunbong` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `win_loss` char(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL DEFAULT NULL,
  `leverage` double(15, 2) NULL DEFAULT NULL,
  `margin` double(15, 2) NULL DEFAULT NULL,
  `positionSize` double(15, 10) NULL DEFAULT NULL,
  `signalType` char(5) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  `signalPrice` double(15, 10) NULL DEFAULT NULL,
  `signalTime` datetime NULL DEFAULT NULL,
  `openPrice` double(15, 10) NULL DEFAULT NULL COMMENT '체결된가격 진입가격',
  `closePrice` double(15, 10) NULL DEFAULT NULL COMMENT '익절 가격',
  `closeTick` double(15, 10) NULL DEFAULT NULL,
  `pol_tick` double(15, 10) NULL DEFAULT NULL COMMENT '손익 틱',
  `pol_sum` double(15, 10) NULL DEFAULT NULL COMMENT '손익 돈',
  `charge` double(15, 10) NULL DEFAULT 0.0000000000 COMMENT 'ls증권 수수료',
  `openTime` datetime NULL DEFAULT NULL,
  `closeTime` datetime NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `item_uid`(`uid`) USING BTREE,
  INDEX `play_list_id`(`pid`) USING BTREE,
  CONSTRAINT `test_play_log_ibfk_1` FOREIGN KEY (`uid`) REFERENCES `admin_member` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB AUTO_INCREMENT = 186 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of test_play_log
-- ----------------------------
INSERT INTO `test_play_log` VALUES (1, 147, 4, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '1', 'Win', 20.00, 10.00, 200.0000000000, 'SELL', 95393.6000000000, '2026-01-16 13:14:22', 95393.5000000000, 95200.9000000000, NULL, 0.3852000000, 0.3852000000, 0.0000000000, '2026-01-16 13:14:23', '2026-01-16 13:38:21');
INSERT INTO `test_play_log` VALUES (2, 147, 1, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 3297.4600000000, '2026-01-16 12:55:22', 3297.4700000000, 3306.7900000000, NULL, 2.8264093381, 2.8264093381, 0.0000000000, '2026-01-16 12:55:22', '2026-01-16 14:43:02');
INSERT INTO `test_play_log` VALUES (3, 147, 3, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '1', 'Win', 20.00, 10.00, 200.0000000000, 'BUY', 95375.0000000000, '2026-01-16 12:51:22', 95375.1000000000, 95599.6000000000, NULL, 0.4707727698, 0.4707727698, 0.0000000000, '2026-01-16 12:51:22', '2026-01-16 14:43:40');
INSERT INTO `test_play_log` VALUES (4, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 3313.0100000000, '2026-01-16 14:50:21', 3313.0000000000, 3305.9700000000, NULL, 2.1219438575, 2.1219438575, 0.0000000000, '2026-01-16 14:50:22', '2026-01-16 15:08:02');
INSERT INTO `test_play_log` VALUES (5, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 3313.4100000000, '2026-01-16 15:50:22', 3313.4000000000, 3306.7000000000, NULL, 2.0220921108, 2.0220921108, 0.0000000000, '2026-01-16 15:50:22', '2026-01-16 16:29:06');
INSERT INTO `test_play_log` VALUES (6, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 3315.5400000000, '2026-01-16 17:25:23', 3315.5300000000, 3308.5500000000, NULL, 2.1052441088, 2.1052441088, 0.0000000000, '2026-01-16 17:25:23', '2026-01-16 18:16:29');
INSERT INTO `test_play_log` VALUES (7, 147, 1, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 3296.3000000000, '2026-01-16 19:40:22', 3296.3100000000, 3305.3000000000, NULL, 2.7272920326, 2.7272920326, 0.0000000000, '2026-01-16 19:40:22', '2026-01-16 21:14:22');
INSERT INTO `test_play_log` VALUES (8, 147, 3, NULL, NULL, 'STOP', 'BTCUSDT', 'scalping', '1', 'Lose', 20.00, 10.00, 200.0000000000, 'BUY', 95634.5000000000, '2026-01-16 16:17:22', 95634.6000000000, 95447.9000000000, NULL, -0.3904444626, -0.3904444626, 0.0000000000, '2026-01-16 16:17:22', '2026-01-16 21:46:51');
INSERT INTO `test_play_log` VALUES (9, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 3309.8600000000, '2026-01-16 21:25:23', 3309.8500000000, 3302.9000000000, NULL, 2.0997930420, 2.0997930420, 0.0000000000, '2026-01-16 21:25:23', '2026-01-16 21:50:53');
INSERT INTO `test_play_log` VALUES (10, 147, 4, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '1', 'Win', 20.00, 10.00, 200.0000000000, 'SELL', 95362.6000000000, '2026-01-16 14:03:22', 95362.5000000000, 95334.1000000000, NULL, 0.0595621969, 0.0595621969, 0.0000000000, '2026-01-16 14:03:23', '2026-01-16 23:39:33');
INSERT INTO `test_play_log` VALUES (11, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2967.3600000000, '2026-01-21 17:10:04', 2967.3700000000, 2961.9600000000, NULL, -1.8231632725, -1.8231632725, 0.0000000000, '2026-01-21 17:10:04', '2026-01-21 17:14:59');
INSERT INTO `test_play_log` VALUES (12, 146, 8, NULL, NULL, 'STOP', 'XRPUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 1.9100000000, '2026-01-21 17:10:04', 1.9100000000, 1.8973000000, NULL, -6.6492146597, -6.6492146597, 0.0000000000, '2026-01-21 17:10:04', '2026-01-21 17:38:25');
INSERT INTO `test_play_log` VALUES (13, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 89170.6000000000, '2026-01-21 17:00:05', 89170.7000000000, 89399.9000000000, NULL, 2.5703510234, 2.5703510234, 0.0000000000, '2026-01-21 17:00:06', '2026-01-21 18:25:17');
INSERT INTO `test_play_log` VALUES (14, 146, 8, NULL, NULL, 'PROFIT', 'XRPUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 1.9000000000, '2026-01-21 17:45:02', 1.9000000000, 1.9076000000, NULL, 4.0000000000, 4.0000000000, 0.0000000000, '2026-01-21 17:45:02', '2026-01-21 18:38:04');
INSERT INTO `test_play_log` VALUES (15, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2963.3400000000, '2026-01-21 18:00:07', 2963.3500000000, 2957.7500000000, NULL, -1.8897531510, -1.8897531510, 0.0000000000, '2026-01-21 18:00:07', '2026-01-21 18:55:01');
INSERT INTO `test_play_log` VALUES (16, 146, 7, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 2960.1300000000, '2026-01-21 19:05:01', 2960.1400000000, 2970.6000000000, NULL, 3.5336166533, 3.5336166533, 0.0000000000, '2026-01-21 19:05:02', '2026-01-21 20:21:31');
INSERT INTO `test_play_log` VALUES (17, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2912.3000000000, '2026-01-21 21:20:04', 2912.3500000000, 2907.7700000000, NULL, -1.5726131818, -1.5726131818, 0.0000000000, '2026-01-21 21:20:04', '2026-01-21 21:21:46');
INSERT INTO `test_play_log` VALUES (18, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 88316.5000000000, '2026-01-21 21:20:03', 88316.6000000000, 88547.2000000000, NULL, 2.6110606613, 2.6110606613, 0.0000000000, '2026-01-21 21:20:03', '2026-01-21 21:35:26');
INSERT INTO `test_play_log` VALUES (19, 146, 7, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 2912.8900000000, '2026-01-21 21:35:00', 2912.9000000000, 2923.1500000000, NULL, 3.5188300319, 3.5188300319, 0.0000000000, '2026-01-21 21:35:01', '2026-01-21 21:50:07');
INSERT INTO `test_play_log` VALUES (20, 146, 8, NULL, NULL, 'PROFIT', 'XRPUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 1.8900000000, '2026-01-21 21:20:02', 1.8900000000, 1.8981000000, NULL, 4.2857142857, 4.2857142857, 0.0000000000, '2026-01-21 21:20:02', '2026-01-21 22:04:40');
INSERT INTO `test_play_log` VALUES (21, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 88616.8000000000, '2026-01-21 21:40:01', 88616.9000000000, 88866.7000000000, NULL, 2.8188754064, 2.8188754064, 0.0000000000, '2026-01-21 21:40:02', '2026-01-21 22:04:41');
INSERT INTO `test_play_log` VALUES (22, 146, 6, NULL, NULL, 'STOP', 'BTCUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 89133.1000000000, '2026-01-22 01:35:02', 89133.2000000000, 88685.6000000000, NULL, -5.0216978634, -5.0216978634, 0.0000000000, '2026-01-22 01:35:02', '2026-01-22 01:40:10');
INSERT INTO `test_play_log` VALUES (23, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2889.5800000000, '2026-01-22 01:45:04', 2889.5900000000, 2884.3900000000, NULL, -1.7995632598, -1.7995632598, 0.0000000000, '2026-01-22 01:45:04', '2026-01-22 01:45:12');
INSERT INTO `test_play_log` VALUES (24, 146, 8, NULL, NULL, 'PROFIT', 'XRPUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 1.8900000000, '2026-01-22 01:45:06', 1.8900000000, 1.8980000000, NULL, 4.2328042328, 4.2328042328, 0.0000000000, '2026-01-22 01:45:06', '2026-01-22 01:45:49');
INSERT INTO `test_play_log` VALUES (25, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2911.6600000000, '2026-01-22 02:05:01', 2911.6700000000, 2907.1700000000, NULL, -1.5455048134, -1.5455048134, 0.0000000000, '2026-01-22 02:05:02', '2026-01-22 02:05:09');
INSERT INTO `test_play_log` VALUES (26, 146, 6, NULL, NULL, 'STOP', 'BTCUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 88047.6000000000, '2026-01-22 02:05:01', 88047.7000000000, 87598.9000000000, NULL, -5.0972370658, -5.0972370658, 0.0000000000, '2026-01-22 02:05:02', '2026-01-22 02:12:48');
INSERT INTO `test_play_log` VALUES (27, 146, 8, NULL, NULL, 'STOP', 'XRPUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 1.8900000000, '2026-01-22 02:05:02', 1.8900000000, 1.8773000000, NULL, -6.7195767196, -6.7195767196, 0.0000000000, '2026-01-22 02:05:02', '2026-01-22 02:14:16');
INSERT INTO `test_play_log` VALUES (28, 146, 7, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 2879.0300000000, '2026-01-22 02:35:01', 2879.0400000000, 2889.4300000000, NULL, 3.6088418362, 3.6088418362, 0.0000000000, '2026-01-22 02:35:01', '2026-01-22 02:39:14');
INSERT INTO `test_play_log` VALUES (29, 146, 8, NULL, NULL, 'PROFIT', 'XRPUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 1.8800000000, '2026-01-22 03:05:02', 1.8800000000, 1.8882000000, NULL, 4.3617021277, 4.3617021277, 0.0000000000, '2026-01-22 03:05:02', '2026-01-22 03:05:43');
INSERT INTO `test_play_log` VALUES (30, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 87871.3000000000, '2026-01-22 03:15:02', 87871.4000000000, 88093.6000000000, NULL, 2.5286953434, 2.5286953434, 0.0000000000, '2026-01-22 03:15:03', '2026-01-22 03:39:11');
INSERT INTO `test_play_log` VALUES (31, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 89841.1000000000, '2026-01-22 08:05:01', 89841.2000000000, 90150.0000000000, NULL, 3.4371758169, 3.4371758169, 0.0000000000, '2026-01-22 08:05:01', '2026-01-22 08:14:08');
INSERT INTO `test_play_log` VALUES (32, 146, 8, NULL, NULL, 'STOP', 'XRPUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 1.9600000000, '2026-01-22 08:25:01', 1.9600000000, 1.9470000000, NULL, -6.6326530612, -6.6326530612, 0.0000000000, '2026-01-22 08:25:01', '2026-01-22 08:44:07');
INSERT INTO `test_play_log` VALUES (33, 146, 7, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 2973.0400000000, '2026-01-22 08:50:01', 2973.0500000000, 2983.9900000000, NULL, 3.6797228435, 3.6797228435, 0.0000000000, '2026-01-22 08:50:01', '2026-01-22 09:00:42');
INSERT INTO `test_play_log` VALUES (34, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 89543.0000000000, '2026-01-22 09:05:01', 89543.1000000000, 89775.4000000000, NULL, 2.5942814131, 2.5942814131, 0.0000000000, '2026-01-22 09:05:01', '2026-01-22 09:25:28');
INSERT INTO `test_play_log` VALUES (35, 146, 7, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 2990.1700000000, '2026-01-22 09:05:01', 2990.1800000000, 3001.3100000000, NULL, 3.7221839488, 3.7221839488, 0.0000000000, '2026-01-22 09:05:01', '2026-01-22 09:26:51');
INSERT INTO `test_play_log` VALUES (36, 146, 8, NULL, NULL, 'PROFIT', 'XRPUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 1.9500000000, '2026-01-22 09:05:01', 1.9500000000, 1.9586000000, NULL, 4.4102564103, 4.4102564103, 0.0000000000, '2026-01-22 09:05:01', '2026-01-22 09:27:59');
INSERT INTO `test_play_log` VALUES (37, 146, 8, NULL, NULL, 'PROFIT', 'XRPUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 1.9500000000, '2026-01-22 12:05:01', 1.9500000000, 1.9587000000, NULL, 4.4615384615, 4.4615384615, 0.0000000000, '2026-01-22 12:05:01', '2026-01-22 15:51:21');
INSERT INTO `test_play_log` VALUES (38, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 3008.5800000000, '2026-01-22 16:30:06', 3008.5900000000, 3003.6900000000, NULL, -1.6286699085, -1.6286699085, 0.0000000000, '2026-01-22 16:30:06', '2026-01-22 16:53:24');
INSERT INTO `test_play_log` VALUES (39, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 3005.9100000000, '2026-01-22 17:05:02', 3005.9200000000, 3001.3500000000, NULL, -1.5203332091, -1.5203332091, 0.0000000000, '2026-01-22 17:05:02', '2026-01-22 17:10:25');
INSERT INTO `test_play_log` VALUES (40, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2999.2400000000, '2026-01-22 17:40:01', 2999.2500000000, 2994.3100000000, NULL, -1.6470784363, -1.6470784363, 0.0000000000, '2026-01-22 17:40:01', '2026-01-22 17:43:56');
INSERT INTO `test_play_log` VALUES (41, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 89892.4000000000, '2026-01-22 16:40:01', 89892.5000000000, 90122.9000000000, NULL, 2.5630614345, 2.5630614345, 0.0000000000, '2026-01-22 16:40:01', '2026-01-22 20:11:39');
INSERT INTO `test_play_log` VALUES (42, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2984.9200000000, '2026-01-22 20:55:01', 2984.9300000000, 2980.4000000000, NULL, -1.5176235289, -1.5176235289, 0.0000000000, '2026-01-22 20:55:02', '2026-01-22 21:00:14');
INSERT INTO `test_play_log` VALUES (43, 146, 8, NULL, NULL, 'STOP', 'XRPUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 1.9500000000, '2026-01-22 19:55:01', 1.9500000000, 1.9358000000, NULL, -7.2820512821, -7.2820512821, 0.0000000000, '2026-01-22 19:55:01', '2026-01-22 22:03:41');
INSERT INTO `test_play_log` VALUES (44, 146, 8, NULL, NULL, 'STOP', 'XRPUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 1.9400000000, '2026-01-22 22:05:01', 1.9400000000, 1.9273000000, NULL, -6.5463917526, -6.5463917526, 0.0000000000, '2026-01-22 22:05:01', '2026-01-22 22:41:09');
INSERT INTO `test_play_log` VALUES (45, 146, 8, NULL, NULL, 'PROFIT', 'XRPUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 1.9200000000, '2026-01-22 23:25:02', 1.9200000000, 1.9278000000, NULL, 4.0625000000, 4.0625000000, 0.0000000000, '2026-01-22 23:25:03', '2026-01-22 23:31:41');
INSERT INTO `test_play_log` VALUES (46, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2958.1900000000, '2026-01-22 23:45:07', 2958.2000000000, 2953.1600000000, NULL, -1.7037387601, -1.7037387601, 0.0000000000, '2026-01-22 23:45:08', '2026-01-22 23:45:16');
INSERT INTO `test_play_log` VALUES (47, 146, 6, NULL, NULL, 'STOP', 'BTCUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 89545.3000000000, '2026-01-22 23:05:01', 89545.4000000000, 89048.5000000000, NULL, -5.5491404360, -5.5491404360, 0.0000000000, '2026-01-22 23:05:02', '2026-01-22 23:49:35');
INSERT INTO `test_play_log` VALUES (48, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 89022.4000000000, '2026-01-23 00:00:15', 89035.4000000000, 89277.5000000000, NULL, 2.7191431723, 2.7191431723, 0.0000000000, '2026-01-23 00:00:15', '2026-01-23 00:04:17');
INSERT INTO `test_play_log` VALUES (49, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2917.6900000000, '2026-01-23 00:25:02', 2917.7000000000, 2912.8700000000, NULL, -1.6554135106, -1.6554135106, 0.0000000000, '2026-01-23 00:25:02', '2026-01-23 00:26:02');
INSERT INTO `test_play_log` VALUES (50, 146, 8, NULL, NULL, 'PROFIT', 'XRPUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 1.9000000000, '2026-01-23 00:30:03', 1.9000000000, 1.9079000000, NULL, 4.1578947368, 4.1578947368, 0.0000000000, '2026-01-23 00:30:04', '2026-01-23 00:35:16');
INSERT INTO `test_play_log` VALUES (51, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 88812.2000000000, '2026-01-23 00:25:03', 88812.3000000000, 89034.6000000000, NULL, 2.5030316747, 2.5030316747, 0.0000000000, '2026-01-23 00:25:03', '2026-01-23 00:44:18');
INSERT INTO `test_play_log` VALUES (52, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 89064.5000000000, '2026-01-23 00:45:03', 89064.6000000000, 89297.4000000000, NULL, 2.6138331054, 2.6138331054, 0.0000000000, '2026-01-23 00:45:03', '2026-01-23 00:46:13');
INSERT INTO `test_play_log` VALUES (53, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2937.6200000000, '2026-01-23 05:50:03', 2937.6300000000, 2933.0200000000, NULL, -1.5692922526, -1.5692922526, 0.0000000000, '2026-01-23 05:50:03', '2026-01-23 06:04:39');
INSERT INTO `test_play_log` VALUES (54, 146, 8, NULL, NULL, 'PROFIT', 'XRPUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 1.9200000000, '2026-01-23 05:50:10', 1.9200000000, 1.9278000000, NULL, 4.0625000000, 4.0625000000, 0.0000000000, '2026-01-23 05:50:10', '2026-01-23 06:19:03');
INSERT INTO `test_play_log` VALUES (55, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 89262.2000000000, '2026-01-23 07:10:01', 89262.3000000000, 89506.3000000000, NULL, 2.7335168375, 2.7335168375, 0.0000000000, '2026-01-23 07:10:02', '2026-01-23 07:13:27');
INSERT INTO `test_play_log` VALUES (56, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2971.0000000000, '2026-01-23 13:25:01', 2970.9900000000, 2964.8900000000, NULL, 2.0531876580, 2.0531876580, 0.0000000000, '2026-01-23 13:25:01', '2026-01-23 14:26:04');
INSERT INTO `test_play_log` VALUES (57, 146, 8, NULL, NULL, 'STOP', 'XRPUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 1.9200000000, '2026-01-23 09:55:01', 1.9200000000, 1.9073000000, NULL, -6.6145833333, -6.6145833333, 0.0000000000, '2026-01-23 09:55:02', '2026-01-23 14:50:06');
INSERT INTO `test_play_log` VALUES (58, 147, 4, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '1', 'Win', 20.00, 10.00, 200.0000000000, 'SELL', 89699.1000000000, '2026-01-23 15:06:01', 89699.0000000000, 89515.4000000000, NULL, 0.4093691123, 0.4093691123, 0.0000000000, '2026-01-23 15:06:01', '2026-01-23 15:27:11');
INSERT INTO `test_play_log` VALUES (59, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2946.4500000000, '2026-01-23 15:50:02', 2946.4600000000, 2941.8200000000, NULL, -1.5747710812, -1.5747710812, 0.0000000000, '2026-01-23 15:50:02', '2026-01-23 15:54:03');
INSERT INTO `test_play_log` VALUES (60, 147, 4, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '1', 'Win', 20.00, 10.00, 200.0000000000, 'SELL', 89574.2000000000, '2026-01-23 16:23:01', 89574.1000000000, 89391.3000000000, NULL, 0.4081536962, 0.4081536962, 0.0000000000, '2026-01-23 16:23:01', '2026-01-23 17:27:11');
INSERT INTO `test_play_log` VALUES (61, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2940.9800000000, '2026-01-23 16:15:02', 2940.9900000000, 2936.1100000000, NULL, -1.6593051999, -1.6593051999, 0.0000000000, '2026-01-23 16:15:03', '2026-01-23 17:28:12');
INSERT INTO `test_play_log` VALUES (62, 146, 6, NULL, NULL, 'STOP', 'BTCUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 89603.4000000000, '2026-01-23 14:30:02', 89603.5000000000, 89148.5000000000, NULL, -5.0779266435, -5.0779266435, 0.0000000000, '2026-01-23 14:30:02', '2026-01-23 17:36:05');
INSERT INTO `test_play_log` VALUES (63, 146, 8, NULL, NULL, 'PROFIT', 'XRPUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 1.9000000000, '2026-01-23 17:35:02', 1.9000000000, 1.9078000000, NULL, 4.1052631579, 4.1052631579, 0.0000000000, '2026-01-23 17:35:02', '2026-01-23 17:45:19');
INSERT INTO `test_play_log` VALUES (64, 146, 8, NULL, NULL, 'PROFIT', 'XRPUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 1.9000000000, '2026-01-23 17:50:01', 1.9000000000, 1.9077000000, NULL, 4.0526315789, 4.0526315789, 0.0000000000, '2026-01-23 17:50:01', '2026-01-23 18:03:10');
INSERT INTO `test_play_log` VALUES (65, 147, 4, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '1', 'Win', 20.00, 10.00, 200.0000000000, 'SELL', 89316.8000000000, '2026-01-23 18:11:01', 89316.7000000000, 89111.0000000000, NULL, 0.4606081505, 0.4606081505, 0.0000000000, '2026-01-23 18:11:01', '2026-01-23 18:15:49');
INSERT INTO `test_play_log` VALUES (66, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2925.8800000000, '2026-01-23 17:50:01', 2925.8900000000, 2920.3200000000, NULL, -1.9036942605, -1.9036942605, 0.0000000000, '2026-01-23 17:50:02', '2026-01-23 18:18:07');
INSERT INTO `test_play_log` VALUES (67, 147, 1, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2946.4500000000, '2026-01-23 15:50:02', 2946.4600000000, 2916.7700000000, NULL, -10.0764985780, -10.0764985780, 0.0000000000, '2026-01-23 15:50:02', '2026-01-23 18:35:03');
INSERT INTO `test_play_log` VALUES (68, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2920.3800000000, '2026-01-23 18:35:01', 2920.3900000000, 2915.6100000000, NULL, -1.6367676920, -1.6367676920, 0.0000000000, '2026-01-23 18:35:02', '2026-01-23 18:46:32');
INSERT INTO `test_play_log` VALUES (69, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2921.4900000000, '2026-01-23 19:05:01', 2921.5000000000, 2917.0500000000, NULL, -1.5231901421, -1.5231901421, 0.0000000000, '2026-01-23 19:05:01', '2026-01-23 19:10:46');
INSERT INTO `test_play_log` VALUES (70, 147, 1, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 2921.4900000000, '2026-01-23 19:05:01', 2921.5000000000, 2929.8500000000, NULL, 2.8581208283, 2.8581208283, 0.0000000000, '2026-01-23 19:05:01', '2026-01-23 19:43:18');
INSERT INTO `test_play_log` VALUES (71, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2936.4300000000, '2026-01-23 20:20:01', 2936.4200000000, 2929.3100000000, NULL, 2.4213157518, 2.4213157518, 0.0000000000, '2026-01-23 20:20:01', '2026-01-23 21:35:44');
INSERT INTO `test_play_log` VALUES (72, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 89226.2000000000, '2026-01-23 17:50:01', 89221.4000000000, 89445.9000000000, NULL, 2.5162124782, 2.5162124782, 0.0000000000, '2026-01-23 17:50:01', '2026-01-23 23:18:14');
INSERT INTO `test_play_log` VALUES (73, 147, 4, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '1', 'Win', 20.00, 10.00, 200.0000000000, 'SELL', 89084.3000000000, '2026-01-23 19:21:02', 89084.2000000000, 88883.7000000000, NULL, 0.4501359388, 0.4501359388, 0.0000000000, '2026-01-23 19:21:03', '2026-01-23 23:37:50');
INSERT INTO `test_play_log` VALUES (74, 147, 3, NULL, NULL, 'STOP', 'BTCUSDT', 'scalping', '1', 'Lose', 20.00, 10.00, 200.0000000000, 'BUY', 89864.8000000000, '2026-01-23 14:05:02', 89864.9000000000, 88767.3000000000, NULL, -2.4427779923, -2.4427779923, 0.0000000000, '2026-01-23 14:05:03', '2026-01-23 23:38:00');
INSERT INTO `test_play_log` VALUES (75, 147, 3, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '1', 'Win', 20.00, 10.00, 200.0000000000, 'BUY', 88767.3000000000, '2026-01-23 23:38:02', 88767.4000000000, 88958.9000000000, NULL, 0.4314647044, 0.4314647044, 0.0000000000, '2026-01-23 23:38:02', '2026-01-23 23:41:41');
INSERT INTO `test_play_log` VALUES (76, 146, 8, NULL, NULL, 'STOP', 'XRPUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 1.9000000000, '2026-01-23 22:55:05', 1.9000000000, 1.8869000000, NULL, -6.8947368421, -6.8947368421, 0.0000000000, '2026-01-23 22:55:05', '2026-01-23 23:47:14');
INSERT INTO `test_play_log` VALUES (77, 147, 3, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '1', 'Win', 20.00, 10.00, 200.0000000000, 'BUY', 88740.6000000000, '2026-01-23 23:49:01', 88764.8000000000, 88988.5000000000, NULL, 0.5040286240, 0.5040286240, 0.0000000000, '2026-01-23 23:49:01', '2026-01-23 23:51:37');
INSERT INTO `test_play_log` VALUES (78, 147, 3, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '1', 'Win', 20.00, 10.00, 200.0000000000, 'BUY', 88669.6000000000, '2026-01-24 00:18:01', 88669.7000000000, 88870.1000000000, NULL, 0.4520146115, 0.4520146115, 0.0000000000, '2026-01-24 00:18:01', '2026-01-24 00:20:30');
INSERT INTO `test_play_log` VALUES (79, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 88941.9000000000, '2026-01-24 00:00:16', 88942.0000000000, 89172.2000000000, NULL, 2.5882035484, 2.5882035484, 0.0000000000, '2026-01-24 00:00:17', '2026-01-24 00:21:20');
INSERT INTO `test_play_log` VALUES (80, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2951.8200000000, '2026-01-24 01:00:14', 2951.8100000000, 2945.4400000000, NULL, 2.1579979741, 2.1579979741, 0.0000000000, '2026-01-24 01:00:15', '2026-01-24 01:27:47');
INSERT INTO `test_play_log` VALUES (81, 147, 4, NULL, NULL, 'STOP', 'BTCUSDT', 'scalping', '1', 'Lose', 20.00, 10.00, 200.0000000000, 'SELL', 89163.3000000000, '2026-01-24 00:41:01', 89163.2000000000, 90243.0000000000, NULL, -2.4220754751, -2.4220754751, 0.0000000000, '2026-01-24 00:41:01', '2026-01-24 01:41:11');
INSERT INTO `test_play_log` VALUES (82, 147, 4, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '1', 'Win', 20.00, 10.00, 200.0000000000, 'SELL', 90162.3000000000, '2026-01-24 01:48:01', 90162.2000000000, 89980.2000000000, NULL, 0.4037168570, 0.4037168570, 0.0000000000, '2026-01-24 01:48:01', '2026-01-24 02:00:28');
INSERT INTO `test_play_log` VALUES (83, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2968.9100000000, '2026-01-24 01:55:53', 2968.9000000000, 2961.3100000000, NULL, 2.5565024083, 2.5565024083, 0.0000000000, '2026-01-24 01:55:54', '2026-01-24 02:00:29');
INSERT INTO `test_play_log` VALUES (84, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2990.6300000000, '2026-01-24 02:35:01', 2990.6200000000, 2984.0100000000, NULL, 2.2102440297, 2.2102440297, 0.0000000000, '2026-01-24 02:35:01', '2026-01-24 03:00:08');
INSERT INTO `test_play_log` VALUES (85, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2994.8500000000, '2026-01-24 03:30:05', 2994.8400000000, 2988.7900000000, NULL, 2.0201413097, 2.0201413097, 0.0000000000, '2026-01-24 03:30:05', '2026-01-24 03:45:16');
INSERT INTO `test_play_log` VALUES (86, 147, 4, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '1', 'Win', 20.00, 10.00, 200.0000000000, 'SELL', 90139.4000000000, '2026-01-24 02:15:02', 90139.3000000000, 89924.2000000000, NULL, 0.4772613056, 0.4772613056, 0.0000000000, '2026-01-24 02:15:02', '2026-01-24 04:17:06');
INSERT INTO `test_play_log` VALUES (87, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 89830.0000000000, '2026-01-24 04:45:02', 89830.1000000000, 90059.0000000000, NULL, 2.5481436623, 2.5481436623, 0.0000000000, '2026-01-24 04:45:02', '2026-01-24 05:12:47');
INSERT INTO `test_play_log` VALUES (88, 147, 4, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '1', 'Win', 20.00, 10.00, 200.0000000000, 'SELL', 90094.9000000000, '2026-01-24 05:14:01', 90094.8000000000, 89914.3000000000, NULL, 0.4006890520, 0.4006890520, 0.0000000000, '2026-01-24 05:14:01', '2026-01-24 05:23:18');
INSERT INTO `test_play_log` VALUES (89, 147, 3, NULL, NULL, 'STOP', 'BTCUSDT', 'scalping', '1', 'Lose', 20.00, 10.00, 200.0000000000, 'BUY', 90583.6000000000, '2026-01-24 03:48:01', 90583.7000000000, 89386.0000000000, NULL, -2.6444051192, -2.6444051192, 0.0000000000, '2026-01-24 03:48:01', '2026-01-24 05:31:48');
INSERT INTO `test_play_log` VALUES (90, 147, 3, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '1', 'Win', 20.00, 10.00, 200.0000000000, 'BUY', 89270.8000000000, '2026-01-24 05:38:01', 89270.9000000000, 89456.0000000000, NULL, 0.4146928058, 0.4146928058, 0.0000000000, '2026-01-24 05:38:01', '2026-01-24 05:55:30');
INSERT INTO `test_play_log` VALUES (91, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 89412.2000000000, '2026-01-24 05:55:02', 89412.3000000000, 89664.0000000000, NULL, 2.8150489362, 2.8150489362, 0.0000000000, '2026-01-24 05:55:03', '2026-01-24 06:08:27');
INSERT INTO `test_play_log` VALUES (92, 147, 4, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '1', 'Win', 20.00, 10.00, 200.0000000000, 'SELL', 89596.9000000000, '2026-01-24 06:12:01', 89596.8000000000, 89409.2000000000, NULL, 0.4187649559, 0.4187649559, 0.0000000000, '2026-01-24 06:12:01', '2026-01-24 06:41:22');
INSERT INTO `test_play_log` VALUES (93, 147, 3, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '1', 'Win', 20.00, 10.00, 200.0000000000, 'BUY', 89380.1000000000, '2026-01-24 06:42:01', 89380.2000000000, 89560.0000000000, NULL, 0.4023262423, 0.4023262423, 0.0000000000, '2026-01-24 06:42:01', '2026-01-24 07:03:49');
INSERT INTO `test_play_log` VALUES (94, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2958.7700000000, '2026-01-24 07:40:01', 2958.7600000000, 2952.4000000000, NULL, 2.1495491354, 2.1495491354, 0.0000000000, '2026-01-24 07:40:01', '2026-01-24 08:06:42');
INSERT INTO `test_play_log` VALUES (95, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 89528.3000000000, '2026-01-24 07:05:03', 89528.4000000000, 89550.3000000000, NULL, 0.2446151165, 0.2446151165, 0.0000000000, '2026-01-24 07:05:03', '2026-01-24 10:23:26');
INSERT INTO `test_play_log` VALUES (96, 147, 3, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '1', 'Win', 20.00, 10.00, 200.0000000000, 'BUY', 89490.1000000000, '2026-01-24 09:16:01', 89490.2000000000, 89679.8000000000, NULL, 0.4237335485, 0.4237335485, 0.0000000000, '2026-01-24 09:16:01', '2026-01-24 11:58:00');
INSERT INTO `test_play_log` VALUES (97, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2958.5000000000, '2026-01-24 22:40:01', 2958.5100000000, 2953.5000000000, NULL, -1.6934199986, -1.6934199986, 0.0000000000, '2026-01-24 22:40:01', '2026-01-24 22:59:51');
INSERT INTO `test_play_log` VALUES (98, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2955.7800000000, '2026-01-24 10:25:01', 2955.7700000000, 2948.4100000000, NULL, 2.4900448952, 2.4900448952, 0.0000000000, '2026-01-24 10:25:01', '2026-01-24 23:00:01');
INSERT INTO `test_play_log` VALUES (99, 147, 4, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '1', 'Win', 20.00, 10.00, 200.0000000000, 'SELL', 89528.4000000000, '2026-01-24 07:05:02', 89528.3000000000, 89331.2000000000, NULL, 0.4403077016, 0.4403077016, 0.0000000000, '2026-01-24 07:05:02', '2026-01-24 23:00:01');
INSERT INTO `test_play_log` VALUES (100, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2964.0000000000, '2026-01-25 00:20:01', 2963.9900000000, 2957.9600000000, NULL, 2.0344198192, 2.0344198192, 0.0000000000, '2026-01-25 00:20:02', '2026-01-25 00:40:34');
INSERT INTO `test_play_log` VALUES (101, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2964.1600000000, '2026-01-25 02:25:01', 2964.1500000000, 2957.9300000000, NULL, 2.0984093248, 2.0984093248, 0.0000000000, '2026-01-25 02:25:01', '2026-01-25 04:11:24');
INSERT INTO `test_play_log` VALUES (102, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2961.3000000000, '2026-01-25 07:20:02', 2961.2900000000, 2955.2600000000, NULL, 2.0362747316, 2.0362747316, 0.0000000000, '2026-01-25 07:20:02', '2026-01-25 08:09:02');
INSERT INTO `test_play_log` VALUES (103, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2938.7200000000, '2026-01-25 15:35:01', 2938.7300000000, 2930.1100000000, NULL, -2.9332398689, -2.9332398689, 0.0000000000, '2026-01-25 15:35:01', '2026-01-25 17:38:34');
INSERT INTO `test_play_log` VALUES (104, 146, 6, NULL, NULL, 'STOP', 'BTCUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 88759.1000000000, '2026-01-25 15:30:00', 88759.2000000000, 88303.0000000000, NULL, -5.1397488936, -5.1397488936, 0.0000000000, '2026-01-25 15:30:01', '2026-01-25 17:41:12');
INSERT INTO `test_play_log` VALUES (105, 146, 8, NULL, NULL, 'STOP', 'XRPUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 1.9000000000, '2026-01-25 15:35:01', 1.9000000000, 1.8876000000, NULL, -6.5263157895, -6.5263157895, 0.0000000000, '2026-01-25 15:35:02', '2026-01-25 18:04:25');
INSERT INTO `test_play_log` VALUES (106, 146, 8, NULL, NULL, 'PROFIT', 'XRPUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 1.8900000000, '2026-01-25 18:30:02', 1.8900000000, 1.8977000000, NULL, 4.0740740741, 4.0740740741, 0.0000000000, '2026-01-25 18:30:02', '2026-01-25 19:15:25');
INSERT INTO `test_play_log` VALUES (107, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 88266.6000000000, '2026-01-25 18:05:01', 88266.7000000000, 88494.4000000000, NULL, 2.5796818053, 2.5796818053, 0.0000000000, '2026-01-25 18:05:01', '2026-01-25 19:21:13');
INSERT INTO `test_play_log` VALUES (108, 146, 7, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 2931.3300000000, '2026-01-25 18:15:01', 2931.3400000000, 2942.4400000000, NULL, 3.7866641195, 3.7866641195, 0.0000000000, '2026-01-25 18:15:01', '2026-01-25 19:24:11');
INSERT INTO `test_play_log` VALUES (109, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 88419.9000000000, '2026-01-25 21:05:00', 88420.0000000000, 88642.8000000000, NULL, 2.5197919023, 2.5197919023, 0.0000000000, '2026-01-25 21:05:01', '2026-01-25 21:24:31');
INSERT INTO `test_play_log` VALUES (110, 146, 8, NULL, NULL, 'STOP', 'XRPUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 1.9000000000, '2026-01-25 21:45:01', 1.9000000000, 1.8876000000, NULL, -6.5263157895, -6.5263157895, 0.0000000000, '2026-01-25 21:45:01', '2026-01-25 23:27:51');
INSERT INTO `test_play_log` VALUES (111, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 87648.8000000000, '2026-01-26 01:20:00', 87648.9000000000, 87871.5000000000, NULL, 2.5396781933, 2.5396781933, 0.0000000000, '2026-01-26 01:20:01', '2026-01-26 01:23:51');
INSERT INTO `test_play_log` VALUES (112, 146, 6, NULL, NULL, 'STOP', 'BTCUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 88033.5000000000, '2026-01-26 01:30:01', 88033.6000000000, 87573.3000000000, NULL, -5.2286854110, -5.2286854110, 0.0000000000, '2026-01-26 01:30:01', '2026-01-26 03:13:05');
INSERT INTO `test_play_log` VALUES (113, 146, 6, NULL, NULL, 'STOP', 'BTCUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 87367.5000000000, '2026-01-26 03:40:01', 87367.6000000000, 86887.2000000000, NULL, -5.4986058905, -5.4986058905, 0.0000000000, '2026-01-26 03:40:01', '2026-01-26 03:44:54');
INSERT INTO `test_play_log` VALUES (114, 146, 6, NULL, NULL, 'STOP', 'BTCUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 87330.3000000000, '2026-01-26 03:55:00', 87354.1000000000, 86792.3000000000, NULL, -6.4312951539, -6.4312951539, 0.0000000000, '2026-01-26 03:55:01', '2026-01-26 04:20:37');
INSERT INTO `test_play_log` VALUES (115, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 86431.8000000000, '2026-01-26 04:30:02', 86431.9000000000, 86660.0000000000, NULL, 2.6390719167, 2.6390719167, 0.0000000000, '2026-01-26 04:30:02', '2026-01-26 04:40:31');
INSERT INTO `test_play_log` VALUES (116, 146, 6, NULL, NULL, 'STOP', 'BTCUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 86667.2000000000, '2026-01-26 04:45:01', 86667.3000000000, 86186.0000000000, NULL, -5.5534209558, -5.5534209558, 0.0000000000, '2026-01-26 04:45:01', '2026-01-26 04:53:40');
INSERT INTO `test_play_log` VALUES (117, 146, 6, NULL, NULL, 'STOP', 'BTCUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 86635.3000000000, '2026-01-26 05:10:00', 86635.4000000000, 86200.0000000000, NULL, -5.0256592571, -5.0256592571, 0.0000000000, '2026-01-26 05:10:01', '2026-01-26 05:34:30');
INSERT INTO `test_play_log` VALUES (118, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 86235.7000000000, '2026-01-26 05:35:01', 86235.8000000000, 86465.0000000000, NULL, 2.6578288831, 2.6578288831, 0.0000000000, '2026-01-26 05:35:01', '2026-01-26 05:51:48');
INSERT INTO `test_play_log` VALUES (119, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 86573.2000000000, '2026-01-26 05:55:00', 86573.3000000000, 86796.2000000000, NULL, 2.5746968176, 2.5746968176, 0.0000000000, '2026-01-26 05:55:00', '2026-01-26 06:03:39');
INSERT INTO `test_play_log` VALUES (120, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 86269.5000000000, '2026-01-26 07:25:01', 86269.6000000000, 86506.9000000000, NULL, 2.7506792659, 2.7506792659, 0.0000000000, '2026-01-26 07:25:01', '2026-01-26 07:36:38');
INSERT INTO `test_play_log` VALUES (121, 147, 2, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'SELL', 2820.0300000000, '2026-01-26 09:05:01', 2820.0200000000, 2848.5300000000, NULL, -10.1098573769, -10.1098573769, 0.0000000000, '2026-01-26 09:05:01', '2026-01-26 10:03:47');
INSERT INTO `test_play_log` VALUES (122, 147, 2, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'SELL', 2864.9400000000, '2026-01-26 10:20:01', 2864.9300000000, 2897.2800000000, NULL, -11.2917244051, -11.2917244051, 0.0000000000, '2026-01-26 10:20:01', '2026-01-26 10:53:29');
INSERT INTO `test_play_log` VALUES (123, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2871.3500000000, '2026-01-26 11:05:01', 2871.3400000000, 2864.1800000000, NULL, 2.4936092556, 2.4936092556, 0.0000000000, '2026-01-26 11:05:02', '2026-01-26 11:53:09');
INSERT INTO `test_play_log` VALUES (124, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 87116.7000000000, '2026-01-26 12:55:01', 87116.8000000000, 87339.7000000000, NULL, 2.5586339259, 2.5586339259, 0.0000000000, '2026-01-26 12:55:01', '2026-01-26 13:07:26');
INSERT INTO `test_play_log` VALUES (125, 147, 2, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'SELL', 2880.9100000000, '2026-01-26 15:40:01', 2880.9000000000, 2910.7600000000, NULL, -10.3648165504, -10.3648165504, 0.0000000000, '2026-01-26 15:40:01', '2026-01-26 16:18:52');
INSERT INTO `test_play_log` VALUES (126, 147, 2, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'SELL', 2893.2600000000, '2026-01-26 16:30:01', 2893.2500000000, 2931.8700000000, NULL, -13.3483107232, -13.3483107232, 0.0000000000, '2026-01-26 16:30:02', '2026-01-26 17:23:30');
INSERT INTO `test_play_log` VALUES (127, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2913.0100000000, '2026-01-26 17:35:01', 2913.0000000000, 2907.0900000000, NULL, 2.0288362513, 2.0288362513, 0.0000000000, '2026-01-26 17:35:02', '2026-01-26 17:54:10');
INSERT INTO `test_play_log` VALUES (128, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2906.5500000000, '2026-01-26 17:55:01', 2906.5400000000, 2899.6700000000, NULL, 2.3636351125, 2.3636351125, 0.0000000000, '2026-01-26 17:55:01', '2026-01-26 18:03:45');
INSERT INTO `test_play_log` VALUES (129, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 87719.9000000000, '2026-01-26 18:25:02', 87720.0000000000, 87939.9000000000, NULL, 2.5068399453, 2.5068399453, 0.0000000000, '2026-01-26 18:25:02', '2026-01-26 20:11:44');
INSERT INTO `test_play_log` VALUES (130, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2911.0200000000, '2026-01-26 21:20:01', 2911.0100000000, 2905.1500000000, NULL, 2.0130470180, 2.0130470180, 0.0000000000, '2026-01-26 21:20:01', '2026-01-26 21:21:24');
INSERT INTO `test_play_log` VALUES (131, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2907.1800000000, '2026-01-26 22:25:04', 2907.1700000000, 2898.4400000000, NULL, 3.0029203659, 3.0029203659, 0.0000000000, '2026-01-26 22:25:04', '2026-01-26 23:10:10');
INSERT INTO `test_play_log` VALUES (132, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2916.2300000000, '2026-01-26 23:50:02', 2916.2200000000, 2910.2100000000, NULL, 2.0608870387, 2.0608870387, 0.0000000000, '2026-01-26 23:50:02', '2026-01-26 23:53:12');
INSERT INTO `test_play_log` VALUES (133, 146, 6, NULL, NULL, 'STOP', 'BTCUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 87613.5000000000, '2026-01-27 01:05:01', 87613.6000000000, 87168.9000000000, NULL, -5.0756960107, -5.0756960107, 0.0000000000, '2026-01-27 01:05:01', '2026-01-27 01:15:59');
INSERT INTO `test_play_log` VALUES (134, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 87347.9000000000, '2026-01-27 02:25:02', 87348.0000000000, 87568.9000000000, NULL, 2.5289646014, 2.5289646014, 0.0000000000, '2026-01-27 02:25:02', '2026-01-27 02:49:08');
INSERT INTO `test_play_log` VALUES (135, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2916.6200000000, '2026-01-27 03:20:01', 2916.6100000000, 2910.7200000000, NULL, 2.0194678068, 2.0194678068, 0.0000000000, '2026-01-27 03:20:02', '2026-01-27 05:39:02');
INSERT INTO `test_play_log` VALUES (136, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 87767.5000000000, '2026-01-27 05:45:03', 87767.6000000000, 88014.8000000000, NULL, 2.8165291064, 2.8165291064, 0.0000000000, '2026-01-27 05:45:03', '2026-01-27 06:41:26');
INSERT INTO `test_play_log` VALUES (137, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2931.9400000000, '2026-01-27 06:55:29', 2931.9300000000, 2925.8900000000, NULL, 2.0600764684, 2.0600764684, 0.0000000000, '2026-01-27 06:55:29', '2026-01-27 06:58:00');
INSERT INTO `test_play_log` VALUES (138, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2940.0000000000, '2026-01-27 08:40:02', 2939.9900000000, 2933.6900000000, NULL, 2.1428644315, 2.1428644315, 0.0000000000, '2026-01-27 08:40:02', '2026-01-27 08:46:07');
INSERT INTO `test_play_log` VALUES (139, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2936.8300000000, '2026-01-27 10:40:01', 2936.8200000000, 2930.8800000000, NULL, 2.0225958690, 2.0225958690, 0.0000000000, '2026-01-27 10:40:01', '2026-01-27 10:41:22');
INSERT INTO `test_play_log` VALUES (140, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2939.9000000000, '2026-01-27 11:10:01', 2939.8900000000, 2933.9400000000, NULL, 2.0238852474, 2.0238852474, 0.0000000000, '2026-01-27 11:10:01', '2026-01-27 11:26:41');
INSERT INTO `test_play_log` VALUES (141, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2939.8200000000, '2026-01-27 11:55:01', 2939.8100000000, 2933.8600000000, NULL, 2.0239403227, 2.0239403227, 0.0000000000, '2026-01-27 11:55:02', '2026-01-27 14:11:57');
INSERT INTO `test_play_log` VALUES (142, 146, 8, NULL, NULL, 'STOP', 'XRPUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 1.9000000000, '2026-01-27 14:15:05', 1.9000000000, 1.8984000000, NULL, -0.8421052632, -0.8421052632, 0.0000000000, '2026-01-27 14:15:05', '2026-01-27 16:16:23');
INSERT INTO `test_play_log` VALUES (143, 146, 7, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 2927.0800000000, '2026-01-27 15:55:01', 2927.0900000000, 2931.5200000000, NULL, 1.5134485103, 1.5134485103, 0.0000000000, '2026-01-27 15:55:01', '2026-01-27 16:16:26');
INSERT INTO `test_play_log` VALUES (144, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2919.2200000000, '2026-01-27 17:50:04', 2919.2300000000, 2914.8100000000, NULL, -1.5140978957, -1.5140978957, 0.0000000000, '2026-01-27 17:50:04', '2026-01-27 18:08:50');
INSERT INTO `test_play_log` VALUES (145, 146, 6, NULL, NULL, 'STOP', 'BTCUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 88438.0000000000, '2026-01-27 14:10:00', 88438.1000000000, 87983.7000000000, NULL, -5.1380570139, -5.1380570139, 0.0000000000, '2026-01-27 14:10:01', '2026-01-27 18:09:49');
INSERT INTO `test_play_log` VALUES (146, 146, 8, NULL, NULL, 'STOP', 'XRPUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 1.8900000000, '2026-01-27 17:55:02', 1.9000000000, 1.8875000000, NULL, -6.5789473684, -6.5789473684, 0.0000000000, '2026-01-27 17:55:03', '2026-01-27 18:09:51');
INSERT INTO `test_play_log` VALUES (147, 146, 7, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 2910.0900000000, '2026-01-27 18:30:06', 2910.1000000000, 2905.1400000000, NULL, -1.7044087832, -1.7044087832, 0.0000000000, '2026-01-27 18:30:06', '2026-01-27 19:32:29');
INSERT INTO `test_play_log` VALUES (148, 146, 7, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 2904.2700000000, '2026-01-27 19:55:01', 2904.2800000000, 2914.7400000000, NULL, 3.6015811148, 3.6015811148, 0.0000000000, '2026-01-27 19:55:01', '2026-01-27 20:35:24');
INSERT INTO `test_play_log` VALUES (149, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2918.2300000000, '2026-01-27 20:45:01', 2918.2200000000, 2912.1700000000, NULL, 2.0731815970, 2.0731815970, 0.0000000000, '2026-01-27 20:45:01', '2026-01-27 22:09:41');
INSERT INTO `test_play_log` VALUES (150, 146, 8, NULL, NULL, 'STOP', 'XRPUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 1.8800000000, '2026-01-27 18:35:02', 1.8900000000, 1.8775000000, NULL, -6.6137566138, -6.6137566138, 0.0000000000, '2026-01-27 18:35:03', '2026-01-27 22:30:39');
INSERT INTO `test_play_log` VALUES (151, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 87993.3000000000, '2026-01-27 18:40:02', 87993.4000000000, 88215.1000000000, NULL, 2.5195071449, 2.5195071449, 0.0000000000, '2026-01-27 18:40:03', '2026-01-27 23:13:57');
INSERT INTO `test_play_log` VALUES (152, 146, 8, NULL, NULL, 'PROFIT', 'XRPUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 1.8800000000, '2026-01-27 22:40:02', 1.8800000000, 1.8877000000, NULL, 4.0957446809, 4.0957446809, 0.0000000000, '2026-01-27 22:40:02', '2026-01-27 23:14:44');
INSERT INTO `test_play_log` VALUES (153, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2925.6000000000, '2026-01-27 23:15:02', 2925.5900000000, 2919.3600000000, NULL, 2.1294849928, 2.1294849928, 0.0000000000, '2026-01-27 23:15:02', '2026-01-27 23:34:44');
INSERT INTO `test_play_log` VALUES (154, 147, 2, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'SELL', 2945.8900000000, '2026-01-28 01:05:03', 2945.8800000000, 2976.3300000000, NULL, -10.3364699173, -10.3364699173, 0.0000000000, '2026-01-28 01:05:03', '2026-01-28 01:10:28');
INSERT INTO `test_play_log` VALUES (155, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2972.0500000000, '2026-01-28 01:20:03', 2972.0400000000, 2965.2900000000, NULL, 2.2711672790, 2.2711672790, 0.0000000000, '2026-01-28 01:20:03', '2026-01-28 02:11:59');
INSERT INTO `test_play_log` VALUES (156, 146, 6, NULL, NULL, 'STOP', 'BTCUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 87729.9000000000, '2026-01-28 02:35:02', 87730.0000000000, 87289.3000000000, NULL, -5.0233671492, -5.0233671492, 0.0000000000, '2026-01-28 02:35:02', '2026-01-28 02:45:08');
INSERT INTO `test_play_log` VALUES (157, 146, 6, NULL, NULL, 'PROFIT', 'BTCUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'BUY', 87500.0000000000, '2026-01-28 03:00:08', 87500.1000000000, 87749.9000000000, NULL, 2.8548538802, 2.8548538802, 0.0000000000, '2026-01-28 03:00:08', '2026-01-28 03:03:14');
INSERT INTO `test_play_log` VALUES (158, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2976.6900000000, '2026-01-28 04:00:06', 2976.6800000000, 2970.6000000000, NULL, 2.0425440424, 2.0425440424, 0.0000000000, '2026-01-28 04:00:06', '2026-01-28 04:03:50');
INSERT INTO `test_play_log` VALUES (159, 147, 2, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'SELL', 2978.3600000000, '2026-01-28 04:55:02', 2978.3500000000, 3008.6400000000, NULL, -10.1700606040, -10.1700606040, 0.0000000000, '2026-01-28 04:55:02', '2026-01-28 05:20:13');
INSERT INTO `test_play_log` VALUES (160, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 3022.7800000000, '2026-01-28 06:05:01', 3022.7700000000, 3016.4500000000, NULL, 2.0907975135, 2.0907975135, 0.0000000000, '2026-01-28 06:05:01', '2026-01-28 06:19:44');
INSERT INTO `test_play_log` VALUES (161, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 3015.2300000000, '2026-01-28 06:30:03', 3014.8500000000, 3008.3100000000, NULL, 2.1692621523, 2.1692621523, 0.0000000000, '2026-01-28 06:30:04', '2026-01-28 06:33:05');
INSERT INTO `test_play_log` VALUES (162, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 3014.6600000000, '2026-01-28 07:00:04', 3014.6500000000, 3008.3500000000, NULL, 2.0897948352, 2.0897948352, 0.0000000000, '2026-01-28 07:00:04', '2026-01-28 07:17:32');
INSERT INTO `test_play_log` VALUES (163, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 3019.7100000000, '2026-01-28 07:55:01', 3019.7000000000, 3013.2700000000, NULL, 2.1293505977, 2.1293505977, 0.0000000000, '2026-01-28 07:55:02', '2026-01-28 08:01:07');
INSERT INTO `test_play_log` VALUES (164, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 3023.0600000000, '2026-01-28 08:55:01', 3023.0500000000, 3016.6000000000, NULL, 2.1336067878, 2.1336067878, 0.0000000000, '2026-01-28 08:55:01', '2026-01-28 09:37:57');
INSERT INTO `test_play_log` VALUES (165, 146, 8, NULL, NULL, 'STOP', 'XRPUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 1.9100000000, '2026-01-28 09:45:02', 1.9100000000, 1.8975000000, NULL, -6.5445026178, -6.5445026178, 0.0000000000, '2026-01-28 09:45:02', '2026-01-28 10:27:29');
INSERT INTO `test_play_log` VALUES (166, 146, 6, NULL, NULL, 'STOP', 'BTCUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 89111.5000000000, '2026-01-28 11:45:01', 89111.6000000000, 88958.0000000000, NULL, -1.7236813165, -1.7236813165, 0.0000000000, '2026-01-28 11:45:01', '2026-01-28 12:31:29');
INSERT INTO `test_play_log` VALUES (167, 146, 8, NULL, NULL, 'STOP', 'XRPUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'BUY', 1.9000000000, '2026-01-28 10:35:02', 1.9000000000, 1.8972000000, NULL, -1.4736842105, -1.4736842105, 0.0000000000, '2026-01-28 10:35:02', '2026-01-28 12:31:32');
INSERT INTO `test_play_log` VALUES (168, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 3009.5600000000, '2026-01-28 15:10:01', 3009.5500000000, 3003.5100000000, NULL, 2.0069445598, 2.0069445598, 0.0000000000, '2026-01-28 15:10:02', '2026-01-28 15:41:24');
INSERT INTO `test_play_log` VALUES (169, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 3023.0100000000, '2026-01-28 19:20:01', 3023.0000000000, 3016.8000000000, NULL, 2.0509427721, 2.0509427721, 0.0000000000, '2026-01-28 19:20:01', '2026-01-28 20:12:28');
INSERT INTO `test_play_log` VALUES (170, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 3037.1700000000, '2026-01-28 21:00:11', 3037.1600000000, 3030.6000000000, NULL, 2.1599125499, 2.1599125499, 0.0000000000, '2026-01-28 21:00:11', '2026-01-28 21:02:28');
INSERT INTO `test_play_log` VALUES (171, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 3034.4400000000, '2026-01-28 22:20:01', 3034.4300000000, 3027.5400000000, NULL, 2.2706076594, 2.2706076594, 0.0000000000, '2026-01-28 22:20:02', '2026-01-28 23:07:33');
INSERT INTO `test_play_log` VALUES (172, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 3026.5200000000, '2026-01-29 02:55:02', 3026.5100000000, 3020.2000000000, NULL, 2.0849096814, 2.0849096814, 0.0000000000, '2026-01-29 02:55:02', '2026-01-29 02:56:00');
INSERT INTO `test_play_log` VALUES (173, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 3022.5000000000, '2026-01-29 05:10:02', 3022.4900000000, 3015.5000000000, NULL, 2.3126627383, 2.3126627383, 0.0000000000, '2026-01-29 05:10:02', '2026-01-29 05:18:29');
INSERT INTO `test_play_log` VALUES (174, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 3020.7900000000, '2026-01-29 05:35:02', 3020.7800000000, 3014.6000000000, NULL, 2.0458292229, 2.0458292229, 0.0000000000, '2026-01-29 05:35:02', '2026-01-29 05:37:30');
INSERT INTO `test_play_log` VALUES (175, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2960.1500000000, '2026-01-29 17:00:08', 2959.7200000000, 2953.7400000000, NULL, 2.0204613950, 2.0204613950, 0.0000000000, '2026-01-29 17:00:08', '2026-01-29 17:05:56');
INSERT INTO `test_play_log` VALUES (176, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2821.2200000000, '2026-01-30 06:50:01', 2821.2100000000, 2814.1200000000, NULL, 2.5131060786, 2.5131060786, 0.0000000000, '2026-01-30 06:50:02', '2026-01-30 07:13:02');
INSERT INTO `test_play_log` VALUES (177, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2818.7400000000, '2026-01-30 08:00:03', 2818.7300000000, 2813.0100000000, NULL, 2.0292826911, 2.0292826911, 0.0000000000, '2026-01-30 08:00:03', '2026-01-30 08:10:50');
INSERT INTO `test_play_log` VALUES (178, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2825.6300000000, '2026-01-30 08:40:01', 2825.6200000000, 2819.9100000000, NULL, 2.0207954360, 2.0207954360, 0.0000000000, '2026-01-30 08:40:01', '2026-01-30 09:13:29');
INSERT INTO `test_play_log` VALUES (179, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2761.8000000000, '2026-01-30 13:30:02', 2761.7900000000, 2755.7200000000, NULL, 2.1978499451, 2.1978499451, 0.0000000000, '2026-01-30 13:30:02', '2026-01-30 13:39:56');
INSERT INTO `test_play_log` VALUES (180, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2740.0000000000, '2026-01-30 20:25:00', 2739.9900000000, 2734.3200000000, NULL, 2.0693506181, 2.0693506181, 0.0000000000, '2026-01-30 20:25:01', '2026-01-30 22:04:33');
INSERT INTO `test_play_log` VALUES (181, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2758.1600000000, '2026-01-30 23:45:05', 2758.1500000000, 2750.1700000000, NULL, 2.8932436597, 2.8932436597, 0.0000000000, '2026-01-30 23:45:05', '2026-01-30 23:46:34');
INSERT INTO `test_play_log` VALUES (182, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2739.9300000000, '2026-01-31 04:00:04', 2739.9200000000, 2733.6400000000, NULL, 2.2920377237, 2.2920377237, 0.0000000000, '2026-01-31 04:00:04', '2026-01-31 04:42:17');
INSERT INTO `test_play_log` VALUES (183, 147, 2, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'SELL', 2403.1500000000, '2026-02-01 06:35:00', 2403.1400000000, 2427.2200000000, NULL, -10.0202235409, -10.0202235409, 0.0000000000, '2026-02-01 06:35:00', '2026-02-01 08:08:01');
INSERT INTO `test_play_log` VALUES (184, 147, 2, NULL, NULL, 'STOP', 'ETHUSDT', 'scalping', '5', 'Lose', 20.00, 50.00, 1000.0000000000, 'SELL', 2420.2800000000, '2026-02-01 08:15:00', 2420.2700000000, 2446.6300000000, NULL, -10.8913468332, -10.8913468332, 0.0000000000, '2026-02-01 08:15:01', '2026-02-01 08:21:52');
INSERT INTO `test_play_log` VALUES (185, 147, 2, NULL, NULL, 'PROFIT', 'ETHUSDT', 'scalping', '5', 'Win', 20.00, 50.00, 1000.0000000000, 'SELL', 2457.7500000000, '2026-02-01 08:35:00', 2457.7400000000, 2449.8400000000, NULL, 3.2143351209, 3.2143351209, 0.0000000000, '2026-02-01 08:35:01', '2026-02-01 08:38:10');

-- ----------------------------
-- Table structure for update_st
-- ----------------------------
DROP TABLE IF EXISTS `update_st`;
CREATE TABLE `update_st`  (
  `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  `st` char(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 2 CHARACTER SET = utf8mb3 COLLATE = utf8mb3_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of update_st
-- ----------------------------
INSERT INTO `update_st` VALUES (1, 'N');

SET FOREIGN_KEY_CHECKS = 1;
