// Stands in for api.apifirme.dev in the dev stack: answers a few addresses as
// the API does and notes every request (never the key's value).
const http = require('http');
const seen = [];

http
	.createServer((req, res) => {
		const url = new URL(req.url, 'http://stub');
		const send = (status, body, headers = {}) => {
			res.writeHead(status, { 'content-type': 'application/json', ...headers });
			res.end(JSON.stringify(body));
		};

		if (url.pathname === '/seen') return send(200, seen);

		seen.push({
			method: req.method,
			path: url.pathname + url.search,
			auth: /^Bearer af_live_/.test(req.headers.authorization || '') ? 'sent' : 'missing',
			client: req.headers['x-apifirme-client'] || null,
		});

		if (url.pathname === '/rest/v1/companies/13548146') return send(200, { cui: 13548146, denumire: 'Dante International SA', scp_tva: true }, { 'x-quota-remaining': '87' });
		if (url.pathname === '/rest/v1/watchlist/events') return send(200, { data: [{ cui: 13548146, denumire: 'Dante International SA', type: 'vat_deregistered', detected_on: '2026-11-22' }], next_cursor: 'c1', more: false });
		if (url.pathname === '/rest/v1/watchlist') return send(200, { watched: 1, active: 1, capacity: 500, data: [{ cui: 13548146, denumire: 'Dante International SA', added_on: '2026-11-23', active: true }], more: false });

		send(404, { type: 'https://apifirme.dev/problems/company-not-found', title: 'Company not found', status: 404, detail: 'No taxpayer is registered under this CUI.' });
	})
	.listen(8080, () => console.log('stub listening'));
