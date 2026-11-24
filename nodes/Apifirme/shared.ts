import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeOperationError, sleep } from 'n8n-workflow';

type Context = IExecuteFunctions | IPollFunctions;

const WEIGHTS = [7, 5, 3, 2, 1, 7, 5, 3, 2];

/** Whether the number's last digit is the check digit of the others. */
export function validCui(cui: number): boolean {
	if (!Number.isSafeInteger(cui) || cui < 10 || cui > 9999999999) return false;

	const check = cui % 10;
	const digits = String(Math.floor(cui / 10)).padStart(9, '0');
	const sum = WEIGHTS.reduce((total, weight, i) => total + weight * Number(digits[i]), 0);
	const expected = (sum * 10) % 11;

	return (expected === 10 ? 0 : expected) === check;
}

/**
 * Reads a CUI as people write it (blanks, an RO in front), before anything
 * is sent: what is no CUI costs no request, and a thirteen-digit number is a
 * personal identity number, which goes nowhere.
 */
export function readCui(raw: unknown): { cui: number } | { problem: 'empty' | 'personal' | 'invalid' } {
	if (typeof raw !== 'string' && typeof raw !== 'number') return { problem: 'invalid' };

	let text = String(raw).replace(/\s+/g, '').toUpperCase();
	if (text === '') return { problem: 'empty' };
	if (text.startsWith('RO')) text = text.slice(2);
	if (/^\d{13}$/.test(text)) return { problem: 'personal' };
	if (!/^[1-9]\d{1,9}$/.test(text) || !validCui(Number(text))) return { problem: 'invalid' };

	return { cui: Number(text) };
}

/** The CUI of an item's parameter, or an error that says what is wrong with it. */
export function cuiOf(context: Context, raw: unknown, itemIndex?: number): number {
	const read = readCui(raw);
	if ('cui' in read) return read.cui;

	const message =
		read.problem === 'personal'
			? 'This is a 13-digit personal identity number (CNP), not a company\'s CUI. It was not sent anywhere.'
			: read.problem === 'empty'
				? 'A CUI is needed.'
				: 'This is not a valid CUI: it consists of 2 to 10 digits, optionally after RO, and ends in a check digit.';

	throw new NodeOperationError(context.getNode(), message, { itemIndex });
}

/** CUIs from a list, or a text with commas, blanks or lines between them. */
export function cuisOf(context: Context, raw: unknown, itemIndex?: number): number[] {
	const pieces = Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,;]+/);
	const cuis = pieces.filter((piece) => String(piece).trim() !== '').map((piece) => cuiOf(context, piece, itemIndex));

	if (cuis.length === 0) throw new NodeOperationError(context.getNode(), 'At least one CUI is needed.', { itemIndex });

	return [...new Set(cuis)];
}

export interface Answer {
	status: number;
	body: IDataObject;
	headers: IDataObject;
}

/** One request to the API with the node's credentials. Never throws for a status. */
export async function ask(
	context: Context,
	method: IHttpRequestMethods,
	path: string,
	qs: IDataObject = {},
	body?: IDataObject,
): Promise<Answer> {
	const credentials = await context.getCredentials('apifirmeApi');
	const base = String(credentials.baseUrl || 'https://api.apifirme.dev').replace(/\/+$/, '');

	const options: IHttpRequestOptions = {
		method,
		url: base + path,
		qs,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};

	if (body !== undefined) options.body = body;

	const response = (await context.helpers.httpRequestWithAuthentication.call(context, 'apifirmeApi', options)) as {
		statusCode: number;
		body: unknown;
		headers: IDataObject;
	};

	return {
		status: response.statusCode,
		body: typeof response.body === 'object' && response.body !== null ? (response.body as IDataObject) : {},
		headers: response.headers ?? {},
	};
}

/**
 * A request whose answer is the data: `202` (the company is being fetched)
 * is asked again as the API says, a refusal becomes an error in the API's
 * own words.
 */
export async function get(
	context: Context,
	method: IHttpRequestMethods,
	path: string,
	qs: IDataObject = {},
	body?: IDataObject,
	itemIndex?: number,
): Promise<IDataObject> {
	for (let attempt = 0; ; attempt++) {
		const answer = await ask(context, method, path, qs, body);

		if (answer.status >= 200 && answer.status < 300 && answer.status !== 202) return answer.body;

		if (answer.status === 202 && attempt < 3) {
			const after = Number(answer.headers['retry-after'] ?? answer.body.retry_after ?? 2);
			await sleep(Math.min(Math.max(after, 1), 10) * 1000);
			continue;
		}

		const said =
			answer.status === 202
				? 'The company is still being fetched from ANAF. Try again in a few seconds.'
				: [answer.body.title, answer.body.detail].filter(Boolean).join(': ') || `The API answered ${answer.status}.`;

		throw new NodeOperationError(context.getNode(), said, {
			itemIndex,
			description: typeof answer.body.upgrade_url === 'string' ? `Plans: ${answer.body.upgrade_url}` : undefined,
		});
	}
}
