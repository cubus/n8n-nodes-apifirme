// The node's own logic against a stand-in for n8n's context and for the API:
// `npm run build && npm test`. What n8n itself does (the credentials'
// header, the polling schedule) is not tried here.
const assert = require('assert');
const { readCui } = require('../dist/nodes/Apifirme/shared');
const { Apifirme } = require('../dist/nodes/Apifirme/Apifirme.node');
const { ApifirmeTrigger } = require('../dist/nodes/Apifirme/ApifirmeTrigger.node');

let passed = 0;
const tests = [];
const test = (name, run) => tests.push({ name, run });

// A context as n8n hands one to a node: `parameters` per item, `answers` in
// the order the API is asked, every request noted.
function context({ parameters = [{}], answers = [], mode = 'trigger', state = {}, continueOnFail = false }) {
	const requests = [];
	const ctx = {
		requests,
		state,
		getInputData: () => parameters.map(() => ({ json: {} })),
		getNodeParameter: (name, i, fallback) => {
			const item = parameters[typeof i === 'number' ? i : 0];
			const given = typeof i === 'number' ? fallback : i;
			return name in item ? item[name] : given;
		},
		getCredentials: async () => ({ apiKey: 'af_live_test', baseUrl: 'https://api.example.test/' }),
		getNode: () => ({ name: 'apifirme', type: 'apifirme', typeVersion: 1, position: [0, 0], parameters: {} }),
		getMode: () => mode,
		getWorkflowStaticData: () => state,
		continueOnFail: () => continueOnFail,
		helpers: {
			returnJsonArray: (items) => items.map((json) => ({ json })),
			httpRequestWithAuthentication: async function (credential, options) {
				requests.push({ credential, ...options });
				const answer = answers.shift();
				if (!answer) throw new Error('asked more often than the test expected: ' + options.url);
				return { statusCode: answer[0], body: answer[1], headers: answer[2] || {} };
			},
		},
	};
	return ctx;
}

const run = async (ctx) => (await new Apifirme().execute.call(ctx))[0].map((item) => item.json);
const poll = async (ctx) => {
	const out = await new ApifirmeTrigger().poll.call(ctx);
	return out === null ? null : out[0].map((item) => item.json);
};

test('a CUI is read as people write it, and checked before anything is sent', () => {
	for (const cui of [19, 27, 132, 1570, 13548146, 4221306, 14399840, 48000005, 490001232, 1234567897, 9999999994]) {
		assert.deepStrictEqual(readCui(String(cui)), { cui });
		const other = Math.floor(cui / 10) * 10 + ((cui % 10) + 1) % 10;
		assert.deepStrictEqual(readCui(String(other)), { problem: 'invalid' });
	}
	assert.deepStrictEqual(readCui(' ro 135 48146 '), { cui: 13548146 });
	// A no-break space and a narrow one, written out: a spreadsheet's cell has them.
	assert.deepStrictEqual(readCui('RO\u00a0135\u202f48146'), { cui: 13548146 });
	assert.deepStrictEqual(readCui(13548146), { cui: 13548146 });
	assert.deepStrictEqual(readCui(''), { problem: 'empty' });
	assert.deepStrictEqual(readCui('013548146'), { problem: 'invalid' });
	assert.deepStrictEqual(readCui(['13548146']), { problem: 'invalid' });
	assert.deepStrictEqual(readCui('1850101123456'), { problem: 'personal' });
	assert.deepStrictEqual(readCui('RO 185 0101 123456'), { problem: 'personal' });
});

test('a company by its CUI', async () => {
	const ctx = context({
		parameters: [{ resource: 'company', operation: 'get', cui: 'RO13548146' }],
		answers: [[200, { cui: 13548146, denumire: 'Dante International SA' }]],
	});
	assert.deepStrictEqual(await run(ctx), [{ cui: 13548146, denumire: 'Dante International SA' }]);
	assert.strictEqual(ctx.requests[0].url, 'https://api.example.test/rest/v1/companies/13548146');
	assert.strictEqual(ctx.requests[0].method, 'GET');
	assert.strictEqual(ctx.requests[0].credential, 'apifirmeApi');
});

test('what is no CUI makes no request; a personal number is said to be one', async () => {
	for (const [cui, words] of [['13548147', /not a valid CUI/], ['1850101123456', /personal identity number/], ['', /A CUI is needed/]]) {
		const ctx = context({ parameters: [{ resource: 'company', operation: 'get', cui }] });
		await assert.rejects(run(ctx), words);
		assert.strictEqual(ctx.requests.length, 0);
	}
});

