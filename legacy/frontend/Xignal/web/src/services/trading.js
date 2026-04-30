import api from '../api';

export const trading = {
	candle(params, callback) {
		api.get('/admin/candle/data', {
			params
		}).then((res) => {
			callback(res);
		});
	},
	liveList(params, callback) {
		api.get('/admin/live/list', {
			params
		}).then((res) => {
			callback(res);
		});
	},
	testList(params, callback) {
		api.get('/admin/test/list', {
			params
		}).then((res) => {
			callback(res);
		});
	},
	livePrice(params, callback) {
		api.get('/admin/price', {
			params
		}).then((res) => {
			callback(res);
		});
	},
	performanceSummary(params, callback) {
		api.get('/admin/live/performance-summary', {
			params
		}).then((res) => {
			callback(res);
		}).catch((res) => {
			callback(res.response?.data || false);
		});
	},
	symbolRules(params, callback) {
		api.get('/admin/exchange/symbol-rules', {
			params
		}).then((res) => {
			callback(res);
		}).catch((res) => {
			callback(res.response?.data || { ok: false, rules: null });
		});
	},
	strategyCatalogOptions(params, callback) {
		api
			.get('/admin/trading/catalog-options', {
				params
			})
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	testDetail(params, callback) {
		api.get('/admin/test/detail', {
			params
		}).then((res) => {
			callback(res);
		});
	},
	liveDetail(params, callback) {
		api.get('/admin/live/detail', {
			params
		}).then((res) => {
			callback(res);
		});
	},
	// testDetail(params, callback) {
	// 	api.get('/admin/test/detail', {
	// 		params
	// 	}).then((res) => {
	// 		callback(res);
	// 	});
	// },
	liveDetailUpload(body, params, callback) {
		api.post('/admin/live/add', body, { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response.data.errors[0]);
			});
	},
	liveDetailEdit(body, params, callback) {
		api.post('/admin/live/edit', body, { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response.data.errors[0]);
			});
	},
	testDetailUpload(body, params, callback) {
		api.post('/admin/test/add', body, { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response.data.errors[0]);
			});
	},
	testDetailEdit(body, params, callback) {
		api.post('/admin/test/edit', body, { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response.data.errors[0]);
			});
	},
	// liveSelectItem(body, params, callback) {
	// 	api.post('/admin/live/select', body, { params }).then((res) => {
	// 		callback(res);
	// 	});
	// },
	// testSelectItem(body, params, callback) {
	// 	api.post('/admin/test/select', body, { params }).then((res) => {
	// 		callback(res);
	// 	});
	// },
	liveAutoItem(body, params, callback) {
		api.post('/admin/live/auto', body, { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response.data.errors[0]);
			});
	},
	testAutoItem(body, params, callback) {
		api.post('/admin/test/auto', body, { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response.data.errors[0]);
			});
	},
	gridLiveList(params, callback) {
		api.get('/admin/grid/live/list', {
			params
		}).then((res) => {
			callback(res);
		});
	},
	gridTestList(params, callback) {
		api.get('/admin/grid/test/list', {
			params
		}).then((res) => {
			callback(res);
		});
	},
	gridLiveDetail(params, callback) {
		api.get('/admin/grid/live/detail', {
			params
		}).then((res) => {
			callback(res);
		});
	},
	gridTestDetail(params, callback) {
		api.get('/admin/grid/test/detail', {
			params
		}).then((res) => {
			callback(res);
		});
	},
	gridLiveDetailUpload(body, params, callback) {
		api.post('/admin/grid/live/add', body, { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data?.errors?.[0] || false);
			});
	},
	gridLiveDetailEdit(body, params, callback) {
		api.post('/admin/grid/live/edit', body, { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data?.errors?.[0] || false);
			});
	},
	gridTestDetailUpload(body, params, callback) {
		api.post('/admin/grid/test/add', body, { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data?.errors?.[0] || false);
			});
	},
	gridTestDetailEdit(body, params, callback) {
		api.post('/admin/grid/test/edit', body, { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data?.errors?.[0] || false);
			});
	},
	gridLiveAutoItem(body, params, callback) {
		api.post('/admin/grid/live/auto', body, { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data?.errors?.[0] || false);
			});
	},
	gridTestAutoItem(body, params, callback) {
		api.post('/admin/grid/test/auto', body, { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data?.errors?.[0] || false);
			});
	},
	deleteLivePlayItems(body, params, callback) {
		api.post('/admin/live/del', body, { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data?.errors?.[0] || false);
			});
	},
	deleteTestPlayItems(body, params, callback) {
		api.post('/admin/test/del', body, { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data?.errors?.[0] || false);
			});
	},
	gridLiveDeleteItem(body, params, callback) {
		api.post('/admin/grid/live/del', body, { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data?.errors?.[0] || false);
			});
	},
	gridTestDeleteItem(body, params, callback) {
		api.post('/admin/grid/test/del', body, { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data?.errors?.[0] || false);
			});
	},
	deletePlayItems(body, params, callback) {
		api.post('/admin/play/del', body, { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data?.errors?.[0] || false);
			});
	},
	msg(params, callback) {
		api.get('/admin/msg', {
			params
		}).then((res) => {
			callback(res);
		});
	},
	userFacingMessages(params, callback) {
		api.get('/admin/msg/user-facing', {
			params
		}).then((res) => {
			callback(res);
		}).catch((res) => {
			callback(res.response?.data || []);
		});
	},
	liveRate(callback) {
		api.get('/admin/live/detail/rate')
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data.errors[0]);
			});
	},
	getTrackRecordDetail(params, callback) {
		api.get('admin/live/result/item', {
			params
		}).then((res) => {
			callback(res);
		});
	},
	getTrackRecord(params, callback) {
		api.get('admin/live/result/all', {
			params
		}).then((res) => {
			callback(res);
		});
	},
	getRuntimeTrackRecord(params, callback) {
		api.get('/admin/live/track-record/runtime/recent', {
			params
		}).then((res) => {
			callback(res);
		}).catch((res) => {
			callback(res.response?.data || false);
		});
	},
	getRuntimeTrackRecordItem(params, callback) {
		api.get('/admin/live/track-record/runtime/item', {
			params
		}).then((res) => {
			callback(res);
		}).catch((res) => {
			callback(res.response?.data || false);
		});
	},
	getTestRuntimeTrackRecord(params, callback) {
		api.get('/admin/test/track-record/runtime/recent', {
			params
		}).then((res) => {
			callback(res);
		}).catch((res) => {
			callback(res.response?.data || false);
		});
	},
	getTestRuntimeTrackRecordItem(params, callback) {
		api.get('/admin/test/track-record/runtime/item', {
			params
		}).then((res) => {
			callback(res);
		}).catch((res) => {
			callback(res.response?.data || false);
		});
	},
	getExactTrackRecord(callback) {
		api.get('admin/live/result/exact/all').then((res) => {
			callback(res);
		});
	},
	getTestTrackRecordDetail(params, callback) {
		api.get('admin/test/result/item', {
			params
		}).then((res) => {
			callback(res);
		});
	},
	getTestTrackRecord(params, callback) {
		api.get('admin/test/result/all', {
			params
		}).then((res) => {
			callback(res);
		});
	},
	getTestExactTrackRecord(params, callback) {
		api.get('admin/test/result/exact/all').then((res) => {
			callback(res);
		});
	},
	testRate(callback) {
		api.get('/admin/test/detail/rate')
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data.errors[0]);
			});
	},
	searchTrackRecordByName(params, callback) {
		api.get('admin/live/result/name').then((res) => {
			callback(res);
		});
	},
	searchTestTrackRecordByName(params, callback) {
		api.get('admin/test/result/name').then((res) => {
			callback(res);
		});
	},
	liveDetailRate(params, callback) {
		api.get('/admin/live/detail/item/rate', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data.errors[0]);
			});
	},
	testDetailRate(params, callback) {
		api.get('/admin/test/detail/item/rate', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data.errors[0]);
			});
	},
	getBacktestStats(params, callback) {
		api.get('/admin/backtest/stats', { params })
			.then((res) => {
				callback(res);
			})
			.catch((res) => {
				callback(res.response?.data || false);
			});
	},
	getTrending(params, callback) {
		// Mock: fetch from public/mock/trending.json
		// 나중에 api.get('/admin/trending', { params })로 교체
		fetch('/mock/trending.json')
			.then(res => res.json())
			.then(data => callback(data))
			.catch(() => callback([]));
	}
	// entryDetail(params, callback) {
	// 	api.get('/admin/live/detail/log', {
	// 		params
	// 	}).then((res) => {
	// 		callback(res);
	// 	});
	// },
	// testEntryDetail(params, callback) {
	// 	api.get('/admin/test/detail/log', {
	// 		params
	// 	}).then((res) => {
	// 		callback(res);
	// 	});
	// },
	// entryDetailTopData(params, callback) {
	// 	api.get('/admin/live/detail', {
	// 		params
	// 	}).then((res) => {
	// 		callback(res);
	// 	});
	// },
	// testEntryDetailTopData(params, callback) {
	// 	api.get('/admin/test/detail', {
	// 		params
	// 	}).then((res) => {
	// 		callback(res);
	// 	});
	// },
	// history(params, callback) {
	// 	api.get('/admin/live/result', {
	// 		params
	// 	}).then((res) => {
	// 		callback(res);
	// 	});
	// },
	// testHistory(params, callback) {
	// 	api.get('/admin/test/result', {
	// 		params
	// 	}).then((res) => {
	// 		callback(res);
	// 	});
	// },
	// historyDetail(params, callback) {
	// 	api.get('/admin/live/result/detail', {
	// 		params
	// 	}).then((res) => {
	// 		callback(res);
	// 	});
	// },
	// testHistoryDetail(params, callback) {
	// 	api.get('/admin/test/result/detail', {
	// 		params
	// 	}).then((res) => {
	// 		callback(res);
	// 	});
	// },
	// msg(params, callback) {
	// 	api.get('/admin/msg', {
	// 		params
	// 	}).then((res) => {
	// 		callback(res);
	// 	});
	// },
	// msgDetail(params, callback) {
	// 	api.get('/admin/msg/item', {
	// 		params
	// 	}).then((res) => {
	// 		callback(res);
	// 	});
	// },
	// errorMsg(callback) {
	// 	api.get('/admin/msg/alert').then((res) => {
	// 		callback(res);
	// 	});
	// },
};
