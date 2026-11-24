import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ApifirmeApi implements ICredentialType {
	name = 'apifirmeApi';

	displayName = 'Apifirme API';

	icon = {
		light: 'file:../nodes/Apifirme/apifirme.svg',
		dark: 'file:../nodes/Apifirme/apifirme.dark.svg',
	} as const;

	documentationUrl = 'https://apifirme.dev/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'A key from your account at apifirme.dev. It starts with af_live_.',
		},
		{
			displayName: 'API Address',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.apifirme.dev',
			description: 'Leave as it is unless you were given another address',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
				'x-apifirme-client': 'n8n-0.1.2',
			},
		},
	};

	// Costs one request of the month's: there is no free address that needs a key.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/rest/v1/watchlist',
			qs: { limit: 1 },
		},
	};
}
