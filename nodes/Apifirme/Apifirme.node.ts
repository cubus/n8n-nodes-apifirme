import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { cuiOf, cuisOf, get } from './shared';

const cui: INodeProperties = {
	displayName: 'CUI',
	name: 'cui',
	type: 'string',
	default: '',
	required: true,
	placeholder: '13548146',
	description: 'The company\'s fiscal code (CUI / CIF), with or without RO',
};

const show = (resource: string, operation: string[]) => ({ show: { resource: [resource], operation } });

export class Apifirme implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'apifirme',
		name: 'apifirme',
		icon: { light: 'file:apifirme.svg', dark: 'file:apifirme.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Romanian company data from the official registers (ANAF, ONRC, Ministry of Finance, BNR)',
		defaults: { name: 'apifirme' },
		// Every operation but two reads; an assistant's agent may use the node.
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'apifirmeApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Company', value: 'company' },
					{ name: 'Watch List', value: 'watchlist' },
					{ name: 'New Company', value: 'registration' },
					{ name: 'Exchange Rate', value: 'fx' },
				],
				default: 'company',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['company'] } },
				options: [
					{ name: 'Check Before Invoicing', value: 'invoiceCheck', action: 'Check a company before invoicing', description: 'Exists, VAT, VAT on collection, inactive, e-Factura' },
					{ name: 'Find', value: 'find', action: 'Find a company without its CUI', description: 'By name or trade register number; at most 10' },
					{ name: 'Get', value: 'get', action: 'Get a company', description: 'Name, register number, address, status, CAEN, VAT' },
					{ name: 'Get Changes', value: 'events', action: 'Get what changed at a company' },
					{ name: 'Get Financial Statements', value: 'financials', action: 'Get the financial statements of a company' },
					{ name: 'Get Many', value: 'batch', action: 'Get many companies', description: 'Up to 100 CUIs in one request; each company returned counts as a request' },
				],
				default: 'get',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['watchlist'] } },
				options: [
					{ name: 'Add', value: 'add', action: 'Add companies to the watch list' },
					{ name: 'Get Many', value: 'list', action: 'Get the watched companies' },
					{ name: 'Remove', value: 'remove', action: 'Remove a company from the watch list' },
				],
				default: 'list',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['registration'] } },
				options: [
					{ name: 'Count', value: 'count', action: 'Count newly registered companies', description: 'Included in every plan' },
					{ name: 'Get Many', value: 'list', action: 'Get newly registered companies', description: 'On the plans that include the list' },
				],
				default: 'count',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['fx'] } },
				options: [{ name: 'Get', value: 'get', action: 'Get the BNR reference exchange rates' }],
				default: 'get',
			},

			{ ...cui, displayOptions: show('company', ['get', 'invoiceCheck', 'events', 'financials']) },
			{ ...cui, displayOptions: show('watchlist', ['remove']) },
			{
				displayName: 'Year',
				name: 'year',
				type: 'number',
				default: 0,
				description: 'The financial year, for example 2025. 0 for all years.',
				displayOptions: show('company', ['financials']),
			},
			{
				displayName: 'Search By',
				name: 'searchBy',
				type: 'options',
				options: [
					{ name: 'Name', value: 'denumire' },
					{ name: 'Trade Register Number', value: 'nr_reg_com' },
				],
				default: 'denumire',
				displayOptions: show('company', ['find']),
			},
			{
				displayName: 'Text',
				name: 'query',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'Dedeman',
				description: 'The name or a part of it, or the register number (J32/508/2000)',
				displayOptions: show('company', ['find']),
			},
			{
				displayName: 'County',
				name: 'judet',
				type: 'string',
				default: '',
				placeholder: 'SB',
				description: 'With a name only: the county\'s code as on number plates (B for Bucharest)',
				displayOptions: show('company', ['find']),
			},
			{
				displayName: 'CUIs',
				name: 'cuis',
				type: 'string',
				default: '',
				required: true,
				placeholder: '13548146, 4221306',
				description: 'CUIs with commas, blanks or lines between them, or a list',
				displayOptions: { show: { resource: ['company', 'watchlist'], operation: ['batch', 'add'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['watchlist', 'registration'], operation: ['list'] } },
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { resource: ['registration'] } },
				options: [
					{ displayName: 'Activity Code Begins With', name: 'caen_prefix', type: 'string', default: '', placeholder: '62', description: 'The first two or three digits of the CAEN code' },
					{ displayName: 'Counties', name: 'judet', type: 'string', default: '', placeholder: 'SB,B', description: 'County codes with commas between them' },
					{ displayName: 'Registered In The Last Days', name: 'days', type: 'number', default: 7 },
					{
						displayName: 'Kind',
						name: 'persoana_fizica',
						type: 'options',
						options: [
							{ name: 'Companies Only (Legal Persons)', value: 'false' },
							{ name: 'Sole Traders Only (Natural Persons)', value: 'true' },
						],
						default: 'false',
					},
				],
			},
			{
				displayName: 'Date',
				name: 'date',
				type: 'string',
				default: '',
				placeholder: '2026-10-02',
				description: 'The day as YYYY-MM-DD. Empty for the latest published rates.',
				displayOptions: show('fx', ['get']),
			},
			{
				displayName: 'Currency',
				name: 'currency',
				type: 'string',
				default: '',
				placeholder: 'EUR',
				description: 'Empty for all currencies',
				displayOptions: show('fx', ['get']),
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const results = await run.call(this, resource, operation, i);

				for (const json of results) out.push({ json, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}

				// An error of the node's own passes as it is; anything else is told as the node's.
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [out];
	}
}

