import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';

import { NodeConnectionTypes } from 'n8n-workflow';

import { get } from './shared';

// How many pages one poll reads at most: what is left comes with the next.
const PAGES = 10;

export class ApifirmeTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'apifirme Trigger',
		name: 'apifirmeTrigger',
		icon: { light: 'file:apifirme.svg', dark: 'file:apifirme.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts a workflow for each newly registered Romanian company, or each change at a company you watch',
		defaults: { name: 'apifirme Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'apifirmeApi', required: true }],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Watched Company Changed',
						value: 'watchedChange',
						description: 'VAT, inactivity, strike-off, name, address at a company on your watch list. Each change costs a request.',
					},
					{
						name: 'New Company Registered',
						value: 'newCompany',
						description: 'Each newly registered company that matches the filters. On the plans that include the list.',
					},
				],
				default: 'watchedChange',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { event: ['newCompany'] } },
				options: [
					{ displayName: 'Activity Code Begins With', name: 'caen_prefix', type: 'string', default: '', placeholder: '62' },
					{ displayName: 'Counties', name: 'judet', type: 'string', default: '', placeholder: 'SB,B' },
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
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const event = this.getNodeParameter('event') as string;
		const state = this.getWorkflowStaticData('node') as { cursor?: string; event?: string };
		const manual = this.getMode() === 'manual';

		// Another event than the one the position was kept for: start again.
		if (state.event !== event) {
			delete state.cursor;
			state.event = event;
		}

		const found = event === 'newCompany' ? await newCompanies.call(this, state, manual) : await changes.call(this, state, manual);

		return found.length > 0 ? [this.helpers.returnJsonArray(found)] : null;
	}
}

/**
 * The changes at the watched companies after the kept position. The first
 * run brings what changed since each company was put on the list.
 */
async function changes(this: IPollFunctions, state: { cursor?: string }, manual: boolean): Promise<IDataObject[]> {
	const found: IDataObject[] = [];
	// A test run reads from the list's beginning: after the kept position a
	// workflow that has run would mostly show nothing to map fields from.
	let cursor = manual ? undefined : state.cursor;

	for (let page = 0; page < PAGES; page++) {
		const qs: IDataObject = { limit: manual ? 5 : 100 };
		if (cursor !== undefined) qs.after = cursor;

		const answer = await get(this, 'GET', '/rest/v1/watchlist/events', qs);
		found.push(...((answer.data as IDataObject[]) ?? []));
		cursor = answer.next_cursor as string;

		if (manual || answer.more !== true) break;
	}

	// A test run shows a sample and keeps no position.
	if (!manual) state.cursor = cursor;

	return found;
}

/**
 * The companies indexed after the kept position. The first run only finds
 * where the list ends today, so that a workflow switched on does not start
 * for every company of the last week; a test run shows a few of the latest.
 */
async function newCompanies(this: IPollFunctions, state: { cursor?: string }, manual: boolean): Promise<IDataObject[]> {
	const filters: IDataObject = { ...(this.getNodeParameter('filters', {}) as IDataObject) };
	for (const key of Object.keys(filters)) if (filters[key] === '') delete filters[key];

	if (manual) {
		const answer = await get(this, 'GET', '/rest/v1/registrations', { ...filters, days: 7, limit: 3 });
		return (answer.data as IDataObject[]) ?? [];
	}

	const first = state.cursor === undefined;
	const found: IDataObject[] = [];
	let cursor = state.cursor;

	for (let page = 0; page < PAGES; page++) {
		// A company registered days ago can be indexed today: the window is
		// wider than the time between two polls.
		const qs: IDataObject = { ...filters, days: first ? 1 : 7, limit: 500 };
		if (cursor !== undefined) qs.cursor = cursor;

		const answer = await get(this, 'GET', '/rest/v1/registrations', qs);
		if (!first) found.push(...((answer.data as IDataObject[]) ?? []));
		cursor = answer.next_cursor as string;

		if (answer.more !== true) break;
	}

	state.cursor = cursor;

	return found;
}