test('a company still being fetched is asked again; a refusal is told in the API\'s words', async () => {
	const ctx = context({
		parameters: [{ resource: 'company', operation: 'invoiceCheck', cui: '4221306' }],
		answers: [[202, { status: 'pending', retry_after: 1 }, { 'retry-after': '1' }], [200, { exists: true }]],
	});
	assert.deepStrictEqual(await run(ctx), [{ exists: true }]);
	assert.strictEqual(ctx.requests.length, 2);

	const refused = context({
		parameters: [{ resource: 'company', operation: 'get', cui: '4221306' }],
		answers: [[429, { title: 'Monthly quota used up', detail: 'The Starter plan includes 12,000 requests per month.', upgrade_url: 'https://apifirme.dev/en/preturi' }]],
	});
	await assert.rejects(run(refused), /Monthly quota used up: The Starter plan/);
});

test('one failing item does not stop the others where the workflow says so', async () => {
	const ctx = context({
		parameters: [{ resource: 'company', operation: 'get', cui: 'nimic' }, { resource: 'company', operation: 'get', cui: '19' }],
		answers: [[200, { cui: 19 }]],
		continueOnFail: true,
	});
	const out = await run(ctx);
	assert.match(out[0].error, /not a valid CUI/);
	assert.deepStrictEqual(out[1], { cui: 19 });
});

test('many companies in one request, each once', async () => {
	const ctx = context({
		parameters: [{ resource: 'company', operation: 'batch', cuis: '13548146, RO4221306\n13548146' }],
		answers: [[200, { data: [{ cui: 13548146 }, { cui: 4221306 }], not_stored: [], incomplete: [], invalid: [] }]],
	});
	assert.deepStrictEqual(await run(ctx), [{ cui: 13548146 }, { cui: 4221306 }]);
	assert.strictEqual(ctx.requests[0].method, 'POST');
	assert.deepStrictEqual(ctx.requests[0].body, { cuis: [13548146, 4221306] });
});

test('the watch list: added to, read a page at a time, taken from', async () => {
	const add = context({
		parameters: [{ resource: 'watchlist', operation: 'add', cuis: ['13548146', 4221306] }],
		answers: [[200, { added: [13548146, 4221306], already: [], not_stored: [], invalid: 0, watched: 2 }]],
	});
	assert.strictEqual((await run(add))[0].watched, 2);
	assert.deepStrictEqual(add.requests[0].body, { cuis: [13548146, 4221306] });

	const list = context({
		parameters: [{ resource: 'watchlist', operation: 'list', limit: 3 }],
		answers: [
			[200, { data: [{ cui: 19 }, { cui: 27 }], more: true }],
			[200, { data: [{ cui: 132 }], more: false }],
		],
	});
	assert.deepStrictEqual(await run(list), [{ cui: 19 }, { cui: 27 }, { cui: 132 }]);
	assert.deepStrictEqual(list.requests.map((r) => r.qs), [{ limit: 3 }, { limit: 1, after: 27 }]);

	const remove = context({
		parameters: [{ resource: 'watchlist', operation: 'remove', cui: '19' }],
		answers: [[200, { cui: 19, removed: true }]],
	});
	assert.deepStrictEqual(await run(remove), [{ cui: 19, removed: true }]);
	assert.strictEqual(remove.requests[0].method, 'DELETE');
	assert.strictEqual(remove.requests[0].url, 'https://api.example.test/rest/v1/watchlist/19');
});

test('exchange rates: the latest, or a day\'s, written as a day', async () => {
	// The API's answer as it is (seen against the real API on 2026-11-24): every
	// currency of the day, and no parameter that picks one.
	const day = {
		date: '2026-09-27',
		base: 'RON',
		source: { source: 'bnr_fx' },
		rates: { EUR: { rate: 5.3447, multiplier: 1 }, HUF: { rate: 1.4526, multiplier: 100 } },
		effective_date: '2026-09-25',
	};

	const all = context({ parameters: [{ resource: 'fx', operation: 'get' }], answers: [[200, day]] });
	assert.deepStrictEqual(await run(all), [day]);
	assert.strictEqual(all.requests[0].url, 'https://api.example.test/rest/v1/fx/latest');
	assert.deepStrictEqual(all.requests[0].qs, {});

	// One currency: picked from the answer, nothing of it sent.
	const one = context({ parameters: [{ resource: 'fx', operation: 'get', date: '2026-09-27', currency: 'huf' }], answers: [[200, day]] });
	assert.deepStrictEqual(await run(one), [
		{ date: '2026-09-27', base: 'RON', source: { source: 'bnr_fx' }, effective_date: '2026-09-25', currency: 'HUF', rate: 1.4526, multiplier: 100 },
	]);
	assert.strictEqual(one.requests[0].url, 'https://api.example.test/rest/v1/fx/2026-09-27');
	assert.deepStrictEqual(one.requests[0].qs, {});

	await assert.rejects(run(context({ parameters: [{ resource: 'fx', operation: 'get', currency: 'XXX' }], answers: [[200, day]] })), /no reference rate for XXX/);
	await assert.rejects(run(context({ parameters: [{ resource: 'fx', operation: 'get', currency: 'euro' }] })), /three letters/);
	await assert.rejects(run(context({ parameters: [{ resource: 'fx', operation: 'get', date: '2.10.2026' }] })), /YYYY-MM-DD/);
});