/** The answers of one item: one object, or the entries of a list. */
async function run(this: IExecuteFunctions, resource: string, operation: string, i: number): Promise<IDataObject[]> {
	const one = async (path: string, qs: IDataObject = {}) => [await get(this, 'GET', path, qs, undefined, i)];
	const listOf = (answer: IDataObject, key: string) => (Array.isArray(answer[key]) ? (answer[key] as IDataObject[]) : []);

	if (resource === 'company') {
		if (operation === 'find') {
			const qs: IDataObject = { [this.getNodeParameter('searchBy', i) as string]: this.getNodeParameter('query', i) };
			const judet = this.getNodeParameter('judet', i, '') as string;
			if (judet !== '' && qs.denumire !== undefined) qs.judet = judet;

			return listOf(await get(this, 'GET', '/rest/v1/companies/search', qs, undefined, i), 'data');
		}

		if (operation === 'batch') {
			const cuis = cuisOf(this, this.getNodeParameter('cuis', i), i);
			if (cuis.length > 100) throw new NodeOperationError(this.getNode(), 'At most 100 CUIs in one request.', { itemIndex: i });

			return listOf(await get(this, 'POST', '/rest/v1/companies/batch', {}, { cuis }, i), 'data');
		}

		const cui = cuiOf(this, this.getNodeParameter('cui', i), i);

		if (operation === 'get') return one(`/rest/v1/companies/${cui}`);
		if (operation === 'invoiceCheck') return one(`/rest/v1/invoice-check/${cui}`);
		if (operation === 'events') return listOf(await get(this, 'GET', `/rest/v1/companies/${cui}/events`, {}, undefined, i), 'events');

		if (operation === 'financials') {
			const year = this.getNodeParameter('year', i, 0) as number;
			if (year > 0) return one(`/rest/v1/companies/${cui}/financials/${year}`);

			return listOf(await get(this, 'GET', `/rest/v1/companies/${cui}/financials`, {}, undefined, i), 'financials');
		}
	}

	if (resource === 'watchlist') {
		if (operation === 'add') {
			const cuis = cuisOf(this, this.getNodeParameter('cuis', i), i);
			return [await get(this, 'POST', '/rest/v1/watchlist', {}, { cuis }, i)];
		}

		if (operation === 'remove') {
			const cui = cuiOf(this, this.getNodeParameter('cui', i), i);
			return [await get(this, 'DELETE', `/rest/v1/watchlist/${cui}`, {}, undefined, i)];
		}

		if (operation === 'list') {
			const limit = this.getNodeParameter('limit', i, 50) as number;
			const entries: IDataObject[] = [];
			let after: number | undefined;

			// By CUI, a page at a time, until the limit or the end.
			while (entries.length < limit) {
				const qs: IDataObject = { limit: Math.min(limit - entries.length, 1000) };
				if (after !== undefined) qs.after = after;

				const page = await get(this, 'GET', '/rest/v1/watchlist', qs, undefined, i);
				const data = listOf(page, 'data');
				entries.push(...data);

				if (page.more !== true || data.length === 0) break;
				after = data[data.length - 1].cui as number;
			}

			return entries;
		}
	}

	if (resource === 'registration') {
		const qs: IDataObject = { ...(this.getNodeParameter('filters', i, {}) as IDataObject) };
		for (const key of Object.keys(qs)) if (qs[key] === '') delete qs[key];

		if (operation === 'count') return one('/rest/v1/registrations/count', qs);

		if (operation === 'list') {
			qs.limit = Math.min(this.getNodeParameter('limit', i, 50) as number, 500);
			return listOf(await get(this, 'GET', '/rest/v1/registrations', qs, undefined, i), 'data');
		}
	}

	if (resource === 'fx' && operation === 'get') {
		const date = (this.getNodeParameter('date', i, '') as string).trim();
		const currency = (this.getNodeParameter('currency', i, '') as string).trim().toUpperCase();

		if (date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
			throw new NodeOperationError(this.getNode(), 'The date is written YYYY-MM-DD.', { itemIndex: i });
		}

		if (currency !== '' && !/^[A-Z]{3}$/.test(currency)) {
			throw new NodeOperationError(this.getNode(), 'A currency is written as its three letters, for example EUR.', { itemIndex: i });
		}

		// The API answers with every currency of the day: one of them is
		// picked here.
		const answer = await get(this, 'GET', date === '' ? '/rest/v1/fx/latest' : `/rest/v1/fx/${date}`, {}, undefined, i);
		if (currency === '') return [answer];

		const rates = (answer.rates ?? {}) as IDataObject;
		const rate = rates[currency] as IDataObject | undefined;

		if (rate === undefined) {
			throw new NodeOperationError(this.getNode(), `BNR publishes no reference rate for ${currency}.`, { itemIndex: i });
		}

		const day: IDataObject = { ...answer };
		delete day.rates;

		return [{ ...day, currency, ...rate }];
	}

	throw new NodeOperationError(this.getNode(), `Not an operation of this node: ${resource} / ${operation}.`, { itemIndex: i });
}
