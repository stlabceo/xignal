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
	msg(params, callback) {
		api.get('/admin/msg', {
			params
		}).then((res) => {
			callback(res);
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
	// line(params, callback) {
	// 	api.get('admin/zzar/line', {
	// 		params
	// 	}).then((res) => {
	// 		callback(res);
	// 	});
	// },
	// lineDataSave(body, callback) {
	// 	api.post('admin/zzar/line', body).then((res) => {
	// 		callback(res);
	// 	});
	// }
};