test('the trigger for changes: goes on from where it stopped, and a test run keeps no position', async () => {
	const state = {};
	const first = context({
		parameters: [{ event: 'watchedChange' }],
		state,
		answers: [
			[200, { data: [{ cui: 19, type: 'vat_deregistered' }], next_cursor: 'c1', more: true }],
			[200, { data: [{ cui: 27, type: 'inactivated' }], next_cursor: 'c2', more: false }],
		],
	});
	assert.deepStrictEqual(await poll(first), [{ cui: 19, type: 'vat_deregistered' }, { cui: 27, type: 'inactivated' }]);
	assert.deepStrictEqual(first.requests.map((r) => r.qs), [{ limit: 100 }, { limit: 100, after: 'c1' }]);
	assert.strictEqual(state.cursor, 'c2');

	const nothing = context({ parameters: [{ event: 'watchedChange' }], state, answers: [[200, { data: [], next_cursor: 'c2', more: false }]] });
	assert.strictEqual(await poll(nothing), null);
	assert.deepStrictEqual(nothing.requests[0].qs, { limit: 100, after: 'c2' });

	const manual = context({ parameters: [{ event: 'watchedChange' }], state, mode: 'manual', answers: [[200, { data: [{ cui: 132 }], next_cursor: 'c9', more: true }]] });
	assert.deepStrictEqual(await poll(manual), [{ cui: 132 }]);
	// From the list's beginning, not from the kept position, and that stays.
	assert.deepStrictEqual(manual.requests[0].qs, { limit: 5 });
	assert.strictEqual(state.cursor, 'c2');
});

test('the trigger for new companies: the first run only finds the end, the next bring what came since', async () => {
	const state = {};
	const first = context({
		parameters: [{ event: 'newCompany', filters: { judet: 'SB', caen_prefix: '' } }],
		state,
		answers: [
			[200, { data: [{ cui: 19 }], next_cursor: 'r1', more: true }],
			[200, { data: [{ cui: 27 }], next_cursor: 'r2', more: false }],
		],
	});
	assert.strictEqual(await poll(first), null);
	assert.deepStrictEqual(first.requests.map((r) => r.qs), [{ judet: 'SB', days: 1, limit: 500 }, { judet: 'SB', days: 1, limit: 500, cursor: 'r1' }]);
	assert.strictEqual(state.cursor, 'r2');

	const next = context({ parameters: [{ event: 'newCompany', filters: { judet: 'SB' } }], state, answers: [[200, { data: [{ cui: 132 }], next_cursor: 'r3', more: false }]] });
	assert.deepStrictEqual(await poll(next), [{ cui: 132 }]);
	assert.deepStrictEqual(next.requests[0].qs, { judet: 'SB', days: 7, limit: 500, cursor: 'r2' });
	assert.strictEqual(state.cursor, 'r3');

	const refused = context({ parameters: [{ event: 'newCompany' }], state, answers: [[403, { title: 'Not included in this plan', detail: 'The list comes with the Plus plan.' }]] });
	await assert.rejects(poll(refused), /Not included in this plan/);
	assert.strictEqual(state.cursor, 'r3');
});

test('another event than the kept position was for starts again', async () => {
	const state = { cursor: 'r3', event: 'newCompany' };
	const ctx = context({ parameters: [{ event: 'watchedChange' }], state, answers: [[200, { data: [], next_cursor: 'c0', more: false }]] });
	await poll(ctx);
	assert.deepStrictEqual(ctx.requests[0].qs, { limit: 100 });
	assert.deepStrictEqual(state, { cursor: 'c0', event: 'watchedChange' });
});

(async () => {
	let failed = 0;
	for (const { name, run } of tests) {
		try {
			await run();
			passed++;
		} catch (error) {
			failed++;
			console.log('FAILED: ' + name + '\n  ' + String(error.message).split('\n').join('\n  '));
		}
	}
	console.log(`${passed} passed, ${failed} failed`);
	process.exit(failed > 0 ? 1 : 0);
})();
